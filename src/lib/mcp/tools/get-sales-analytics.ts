import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, ok, todayInIndia, withUserDb, type Db } from "../shared";
import {
  buildPipeline, confirmedOrdersKpi, fyBounds, mfgShareOf, pickAmt,
  type Ccy, type PipelineInquiry, type PipelineOpts, type Snapshot,
} from "../../master-analytics";
import { getProjectionDefaults, setProjectionDefaults } from "../../projections";
import { applyLiveRates } from "../../live-rates";

// Read-only: the Analytics page's revenue numbers (Projections zone, "Projected revenue · FY"),
// split by month, quarter and financial year, and by trading vs manufacturing.
// Actuals come from the latest analytics_snapshots row, exactly as the page reads them.
// Pipeline is rebuilt with the page's own buildPipeline; the one difference is that each open
// inquiry's FOB, GPM and man-hours come from the price, cost and man-hours saved on its products
// (the costing cache) instead of a fresh run of the costing engine in the browser.

const PAGE = 1000;
const OPEN_EXCLUDED = ["po", "complete", "cancelled", "paused"];

export type Split = { total: number; manufacturing: number | null; trading: number | null };
export type MonthRow = {
  month: string;
  /** Invoiced in Odoo this month (real sales). */
  actual: Split;
  /** Booked SOs not yet invoiced, by expected date; overdue ones count in the current month. */
  booked: Split;
  /** Open inquiries, weighted by likelihood, by shipping month. */
  pipeline: Split;
  /** booked + pipeline (pipeline only when include_pipeline). */
  projected: Split;
  /** actual + projected. */
  total: Split;
  /** Odoo SOs confirmed this month worth at least $100, like the Confirmed SOs KPI. */
  confirmed_orders: { count: number; amount: number };
};
export type Bucket = Omit<MonthRow, "month"> & { label: string; start: string; end: string };

type Input = { currency?: Ccy; include_pipeline?: boolean; include_inquiries?: boolean };

const zero = (): Split => ({ total: 0, manufacturing: 0, trading: 0 });
const add = (s: Split, amount: number, mfgShare: number | null) => {
  s.total += amount;
  if (mfgShare == null || s.manufacturing == null || s.trading == null) { s.manufacturing = null; s.trading = null; return; }
  s.manufacturing += amount * mfgShare;
  s.trading += amount * (1 - mfgShare);
};
const sum = (a: Split, b: Split): Split => ({
  total: a.total + b.total,
  manufacturing: a.manufacturing == null || b.manufacturing == null ? null : a.manufacturing + b.manufacturing,
  trading: a.trading == null || b.trading == null ? null : a.trading + b.trading,
});
const round = (s: Split): Split => ({
  total: Math.round(s.total),
  manufacturing: s.manufacturing == null ? null : Math.round(s.manufacturing),
  trading: s.trading == null ? null : Math.round(s.trading),
});

