import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { FakeDb, schemaColumns } from "./fake-db";
import { getSalesAnalytics } from "../tools/get-sales-analytics";
import { TOOLS } from "../index";

const usd = (amount_usd: number) => ({ amount_usd, amount_inr: amount_usd * 80 });

function seed() {
  return new FakeDb({
    analytics_snapshots: [
      { id: "old", synced_at: "2026-11-01T00:00:00Z", payload: { today: "2026-11-01", invoiced: [], pending_so_revenue: [], sales_orders: [], inr_per_usd: 80 } },
      {
        id: "s1", synced_at: "2026-11-20T03:00:00Z",
        payload: {
          today: "2026-11-20", inr_per_usd: 80,
          invoiced: [
            { ref: "INV/1", partner: "CCT", date: "2026-05-10", kind: "manufacturing", tagged: true, ...usd(1000) },
            { ref: "INV/2", partner: "Luxe", date: "2026-11-02", kind: "trading", tagged: true, ...usd(400) },
            { ref: "INV/3", partner: "Mixed", date: "2026-11-05", kind: "manufacturing", mfg_share: 0.25, tagged: false, ...usd(800) },
            { ref: "INV/old", partner: "Old FY", date: "2026-03-30", kind: "trading", tagged: true, ...usd(999) },
          ],
          pending_so_revenue: [
            { ref: "SO/9", partner: "Late", date: "2026-10-01", kind: "trading", tagged: true, ...usd(300) },
            { ref: "SO/10", partner: "CCT", date: "2027-02-15", kind: "manufacturing", tagged: true, ...usd(700) },
            { ref: "SO/11", partner: "Next FY", date: "2027-05-01", kind: "trading", tagged: true, ...usd(5000) },
          ],
          sales_orders: [
            { name: "SO/10", date_order: "2026-11-03", ...usd(700) },
            { name: "SO/tiny", date_order: "2026-11-04", ...usd(50) },
          ],
        },
      },
    ],
    global_settings: [{ id: "g", exchange_rate: 83, live_exchange_rate: 84, default_certainty_pct: 0.3, analytics_targets: { revenue_usd_monthly: 250000, confirmed_sos_monthly: 15 } }],
    company_entities: [{ id: "pv", name: "Parable Ventures", entity_type: "India" }],
    customer_rfqs: [
      { id: "i1", rfq_number: "RFQ-1", title: "Tables", status: "active", customers: { name: "CCT" },
        inquiry_projections: [{ certainty_override: 0.5, order_kind: "manufacturing", shipping_month: "2027-01-01" }] },
      { id: "i2", rfq_number: "RFQ-2", title: "Planters", status: "active", customers: { name: "Luxe" },
        inquiry_projections: [{ shipping_month: "2026-12-01" }] },
      { id: "i3", rfq_number: "RFQ-3", title: "Past ship", status: "active", customers: null,
        inquiry_projections: [{ shipping_month: "2026-09-01" }] },
      { id: "i4", rfq_number: "RFQ-4", title: "Booked", status: "po", customers: null,
        inquiry_projections: [{ shipping_month: "2026-12-01" }] },
    ],
    products: [
      { id: "p1", customer_rfq_id: "i1", quantity: 10, calculated_unit_price_usd: 100, calculated_unit_cost_usd: 60, calculated_man_hours_per_unit: 2, archived_at: null },
      { id: "p2", customer_rfq_id: "i2", quantity: 20, calculated_unit_price_usd: 100, calculated_unit_cost_usd: 70, calculated_man_hours_per_unit: 0, archived_at: null },
      { id: "p3", customer_rfq_id: "i3", quantity: 1, calculated_unit_price_usd: 999, calculated_unit_cost_usd: 1, archived_at: null },
      { id: "p4", customer_rfq_id: "i4", quantity: 1, calculated_unit_price_usd: 999, calculated_unit_cost_usd: 1, archived_at: null },
      { id: "p5", customer_rfq_id: "i2", quantity: 5, calculated_unit_price_usd: 100, archived_at: "2026-11-01" },
    ],
  });
}

