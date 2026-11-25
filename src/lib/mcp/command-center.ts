// Command center logic for the PD HQ connector: usage snapshots, schedule sync, bounces, and the overview read.
// Relative imports only (see AGENTS.md).
import { check, ToolError, type Db } from "./shared";
import { normalizeEmail } from "../sales/sales-core";
import {
  claudePace, claudeWeekTotal, creditsByTool, istWeekStart, resetSinceReading, funnelWeekAgo, latestUsage, runBoard, tasksDue, weekOverWeek, weekTargets,
  type CcSchedule,
} from "../sales/command-center";

const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);
const iso = (v: string | undefined, name: string) => {
  if (v == null) return null;
  if (Number.isNaN(Date.parse(v))) throw new ToolError(`${name} must be an ISO date-time.`);
  return new Date(v).toISOString();
};

// ---------- usage ----------

export type UsageReading = { source?: string; metric?: string; value?: number; unit?: string; resets_at?: string; plan?: string; note?: string };
export type LogUsageInput = { readings: UsageReading[]; taken_at?: string; logged_by?: string; dry_run?: boolean };

/** One or more readings (Claude weekly %, session %, a tool's credits left or used) taken at the same moment. */
export async function logUsage(db: Db, input: LogUsageInput) {
  if (!input.readings?.length) throw new ToolError("Give at least one reading.");
  const taken_at = iso(input.taken_at, "taken_at") ?? new Date().toISOString();
  const rows = input.readings.map(r => {
    const source = clean(r.source)?.toLowerCase(), metric = clean(r.metric)?.toLowerCase();
    if (!source || !metric) throw new ToolError("Each reading needs a source and a metric.");
    if (typeof r.value !== "number" || !Number.isFinite(r.value)) throw new ToolError(`${source} ${metric}: value must be a number.`);
    return { taken_at, source, metric, value: r.value, unit: clean(r.unit), resets_at: iso(r.resets_at, "resets_at"), plan: clean(r.plan), note: clean(r.note), logged_by: clean(input.logged_by) };
  });
  if (input.dry_run) return { rows, created: 0, dry_run: true };
  check(await db.from("usage_snapshots").insert(rows), "Could not log the usage");
  return { rows, created: rows.length, dry_run: false };
}

// ---------- schedules ----------

export type ScheduleSync = {
  id?: string; job?: string; name?: string; cadence?: string; cron?: string | null; runs_where?: string; what_it_does?: string;
  status?: "live" | "paused" | "planned" | "retired"; run_once_at?: string | null; credit_budget?: string | null;
  last_fired_at?: string | null; last_fire_status?: string | null; next_run_at?: string | null; note?: string | null;
};
export type SyncSchedulesInput = { schedules: ScheduleSync[]; dry_run?: boolean };

const SCHEDULE_FIELDS = ["job", "name", "cadence", "cron", "runs_where", "what_it_does", "status", "run_once_at", "credit_budget", "last_fired_at", "last_fire_status", "next_run_at", "note"] as const;
const DATE_FIELDS = new Set(["run_once_at", "last_fired_at", "next_run_at"]);

/**
 * Bring the Command center's run board in line with the scheduled tasks: last fire, its status, the next fire,
 * plus any new or changed run. Matches on id; a new id needs job, name and cadence. Never deletes; retire instead.
 */
