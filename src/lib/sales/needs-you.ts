// Builds the Sales page's "Needs you" list from accounts, touches and open tasks. Pure, no imports outside sales-core.
import { isForgotten, QUIET_DAYS, sortNeedsYou, type NeedsYouItem, type TouchLite } from "./sales-core";

export type AccountRow = {
  id: string; name: string; company: string | null; sales_stage: string | null; dnc: boolean; next_step?: string | null; next_step_date?: string | null;
  not_now_until?: string | null; last_contacted_at?: string | null; sales_stage_changed_at?: string | null; brief_updated_at?: string | null;
};
export type TouchRow = TouchLite & { customer_id: string | null; channel: string; body?: string | null };
export type TaskRow = {
  id: string; customer_id: string | null; title: string; due_date: string | null; status: string;
  nudge_step?: number | null; draft_text?: string | null; draft_status?: string | null; draft_channel?: string | null; priority?: string;
};

export type NeedsYouEntry = NeedsYouItem & {
  key: string;
  account: AccountRow;
  title: string;
  detail?: string | null;
  task?: TaskRow;
};

const QUALIFIED = new Set(["in_conversation", "inquiry"]);

export function buildNeedsYou(accounts: AccountRow[], touches: TouchRow[], tasks: TaskRow[], now = new Date(), horizonDays = 7, engagedIds: Set<string> = new Set()): NeedsYouEntry[] {
  const byId = new Map(accounts.map(a => [a.id, a]));
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000).toISOString().slice(0, 10);
  const out: NeedsYouEntry[] = [];
  const forgottenIds = new Set<string>();

  const touchesBy = new Map<string, TouchRow[]>();
  for (const t of touches) if (t.customer_id) (touchesBy.get(t.customer_id) ?? touchesBy.set(t.customer_id, []).get(t.customer_id)!).push(t);
  for (const a of accounts) {
    if (a.dnc || a.sales_stage === "dnc" || a.sales_stage === "not_a_fit") continue;
    const list = touchesBy.get(a.id) ?? [];
    const f = isForgotten(list, now);
    if (f.forgotten) {
      const lastIn = list.filter(t => t.direction === "in").sort((x, y) => x.occurred_at.localeCompare(y.occurred_at)).pop();
      forgottenIds.add(a.id);
      out.push({ key: `f-${a.id}`, kind: "forgotten", account: a, waitingDays: f.waitingDays, title: `Waiting on us ${f.waitingDays} days`, detail: lastIn?.body ?? null });
    }
  }

  for (const t of tasks) {
    if (t.status !== "open" || !t.customer_id) continue;
    const a = byId.get(t.customer_id);
    if (!a || a.dnc) continue;
    if (t.draft_status && t.draft_status !== "draft") continue; // approved drafts wait for the sender, not for Caleb
    const due = t.due_date ?? null;
    const hasDraft = !!t.draft_text && t.draft_status === "draft";
    if (!hasDraft && due && due > horizon) continue;
    const kind: NeedsYouItem["kind"] = QUALIFIED.has(a.sales_stage ?? "") ? "qualified" : t.nudge_step ? "nudge" : hasDraft ? "draft" : "task";
    out.push({ key: `t-${t.id}`, kind, account: a, task: t, due_date: due, title: t.title, detail: t.draft_text ?? null });
  }

  // A qualified account with nothing open still needs a next step from Caleb.
  for (const a of accounts) {
    if (!QUALIFIED.has(a.sales_stage ?? "") || a.dnc || forgottenIds.has(a.id)) continue;
    if (out.some(e => e.account.id === a.id)) continue;
    out.push({ key: `q-${a.id}`, kind: "qualified", account: a, due_date: a.next_step_date ?? null, title: a.next_step ? `Next step: ${a.next_step}` : "No next step set" });
  }

  // Warm accounts that went quiet with nothing planned: the follow-ups that slip.
  const today = now.toISOString().slice(0, 10);
  const hasOpenTask = new Set(tasks.filter(t => t.status === "open" && t.customer_id).map(t => t.customer_id as string));
  const quietBefore = new Date(now.getTime() - QUIET_DAYS * 86_400_000).toISOString();
  for (const a of accounts) {
    if (a.dnc || forgottenIds.has(a.id) || hasOpenTask.has(a.id) || out.some(e => e.account.id === a.id)) continue;
    if (a.sales_stage === "responded") {
      const list = touchesBy.get(a.id) ?? [];
      const last = list.map(t => t.occurred_at).sort().pop() ?? a.last_contacted_at ?? null;
      if (last && last > quietBefore) continue;
      const engaged = engagedIds.has(a.id);
      const days = last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000) : 0;
      out.push({
        key: `w-${a.id}`, kind: "quiet", account: a, engaged, waitingDays: days,
        title: `${engaged ? "Said they're interested" : "Replied"}, ${last ? `quiet ${days} days` : "no messages logged"}, nothing planned`,
      });
    } else if (a.sales_stage === "not_now" && a.not_now_until && a.not_now_until <= today) {
      out.push({ key: `b-${a.id}`, kind: "back", account: a, engaged: engagedIds.has(a.id), due_date: a.not_now_until, title: `Back from Not now (${a.not_now_until})` });
    }
  }
  return sortNeedsYou(out);
}

/** Pipeline columns: count and accounts per stage. */
export function groupByStage<T extends { sales_stage: string | null }>(accounts: T[], stages: readonly string[]): Record<string, T[]> {
  const g: Record<string, T[]> = Object.fromEntries(stages.map(s => [s, [] as T[]]));
  for (const a of accounts) if (a.sales_stage && g[a.sales_stage]) g[a.sales_stage].push(a);
  return g;
}

export type JobRunRow = { job: string; status: string; started_at: string; cost_usd: number | null; needs_review: number; credits?: Record<string, number> | null };

/** This week's job totals for the Jobs tab: runs, failures, cost and credits per job. */
export function summarizeJobs(runs: JobRunRow[], since: string) {
  const recent = runs.filter(r => r.started_at >= since);
  const jobs = new Map<string, { job: string; runs: number; failed: number; cost: number; needs_review: number; last: string; lastStatus: string; credits: Record<string, number> }>();
  for (const r of [...recent].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const j = jobs.get(r.job) ?? { job: r.job, runs: 0, failed: 0, cost: 0, needs_review: 0, last: r.started_at, lastStatus: r.status, credits: {} };
    j.runs++;
    if (r.status === "failed") j.failed++;
    j.cost += Number(r.cost_usd ?? 0);
    j.needs_review = r.needs_review; // latest run's queue
    j.last = r.started_at;
    j.lastStatus = r.status;
    for (const [k, v] of Object.entries(r.credits ?? {})) j.credits[k] = (j.credits[k] ?? 0) + Number(v);
    jobs.set(r.job, j);
  }
  const list = [...jobs.values()].sort((a, b) => b.last.localeCompare(a.last));
  return { jobs: list, totalCost: list.reduce((s, j) => s + j.cost, 0), runs: recent.length, failed: list.reduce((s, j) => s + j.failed, 0) };
}
