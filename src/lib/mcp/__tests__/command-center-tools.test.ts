import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FakeDb, schemaColumns } from "./fake-db";
import { TOOLS } from "../index";
import { getSalesOverview, logUsage, markBounced, syncSchedules } from "../command-center";

const types = readFileSync(path.resolve(__dirname, "../../../integrations/supabase/types.ts"), "utf8");
const FAKE_KEYS = new Set(["id", "created_at"]);
const keysOk = (table: string, row: Record<string, unknown>) => {
  const have = schemaColumns(types, table);
  return Object.keys(row).filter(k => !FAKE_KEYS.has(k) && !have.has(k));
};

const ACME = "00000000-0000-4000-8000-00000000a001";
const ANN = "00000000-0000-4000-8000-00000000c001";
const recent = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const seed = () => new FakeDb({
  customers: [{ id: ACME, name: "Acme Decor", company: "Acme Decor", sales_stage: "responded", fit_score: 80 }],
  contacts: [{ id: ANN, customer_id: ACME, full_name: "Ann Buyer", email: "ann@acmedecor.com", never_email: false }],
  sales_touches: [
    { id: "t1", customer_id: ACME, contact_id: ANN, channel: "email", direction: "out", occurred_at: recent(2), external_id: "m-1", is_drip: false, bounced_at: null },
  ],
  sales_stage_events: [],
  customer_rfqs: [],
  sales_schedules: [{ id: "daily-send", job: "daily-send", name: "Daily send", cadence: "Mon-Fri 19:22 IST", cron: "22 19 * * 1-5", status: "live", sort_order: 20 }],
  job_runs: [],
  usage_snapshots: [],
  tasks: [{ id: "k1", title: "Sales · CRM: review", due_date: "2020-01-01", status: "open", assignee: "CQ" }],
});

describe("command center tools", () => {
  it("registers four tools with unique names", () => {
    const names = TOOLS.map(t => t.name);
    for (const n of ["get_sales_overview", "log_usage", "sync_schedules", "mark_bounced"]) expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it("logs usage readings with real columns, dry run writes nothing", async () => {
    const db = seed();
    const dry = await logUsage(db, { readings: [{ source: "Claude", metric: "weekly_pct", value: 62, unit: "pct", resets_at: "2026-11-25T03:00:00Z", plan: "Max 5x" }], dry_run: true });
    expect(db.writes).toEqual([]);
    expect(dry.rows[0]).toMatchObject({ source: "claude", metric: "weekly_pct", value: 62 });
    await logUsage(db, { readings: [{ source: "firecrawl", metric: "credits_left", value: 1200 }], logged_by: "usage-snapshot" });
    const row = db.writesTo("usage_snapshots", "insert")[0].rows![0];
    expect(keysOk("usage_snapshots", row)).toEqual([]);
    await expect(logUsage(db, { readings: [{ source: "x", metric: "y", value: Number.NaN }] })).rejects.toThrow(/number/);
  });

  it("syncs schedules: updates by id, adds new ones only with job, name and cadence", async () => {
    const db = seed();
    const r = await syncSchedules(db, { schedules: [
      { id: "daily-send", last_fired_at: "2026-11-23T13:53:27Z", last_fire_status: "delivered", next_run_at: "2026-11-24T13:52:00Z" },
      { id: "usage-snapshot", job: "usage-snapshot", name: "Daily usage snapshot", cadence: "Daily 21:47 IST", cron: "47 21 * * *" },
    ] });
    expect(r).toMatchObject({ added: ["usage-snapshot"], updated: ["daily-send"] });
    for (const w of db.writes) {
      const row = w.op === "insert" ? w.rows![0] : w.patch!;
      expect(keysOk("sales_schedules", row)).toEqual([]);
    }
    expect(db.rows("sales_schedules").find((s: any) => s.id === "daily-send").last_fired_at).toBe("2026-11-23T13:53:27.000Z");
    await expect(syncSchedules(seed(), { schedules: [{ id: "new-one" }] })).rejects.toThrow(/needs job, name and cadence/);
  });

  it("marks a bounce on the latest email and sets never-email on a hard bounce", async () => {
    const db = seed();
    const dry = await markBounced(db, { email: "ANN@acmedecor.com", dry_run: true });
    expect(dry).toMatchObject({ touch_id: "t1", sets_never_email: true });
    expect(db.writes).toEqual([]);
    await markBounced(db, { touch_external_id: "m-1" });
    expect(db.rows("sales_touches")[0].bounced_at).toBeTruthy();
    expect(db.rows("contacts")[0].never_email).toBe(true);
    for (const w of db.writes) expect(keysOk(w.table, w.patch!)).toEqual([]);
  });

  it("reads the overview: sends this week, the run board and Caleb's overdue tasks", async () => {
    const r = await getSalesOverview(seed());
    expect(r.this_week.email).toBeGreaterThanOrEqual(0);
    expect(r.runs.map(x => x.id)).toEqual(["daily-send"]);
    expect(r.tasks.overdue.map(t => t.id)).toEqual(["k1"]);
    expect(r.funnel.find(f => f.stage === "responded")?.now).toBe(1);
  });
});