export async function syncSchedules(db: Db, input: SyncSchedulesInput) {
  if (!input.schedules?.length) throw new ToolError("Give at least one schedule.");
  const existing = check(await db.from("sales_schedules").select("id"), "Could not read the schedules") as { id: string }[];
  const have = new Set(existing.map(r => r.id));
  const now = new Date().toISOString();
  const plan = input.schedules.map(s => {
    const id = clean(s.id);
    if (!id) throw new ToolError("Each schedule needs an id.");
    const patch: Record<string, unknown> = { synced_at: now };
    for (const f of SCHEDULE_FIELDS) {
      const v = (s as Record<string, unknown>)[f];
      if (v === undefined) continue;
      patch[f] = DATE_FIELDS.has(f) ? (v == null ? null : iso(String(v), f)) : v;
    }
    const isNew = !have.has(id);
    if (isNew && !(patch.job && patch.name && patch.cadence)) throw new ToolError(`New schedule ${id} needs job, name and cadence.`);
    return { id, isNew, patch };
  });
  if (input.dry_run) return { added: plan.filter(p => p.isNew).map(p => p.id), updated: plan.filter(p => !p.isNew).map(p => p.id), dry_run: true };
  for (const p of plan) {
    if (p.isNew) check(await db.from("sales_schedules").insert({ id: p.id, ...p.patch }), `Could not add ${p.id}`);
    else check(await db.from("sales_schedules").update(p.patch).eq("id", p.id), `Could not update ${p.id}`);
  }
  return { added: plan.filter(p => p.isNew).map(p => p.id), updated: plan.filter(p => !p.isNew).map(p => p.id), dry_run: false };
}

// ---------- bounces ----------

export type MarkBouncedInput = { email?: string; touch_external_id?: string; bounced_at?: string; hard?: boolean; dry_run?: boolean };

/** Mark the latest outbound email to an address (or one touch by its message id) as bounced; a hard bounce also sets never-email. */
export async function markBounced(db: Db, input: MarkBouncedInput) {
  const email = normalizeEmail(input.email);
  const ext = clean(input.touch_external_id);
  if (!email && !ext) throw new ToolError("Give the email address or the touch's external_id.");
  const at = iso(input.bounced_at, "bounced_at") ?? new Date().toISOString();
  let touch: Record<string, unknown> | null = null;
  let contact: Record<string, unknown> | null = null;
  if (ext) {
    touch = check(await db.from("sales_touches").select("id, contact_id, customer_id, occurred_at, bounced_at").eq("channel", "email").eq("external_id", ext).maybeSingle(), "Could not find the touch");
    if (!touch) throw new ToolError(`No email touch with external_id ${ext}.`);
    if (touch.contact_id) contact = check(await db.from("contacts").select("id, full_name, email, never_email").eq("id", touch.contact_id).maybeSingle(), "Could not read the contact");
  } else {
    contact = check(await db.from("contacts").select("id, full_name, email, never_email").ilike("email", email!).maybeSingle(), "Could not find the contact");
    if (!contact) throw new ToolError(`No contact with ${email}.`);
    const list = check(await db.from("sales_touches").select("id, contact_id, customer_id, occurred_at, bounced_at").eq("contact_id", contact.id).eq("channel", "email").eq("direction", "out").order("occurred_at", { ascending: false }).limit(1), "Could not read the touches") as Record<string, unknown>[];
    touch = list[0] ?? null;
    if (!touch) throw new ToolError(`No outbound email to ${email} is logged.`);
  }
  const hard = input.hard !== false;
  const setsNeverEmail = hard && !!contact && !contact.never_email;
  if (input.dry_run) return { touch_id: touch.id, contact: contact?.full_name ?? null, sets_never_email: setsNeverEmail, dry_run: true };
  check(await db.from("sales_touches").update({ bounced_at: at }).eq("id", touch.id), "Could not mark the bounce");
  if (setsNeverEmail) check(await db.from("contacts").update({ never_email: true, email_check_result: "bounced", email_checked_at: at }).eq("id", contact!.id), "Could not set never-email");
  return { touch_id: touch.id, contact: contact?.full_name ?? null, sets_never_email: setsNeverEmail, dry_run: false };
}

// ---------- overview ----------

