// Prospecting dashboard maths: funnel, send pace against targets, A/B results per message variant,
// and win/loss from inquiries. Pure, no imports outside sales-core.
import { SALES_STAGES } from "./sales-core";

const DAY = 86_400_000;

/** Caleb's send targets (23 Nov 2026): LinkedIn ~35 per weekday per seat, never above 200 a week; email ramps 8, 12, 16, then 20 a day while bounces stay under 2%. */
export const SEND_TARGETS = {
  linkedinPerWeekday: 35,
  linkedinWeeklyCap: 200,
  emailRamp: [8, 12, 16, 20] as const,
  researchedPerWeek: 500,
};
/** A variant needs this many sends before it can win. */
export const MIN_SENDS_PER_VARIANT = 100;

export type FunnelAccount = { sales_stage: string | null; source?: string | null; customer_type?: string | null; persona?: string | null };

/** Accounts per pipeline stage, cumulative "reached at least this stage" and the step-to-step rate. */
export function funnel(accounts: FunnelAccount[]) {
  const counts: Record<string, number> = {};
  for (const a of accounts) if (a.sales_stage) counts[a.sales_stage] = (counts[a.sales_stage] ?? 0) + 1;
  const steps = SALES_STAGES.map((s, i) => ({ stage: s, now: counts[s] ?? 0, reached: SALES_STAGES.slice(i).reduce((n, x) => n + (counts[x] ?? 0), 0) }));
  return steps.map((s, i) => ({ ...s, rate: i === 0 || !steps[i - 1].reached ? null : s.reached / steps[i - 1].reached }));
}

