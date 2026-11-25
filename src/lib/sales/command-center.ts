// Command center maths: the Sales landing page's birds-eye numbers. Week-over-week activity against targets,
// the funnel now and a week ago, every scheduled run with its last and next fire, usage and credits, tasks due.
// Pure, no imports outside the sales folder, so the connector can share it.
import { SALES_EXITS, SALES_STAGES } from "./sales-core";
import { SEND_TARGETS, emailTargetToday } from "./prospecting";

const DAY = 86_400_000;
const MIN = 60_000;
/** India Standard Time has no daylight saving: always UTC+5:30. */
export const IST_OFFSET_MS = 330 * MIN;

/** A date's wall clock in IST, as UTC fields of a shifted Date. */
const ist = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);
const fromIst = (y: number, m: number, day: number, h = 0, mi = 0) => new Date(Date.UTC(y, m, day, h, mi) - IST_OFFSET_MS);

/** Monday 00:00 IST of the week holding `d`. */
export function istWeekStart(d: Date): Date {
  const x = ist(d);
  const dow = (x.getUTCDay() + 6) % 7;
  return fromIst(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() - dow);
}

/** Today's date (YYYY-MM-DD) in IST. */
export const istToday = (now = new Date()) => ist(now).toISOString().slice(0, 10);

// ---------- cron ----------

type CronSpec = { min: Set<number>; hour: Set<number>; dom: Set<number> | null; mon: Set<number> | null; dow: Set<number> | null };

function field(src: string, lo: number, hi: number): Set<number> | null {
  if (src === "*" || src === "?") return null;
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS ? Number(stepS) : 1;
    let a = lo, b = hi;
    if (range !== "*") {
      const [x, y] = range.split("-").map(Number);
      a = x; b = y ?? (stepS ? hi : x);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(step) || step < 1) throw new Error(`Bad cron field "${src}"`);
    for (let v = a; v <= b; v += step) out.add(hi === 7 && v === 7 ? 0 : v);
  }
  return out;
}

