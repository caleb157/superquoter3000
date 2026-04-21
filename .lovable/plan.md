

## Logo not rendering well — switch to a clean PNG with proper treatment

The current `src/assets/dkt-logo.png` is being rendered at 28×28 with `dark:invert`, which mangles colored/multi-tone logos and shows artifacts on light backgrounds. Two things to fix: the **asset itself**, and **how it's displayed**.

### What I'll change

**1. Replace the logo asset**
Re-import the uploaded image as a fresh PNG at `src/assets/dkt-logo.png`, trimmed of whitespace and exported at 512×512 with a transparent background so it scales crisply at any size (header 28px, mobile drawer 28px, future use up to 96px).

**2. Remove the `dark:invert` hack**
`dark:invert` only works for pure black/white marks. For a colored logo it produces washed-out or wrong-colored output. Replace with a logo that already reads well on both light and dark surfaces, OR wrap it in a small rounded tile so the background is consistent regardless of theme.

**3. Display treatment in the header**
In `src/components/AppLayout.tsx`, render the logo inside a subtle rounded container so it always sits on a predictable backdrop:

```text
[ ▢ logo ]  DKT Costing
```

- Container: `h-8 w-8 rounded-lg bg-white dark:bg-white/10 flex items-center justify-center overflow-hidden`
- Image: `h-6 w-6 object-contain` (no invert)
- Same treatment in the mobile sheet drawer

This guarantees the logo never blends into the header background and never gets color-inverted.

**4. Regenerate PWA icons**
Re-run icon generation from the cleaned-up source so `public/icon-192.png`, `public/icon-512.png`, and `public/favicon.ico` all match the new logo. PWA icons get a solid background tile baked in (required by `maskable` icon spec) — that's what makes them look sharp on iOS/Android home screens.

### Files touched

- `src/assets/dkt-logo.png` — replaced (cleaned, transparent, 512×512)
- `src/components/AppLayout.tsx` — wrap header + drawer logo in a rounded tile, drop `dark:invert`
- `public/icon-192.png`, `public/icon-512.png`, `public/favicon.ico` — regenerated

### Note on PNG vs SVG

PNG is fine here — yours already is one. SVG would be sharper at every size but requires a vector source file (which we don't have; the upload is raster). If you ever export the logo as SVG from the original design tool, we can swap it in for perfect crispness. For now, a clean 512px PNG + the rounded-tile treatment will look noticeably better than the current rendering.

### Verification

- Header logo looks crisp on both light and dark mode at desktop and mobile widths
- Browser tab favicon updates (hard refresh)
- "Add to home screen" on mobile shows the new icon

