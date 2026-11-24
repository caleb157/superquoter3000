import { describe, expect, it } from "vitest";
import {
  claudePace, creditsByTool, funnelWeekAgo, istWeekStart, nextCronRun, prevCronRun, runBoard, tasksDue, weekOverWeek, weekTargets,
  type CcSchedule,
} from "../command-center";

// Tuesday 24 Nov 2026, 9:15 AM IST.
const NOW = new Date("2026-11-24T03:45:00Z");

describe("cron in IST", () => {
  it("finds the next and previous weekday fire", () => {
    expect(nextCronRun("44 9 * * 1-5", NOW)?.toISOString()).toBe("2026-11-24T04:14:00.000Z");
    expect(prevCronRun("44 9 * * 1-5", NOW)?.toISOString()).toBe("2026-11-23T04:14:00.000Z");
    expect(nextCronRun("CRON_TZ=Asia/Kolkata 22 19 * * 1-5", NOW)?.toISOString()).toBe("2026-11-24T13:52:00.000Z");
  });
  it("takes the soonest of several expressions", () => {
    expect(nextCronRun("44 9 * * 1-5; 58 15 * * 1-5", new Date("2026-11-24T05:00:00Z"))?.toISOString()).toBe("2026-11-24T10:28:00.000Z");
  });
  it("reads day-of-month plus weekday as the first Monday", () => {
    expect(nextCronRun("17 10 1-7 * 1", NOW)?.toISOString()).toBe("2026-12-07T04:47:00.000Z");
    expect(nextCronRun("51 8 * * 1", NOW)?.toISOString()).toBe("2026-11-30T03:21:00.000Z");
  });
  it("starts weeks on Monday in IST", () => {
    expect(istWeekStart(NOW).toISOString()).toBe("2026-11-22T18:30:00.000Z");
  });
});

describe("week over week", () => {
  const pipeline = new Set(["a", "b", "c"]);
  const touches = [
    { customer_id: "a", channel: "linkedin", direction: "out" as const, occurred_at: "2026-11-23T05:00:00Z" },
    { customer_id: "a", channel: "email", direction: "out" as const, occurred_at: "2026-11-23T06:00:00Z", bounced_at: "2026-11-23T06:05:00Z" },
    { customer_id: "b", channel: "email", direction: "out" as const, occurred_at: "2026-11-23T07:00:00Z" },
    { customer_id: "b", channel: "email", direction: "out" as const, occurred_at: "2026-11-23T08:00:00Z", is_drip: true },
    { customer_id: "b", channel: "linkedin", direction: "in" as const, occurred_at: "2026-11-23T09:00:00Z" },
    { customer_id: "c", channel: "meeting", direction: "in" as const, occurred_at: "2026-11-17T09:00:00Z" },
    { customer_id: "c", channel: "linkedin", direction: "out" as const, occurred_at: "2026-11-16T05:00:00Z" },
    { customer_id: "c", channel: "linkedin", direction: "out" as const, occurred_at: "2026-11-20T05:00:00Z" },
  ];
  const events = [
    { customer_id: "b", from_stage: "in_outreach", to_stage: "responded", occurred_at: "2026-11-23T09:00:00Z" },
    { customer_id: "c", from_stage: "inquiry", to_stage: "customer", occurred_at: "2026-11-18T09:00:00Z" },
  ];
  const inquiries = [{ id: "q1", customer_id: "a", received_date: "2026-11-24" }, { id: "q2", customer_id: "zz", received_date: "2026-11-24" }];
  const w = weekOverWeek(touches, events, inquiries, pipeline, NOW);

  it("counts this week's sends without drip and the bounce rate", () => {
    expect(w.thisWeek).toMatchObject({ linkedin: 1, email: 2, bounces: 1, bounceRate: 0.5, replies: 1, newResponded: 1, inquiries: 1, customers: 0 });
  });
  it("compares with last week at the same point and all of last week", () => {
    expect(w.lastWeekSamePoint).toMatchObject({ linkedin: 1, meetings: 0, customers: 0 });
    expect(w.lastWeek).toMatchObject({ linkedin: 2, meetings: 1, replies: 1, customers: 1 });
  });
  it("knows the week's targets", () => {
    const t = weekTargets(NOW);
    expect(t.linkedin).toMatchObject({ daily: 35, week: 175, dueSoFar: 70 });
    expect(t.email).toMatchObject({ daily: 8, dueSoFar: 16 });
  });
});

