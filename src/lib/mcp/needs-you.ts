// Needs you for the PD HQ connector: the same list the Sales page shows, and Done / Ignore / Undo.
// Relative imports only (see AGENTS.md).
import { check, isValidYmd, ToolError, type Db } from "./shared";
import { addDaysYmd, isDismissalActive, type DismissalLite, type NeedsYouItem } from "../sales/sales-core";
import { applyDismissals, buildNeedsYou, type AccountRow, type TaskRow, type TouchRow } from "../sales/needs-you";

export const DISMISSAL_COLUMNS = "id, customer_id, item_key, kind, action, note, until, task_id, task_prev, title, detail, actor, dismissed_at, undone_at";
const ACCOUNT_KINDS = ["forgotten", "qualified", "quiet", "back"] as const;
type AccountKind = (typeof ACCOUNT_KINDS)[number];

type Dismissal = DismissalLite & { id: string; kind: string; note: string | null; task_id: string | null; task_prev: Record<string, unknown> | null; title: string | null };

/** Live (not undone) dismissals for these accounts, newest first. */
export async function liveDismissals(db: Db, customerIds?: string[]): Promise<Dismissal[]> {
  let q = db.from("needs_you_dismissals").select(DISMISSAL_COLUMNS).is("undone_at", null);
  if (customerIds) {
    if (!customerIds.length) return [];
    q = q.in("customer_id", customerIds);
  }
  return (check(await q.order("dismissed_at", { ascending: false }).limit(5000), "Could not read Done and ignored items") ?? []) as Dismissal[];
}

/**
 * The account items Done or Ignore is still holding back, for save_follow_up. Stricter than the page: any message
 * either way after the dismissal (Caleb wrote to them himself, or they wrote in) releases it.
 */
export async function activeAccountDismissals(db: Db, account: { id: string; sales_stage_changed_at?: string | null }) {
  const live = (await liveDismissals(db, [account.id])).filter(d => !d.item_key.startsWith("task:"));
  if (!live.length) return [];
  const last = check(await db.from("sales_touches").select("occurred_at").eq("customer_id", account.id).order("occurred_at", { ascending: false }).limit(1), "Could not read messages") ?? [];
  const lastAt = last[0]?.occurred_at ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const newest = new Map<string, Dismissal>();
  for (const d of live) if (!newest.has(d.item_key)) newest.set(d.item_key, d);
  return [...newest.values()].filter(d => isDismissalActive(d, { lastInboundAt: lastAt, stageChangedAt: account.sales_stage_changed_at ?? null, today }));
}

const clip = (s?: string | null, n = 280) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? null);

export type ListNeedsYouInput = { include_hidden?: boolean; kind?: NeedsYouItem["kind"]; limit?: number };

/** Needs you exactly as the Sales page builds it, minus what Done or Ignore holds back. */
export async function listNeedsYou(db: Db, input: ListNeedsYouInput = {}) {
  const now = new Date();
  const since90 = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [a, t, k, e, d] = await Promise.all([
    db.from("customers").select("id, name, company, sales_stage, dnc, next_step, next_step_date, not_now_until, last_contacted_at, sales_stage_changed_at, brief_updated_at").not("sales_stage", "is", null).limit(5000),
    db.from("sales_touches").select("customer_id, direction, occurred_at, channel, body").gte("occurred_at", since90).order("occurred_at", { ascending: false }).limit(20000),
    db.from("tasks").select("id, customer_id, title, due_date, status, nudge_step, draft_text, draft_status, draft_channel, priority").eq("status", "open").not("customer_id", "is", null).limit(5000),
    db.from("contacts").select("customer_id").eq("engaged", true).limit(10000),
    db.from("needs_you_dismissals").select(DISMISSAL_COLUMNS).is("undone_at", null).limit(5000),
  ]);
  const accounts = (check(a, "Could not read the accounts") ?? []) as AccountRow[];
  const touches = (check(t, "Could not read messages") ?? []) as TouchRow[];
  const tasks = (check(k, "Could not read tasks") ?? []) as TaskRow[];
  const engaged = new Set(((check(e, "Could not read contacts") ?? []) as { customer_id: string | null }[]).map(x => x.customer_id).filter(Boolean) as string[]);
  const dismissals = (check(d, "Could not read Done and ignored items") ?? []) as Dismissal[];
  const all = buildNeedsYou(accounts, touches, tasks, now, 7, engaged);
  const { shown, hidden } = applyDismissals(all, dismissals, touches, now);
  const slim = (x: (typeof all)[number]) => ({
    customer_id: x.account.id, company: x.account.company ?? x.account.name, stage: x.account.sales_stage, kind: x.kind,
    item: x.task ? "task" : x.kind, task_id: x.task?.id ?? null, title: x.title, detail: clip(x.detail), due_date: x.due_date ?? null,
    waiting_days: x.waitingDays ?? null, engaged: !!x.engaged,
  });
  const pick = <T extends { kind: string }>(l: T[]) => (input.kind ? l.filter(x => x.kind === input.kind) : l).slice(0, Math.min(input.limit ?? 200, 500));
  return {
    count: shown.length,
    hidden_count: hidden.length,
    items: pick(shown).map(slim),
    ...(input.include_hidden ? {
      hidden: pick(hidden).map(h => ({ ...slim(h), dismissal: { id: h.dismissal.id, action: h.dismissal.action, until: h.dismissal.until ?? null, dismissed_at: h.dismissal.dismissed_at, note: (h.dismissal as Dismissal).note } })),
    } : {}),
  };
}

