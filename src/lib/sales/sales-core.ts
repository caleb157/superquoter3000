// Sales section rules shared by the app and the PD HQ connector.
// No imports: the connector bundles this file through a relative path.

export const SALES_STAGES = ["queued", "in_outreach", "responded", "in_conversation", "inquiry", "customer"] as const;
export const SALES_EXITS = ["not_now", "not_a_fit", "dnc"] as const;
export const ALL_SALES_STAGES = [...SALES_STAGES, ...SALES_EXITS] as const;
export type SalesStage = (typeof ALL_SALES_STAGES)[number];

export const SALES_STAGE_LABELS: Record<SalesStage, string> = {
  queued: "Queued",
  in_outreach: "In outreach",
  responded: "Responded",
  in_conversation: "In conversation",
  inquiry: "Inquiry",
  customer: "Customer",
  not_now: "Not now",
  not_a_fit: "Not a fit",
  dnc: "Do not contact",
};

export const TOUCH_CHANNELS = ["linkedin", "email", "whatsapp", "call", "meeting", "other"] as const;
export type TouchChannel = (typeof TOUCH_CHANNELS)[number];

export const BRIEF_PARTS = [
  "company",
  "products_close_to_ours",
  "market",
  "india_buying",
  "qualification",
  "conversation_so_far",
  "suggested_next_move",
  "watch_outs",
] as const;
export type BriefPart = (typeof BRIEF_PARTS)[number];
export const BRIEF_PART_LABELS: Record<BriefPart, string> = {
  company: "Company",
  products_close_to_ours: "Products close to ours",
  market: "Market and customers",
  india_buying: "Buying from India",
  qualification: "Qualification",
  conversation_so_far: "Conversation so far",
  suggested_next_move: "Suggested next move",
  watch_outs: "Watch outs",
};
export type Brief = Partial<Record<BriefPart, { text: string; source?: string | null }>>;

/** Days a brief stays fresh before the watchdog refreshes it. */
export const BRIEF_FRESH_DAYS = 90;
/** Their message unanswered this many days = a forgotten conversation. */
export const FORGOTTEN_DAYS = 4;
/** Nudges to engaged contacts when we sent last: 1 week, then 1 month, then 1 quarter. */
export const NUDGE_GAP_DAYS = [7, 30, 90] as const;
/** After nudge 3 the account goes to Not now with a follow-up this many days out. */
export const NOT_NOW_DAYS = 182;

const DAY = 86_400_000;

export const addDaysYmd = (from: Date | string, days: number): string => {
  const d = typeof from === "string" ? new Date(from) : from;
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
};

/** LinkedIn profile URLs compared without protocol, www, query or trailing slash. */
export function normalizeLinkedin(url?: string | null): string | null {
  if (!url) return null;
  const m = url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^(www\.|[a-z]{2}\.)/, "").split(/[?#]/)[0].replace(/\/+$/, "");
  if (!m.startsWith("linkedin.com/")) return null;
  return `https://www.${m}`;
}

export const normalizeEmail = (e?: string | null): string | null => {
  const v = e?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
};

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "live.com", "msn.com", "proton.me", "protonmail.com"]);

/** A company's domain from a website or an email; free mail domains give nothing. */
export function normalizeDomain(v?: string | null): string | null {
  if (!v) return null;
  let s = v.trim().toLowerCase();
  if (s.includes("@")) s = s.split("@").pop() ?? "";
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) || FREE_MAIL.has(s)) return null;
  return s;
}

export type ContactFlags = { dnc?: boolean | null; never_email?: boolean | null; email?: string | null; linkedin_url?: string | null; whatsapp?: string | null; phone?: string | null };
export type AccountFlags = { dnc?: boolean | null; sales_stage?: string | null; not_now_until?: string | null };

/**
 * The one check every sender makes right before sending. Do not contact (person or account) always
 * blocks; email also needs an address and no never-email flag; Not now blocks until its date.
 */