/** Top values of one field, with a count, biggest first. */
export function breakdown<T>(rows: T[], key: (r: T) => string | null | undefined, top = 8) {
  const m = new Map<string, number>();
  for (const r of rows) { const k = (key(r) ?? "").trim() || "Not set"; m.set(k, (m.get(k) ?? 0) + 1); }
  const list = [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  if (list.length <= top) return list;
  const rest = list.slice(top).reduce((s, x) => s + x.n, 0);
  return [...list.slice(0, top), { label: "Other", n: rest }];
}

export type SendTouch = {
  customer_id: string | null; contact_id?: string | null; channel: string; direction: "in" | "out"; occurred_at: string;
  variant?: string | null; test_name?: string | null; is_drip?: boolean | null; sender_account?: string | null;
};

/** Monday 00:00 UTC of the week holding `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - dow * DAY);
}

/** Today's email target on the ramp, counted from the first email we ever sent (week 1 = 8 a day). */
export function emailTargetToday(firstEmailAt: string | null, now = new Date()): number {
  if (!firstEmailAt) return SEND_TARGETS.emailRamp[0];
  const weeks = Math.floor((weekStart(now).getTime() - weekStart(new Date(firstEmailAt)).getTime()) / (7 * DAY));
  return SEND_TARGETS.emailRamp[Math.min(Math.max(weeks, 0), SEND_TARGETS.emailRamp.length - 1)];
}

/** This week's outbound against target, per channel; drip sends are not outreach and are left out. */
export function sendPace(touches: SendTouch[], now = new Date(), firstEmailAt: string | null = null) {
  const ws = weekStart(now).toISOString();
  const today = now.toISOString().slice(0, 10);
  const weekdaysSoFar = Math.min(5, ((now.getUTCDay() + 6) % 7) + 1);
  const out = touches.filter(t => t.direction === "out" && !t.is_drip && t.occurred_at >= ws);
  const li = out.filter(t => t.channel === "linkedin");
  const em = out.filter(t => t.channel === "email");
  const emailDaily = emailTargetToday(firstEmailAt, now);
  const liWeekTarget = Math.min(SEND_TARGETS.linkedinWeeklyCap, SEND_TARGETS.linkedinPerWeekday * 5);
  return {
    linkedin: { week: li.length, today: li.filter(t => t.occurred_at.slice(0, 10) === today).length, dailyTarget: SEND_TARGETS.linkedinPerWeekday, weekTarget: liWeekTarget, dueSoFar: Math.min(liWeekTarget, SEND_TARGETS.linkedinPerWeekday * weekdaysSoFar), overCap: li.length > SEND_TARGETS.linkedinWeeklyCap },
    email: { week: em.length, today: em.filter(t => t.occurred_at.slice(0, 10) === today).length, dailyTarget: emailDaily, weekTarget: emailDaily * 5, dueSoFar: emailDaily * weekdaysSoFar },
    other: out.length - li.length - em.length,
    repliesThisWeek: touches.filter(t => t.direction === "in" && t.occurred_at >= ws).length,
  };
}

export type VariantResult = { test: string; variant: string; sends: number; replied: number; rate: number; enough: boolean; winner: boolean };

/**
 * A/B results: each outbound touch with a variant counts as one send; it counts as replied when the same
 * person (or account, if no person) wrote back within `windowDays`. Winner = enough sends on every variant
 * of the test and the best rate at least 1.5x the next one.
 */
export function experiments(touches: SendTouch[], windowDays = 30): VariantResult[] {
  const inbound = new Map<string, string[]>();
  for (const t of touches) if (t.direction === "in") {
    for (const k of [t.contact_id && `c:${t.contact_id}`, t.customer_id && `a:${t.customer_id}`].filter(Boolean) as string[])
      (inbound.get(k) ?? inbound.set(k, []).get(k)!).push(t.occurred_at);
  }
  const groups = new Map<string, VariantResult>();
  for (const t of touches) {
    if (t.direction !== "out" || !t.variant) continue;
    const test = t.test_name?.trim() || "Untitled test";
    const key = `${test}|${t.variant}`;
    const g = groups.get(key) ?? { test, variant: t.variant, sends: 0, replied: 0, rate: 0, enough: false, winner: false };
    g.sends++;
    const until = new Date(new Date(t.occurred_at).getTime() + windowDays * DAY).toISOString();
    const keyIn = t.contact_id ? `c:${t.contact_id}` : t.customer_id ? `a:${t.customer_id}` : null;
    if (keyIn && (inbound.get(keyIn) ?? []).some(at => at > t.occurred_at && at <= until)) g.replied++;
    groups.set(key, g);
  }
  const list = [...groups.values()].map(g => ({ ...g, rate: g.sends ? g.replied / g.sends : 0, enough: g.sends >= MIN_SENDS_PER_VARIANT }));
  const byTest = new Map<string, VariantResult[]>();
  for (const g of list) (byTest.get(g.test) ?? byTest.set(g.test, []).get(g.test)!).push(g);
  for (const vs of byTest.values()) {
    vs.sort((a, b) => b.rate - a.rate);
    if (vs.length >= 2 && vs.every(v => v.enough) && vs[0].rate > 0 && vs[0].rate >= 1.5 * vs[1].rate) vs[0].winner = true;
  }
  return [...byTest.values()].flat();
}

export type InquiryLite = { id: string; status: string; customer_id: string | null; source_channel?: string | null; received_date?: string | null; created_at?: string | null };

const WON = new Set(["po", "complete"]);
const LOST = new Set(["cancelled"]);

/** Inquiries by outcome, overall and per source channel id. */
export function winLoss(inquiries: InquiryLite[]) {
  const total = { open: 0, won: 0, lost: 0 };
  const byChannel = new Map<string, { open: number; won: number; lost: number }>();
  for (const q of inquiries) {
    const k = WON.has(q.status) ? "won" : LOST.has(q.status) ? "lost" : "open";
    total[k]++;
    const ch = q.source_channel?.trim() || "";
    const g = byChannel.get(ch) ?? { open: 0, won: 0, lost: 0 };
    g[k]++;
    byChannel.set(ch, g);
  }
  const decided = total.won + total.lost;
  return { ...total, winRate: decided ? total.won / decided : null, byChannel };
}