describe("get_sales_analytics", () => {
  it("is registered as a read-only tool", () => {
    const t: any = TOOLS.find((x: any) => x.name === "get_sales_analytics");
    expect(t.annotations.readOnlyHint).toBe(true);
  });

  it("reads only columns that exist", () => {
    const types = readFileSync(path.resolve(__dirname, "../../../integrations/supabase/types.ts"), "utf8");
    const have = schemaColumns(types, "products");
    for (const c of ["customer_rfq_id", "quantity", "calculated_unit_price_usd", "calculated_unit_cost_usd", "calculated_man_hours_per_unit", "archived_at"]) expect(have.has(c), c).toBe(true);
    expect(schemaColumns(types, "analytics_snapshots").has("synced_at")).toBe(true);
  });

  it("splits real, booked and weighted pipeline by month, quarter and FY, like the page", async () => {
    const db = seed();
    const r: any = await getSalesAnalytics(db, {});
    expect(db.writes).toEqual([]);
    expect(r.as_of).toBe("2026-11-20");
    expect(r.financial_year).toMatchObject({ start: "2026-04-01", end: "2027-03-31" });
    expect(r.months.map((m: any) => m.month)[0]).toBe("2026-04");
    expect(r.months).toHaveLength(12);

    const m = (k: string) => r.months.find((x: any) => x.month === k);
    expect(m("2026-05").actual).toEqual({ total: 1000, manufacturing: 1000, trading: 0 });
    // Nov: 400 trading + 800 mixed at 25% manufacturing; the overdue Oct SO rolls into this month.
    expect(m("2026-11").actual).toEqual({ total: 1200, manufacturing: 200, trading: 1000 });
    expect(m("2026-11").booked).toEqual({ total: 300, manufacturing: 0, trading: 300 });
    expect(m("2026-10").booked.total).toBe(0);
    expect(m("2026-11").confirmed_orders).toEqual({ count: 1, amount: 700 });
    // Pipeline: RFQ-1 $1000 at 50% (manufacturing) in Jan; RFQ-2 $2000 at the 30% default, no man-hours = trading, in Dec.
    expect(m("2027-01").pipeline).toEqual({ total: 500, manufacturing: 500, trading: 0 });
    expect(m("2026-12").pipeline).toEqual({ total: 600, manufacturing: 0, trading: 600 });
    expect(m("2027-02").projected.total).toBe(700);

    // FY = invoiced YTD + booked by FY end + weighted pipeline (the page's "Projected revenue" card).
    expect(r.year.actual.total).toBe(2200);
    expect(r.year.booked.total).toBe(1000);
    expect(r.year.pipeline.total).toBe(1100);
    expect(r.year.total).toEqual({ total: 4300, manufacturing: 1000 + 200 + 700 + 500, trading: 4300 - 2400 });

    expect(r.current_quarter.label).toBe("Q3 FY 26–27");
    expect(r.current_quarter).toMatchObject({ start: "2026-10-01", end: "2026-12-31" });
    expect(r.current_quarter.total.total).toBe(1200 + 300 + 600);
    expect(r.quarters.map((q: any) => q.total.total).reduce((a: number, b: number) => a + b, 0)).toBe(4300);
    expect(r.targets).toEqual({ revenue_usd_monthly: 250000, confirmed_sos_monthly: 15 });
    expect(r.notes.join(" ")).toMatch(/1 invoice or SO entry has no Trading/);
  });

  it("leaves pipeline out when asked, and converts pipeline to INR at the live HQ rate", async () => {
    const off: any = await getSalesAnalytics(seed(), { include_pipeline: false });
    expect(off.year.total.total).toBe(3200);
    const inr: any = await getSalesAnalytics(seed(), { currency: "INR", include_inquiries: true });
    expect(inr.year.pipeline.total).toBe(1100 * 84);
    expect(inr.year.actual.total).toBe(2200 * 80);
    expect(inr.pipeline_inquiries.map((x: any) => x.rfq_number).sort()).toEqual(["RFQ-1", "RFQ-2"]);
  });

  it("says when there is no sync and when the sync has no trading / manufacturing tags", async () => {
    const empty: any = await getSalesAnalytics(new FakeDb({}), {}, new Date("2026-11-20T06:00:00Z"));
    expect(empty.synced_at).toBeNull();
    expect(empty.year.total.total).toBe(0);
    expect(empty.notes[0]).toMatch(/No Odoo sync yet/);

    const db = seed();
    db.tables.analytics_snapshots[1].payload.invoiced.forEach((i: any) => { delete i.kind; delete i.mfg_share; delete i.tagged; });
    db.tables.analytics_snapshots[1].payload.pending_so_revenue.forEach((i: any) => { delete i.kind; delete i.tagged; });
    const old: any = await getSalesAnalytics(db, { include_pipeline: false });
    expect(old.year.actual).toEqual({ total: 2200, manufacturing: null, trading: null });
    expect(old.notes.join(" ")).toMatch(/predates the Trading/);
  });
});