export function canContact(
  contact: ContactFlags | null,
  account: AccountFlags | null,
  channel: TouchChannel,
  today = new Date().toISOString().slice(0, 10),
): { allowed: boolean; reason: string | null } {
  if (contact?.dnc) return { allowed: false, reason: "Person is on do not contact" };
  if (account?.dnc || account?.sales_stage === "dnc") return { allowed: false, reason: "Account is on do not contact" };
  if (account?.sales_stage === "not_a_fit") return { allowed: false, reason: "Account is marked not a fit" };
  if (account?.sales_stage === "not_now" && account.not_now_until && account.not_now_until > today)
    return { allowed: false, reason: `Not now until ${account.not_now_until}` };
  if (channel === "email") {
    if (contact?.never_email) return { allowed: false, reason: "Never email (bounced or unsubscribed)" };
    if (contact && !contact.email) return { allowed: false, reason: "No email address" };
  }
  if (channel === "linkedin" && contact && !contact.linkedin_url) return { allowed: false, reason: "No LinkedIn profile" };
  if (channel === "whatsapp" && contact && !contact.whatsapp && !contact.phone) return { allowed: false, reason: "No WhatsApp number" };
  return { allowed: true, reason: null };
}

export type TouchLite = { direction: "in" | "out"; occurred_at: string };

/** Their last message is newer than ours and has waited FORGOTTEN_DAYS or more. */
export function isForgotten(touches: TouchLite[], now = new Date()): { forgotten: boolean; waitingDays: number } {
  const lastIn = touches.filter(t => t.direction === "in").map(t => t.occurred_at).sort().pop();
  const lastOut = touches.filter(t => t.direction === "out").map(t => t.occurred_at).sort().pop();
  if (!lastIn || (lastOut && lastOut >= lastIn)) return { forgotten: false, waitingDays: 0 };
  const days = Math.floor((now.getTime() - new Date(lastIn).getTime()) / DAY);
  return { forgotten: days >= FORGOTTEN_DAYS, waitingDays: days };
}

/**
 * Next nudge for an engaged contact when we sent last. nudgesSent counts the nudges already sent
 * since their last reply. After 3 the account moves to Not now, about 6 months out.
 */
export function nextNudge(lastOutAt: string, nudgesSent: number):
  | { kind: "nudge"; step: 1 | 2 | 3; due: string }
  | { kind: "not_now"; until: string } {
  if (nudgesSent >= NUDGE_GAP_DAYS.length) return { kind: "not_now", until: addDaysYmd(lastOutAt, NOT_NOW_DAYS) };
  const step = (nudgesSent + 1) as 1 | 2 | 3;
  return { kind: "nudge", step, due: addDaysYmd(lastOutAt, NUDGE_GAP_DAYS[nudgesSent]) };
}

export type NeedsYouItem = {
  kind: "forgotten" | "qualified" | "nudge" | "draft" | "task" | "quiet" | "back";
  due_date?: string | null;
  waitingDays?: number;
  engaged?: boolean;
};

const NEEDS_RANK: Record<NeedsYouItem["kind"], number> = { forgotten: 0, qualified: 1, nudge: 2, draft: 3, task: 4, quiet: 5, back: 6 };

/** A responded account with no message either way for this many days and nothing planned has gone quiet. */
export const QUIET_DAYS = 10;

/**
 * Needs you order: forgotten conversations, then qualified accounts, then nudges, drafts and due tasks,
 * then warm accounts with nothing planned (engaged people first), then accounts back from Not now.
 */
export function sortNeedsYou<T extends NeedsYouItem>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    NEEDS_RANK[a.kind] - NEEDS_RANK[b.kind]
    || Number(!!b.engaged) - Number(!!a.engaged)
    || (b.waitingDays ?? 0) - (a.waitingDays ?? 0)
    || String(a.due_date ?? "9999").localeCompare(String(b.due_date ?? "9999")));
}

export const isBriefStale = (updatedAt?: string | null, now = new Date()) =>
  !updatedAt || now.getTime() - new Date(updatedAt).getTime() > BRIEF_FRESH_DAYS * DAY;

/** Words in a message, for A/B records. */
export const wordCount = (text?: string | null) => (text?.trim() ? text.trim().split(/\s+/).length : 0);
