import { describe, expect, it } from "vitest";
import { applyDismissals, buildNeedsYou, groupByStage, summarizeJobs, type AccountRow } from "../needs-you";
import { dismissalEndedBy, isDismissalActive, SALES_STAGES } from "../sales-core";

const now = new Date("2026-11-23T10:00:00Z");
const acct = (id: string, stage: string, extra: Partial<AccountRow> = {}): AccountRow => ({ id, name: id, company: id, sales_stage: stage, dnc: false, ...extra });

describe("Needs you", () => {
  it("puts forgotten conversations first, then qualified, nudges and other due tasks; skips do not contact", () => {
    const accounts = [acct("A", "responded"), acct("B", "in_conversation"), acct("C", "in_outreach"), acct("D", "responded", { dnc: true }), acct("E", "inquiry", { next_step: "Send quote" })];
    const touches = [
      { customer_id: "A", direction: "in" as const, occurred_at: "2026-11-17T08:00:00Z", channel: "linkedin", body: "Send prices?" },
      { customer_id: "D", direction: "in" as const, occurred_at: "2026-11-01T08:00:00Z", channel: "linkedin" },
    ];
    const tasks = [
      { id: "t1", customer_id: "C", title: "Nudge 1", due_date: "2026-11-24", status: "open", nudge_step: 1, draft_text: "Hi", draft_status: "draft" },
      { id: "t2", customer_id: "B", title: "Reply to B", due_date: "2026-11-25", status: "open" },
      { id: "t3", customer_id: "C", title: "Far away", due_date: "2027-01-10", status: "open" },
      { id: "t4", customer_id: "C", title: "Approved draft", due_date: "2026-11-24", status: "open", draft_text: "x", draft_status: "approved" },
      { id: "t5", customer_id: "D", title: "DNC task", due_date: "2026-11-24", status: "open" },
    ];
    const list = buildNeedsYou(accounts, touches, tasks, now);
    expect(list.map(e => `${e.kind}:${e.account.id}`)).toEqual(["forgotten:A", "qualified:B", "qualified:E", "nudge:C"]);
    expect(list[0]).toMatchObject({ waitingDays: 6, detail: "Send prices?" });
    expect(list[2].title).toBe("Next step: Send quote");
  });

  it("groups the pipeline by stage and totals this week's jobs", () => {
    const g = groupByStage([acct("A", "queued"), acct("B", "queued"), acct("C", "inquiry"), acct("D", "not_now")], SALES_STAGES);
    expect(g.queued).toHaveLength(2);
    expect(g.inquiry).toHaveLength(1);
    expect(g.not_now).toBeUndefined();
    const s = summarizeJobs([
      { job: "crm-watchdog", status: "ok", started_at: "2026-11-20T04:15:00Z", cost_usd: 0.3, needs_review: 2, credits: {} },
      { job: "crm-watchdog", status: "failed", started_at: "2026-11-21T04:15:00Z", cost_usd: 0.1, needs_review: 1, credits: {} },
      { job: "outreach", status: "ok", started_at: "2026-11-22T05:00:00Z", cost_usd: 1.5, needs_review: 25, credits: { waalaxy_email_finder: 3 } },
      { job: "outreach", status: "ok", started_at: "2026-11-01T05:00:00Z", cost_usd: 9, needs_review: 0, credits: {} },
    ], "2026-11-17");
    expect(s.runs).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.totalCost).toBeCloseTo(1.9);
    expect(s.jobs[0]).toMatchObject({ job: "outreach", needs_review: 25, credits: { waalaxy_email_finder: 3 } });
    expect(s.jobs[1]).toMatchObject({ job: "crm-watchdog", runs: 2, lastStatus: "failed", needs_review: 1 });
  });
});