/** The Command center in numbers: this week vs last week and targets, funnel vs a week ago, runs, usage, Caleb's tasks. */
export async function getSalesOverview(db: Db, input: { assignee?: string } = {}) {
  const now = new Date();
  const since21 = new Date(now.getTime() - 21 * 86_400_000).toISOString();
  const since14 = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [accounts, touches, events, inquiries, schedules, runs, usage, tasks, firstEmail] = await Promise.all([
    db.from("customers").select("id, company, name, sales_stage, fit_score").not("sales_stage", "is", null).limit(5000),
    db.from("sales_touches").select("customer_id, channel, direction, occurred_at, is_drip, bounced_at").gte("occurred_at", since21).limit(20000),
    db.from("sales_stage_events").select("customer_id, from_stage, to_stage, occurred_at, actor").gte("occurred_at", since21).limit(20000),
    db.from("customer_rfqs").select("id, customer_id, received_date, created_at").gte("created_at", since21).limit(2000),
    db.from("sales_schedules").select("*"),
    db.from("job_runs").select("job, status, started_at, credits, counts, cost_usd, needs_review, summary").gte("started_at", since14).limit(2000),
    db.from("usage_snapshots").select("taken_at, source, metric, value, unit, resets_at, plan, note").order("taken_at", { ascending: false }).limit(500),
    db.from("tasks").select("id, title, due_date, status, priority, assignee, customer_id").eq("status", "open").limit(3000),
    db.from("sales_touches").select("occurred_at").eq("channel", "email").eq("direction", "out").eq("is_drip", false).order("occurred_at", { ascending: true }).limit(1),
  ]);
  const acc = check(accounts, "Could not read the accounts") as { id: string; sales_stage: string | null; company: string | null; name: string; fit_score: number | null }[];
  const pipelineIds = new Set(acc.map(a => a.id));
  const wow = weekOverWeek(check(touches, "Could not read touches") ?? [], check(events, "Could not read stage moves") ?? [], check(inquiries, "Could not read inquiries") ?? [], pipelineIds, now);
  const targets = weekTargets(now, (firstEmail.data ?? [])[0]?.occurred_at ?? null);
  const board = runBoard((schedules.data ?? []) as CcSchedule[], runs.data ?? [], now).map(r => ({
    id: r.id, name: r.name, cadence: r.cadence, state: r.state, note: r.stateNote, last_report: r.lastRun?.started_at ?? null,
    last_fired: r.lastFired?.toISOString() ?? null, next_run: r.nextRun?.toISOString() ?? null, credit_budget: r.credit_budget ?? null, credits_this_week: r.creditsWeek,
    claude_week_pct_this_week: r.claudeWeek,
  }));
  const latest = latestUsage(usage.data ?? []);
  const due = tasksDue(tasks.data ?? [], now, input.assignee ?? "CQ");
  const slim = (t: { id: string; title: string; due_date: string | null; priority?: string | null }) => ({ id: t.id, title: t.title, due_date: t.due_date, priority: t.priority ?? "normal" });
  return {
    as_of: now.toISOString(),
    this_week: wow.thisWeek, last_week_same_point: wow.lastWeekSamePoint, last_week: wow.lastWeek, targets,
    funnel: funnelWeekAgo(acc, events.data ?? [], now),
    runs: board,
    usage: Object.fromEntries([...latest.entries()].map(([k, v]) => [k, v])),
    claude_pace: claudePace(latest.get("claude|weekly_pct"), now),
    claude: (() => {
      const w = latest.get("claude|weekly_pct"), sn = latest.get("claude|session_pct");
      const ws = istWeekStart(now).toISOString();
      const jobs = claudeWeekTotal((runs.data ?? []).filter((r: { started_at: string }) => r.started_at >= ws));
      return {
        weekly_pct: w ? Number(w.value) : null, weekly_resets_at: w?.resets_at ?? null, weekly_reset_since_reading: resetSinceReading(w, now),
        session_pct: sn ? Number(sn.value) : null, session_resets_at: sn?.resets_at ?? null, session_reset_since_reading: resetSinceReading(sn, now),
        read_at: w?.taken_at ?? sn?.taken_at ?? null,
        jobs_week_pct: jobs.pct, runs_measured: jobs.measured, runs_this_week: jobs.runs,
      };
    })(),
    credits: creditsByTool(runs.data ?? [], now),
    tasks: { overdue: due.overdue.map(slim), today: due.today.map(slim), next_7_days: due.week.map(slim) },
  };
}