/** Parse "m h dom mon dow" (a CRON_TZ= prefix is ignored: every schedule here is IST). */
export function parseCron(expr: string): CronSpec {
  const parts = expr.replace(/^CRON_TZ=\S+\s+/, "").trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron needs 5 fields: "${expr}"`);
  const [m, h, dom, mon, dow] = parts;
  return { min: field(m, 0, 59) ?? new Set(Array.from({ length: 60 }, (_, i) => i)), hour: field(h, 0, 23) ?? new Set(Array.from({ length: 24 }, (_, i) => i)), dom: field(dom, 1, 31), mon: field(mon, 1, 12), dow: field(dow, 0, 7) };
}

/**
 * Day match. When both day-of-month and day-of-week are set we read it as AND ("1-7 * 1" = first Monday),
 * which is what every playbook schedule means; the job itself checks the date, so this is when it really works.
 */
const dayOk = (s: CronSpec, x: Date) =>
  (!s.mon || s.mon.has(x.getUTCMonth() + 1)) && (!s.dom || s.dom.has(x.getUTCDate())) && (!s.dow || s.dow.has(x.getUTCDay()));

function* times(s: CronSpec) {
  const hs = [...s.hour].sort((a, b) => a - b), ms = [...s.min].sort((a, b) => a - b);
  for (const h of hs) for (const m of ms) yield [h, m] as const;
}

/** Next fire strictly after `from`, across one or more cron expressions joined by ";". Null if none in 400 days. */
export function nextCronRun(cron: string, from: Date): Date | null {
  let best: Date | null = null;
  for (const e of cron.split(";").map(x => x.trim()).filter(Boolean)) {
    const s = parseCron(e);
    const base = ist(from);
    for (let i = 0; i <= 400; i++) {
      const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + i));
      if (!dayOk(s, day)) continue;
      let hit: Date | null = null;
      for (const [h, m] of times(s)) {
        const t = fromIst(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
        if (t > from) { hit = t; break; }
      }
      if (hit) { if (!best || hit < best) best = hit; break; }
    }
  }
  return best;
}

/** Last fire at or before `at`. Null if none in 400 days. */
export function prevCronRun(cron: string, at: Date): Date | null {
  let best: Date | null = null;
  for (const e of cron.split(";").map(x => x.trim()).filter(Boolean)) {
    const s = parseCron(e);
    const base = ist(at);
    for (let i = 0; i <= 400; i++) {
      const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() - i));
      if (!dayOk(s, day)) continue;
      let hit: Date | null = null;
      for (const [h, m] of [...times(s)].reverse()) {
        const t = fromIst(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m);
        if (t <= at) { hit = t; break; }
      }
      if (hit) { if (!best || hit > best) best = hit; break; }
    }
  }
  return best;
}

// ---------- activity this week ----------

export type CcTouch = { customer_id: string | null; channel: string; direction: "in" | "out"; occurred_at: string; is_drip?: boolean | null; bounced_at?: string | null };
export type CcStageEvent = { customer_id: string; from_stage: string | null; to_stage: string | null; occurred_at: string; actor?: string | null };

/** Bulk loads and syncs (crm-load, crm-sync, imports) put existing relationships into the CRM; they are not new movement. */
export const isBackfill = (e: Pick<CcStageEvent, "actor">) => /\b(load|sync|import|seed)\b/i.test(e.actor ?? "");
export type CcInquiry = { id: string; customer_id: string | null; received_date?: string | null; created_at?: string | null };

export type WeekNumbers = {
  linkedin: number; email: number; bounces: number; bounceRate: number | null; replies: number; meetings: number;
  newResponded: number; inquiries: number; customers: number;
};

function countWeek(touches: CcTouch[], events: CcStageEvent[], inquiries: CcInquiry[], from: Date, to: Date, pipelineIds: Set<string>): WeekNumbers {
  const f = from.toISOString(), t = to.toISOString();
  const inWin = (x: string | null | undefined) => !!x && x >= f && x < t;
  const out = touches.filter(x => x.direction === "out" && !x.is_drip && inWin(x.occurred_at));
  const email = out.filter(x => x.channel === "email");
  const bounces = email.filter(x => !!x.bounced_at).length;
  const ev = events.filter(e => inWin(e.occurred_at) && !isBackfill(e));
  // Inquiry dates are calendar days in IST; compare them with the window's IST dates.
  const fd = istToday(from), td = istToday(new Date(to.getTime() - 1));
  return {
    linkedin: out.filter(x => x.channel === "linkedin").length,
    email: email.length,
    bounces,
    bounceRate: email.length ? bounces / email.length : null,
    replies: touches.filter(x => x.direction === "in" && inWin(x.occurred_at)).length,
    meetings: touches.filter(x => (x.channel === "meeting" || x.channel === "call") && inWin(x.occurred_at)).length,
    newResponded: new Set(ev.filter(e => e.to_stage === "responded").map(e => e.customer_id)).size,
    inquiries: inquiries.filter(q => {
      if (!q.customer_id || !pipelineIds.has(q.customer_id)) return false;
      const d = q.received_date ?? q.created_at?.slice(0, 10) ?? null;
      return !!d && d >= fd && d <= td;
    }).length,
    customers: new Set(ev.filter(e => e.to_stage === "customer").map(e => e.customer_id)).size,
  };
}

/** This week so far, last week to the same moment, and all of last week (weeks start Monday 00:00 IST). */
export function weekOverWeek(touches: CcTouch[], events: CcStageEvent[], inquiries: CcInquiry[], pipelineIds: Set<string>, now = new Date()) {
  const ws = istWeekStart(now);
  const lws = new Date(ws.getTime() - 7 * DAY);
  return {
    weekStart: ws,
    thisWeek: countWeek(touches, events, inquiries, ws, now, pipelineIds),
    lastWeekSamePoint: countWeek(touches, events, inquiries, lws, new Date(now.getTime() - 7 * DAY), pipelineIds),
    lastWeek: countWeek(touches, events, inquiries, lws, ws, pipelineIds),
  };
}

/** The week's targets: LinkedIn ~35 a weekday (cap 200), email on the 8/12/16/20 ramp, bounces under 2%. */
export function weekTargets(now = new Date(), firstEmailAt: string | null = null) {
  const x = ist(now);
  const weekdaysSoFar = Math.min(5, ((x.getUTCDay() + 6) % 7) + 1);
  const emailDaily = emailTargetToday(firstEmailAt, now);
  const liWeek = Math.min(SEND_TARGETS.linkedinWeeklyCap, SEND_TARGETS.linkedinPerWeekday * 5);
  return {
    linkedin: { daily: SEND_TARGETS.linkedinPerWeekday, week: liWeek, dueSoFar: Math.min(liWeek, SEND_TARGETS.linkedinPerWeekday * weekdaysSoFar), cap: SEND_TARGETS.linkedinWeeklyCap },
    email: { daily: emailDaily, week: emailDaily * 5, dueSoFar: emailDaily * weekdaysSoFar },
    maxBounceRate: 0.02,
    weekdaysSoFar,
  };
}

// ---------- funnel now and a week ago ----------

export type CcAccount = { id: string; sales_stage: string | null };

/**
 * Accounts per stage now and 7 days ago. The stage a week ago is the from_stage of each account's first
 * stage move after the cutoff (null = not in the pipeline yet); accounts with no move since keep today's stage.
 */
export function funnelWeekAgo(accounts: CcAccount[], events: CcStageEvent[], now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * DAY).toISOString();
  const firstAfter = new Map<string, CcStageEvent>();
  for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
    if (e.occurred_at > cutoff && !firstAfter.has(e.customer_id)) firstAfter.set(e.customer_id, e);
  }
  const stages = [...SALES_STAGES, ...SALES_EXITS] as string[];
  const nowC: Record<string, number> = Object.fromEntries(stages.map(s => [s, 0]));
  const agoC: Record<string, number> = Object.fromEntries(stages.map(s => [s, 0]));
  const loadedC: Record<string, number> = Object.fromEntries(stages.map(s => [s, 0]));
  for (const a of accounts) {
    if (a.sales_stage && a.sales_stage in nowC) nowC[a.sales_stage]++;
    const e = firstAfter.get(a.id);
    const then = e ? e.from_stage : a.sales_stage;
    if (then && then in agoC) agoC[then]++;
    if (e && !e.from_stage && isBackfill(e) && a.sales_stage && a.sales_stage in loadedC) loadedC[a.sales_stage]++;
  }
  // loaded = accounts that arrived this week by a bulk load, so part of the change is existing relationships, not movement.
  return stages.map(s => ({ stage: s, now: nowC[s], weekAgo: agoC[s], change: nowC[s] - agoC[s], loaded: loadedC[s] }));
}

// ---------- runs board ----------

export type CcSchedule = {
  id: string; job: string; name: string; cadence: string; cron: string | null; status: string; sort_order: number;
  runs_where?: string | null; what_it_does?: string | null; run_once_at?: string | null; credit_budget?: string | null;
  last_fired_at?: string | null; last_fire_status?: string | null; next_run_at?: string | null; note?: string | null; live_since?: string | null;
};
export type CcRun = { job: string; status: string; started_at: string; credits?: Record<string, number> | null; counts?: Record<string, unknown> | null; cost_usd?: number | string | null; needs_review?: number | null; summary?: string | null };

export type RunState = "ok" | "failed" | "no_report" | "upcoming" | "paused" | "planned" | "done";
export type BoardRow = CcSchedule & {
  lastRun: CcRun | null; lastFired: Date | null; nextRun: Date | null; state: RunState; stateNote: string;
  creditsWeek: Record<string, number>; costWeek: number; runsWeek: number;
  /** Weekly Claude limit points this week's runs used (null when none measured it). */
  claudeWeek: number | null;
};

/** Hours a run has to report after it fires before the board calls it missing. */
export const REPORT_GRACE_HOURS = 3;

/** One row per scheduled run: last report, last fire, next fire, state and this week's credits. */
export function runBoard(schedules: CcSchedule[], runs: CcRun[], now = new Date()): BoardRow[] {
  const ws = istWeekStart(now).toISOString();
  const rows = schedules.filter(s => s.status !== "retired").map(s => {
    const mine = runs.filter(r => r.job === s.job || r.job === s.id).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const lastRun = mine[0] ?? null;
    let nextRun: Date | null = null, prevFire: Date | null = null;
    if (s.run_once_at) {
      const t = new Date(s.run_once_at);
      if (t > now) nextRun = t; else prevFire = t;
    } else if (s.cron) {
      try { nextRun = nextCronRun(s.cron, now); prevFire = prevCronRun(s.cron, now); } catch { /* bad cron: show the cadence words only */ }
    }
    // A fire from before the run was set up is not a missed run.
    if (prevFire && s.live_since && prevFire < new Date(s.live_since)) prevFire = null;
    if (s.next_run_at && new Date(s.next_run_at) > now && (!nextRun || s.run_once_at)) nextRun = new Date(s.next_run_at);
    const lastFired = s.last_fired_at ? new Date(s.last_fired_at) : null;
    const week = mine.filter(r => r.started_at >= ws);
    const creditsWeek: Record<string, number> = {};
    for (const r of week) for (const [k, v] of Object.entries(r.credits ?? {})) creditsWeek[k] = (creditsWeek[k] ?? 0) + Number(v);
    const graceAgo = new Date(now.getTime() - REPORT_GRACE_HOURS * 3_600_000);
    let state: RunState, stateNote: string;
    if (s.status === "paused") { state = "paused"; stateNote = "Paused"; }
    else if (s.status === "planned") { state = "planned"; stateNote = "Planned, not scheduled yet"; }
    else if (lastRun && lastRun.status === "failed" && (!prevFire || lastRun.started_at >= new Date(prevFire.getTime() - 30 * MIN).toISOString())) { state = "failed"; stateNote = lastRun.summary || "Last run failed"; }
    else if (prevFire && prevFire < graceAgo && (!lastRun || lastRun.started_at < new Date(prevFire.getTime() - 30 * MIN).toISOString())) {
      state = "no_report";
      stateNote = lastFired && lastFired >= new Date(prevFire.getTime() - 30 * MIN) ? "Fired, but the job logged no run" : "No run logged since it was due";
    }
    else if (s.run_once_at && !nextRun && lastRun) { state = "done"; stateNote = "Ran once"; }
    else if (lastRun) { state = "ok"; stateNote = lastRun.summary || lastRun.status; }
    else { state = "upcoming"; stateNote = "Not due yet"; }
    return {
      ...s, lastRun, lastFired, nextRun, state, stateNote, creditsWeek,
      costWeek: week.reduce((n, r) => n + Number(r.cost_usd ?? 0), 0), runsWeek: week.length,
      claudeWeek: claudeWeekTotal(week).pct,
    };
  });
  return rows.sort((a, b) => (a.nextRun?.getTime() ?? Infinity) - (b.nextRun?.getTime() ?? Infinity) || a.sort_order - b.sort_order);
}

/** Runs firing in the next `hours`, soonest first. */
export const comingUp = (rows: BoardRow[], now = new Date(), hours = 24) =>
  rows.filter(r => r.nextRun && r.nextRun.getTime() - now.getTime() <= hours * 3_600_000);

// ---------- usage and credits ----------

export type CcUsage = { taken_at: string; source: string; metric: string; value: number | string; unit?: string | null; resets_at?: string | null; plan?: string | null; note?: string | null };

/** Latest value per source + metric. */
export function latestUsage(rows: CcUsage[]) {
  const m = new Map<string, CcUsage>();
  for (const r of [...rows].sort((a, b) => b.taken_at.localeCompare(a.taken_at))) {
    const k = `${r.source}|${r.metric}`;
    if (!m.has(k)) m.set(k, r);
  }
  return m;
}

/**
 * Claude weekly pace: the share of the week gone since the last reset, and the weekly % it points to at the
 * next reset if use keeps the same pace. Needs a weekly % and its reset time; null otherwise.
 */
export function claudePace(weekly: CcUsage | undefined, now = new Date()) {
  if (!weekly?.resets_at) return null;
  const reset = new Date(weekly.resets_at).getTime();
  const taken = new Date(weekly.taken_at).getTime();
  const start = reset - 7 * DAY;
  const elapsed = (taken - start) / (7 * DAY);
  if (!(elapsed > 0.02) || elapsed > 1) return null;
  const pct = Number(weekly.value);
  return { pct, elapsed, projected: Math.round(pct / elapsed), resetsAt: new Date(reset), stale: now.getTime() - taken > 36 * 3_600_000 };
}

/** Credits per tool and total cost from job runs, this week and last week. */
export function creditsByTool(runs: CcRun[], now = new Date()) {
  const ws = istWeekStart(now).toISOString();
  const lws = new Date(istWeekStart(now).getTime() - 7 * DAY).toISOString();
  const tools = new Map<string, { tool: string; thisWeek: number; lastWeek: number }>();
  let costThis = 0, costLast = 0;
  for (const r of runs) {
    const bucket = r.started_at >= ws ? "thisWeek" : r.started_at >= lws ? "lastWeek" : null;
    if (!bucket) continue;
    if (bucket === "thisWeek") costThis += Number(r.cost_usd ?? 0); else costLast += Number(r.cost_usd ?? 0);
    for (const [k, v] of Object.entries(r.credits ?? {})) {
      const t = tools.get(k) ?? { tool: k, thisWeek: 0, lastWeek: 0 };
      t[bucket] += Number(v);
      tools.set(k, t);
    }
  }
  return { tools: [...tools.values()].sort((a, b) => b.thisWeek - a.thisWeek || b.lastWeek - a.lastWeek), costThis, costLast };
}

// ---------- tasks ----------

export type CcTask = { id: string; title: string; due_date: string | null; status: string; priority?: string | null; assignee?: string | null; customer_id?: string | null; association_label?: string | null };

/** Open tasks for one assignee (or all): overdue, due today, and the next 7 days. Urgent and high first within a day. */
export function tasksDue(tasks: CcTask[], now = new Date(), assignee?: string) {
  const today = istToday(now);
  const week = istToday(new Date(now.getTime() + 7 * DAY));
  const rank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const mine = tasks.filter(t => t.status === "open" && t.due_date && (!assignee || t.assignee === assignee))
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || (rank[a.priority ?? "normal"] ?? 2) - (rank[b.priority ?? "normal"] ?? 2));
  return {
    overdue: mine.filter(t => t.due_date! < today),
    today: mine.filter(t => t.due_date === today),
    week: mine.filter(t => t.due_date! > today && t.due_date! <= week),
    isSales: (t: CcTask) => /^Sales\b/.test(t.title) || !!t.customer_id,
  };
}

// ---------- Claude use per run ----------

/** Claude plan readings a job takes from claude.ai/settings/usage at the start and end of its run (percent). */
export type ClaudeRunReading = {
  week_start?: number | null; week_end?: number | null; session_start?: number | null; session_end?: number | null;
};

/**
 * Percentage points used between two readings. If the limit reset in between (end below start), the end
 * reading is what was used since the reset, so that is the best figure. Null without both readings.
 */
export function pctUsed(start?: number | null, end?: number | null): number | null {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end >= start ? end - start : end) * 10) / 10;
}

/** The counts keys a run stores its Claude readings under (job_runs.counts, so no new column is needed). */
export function claudeRunCounts(c: ClaudeRunReading | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!c) return out;
  const put = (k: string, v: number | null | undefined) => { if (typeof v === "number" && Number.isFinite(v)) out[k] = v; };
  put("claude_week_pct_start", c.week_start); put("claude_week_pct_end", c.week_end);
  put("claude_week_pct_used", pctUsed(c.week_start, c.week_end));
  put("claude_session_pct_start", c.session_start); put("claude_session_pct_end", c.session_end);
  put("claude_session_pct_used", pctUsed(c.session_start, c.session_end));
  return out;
}

/** Weekly-limit points one run used, from its counts; null when the run did not measure it. */
export function claudeWeekUsed(counts: Record<string, unknown> | null | undefined): number | null {
  const v = counts?.claude_week_pct_used;
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
}

/** Sum of the weekly-limit points the runs measured, and how many measured it (null sum when none did). */
export function claudeWeekTotal(runs: { counts?: Record<string, unknown> | null }[]) {
  let sum = 0, measured = 0;
  for (const r of runs) { const v = claudeWeekUsed(r.counts); if (v !== null) { sum += v; measured++; } }
  return { pct: measured ? Math.round(sum * 10) / 10 : null, measured, runs: runs.length };
}

/** True when the plan limit has reset since this reading was taken (the reading no longer says what is left). */
export const resetSinceReading = (r: CcUsage | undefined, now = new Date()) =>
  !!r?.resets_at && new Date(r.resets_at).getTime() <= now.getTime();