describe("Needs you Done and Ignore", () => {
  const accounts = [
    acct("A", "customer", { sales_stage_changed_at: "2026-11-01T00:00:00Z" }),
    acct("B", "responded", { sales_stage_changed_at: "2026-10-01T00:00:00Z" }),
    acct("C", "in_outreach"),
  ];
  const touches = [
    { customer_id: "A", direction: "in" as const, occurred_at: "2026-11-10T08:00:00Z", channel: "email", body: "Thanks, Tim" },
    { customer_id: "B", direction: "out" as const, occurred_at: "2026-10-20T08:00:00Z", channel: "linkedin" },
  ];
  const tasks = [{ id: "t1", customer_id: "C", title: "Reply to C", due_date: "2026-11-23", status: "open" }];
  const all = buildNeedsYou(accounts, touches, tasks, now);

  it("builds forgotten, quiet and task items to start with", () => {
    expect(all.map(e => `${e.kind}:${e.account.id}`).sort()).toEqual(["forgotten:A", "quiet:B", "task:C"]);
  });

  it("hides done and ignored items, with the newest dismissal winning and undo putting it back", () => {
    const d = [
      { customer_id: "A", item_key: "forgotten", action: "done" as const, dismissed_at: "2026-11-22T00:00:00Z" },
      { customer_id: "B", item_key: "quiet", action: "ignored" as const, until: null, dismissed_at: "2026-11-22T00:00:00Z" },
      { customer_id: "C", item_key: "task:t1", action: "ignored" as const, until: "2026-11-30", dismissed_at: "2026-11-22T00:00:00Z" },
    ];
    const r = applyDismissals(all, d, touches, now);
    expect(r.shown).toHaveLength(0);
    expect(r.hidden).toHaveLength(3);
    const undone = applyDismissals(all, [{ ...d[0], undone_at: "2026-11-23T00:00:00Z" }, d[1], d[2]], touches, now);
    expect(undone.shown.map(e => e.account.id)).toEqual(["A"]);
  });

  it("stays dismissed when the watchdog or sync re-runs with old messages, and comes back on a genuinely new inbound message", () => {
    const d = [{ customer_id: "A", item_key: "forgotten", action: "done" as const, dismissed_at: "2026-11-22T00:00:00Z" }];
    // A re-sync logs an older message for the first time: still hidden.
    const resync = [...touches, { customer_id: "A", direction: "in" as const, occurred_at: "2026-11-09T08:00:00Z", channel: "email" }];
    const later = new Date("2026-11-27T10:00:00Z");
    expect(applyDismissals(buildNeedsYou(accounts, resync, [], later), d, resync, later).shown.filter(e => e.account.id === "A")).toHaveLength(0);
    // A new reply after the dismissal: back once it has waited 4 days.
    const fresh = [...touches, { customer_id: "A", direction: "in" as const, occurred_at: "2026-11-23T08:00:00Z", channel: "email", body: "One more question" }];
    const back = applyDismissals(buildNeedsYou(accounts, fresh, [], later), d, fresh, later).shown.find(e => e.account.id === "A");
    expect(back).toMatchObject({ kind: "forgotten", detail: "One more question" });
  });

  it("ends an ignore on its date, a quiet ignore on any new message, and an account item on a stage move", () => {
    expect(isDismissalActive({ customer_id: "C", item_key: "task:t1", action: "ignored", until: "2026-11-30", dismissed_at: "2026-11-22T00:00:00Z" }, { today: "2026-11-29" })).toBe(true);
    expect(dismissalEndedBy({ customer_id: "C", item_key: "task:t1", action: "ignored", until: "2026-11-30", dismissed_at: "2026-11-22T00:00:00Z" }, { today: "2026-11-30" })).toBe("date");
    expect(dismissalEndedBy({ customer_id: "B", item_key: "quiet", action: "ignored", dismissed_at: "2026-11-22T00:00:00Z" }, { lastTouchAt: "2026-11-25T00:00:00Z" })).toBe("new_message");
    expect(dismissalEndedBy({ customer_id: "B", item_key: "back", action: "done", dismissed_at: "2026-11-22T00:00:00Z" }, { stageChangedAt: "2026-11-24T00:00:00Z" })).toBe("stage");
    // Forgotten items ignore stage moves (a Gmail sync re-staging a customer must not bring it back).
    expect(dismissalEndedBy({ customer_id: "A", item_key: "forgotten", action: "done", dismissed_at: "2026-11-22T00:00:00Z" }, { stageChangedAt: "2026-11-24T00:00:00Z" })).toBeNull();
    expect(dismissalEndedBy({ customer_id: "A", item_key: "forgotten", action: "ignored", until: null, dismissed_at: "2026-11-22T00:00:00Z" }, { today: "2030-01-01" })).toBeNull();
  });
});