describe("funnel a week ago", () => {
  it("rolls back stage moves made in the last 7 days", () => {
    const accounts = [{ id: "a", sales_stage: "responded" }, { id: "b", sales_stage: "customer" }, { id: "c", sales_stage: "queued" }];
    const events = [
      { customer_id: "a", from_stage: "in_outreach", to_stage: "responded", occurred_at: "2026-11-23T00:00:00Z" },
      { customer_id: "b", from_stage: "inquiry", to_stage: "customer", occurred_at: "2026-11-10T00:00:00Z" },
      { customer_id: "c", from_stage: null, to_stage: "queued", occurred_at: "2026-11-22T00:00:00Z" },
    ];
    const f = Object.fromEntries(funnelWeekAgo(accounts, events, NOW).map(r => [r.stage, r]));
    expect(f.responded).toMatchObject({ now: 1, weekAgo: 0, change: 1 });
    expect(f.in_outreach).toMatchObject({ now: 0, weekAgo: 1, change: -1 });
    expect(f.queued).toMatchObject({ now: 1, weekAgo: 0 });
    expect(f.customer).toMatchObject({ now: 1, weekAgo: 1, change: 0 });
  });
  it("marks bulk loads, and leaves them out of new responders", () => {
    const ev = [{ customer_id: "a", from_stage: null, to_stage: "responded", occurred_at: "2026-11-23T10:00:00Z", actor: "crm-load" }];
    const f = Object.fromEntries(funnelWeekAgo([{ id: "a", sales_stage: "responded" }], ev, NOW).map(r => [r.stage, r]));
    expect(f.responded).toMatchObject({ change: 1, loaded: 1 });
    expect(weekOverWeek([], ev, [], new Set(["a"]), NOW).thisWeek.newResponded).toBe(0);
  });
});

describe("runs board", () => {
  const s = (x: Partial<CcSchedule>): CcSchedule => ({ id: "x", job: "x", name: "X", cadence: "", cron: null, status: "live", sort_order: 1, ...x });
  it("flags a run that was due and logged nothing, and sorts by next fire", () => {
    const rows = runBoard([
      s({ id: "daily-send", job: "daily-send", cron: "22 19 * * 1-5", last_fired_at: "2026-11-23T13:53:27Z" }),
      s({ id: "watchdog", job: "crm-watchdog", cron: "44 9 * * 1-5; 58 15 * * 1-5" }),
      s({ id: "faire", job: "list-building", run_once_at: "2026-11-24T11:37:00Z" }),
    ], [{ job: "crm-watchdog", status: "ok", started_at: "2026-11-23T10:30:00Z", credits: { firecrawl: 4 }, cost_usd: 0.1 }], NOW);
    expect(rows.map(r => r.id)).toEqual(["watchdog", "faire", "daily-send"]);
    const send = rows.find(r => r.id === "daily-send")!;
    expect(send.state).toBe("no_report");
    expect(send.stateNote).toMatch(/Fired/);
    const wd = rows.find(r => r.id === "watchdog")!;
    expect(wd.state).toBe("ok");
    expect(wd.creditsWeek).toEqual({ firecrawl: 4 });
    expect(rows.find(r => r.id === "faire")!.state).toBe("upcoming");
  });
  it("does not count fires from before the run was set up", () => {
    const [r] = runBoard([s({ cron: "33 11 * * 3", live_since: "2026-11-23T12:13:38Z" })], [], NOW);
    expect(r.state).toBe("upcoming");
  });
  it("shows a failed last run", () => {
    const [r] = runBoard([s({ cron: "44 9 * * 1-5" })], [{ job: "x", status: "failed", started_at: "2026-11-23T04:15:00Z", summary: "Chrome not reachable" }], NOW);
    expect(r.state).toBe("failed");
    expect(r.stateNote).toBe("Chrome not reachable");
  });
});

describe("usage", () => {
  it("projects the Claude weekly % at reset from the current pace", () => {
    const p = claudePace({ taken_at: "2026-11-24T03:00:00Z", source: "claude", metric: "weekly_pct", value: 62, resets_at: "2026-11-25T03:00:00Z" }, NOW)!;
    expect(Math.round(p.elapsed * 100)).toBe(86);
    expect(p.projected).toBe(72);
  });
  it("sums credits per tool this week and last", () => {
    const c = creditsByTool([
      { job: "a", status: "ok", started_at: "2026-11-23T05:00:00Z", credits: { firecrawl: 10, reoon: 2 }, cost_usd: 0.5 },
      { job: "a", status: "ok", started_at: "2026-11-18T05:00:00Z", credits: { firecrawl: 3 }, cost_usd: "0.25" },
    ], NOW);
    expect(c.tools[0]).toEqual({ tool: "firecrawl", thisWeek: 10, lastWeek: 3 });
    expect(c.costThis).toBe(0.5);
    expect(c.costLast).toBe(0.25);
  });
});

describe("tasks due", () => {
  it("splits overdue, today and the week for one assignee", () => {
    const t = tasksDue([
      { id: "1", title: "Old", due_date: "2026-11-19", status: "open", assignee: "CQ" },
      { id: "2", title: "Sales · CRM: review", due_date: "2026-11-24", status: "open", assignee: "CQ" },
      { id: "3", title: "Urgent", due_date: "2026-11-24", status: "open", assignee: "CQ", priority: "urgent" },
      { id: "4", title: "Parker", due_date: "2026-11-24", status: "open", assignee: "PH" },
      { id: "5", title: "Later", due_date: "2026-11-27", status: "open", assignee: "CQ" },
      { id: "6", title: "Done", due_date: "2026-11-20", status: "done", assignee: "CQ" },
    ], NOW, "CQ");
    expect(t.overdue.map(x => x.id)).toEqual(["1"]);
    expect(t.today.map(x => x.id)).toEqual(["3", "2"]);
    expect(t.week.map(x => x.id)).toEqual(["5"]);
    expect(t.isSales(t.today[1])).toBe(true);
  });
});