function fyMonths(fyStart: string): string[] {
  const y = Number(fyStart.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, 3 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}
const monthEnd = (ym: string) => {
  const d = new Date(`${ym}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

async function pageAll(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string) {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (check(await build(from, from + PAGE - 1), what) ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** FOB, GPM and man-hours per inquiry from the price, cost and man-hours saved on its products. */
async function savedInquiryFinancials(db: Db, ids: string[]) {
  const out: PipelineOpts["live"] = {};
  if (!ids.length) return out;
  const products: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const read = (cols: string) => pageAll(
      (a, b) => db.from("products").select(cols).in("customer_rfq_id", chunk).is("archived_at", null).order("id").range(a, b),
      "Could not read inquiry products",
    );
    const base = "id, customer_rfq_id, quantity, calculated_unit_price_usd, calculated_unit_cost_usd";
    try {
      products.push(...await read(`${base}, calculated_man_hours_per_unit`));
    } catch (e) {
      // Databases without the saved man-hours column yet: read the rest.
      if (!String((e as Error).message).includes("calculated_man_hours_per_unit")) throw e;
      products.push(...await read(base));
    }
  }
  const cost: Record<string, number> = {};
  for (const p of products) {
    const id = String(p.customer_rfq_id);
    const q = Number(p.quantity) || 0;
    const o = (out[id] ||= { fob_usd: 0, gpm: 0, man_hours: 0 });
    o.fob_usd += (Number(p.calculated_unit_price_usd) || 0) * q;
    o.man_hours += (Number(p.calculated_man_hours_per_unit) || 0) * q;
    cost[id] = (cost[id] || 0) + (Number(p.calculated_unit_cost_usd) || 0) * q;
  }
  for (const [id, o] of Object.entries(out)) o.gpm = o.fob_usd > 0 ? (o.fob_usd - (cost[id] || 0)) / o.fob_usd : 0;
  return out;
}

export async function getSalesAnalytics(db: Db, input: Input, now = new Date()) {
  const ccy: Ccy = input.currency === "INR" ? "INR" : "USD";
  const includePipeline = input.include_pipeline !== false;
  const notes: string[] = [];

  const snapRow = check(
    await db.from("analytics_snapshots").select("payload, synced_at").order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    "Could not read the analytics snapshot",
  ) as { payload: Snapshot; synced_at: string } | null;
  const snapshot = snapRow?.payload ?? null;
  if (!snapshot) notes.push("No Odoo sync yet: actual and booked sales are empty. Press Refresh Odoo & LaborTrax on the Analytics page.");

  const gs = check(await db.from("global_settings").select("*").limit(1).maybeSingle(), "Could not read settings") as Record<string, unknown> | null;
  if (gs) setProjectionDefaults({
    certainty: Number(gs.default_certainty_pct ?? 0.3),
    repeatCertainty: Number(gs.default_repeat_certainty_pct ?? 0.8),
    custDeposit: Number(gs.default_cust_deposit_pct ?? 0.3),
    ieDeposit: Number(gs.default_ie_deposit_pct ?? 0.8),
    vendorDeposit: Number(gs.default_vendor_deposit_pct ?? 0.5),
  });
  const hqRate = Number(applyLiveRates(gs ?? {}).exchange_rate) || snapshot?.inr_per_usd || 0;
  if (ccy === "INR" && !hqRate) notes.push("No INR rate found: pipeline amounts in INR are 0.");
  const usdToCcy = (usd: number) => (ccy === "USD" ? usd : usd * hqRate);

  // Same "today" as the page: the snapshot's sync day.
  const today = snapshot?.today ?? todayInIndia(now);
  const fy = fyBounds(today);
  const months = fyMonths(fy.start);
  const thisMonth = today.slice(0, 7);

  // ---- Pipeline, as ProjectionsZone builds it ----
  let pipe: PipelineInquiry[] = [];
  if (includePipeline || input.include_inquiries) {
    const [inquiries, entities] = await Promise.all([
      pageAll((a, b) => db.from("customer_rfqs").select("id, rfq_number, title, status, customers(name), inquiry_projections(*)").order("id").range(a, b), "Could not read inquiries"),
      db.from("company_entities").select("id, name, entity_type"),
    ]);
    const ents = (check(entities, "Could not read company entities") ?? []) as { id: string; name: string | null; entity_type: string | null }[];
    const pv = ents.find(e => /parable/i.test(e.name || "") || e.entity_type === "India");
    const open = inquiries.filter(i => !OPEN_EXCLUDED.includes(String(i.status)));
    const live = await savedInquiryFinancials(db, open.map(i => String(i.id)));
    pipe = buildPipeline(open, { today, pvEntityId: pv?.id ?? null, defaults: getProjectionDefaults(), live });
  }
  // FY pipeline = shipping month from this month to FY end (earlier months drop out, like the page).
  const pipeIn = pipe.filter(x => { const m = (x.revenue_month || "").slice(0, 10); return !!m && m.slice(0, 7) >= thisMonth && m <= fy.end; });

  // ---- Month rows ----
  const hasKinds = !!snapshot && [...snapshot.invoiced, ...snapshot.pending_so_revenue].some(x => x.kind !== undefined);
  if (snapshot && !hasKinds) notes.push("This Odoo sync predates the Trading / Manufacturing tags: the split is null until the next refresh.");
  const rows: Record<string, MonthRow> = {};
  for (const m of months) {
    rows[m] = { month: m, actual: zero(), booked: zero(), pipeline: zero(), projected: zero(), total: zero(), confirmed_orders: { count: 0, amount: 0 } };
    if (!hasKinds) for (const k of ["actual", "booked"] as const) { rows[m][k].manufacturing = null; rows[m][k].trading = null; }
  }
  let untagged = 0;
  if (snapshot) {
    for (const i of snapshot.invoiced) {
      if (!i.date || i.date < fy.start || i.date > today) continue;
      const r = rows[i.date.slice(0, 7)]; if (!r) continue;
      add(r.actual, pickAmt(i, ccy), hasKinds ? mfgShareOf(i) : null);
      if (i.kind !== undefined && !i.tagged) untagged++;
    }
    for (const s of snapshot.pending_so_revenue) {
      if (s.date > fy.end) continue;
      const m = s.date.slice(0, 7) < thisMonth ? thisMonth : s.date.slice(0, 7);
      const r = rows[m]; if (!r) continue;
      add(r.booked, pickAmt(s, ccy), hasKinds ? mfgShareOf(s) : null);
      if (s.kind !== undefined && !s.tagged) untagged++;
    }
    const orders = confirmedOrdersKpi(snapshot.sales_orders, new Date(`${fy.start}T00:00:00`), new Date(`${fy.end}T23:59:59`), snapshot.inr_per_usd).qualifying;
    for (const o of orders) {
      const r = rows[String(o.date_order).slice(0, 7)]; if (!r) continue;
      r.confirmed_orders.count++; r.confirmed_orders.amount += pickAmt(o, ccy);
    }
  }
  for (const x of pipeIn) {
    const r = rows[(x.revenue_month as string).slice(0, 7)]; if (!r) continue;
    add(r.pipeline, usdToCcy(x.pv_revenue_usd * x.certainty), x.kind === "manufacturing" ? 1 : 0);
  }
  for (const r of Object.values(rows)) {
    r.projected = includePipeline ? sum(r.booked, r.pipeline) : { ...r.booked };
    r.total = sum(r.actual, r.projected);
  }

  const bucket = (label: string, ms: string[]): Bucket => {
    const b: Bucket = { label, start: `${ms[0]}-01`, end: monthEnd(ms[ms.length - 1]), actual: zero(), booked: zero(), pipeline: zero(), projected: zero(), total: zero(), confirmed_orders: { count: 0, amount: 0 } };
    for (const m of ms) {
      const r = rows[m];
      for (const k of ["actual", "booked", "pipeline", "projected", "total"] as const) b[k] = sum(b[k], r[k]);
      b.confirmed_orders.count += r.confirmed_orders.count; b.confirmed_orders.amount += r.confirmed_orders.amount;
    }
    return b;
  };
  const quarters = [0, 1, 2, 3].map(q => bucket(`Q${q + 1} ${fy.label}`, months.slice(q * 3, q * 3 + 3)));
  const currentQuarter = quarters[Math.floor(months.indexOf(thisMonth) / 3)] ?? null;
  const year = bucket(fy.label, months);

  const roundRow = <T extends Omit<MonthRow, "month">>(r: T): T => ({
    ...r, actual: round(r.actual), booked: round(r.booked), pipeline: round(r.pipeline), projected: round(r.projected), total: round(r.total),
    confirmed_orders: { count: r.confirmed_orders.count, amount: Math.round(r.confirmed_orders.amount) },
  });

  const targets = (gs?.analytics_targets ?? null) as Record<string, number> | null;
  if (untagged) notes.push(`${untagged} invoice or SO entr${untagged === 1 ? "y has" : "ies have"} no Trading / Manufacturing tag in Odoo; the split guesses them from MOs, like the page.`);
  notes.push("Pipeline uses the price, cost and man-hours saved on each product. The page reruns costing live, so an inquiry whose costs or rates moved since it was last opened can differ slightly.");

  return {
    currency: ccy,
    as_of: today,
    synced_at: snapRow?.synced_at ?? null,
    financial_year: { label: fy.label, start: fy.start, end: fy.end },
    include_pipeline: includePipeline,
    inr_per_usd: { odoo: snapshot?.inr_per_usd ?? null, hq: hqRate || null },
    months: months.map(m => ({ month: m, ...roundRow(rows[m]) })),
    current_month: thisMonth,
    current_quarter: currentQuarter ? roundRow(currentQuarter) : null,
    quarters: quarters.map(roundRow),
    year: roundRow(year),
    targets: targets ? {
      revenue_usd_monthly: Number(targets.revenue_usd_monthly) || null,
      confirmed_sos_monthly: Number(targets.confirmed_sos_monthly) || null,
    } : null,
    ...(input.include_inquiries ? {
      pipeline_inquiries: pipeIn.map(x => ({
        id: x.id, rfq_number: x.rfq_number, customer: x.customer, status: x.status, kind: x.kind, kind_auto: x.kind_auto,
        certainty: x.certainty, shipping_month: x.revenue_month, fob_usd: Math.round(x.fob_usd),
        weighted: Math.round(usdToCcy(x.pv_revenue_usd * x.certainty)),
      })),
    } : {}),
    notes,
  };
}

export default defineTool({
  name: "get_sales_analytics",
  title: "Get sales analytics",
  description:
    "Read the Analytics page's revenue: real sales (invoiced in Odoo), booked SOs not yet invoiced, and open inquiries weighted by likelihood, " +
    "by month of the current financial year (April to March), with each quarter, the current quarter and the year, each split into trading and manufacturing. " +
    "Also confirmed SOs per month and the revenue targets set on the page. Actuals come from the last Odoo sync (synced_at). Read-only.",
  inputSchema: {
    currency: z.enum(["USD", "INR"]).optional().describe("Default USD."),
    include_pipeline: z.boolean().optional().describe("Count weighted open inquiries in projected and total (default true, like the page's switch)."),
    include_inquiries: z.boolean().optional().describe("Also list the pipeline inquiries behind the numbers."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: Input) => {
    const out = await getSalesAnalytics(db, input);
    return ok(JSON.stringify(out), out as Record<string, unknown>);
  }),
});