export type DismissNeedsYouInput = {
  customer_id: string;
  item?: AccountKind | "task";
  task_id?: string;
  action: "done" | "ignore" | "undo";
  note?: string;
  ignore_days?: number;
  until?: string;
  dismissal_id?: string;
  title?: string;
  detail?: string;
  actor?: string;
  dry_run?: boolean;
};

/**
 * Done: handled, stays off Needs you until a new message comes in (a task item is closed).
 * Ignore: off Needs you until the date (or forever) or a new message. Undo: puts it back (and reopens a task Done closed).
 */
export async function dismissNeedsYou(db: Db, input: DismissNeedsYouInput) {
  const account = check(await db.from("customers").select("id, company, name").eq("id", input.customer_id).maybeSingle(), "Could not read the account");
  if (!account) throw new ToolError(`Account ${input.customer_id} not found.`);
  const name = account.company ?? account.name;
  const item = input.task_id ? "task" : input.item;
  if (!item) throw new ToolError("Say which item: item (forgotten, qualified, quiet, back) or task_id.");
  if (item !== "task" && !ACCOUNT_KINDS.includes(item)) throw new ToolError(`Unknown item ${item}. Use forgotten, qualified, quiet, back, or task_id.`);
  if (item === "task" && !input.task_id) throw new ToolError("A task item needs task_id.");
  const item_key = item === "task" ? `task:${input.task_id}` : item;

  if (input.action === "undo") {
    let target: Dismissal | null = null;
    if (input.dismissal_id) {
      target = check(await db.from("needs_you_dismissals").select(DISMISSAL_COLUMNS).eq("id", input.dismissal_id).maybeSingle(), "Could not read the item") as Dismissal | null;
      if (!target || target.customer_id !== account.id) throw new ToolError(`Done or ignored item ${input.dismissal_id} not found on ${name}.`);
    } else {
      target = (await liveDismissals(db, [account.id])).find(d => d.item_key === item_key) ?? null;
    }
    if (!target) throw new ToolError(`Nothing on ${name} is marked done or ignored for ${item}.`);
    if (target.undone_at) return { undone: false, already: true, dismissal_id: target.id, dry_run: !!input.dry_run };
    const reopen = target.task_id && target.task_prev ? { status: "open", completed_at: null, ...target.task_prev } : null;
    if (input.dry_run) return { undone: true, dismissal_id: target.id, reopens_task: target.task_id && reopen ? target.task_id : null, dry_run: true };
    check(await db.from("needs_you_dismissals").update({ undone_at: new Date().toISOString() }).eq("id", target.id), "Could not undo");
    if (reopen && target.task_id) check(await db.from("tasks").update(reopen).eq("id", target.task_id), "Could not reopen the task");
    return { undone: true, dismissal_id: target.id, reopened_task: reopen ? target.task_id : null, dry_run: false };
  }

  if (input.action !== "done" && input.action !== "ignore") throw new ToolError("action is done, ignore or undo.");
  let until: string | null = null;
  if (input.action === "ignore") {
    if (input.until) {
      if (!isValidYmd(input.until)) throw new ToolError("until must be YYYY-MM-DD.");
      until = input.until;
    } else if (input.ignore_days != null) {
      if (input.ignore_days < 1 || input.ignore_days > 3650) throw new ToolError("ignore_days is 1 to 3650; leave it out to ignore until a new message.");
      until = addDaysYmd(new Date(), input.ignore_days);
    }
  }
  let task: { id: string; title: string; status: string; customer_id: string | null; draft_status: string | null; draft_text: string | null } | null = null;
  if (input.task_id) {
    task = check(await db.from("tasks").select("id, title, status, customer_id, draft_status, draft_text").eq("id", input.task_id).maybeSingle(), "Could not read the task");
    if (!task) throw new ToolError(`Task ${input.task_id} not found.`);
    if (task.customer_id && task.customer_id !== account.id) throw new ToolError(`Task ${input.task_id} belongs to another account.`);
  }
  const closesTask = input.action === "done" && task && task.status === "open";
  const row = {
    customer_id: account.id,
    item_key,
    kind: item,
    action: input.action === "done" ? "done" : "ignored",
    note: input.note?.trim() || null,
    until,
    task_id: task?.id ?? null,
    task_prev: closesTask ? { status: "open", completed_at: null, ...(task!.draft_status ? { draft_status: task!.draft_status } : {}) } : null,
    title: input.title?.trim() || task?.title || null,
    detail: clip(input.detail?.trim() || task?.draft_text || null, 1000),
    actor: input.actor?.trim() || null,
    dismissed_at: new Date().toISOString(),
  };
  if (input.dry_run) return { dismissal: row, closes_task: !!closesTask, dry_run: true };
  const dismissal = check(await db.from("needs_you_dismissals").insert(row).select(DISMISSAL_COLUMNS).single(), "Could not save");
  if (closesTask) {
    const patch: Record<string, unknown> = { status: "done", completed_at: new Date().toISOString() };
    if (task!.draft_status === "draft") patch.draft_status = "skipped";
    check(await db.from("tasks").update(patch).eq("id", task!.id), "Could not close the task");
  }
  return { dismissal, closes_task: !!closesTask, dry_run: false };
}

