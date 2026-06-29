import asyncio, json, os, re, time
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path(__file__).parent / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
PRODUCT_ID = "17409610-3bcb-4fbc-932d-83a03d7a5dfc"  # Wooden Acacia Plate (ic_only)
BASE = "http://localhost:8080"
DEBOUNCE_MS = 600
MAX_REACT_MS = 300  # well under debounce — header must update via render, not persist

def parse_usd(text: str) -> float:
    m = re.search(r"\$\s*([\d,]+\.\d+)", text)
    assert m, f"no USD price in: {text!r}"
    return float(m.group(1).replace(",", ""))

async def read_header_price(page) -> float:
    label = page.locator('text="Unit Price"').first
    await label.wait_for(state="visible", timeout=15000)
    container = label.locator("xpath=..")
    return parse_usd(await container.inner_text())

async def wait_header_price_change(page, prev: float, budget_ms: int):
    deadline = time.monotonic() + budget_ms / 1000
    last = prev
    while time.monotonic() < deadline:
        try:
            cur = await read_header_price(page)
        except Exception:
            cur = last
        if abs(cur - prev) > 1e-4:
            return cur
        last = cur
        await page.wait_for_timeout(20)
    raise AssertionError(f"header price did not change within {budget_ms}ms (still {last})")

async def open_product(page, pid: str):
    # Use client-side navigation to avoid the AuthProvider race on full reloads.
    # Warm a protected route first so roles are loaded.
    await page.goto(f"{BASE}/inquiries", wait_until="domcontentloaded")
    await page.wait_for_selector("text=Inquiries", timeout=15000)
    await page.wait_for_timeout(600)
    target = f"/product/{pid}"
    await page.evaluate(f"window.history.pushState({{}}, \"\", {json.dumps(target)}); window.dispatchEvent(new PopStateEvent(\"popstate\"));")
    await page.wait_for_selector('text="Unit Price"', timeout=20000)
    return
    # ProtectedRoute has a known race: `loading` flips false before roles load
    # on a fresh mount, so the first hit to a protected route after a reload
    # can bounce to /. Retry with backoff until the route sticks.
    for attempt in range(6):
        await page.goto(f"{BASE}/product/{pid}", wait_until="domcontentloaded")
        for _ in range(40):
            await page.wait_for_timeout(150)
            if f"/product/{pid}" in page.url:
                try:
                    await page.wait_for_selector('text="Unit Price"', timeout=8000)
                    return
                except Exception:
                    break
            if page.url.rstrip("/") in (BASE, f"{BASE}/login"):
                break
        await page.wait_for_timeout(500 * (attempt + 1))
    raise AssertionError(f"could not stay on /product/{pid} (ended at {page.url})")

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        page.on("console", lambda m: print(f"[{m.type}] {m.text[:200]}") if m.type == "error" else None)

        await page.goto(BASE, wait_until="domcontentloaded")
        sk = os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"]
        sj = os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"]
        await page.evaluate(f"window.localStorage.setItem({json.dumps(sk)}, {json.dumps(sj)})")

        await open_product(page, PRODUCT_ID)
        await page.screenshot(path=str(OUT / "1_loaded.png"))

        p0 = await read_header_price(page)
        print(f"[step 0] initial header price: ${p0}")

        # Switch to Costing tab.
        await page.get_by_role("tab", name=re.compile(r"^costing$", re.I)).click()
        await page.wait_for_selector('text="Packaging Type"', timeout=10000)
        await page.screenshot(path=str(OUT / "2_costing_tab.png"))

        # --- Edit 1: change Net Profit Margin % (input, blur to commit). ---
        npm_label = page.locator('label:has-text("Net Profit Margin")').first
        await npm_label.wait_for(state="visible", timeout=5000)
        npm_input = npm_label.locator("xpath=following::input[1]")
        cur = (await npm_input.input_value()).strip()
        new_val = "33.3" if cur != "33.3" else "27.7"
        print(f"[edit] NPM {cur!r} -> {new_val!r}")
        await npm_input.fill(new_val)
        await npm_input.blur()
        t0 = time.monotonic()
        p1 = await wait_header_price_change(page, p0, MAX_REACT_MS)
        dt1 = int((time.monotonic() - t0) * 1000)
        print(f"[assert] header updated to ${p1} in {dt1}ms (must be < debounce {DEBOUNCE_MS}ms)")
        assert dt1 < DEBOUNCE_MS, f"header took {dt1}ms — looks like it waited for debounce"
        await page.screenshot(path=str(OUT / "3_after_markup.png"))

        # --- Edit 2: click "Recalculate all auto costs". ---
        recost = page.get_by_role("button", name=re.compile(r"recalculate all auto", re.I))
        await recost.click()
        # Recost rewrites auto rows + flushes the cache immediately. The header
        # should always reflect the live engine — never the persisted cache.
        await page.wait_for_timeout(150)
        p2 = await read_header_price(page)
        print(f"[step 2] header after recost: ${p2}")
        await page.screenshot(path=str(OUT / "4_after_recost.png"))

        # --- Edit 3: toggle packaging type. ---
        pkg_label = page.locator('label:has-text("Packaging Type")').first
        pkg_trigger = pkg_label.locator("xpath=following::button[1]")
        cur_pkg = (await pkg_trigger.inner_text()).strip()
        print(f"[edit] packaging currently: {cur_pkg!r}")
        await pkg_trigger.click()
        target = "IC + MC" if "IC + MC" not in cur_pkg else "IC only"
        await page.get_by_role("option", name=re.compile(re.escape(target), re.I)).first.click()
        t0 = time.monotonic()
        p3 = await wait_header_price_change(page, p2, MAX_REACT_MS)
        dt3 = int((time.monotonic() - t0) * 1000)
        print(f"[assert] header updated to ${p3} after packaging→{target!r} in {dt3}ms")
        assert dt3 < DEBOUNCE_MS, f"packaging change took {dt3}ms — looks like it waited for debounce"
        await page.screenshot(path=str(OUT / "5_after_packaging.png"))

        # After the debounce + persist round-trip, the cached
        # calculated_unit_price_usd should catch up and the "Stale" badge — if
        # it appeared transiently — should disappear. (The badge is *expected*
        # right after an edit; what we're verifying is that the *header* never
        # waited for it and that the cache eventually reconciles.)
        await page.wait_for_timeout(DEBOUNCE_MS + 1500)
        stale = page.locator('text="Stale"')
        if await stale.count() and await stale.first.is_visible():
            raise AssertionError("Stale badge still visible after debounce+persist — cache failed to reconcile")

        # Restore product state for test idempotency.
        try:
            await npm_input.fill(cur); await npm_input.blur()
            await pkg_trigger.click()
            await page.get_by_role("option", name=re.compile(re.escape(cur_pkg), re.I)).first.click()
            await page.wait_for_timeout(DEBOUNCE_MS + 800)
        except Exception as e:
            print("[cleanup] non-fatal:", e)

        print("PASS — header reflects live engine within %dms (< debounce %dms) after each edit"
              % (MAX_REACT_MS, DEBOUNCE_MS))
        await browser.close()

asyncio.run(main())
