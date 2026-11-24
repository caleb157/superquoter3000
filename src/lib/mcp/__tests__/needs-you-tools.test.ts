import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FakeDb, schemaColumns } from "./fake-db";
import { TOOLS } from "../index";
import { dismissNeedsYou, listNeedsYou } from "../needs-you";
import { listPipeline, logTouch, saveFollowUp } from "../sales";

const types = readFileSync(path.resolve(__dirname, "../../../integrations/supabase/types.ts"), "utf8");
const keysOk = (table: string, row: Record<string, unknown>) => {
  const have = schemaColumns(types, table);
  return Object.keys(row).filter(k => k !== "id" && k !== "created_at" && !have.has(k));
};

const AIG = "00000000-0000-4000-8000-00000000a001";
const BBQ = "00000000-0000-4000-8000-00000000a002";
const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const seed = () => new FakeDb({
  customers: [
    { id: AIG, name: "Answers in Genesis", company: "Answers in Genesis", sales_stage: "customer", dnc: false, sales_stage_changed_at: ago(30) },
    { id: BBQ, name: "BBQ Store AU", company: "BBQ Store AU", sales_stage: "responded", dnc: false, sales_stage_changed_at: ago(40) },
  ],
  contacts: [],
  sales_touches: [
    { id: "m1", customer_id: AIG, channel: "email", direction: "in", occurred_at: ago(63), body: "Latest reply from Molly", external_id: "g-1" },
    { id: "m2", customer_id: BBQ, channel: "email", direction: "in", occurred_at: ago(32), body: "Invoice discrepancy", external_id: "g-2" },
  ],
  sales_stage_events: [],
  tasks: [{ id: "00000000-0000-4000-8000-0000000000t1", customer_id: BBQ, title: "Reply to BBQ Store AU", due_date: ago(1).slice(0, 10), status: "open", draft_text: "Hi", draft_status: "draft" }],
  needs_you_dismissals: [],
});

describe("Needs you tools", () => {
  it("registers list_needs_you and dismiss_needs_you (connector 0.8.0 and later)", () => {
    const names = TOOLS.map(t => (t as { name: string }).name);
    expect(names).toEqual(expect.arrayContaining(["list_needs_you", "dismiss_needs_you"]));
    const src = readFileSync(path.resolve(__dirname, "../index.ts"), "utf8");
    expect(src).toMatch(/version: "0\.(8|9|[1-9]\d)\.\d+"/);
  });

  it("lists the same items as the page, hides Done and Ignored ones, and undo puts them back", async () => {
    const db = seed();
    const before = await listNeedsYou(db, {});
    expect(before.items.map(i => `${i.kind}:${i.company}`)).toEqual(expect.arrayContaining(["forgotten:Answers in Genesis", "forgotten:BBQ Store AU"]));

    const dry = await dismissNeedsYou(db, { customer_id: AIG, item: "forgotten", action: "done", note: "Answered by phone", dry_run: true });
    expect(dry.dry_run).toBe(true);
    expect(db.rows("needs_you_dismissals")).toHaveLength(0);

    await dismissNeedsYou(db, { customer_id: AIG, item: "forgotten", action: "done", note: "Answered by phone" });
    await dismissNeedsYou(db, { customer_id: BBQ, item: "forgotten", action: "ignore", ignore_days: 30 });
    const after = await listNeedsYou(db, { include_hidden: true });
    expect(after.items.find(i => i.kind === "forgotten")).toBeUndefined();
    expect(after.hidden_count).toBe(2);
    expect(after.hidden?.find(h => h.customer_id === BBQ)?.dismissal.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const undo = await dismissNeedsYou(db, { customer_id: AIG, item: "forgotten", action: "undo" });
    expect(undo.undone).toBe(true);
    expect((await listNeedsYou(db, {})).items.some(i => i.customer_id === AIG && i.kind === "forgotten")).toBe(true);
    for (const w of db.writes) expect(keysOk(w.table, { ...(w.rows?.[0] ?? {}), ...(w.patch ?? {}) })).toEqual([]);
  });

  it("Done on a task closes it (draft skipped) and Undo reopens it as it was", async () => {
    const db = seed();
    const T = "00000000-0000-4000-8000-0000000000t1";
    const r = await dismissNeedsYou(db, { customer_id: BBQ, task_id: T, action: "done" });
    expect(r.closes_task).toBe(true);
    expect(db.rows("tasks")[0]).toMatchObject({ status: "done", draft_status: "skipped" });
    await dismissNeedsYou(db, { customer_id: BBQ, task_id: T, action: "undo" });
    expect(db.rows("tasks")[0]).toMatchObject({ status: "open", draft_status: "draft", completed_at: null });
  });

  it("a watchdog or Gmail re-run cannot bring a dismissed item back; a genuinely new inbound message does", async () => {
    const db = seed();
    await dismissNeedsYou(db, { customer_id: AIG, item: "forgotten", action: "ignore" });
    // Re-sync: the same message again is a duplicate; an older one logged for the first time keeps it hidden.
    const dup = await logTouch(db, { customer_id: AIG, channel: "email", direction: "in", occurred_at: ago(63), external_id: "g-1" });
    expect(dup.duplicate).toBe(true);
    await logTouch(db, { customer_id: AIG, channel: "email", direction: "in", occurred_at: ago(70), external_id: "g-0" });
    expect((await listNeedsYou(db, {})).items.some(i => i.customer_id === AIG)).toBe(false);
    // The watchdog sees it as held and cannot add a reply follow-up for it.
    const p = await listPipeline(db, { customer_id: AIG });
    expect((p.accounts[0] as { needs_you_held: { item: string }[] }).needs_you_held).toEqual([expect.objectContaining({ item: "forgotten", action: "ignored" })]);
    await expect(saveFollowUp(db, { customer_id: AIG, due_date: ago(-1).slice(0, 10), title: "Reply to Molly" })).rejects.toThrow(/ignored it on Needs you/);
    const forced = await saveFollowUp(db, { customer_id: AIG, due_date: ago(-1).slice(0, 10), title: "Reply to Molly", override_dismissal: true, dry_run: true });
    expect(forced.dry_run).toBe(true);
    // A real new message after the dismissal releases it.
    await logTouch(db, { customer_id: AIG, channel: "email", direction: "in", occurred_at: new Date(Date.now() + 1000).toISOString(), external_id: "g-new", body: "New order question" });
    const p2 = await listPipeline(db, { customer_id: AIG });
    expect((p2.accounts[0] as { needs_you_held: unknown[] }).needs_you_held).toEqual([]);
    const ok = await saveFollowUp(db, { customer_id: AIG, due_date: ago(-1).slice(0, 10), title: "Reply to Molly", dry_run: true });
    expect(ok.dry_run).toBe(true);
  });

  it("refuses bad input", async () => {
    const db = seed();
    await expect(dismissNeedsYou(db, { customer_id: AIG, action: "done" })).rejects.toThrow(/which item/);
    await expect(dismissNeedsYou(db, { customer_id: AIG, item: "forgotten", action: "ignore", until: "next week" })).rejects.toThrow(/YYYY-MM-DD/);
    await expect(dismissNeedsYou(db, { customer_id: AIG, item: "quiet", action: "undo" })).rejects.toThrow(/Nothing/);
    await expect(dismissNeedsYou(db, { customer_id: AIG, task_id: "00000000-0000-4000-8000-0000000000t1", action: "done" })).rejects.toThrow(/another account/);
  });
});
