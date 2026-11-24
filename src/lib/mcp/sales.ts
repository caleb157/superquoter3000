// Sales CRM logic for the PD HQ connector: (db, input) functions, tested with the fake db.
// Relative imports only (see AGENTS.md).
import { check, isValidYmd, ToolError, type Db } from "./shared";
import { activeAccountDismissals, liveDismissals } from "./needs-you";
import {
  ALL_SALES_STAGES, BRIEF_PARTS, canContact, isDismissalActive, normalizeDomain, normalizeEmail, normalizeLinkedin, stageAfterTouch, wordCount,
  type Brief, type SalesStage, type TouchChannel,
} from "../sales/sales-core";

export const ACCOUNT_COLUMNS =
  "id, name, company, email, domain, country, persona, customer_type, fit_score, owner, lead_status, sales_stage, sales_stage_changed_at, not_now_until, next_step, next_step_date, brief_updated_at, dnc, last_contacted_at, source, linkedin_url";
export const CONTACT_COLUMNS =
  "id, customer_id, full_name, title, persona, email, linkedin_url, phone, whatsapp, engaged, never_email, dnc, dnc_reason, drip_enrolled, drip_track, waalaxy_prospect_id, apollo_contact_id, linkedin_account";

const exact = (v: string) => v.trim().replace(/[\\%_]/g, m => `\\${m}`);
const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);

// ---------- accounts ----------

export type UpsertAccountInput = {
  company: string;
  domain?: string;
  website?: string;
  country?: string;
  persona?: string;
  customer_type?: string;
  fit_score?: number;
  owner?: string;
  source?: string;
  linkedin_url?: string;
  notes?: string;
  sales_stage?: SalesStage;
  dry_run?: boolean;
};

/** Find an account by domain, then exact company name; create it as a prospect (fires no Lead task rules) when none matches. */
export async function upsertAccount(db: Db, input: UpsertAccountInput) {
  const company = input.company?.trim();
  if (!company) throw new ToolError("Give the company name.");
  const domain = normalizeDomain(input.domain ?? input.website ?? null);
  let found = null as Record<string, unknown> | null;
  let matched_on: string | null = null;
  if (domain) {
    const rows = check(await db.from("customers").select(ACCOUNT_COLUMNS).ilike("domain", exact(domain)).limit(2), "Could not search accounts") ?? [];
    if (rows.length) { found = rows[0]; matched_on = "domain"; }
  }
  if (!found) {
    const rows = check(await db.from("customers").select(ACCOUNT_COLUMNS).ilike("company", exact(company)).order("created_at", { ascending: true }).limit(2), "Could not search accounts") ?? [];
    if (rows.length) { found = rows[0]; matched_on = "company"; }
  }
  const fields: Record<string, unknown> = {};
  if (domain) fields.domain = domain;
  for (const k of ["country", "persona", "customer_type", "owner", "source", "linkedin_url"] as const) {
    const v = clean(input[k]);
    if (v) fields[k] = k === "owner" ? v.toUpperCase() : v;
  }
  if (input.fit_score != null) fields.fit_score = Math.round(input.fit_score);
  if (found) {
    // Fill gaps and update sales fields; never overwrite a name, and never move the stage here (use set_sales_stage).
    const OVERWRITE = new Set(["fit_score", "persona", "customer_type", "owner"]);
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(fields).filter(([k, v]) =>
      v != null && found![k] !== v && (OVERWRITE.has(k) || found![k] == null || found![k] === "")));
    if (!found.sales_stage && input.sales_stage) patch.sales_stage = input.sales_stage;
    if (input.dry_run || !Object.keys(patch).length) return { account: { ...found, ...patch }, created: false, updated: Object.keys(patch), matched_on, dry_run: !!input.dry_run };
    const account = check(await db.from("customers").update(patch).eq("id", found.id).select(ACCOUNT_COLUMNS).single(), "Could not update the account");
    return { account, created: false, updated: Object.keys(patch), matched_on, dry_run: false };
  }
  // lead_status is not written: the database mirrors it from sales_stage.
  const row = { name: company, company, sales_stage: input.sales_stage ?? "queued", notes: clean(input.notes), ...fields };
  if (input.dry_run) return { account: row, created: false, would_create: true, matched_on: null, dry_run: true };
  const account = check(await db.from("customers").insert(row).select(ACCOUNT_COLUMNS).single(), "Could not create the account");
  return { account, created: true, matched_on: null, dry_run: false };
}

// ---------- contacts ----------

export type UpsertContactInput = {
  customer_id?: string;
  full_name: string;
  title?: string;
  persona?: string;
  email?: string;
  email_source?: string;
  email_check_result?: string;
  lookup_cost_usd?: number;
  linkedin_url?: string;
  phone?: string;
  whatsapp?: string;
  engaged?: boolean;
  never_email?: boolean;
  drip_enrolled?: boolean;
  drip_track?: string;
  waalaxy_prospect_id?: string;
  apollo_contact_id?: string;
  linkedin_account?: string;
  notes?: string;
  dry_run?: boolean;
};

async function findContact(db: Db, keys: { linkedin?: string | null; email?: string | null; id?: string }) {
  if (keys.id) return check(await db.from("contacts").select(CONTACT_COLUMNS).eq("id", keys.id).maybeSingle(), "Could not read the contact");
  if (keys.linkedin) {
    const rows = check(await db.from("contacts").select(CONTACT_COLUMNS).ilike("linkedin_url", exact(keys.linkedin)).limit(1), "Could not search contacts") ?? [];
    if (rows.length) return rows[0];
  }
  if (keys.email) {
    const rows = check(await db.from("contacts").select(CONTACT_COLUMNS).ilike("email", exact(keys.email)).limit(1), "Could not search contacts") ?? [];
    if (rows.length) return rows[0];
  }
  return null;
}

/** Match a person on LinkedIn URL, then email; create them otherwise. Do not contact is never set or cleared here. */
export async function upsertContact(db: Db, input: UpsertContactInput) {
  const full_name = input.full_name?.trim();
  if (!full_name) throw new ToolError("Give the person's name.");
  const linkedin = normalizeLinkedin(input.linkedin_url);
  if (input.linkedin_url && !linkedin) throw new ToolError(`"${input.linkedin_url}" is not a LinkedIn profile URL.`);
  const email = normalizeEmail(input.email);
  if (input.email && !email) throw new ToolError(`"${input.email}" is not an email address.`);
  if (input.customer_id) {
    const acct = check(await db.from("customers").select("id").eq("id", input.customer_id).maybeSingle(), "Could not read the account");
    if (!acct) throw new ToolError(`Account ${input.customer_id} not found.`);
  }
  const fields: Record<string, unknown> = { full_name };
  if (linkedin) fields.linkedin_url = linkedin;
  if (email) { fields.email = email; fields.email_checked_at = input.email_check_result ? new Date().toISOString() : undefined; }
  for (const k of ["title", "persona", "email_source", "email_check_result", "phone", "whatsapp", "drip_track", "waalaxy_prospect_id", "apollo_contact_id", "linkedin_account", "notes"] as const) {
    const v = clean(input[k]);
    if (v) fields[k] = v;
  }
  if (input.lookup_cost_usd != null) fields.lookup_cost_usd = input.lookup_cost_usd;
  if (input.customer_id) fields.customer_id = input.customer_id;
  if (input.engaged != null) fields.engaged = input.engaged;
  if (input.never_email) fields.never_email = true;
  if (input.drip_enrolled != null) fields.drip_enrolled = input.drip_enrolled;
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];

  const found = await findContact(db, { linkedin, email });
  if (found) {
    if (found.dnc && input.drip_enrolled) throw new ToolError(`${found.full_name} is on do not contact and cannot join the drip.`);
    const patch = Object.fromEntries(Object.entries(fields).filter(([k, v]) => v != null && found[k] !== v && !(k === "full_name" && found.full_name)));
    if (input.dry_run || !Object.keys(patch).length) return { contact: { ...found, ...patch }, created: false, updated: Object.keys(patch), dry_run: !!input.dry_run };
    const contact = check(await db.from("contacts").update(patch).eq("id", found.id).select(CONTACT_COLUMNS).single(), "Could not update the contact");
    return { contact, created: false, updated: Object.keys(patch), dry_run: false };
  }
  if (!linkedin && !email) throw new ToolError("A new contact needs a LinkedIn URL or an email, so later syncs can match them.");
  if (input.dry_run) return { contact: fields, created: false, would_create: true, dry_run: true };
  const contact = check(await db.from("contacts").insert(fields).select(CONTACT_COLUMNS).single(), "Could not create the contact");
  return { contact, created: true, dry_run: false };
}

// ---------- do not contact ----------

type Who = { contact_id?: string; email?: string; linkedin_url?: string; customer_id?: string };

async function resolveWho(db: Db, who: Who) {
  const contact = who.contact_id || who.email || who.linkedin_url
    ? await findContact(db, { id: who.contact_id, email: normalizeEmail(who.email), linkedin: normalizeLinkedin(who.linkedin_url) })
    : null;
  const customerId = who.customer_id ?? contact?.customer_id ?? null;
  const account = customerId
    ? check(await db.from("customers").select(ACCOUNT_COLUMNS).eq("id", customerId).maybeSingle(), "Could not read the account")
    : null;
  return { contact, account };
}

export type CheckCanContactInput = { channel: TouchChannel; people: Who[]; sender?: string; log_blocks?: boolean };

/** The check every sender calls right before sending. Blocked sends are logged to send_blocks unless log_blocks is false. */
export async function checkCanContact(db: Db, input: CheckCanContactInput) {
  if (!input.people?.length) throw new ToolError("Give at least one person.");
  const results = [];
  for (const who of input.people.slice(0, 200)) {
    const { contact, account } = await resolveWho(db, who);
    const known = !!(contact || account);
    const verdict = canContact(contact, account, input.channel);
    results.push({ ...who, known, contact_id: contact?.id ?? null, customer_id: account?.id ?? null, ...verdict });
    if (!verdict.allowed && input.log_blocks !== false && (contact || account)) {
      check(await db.from("send_blocks").insert({
        contact_id: contact?.id ?? null, customer_id: account?.id ?? null, channel: input.channel, sender: clean(input.sender), reason: verdict.reason,
      }), "Could not log the blocked send");
    }
  }
  return { channel: input.channel, allowed: results.filter(r => r.allowed).length, blocked: results.filter(r => !r.allowed).length, results };
}

export type SetDncInput = Who & { reason: string; source: string; whole_account?: boolean; dry_run?: boolean };

/**
 * Removal request: set the master flag (person, or the whole account), which also stops the drip, sets
 * never-email and moves the account to Do not contact when the whole account is named.
 * Returns the follow-ups outside PD HQ (Waalaxy, email lists) for the caller to do next.
 */
export async function setDoNotContact(db: Db, input: SetDncInput) {
  const reason = input.reason?.trim();
  if (!reason) throw new ToolError("Give the reason, e.g. 'asked to be removed on LinkedIn 23 Nov'.");
  const { contact, account } = await resolveWho(db, input);
  if (!contact && !account) throw new ToolError("No contact or account matches. Create the contact first (upsert_contact), then set do not contact.");
  const now = new Date().toISOString();
  const plan = {
    contact: contact ? { id: contact.id, name: contact.full_name, already: !!contact.dnc } : null,
    account: account && (input.whole_account || !contact) ? { id: account.id, name: account.company ?? account.name, already: !!account.dnc } : null,
  };
  const follow_ups = [
    contact?.waalaxy_prospect_id || contact?.linkedin_url ? "Mark the person do not contact in Waalaxy (mark_prospects_do_not_contact) on every seat." : null,
    contact?.email ? `Add ${contact.email} to the never-email list used by every email sender.` : null,
    "Stop any drafted follow-ups for them (save_follow_up with draft_status skipped).",
  ].filter(Boolean);
  if (input.dry_run) return { ...plan, dry_run: true, follow_ups };
  if (plan.contact && !plan.contact.already) {
    check(await db.from("contacts").update({ dnc: true, dnc_at: now, dnc_source: input.source, dnc_reason: reason }).eq("id", contact.id), "Could not set do not contact on the person");
  }
  if (plan.account && !plan.account.already) {
    check(await db.from("customers").update({ dnc: true, dnc_at: now, dnc_source: input.source, dnc_reason: reason }).eq("id", account.id), "Could not set do not contact on the account");
  }
  // Open drafts for this person or account are skipped so nothing queued goes out.
  if (contact) check(await db.from("tasks").update({ draft_status: "skipped" }).eq("contact_id", contact.id).eq("draft_status", "draft"), "Could not skip open drafts");
  if (plan.account) check(await db.from("tasks").update({ draft_status: "skipped" }).eq("customer_id", account.id).eq("draft_status", "draft"), "Could not skip open drafts");
  return { ...plan, dry_run: false, follow_ups };
}

// ---------- touches ----------

export type LogTouchInput = {
  contact_id?: string;
  customer_id?: string;
  channel: TouchChannel;
  direction: "in" | "out";
  occurred_at?: string;
  body?: string;
  subject?: string;
  sender_account?: string;
  external_id?: string;
  auto_sent?: boolean;
  is_drip?: boolean;
  drip_issue?: string;
  variant?: string;
  test_name?: string;
  angle?: string;
  persona?: string;
  step?: number;
  opener_type?: string;
  engaged?: boolean;
  logged_by?: string;
  dry_run?: boolean;
};

/**
 * Log one message in or out. Safe to repeat with the same external_id (returns the existing touch).
 * Outbound to do-not-contact is refused here and at the database.
 * Stage moves follow stageAfterTouch: a reply from Queued, In outreach or Not now = Responded, an engaged reply
 * on Responded = In conversation, our first message from Queued = In outreach.
 */
export async function logTouch(db: Db, input: LogTouchInput) {
  if (!input.contact_id && !input.customer_id) throw new ToolError("Give contact_id or customer_id.");
  const { contact, account } = await resolveWho(db, { contact_id: input.contact_id, customer_id: input.customer_id });
  if (input.contact_id && !contact) throw new ToolError(`Contact ${input.contact_id} not found.`);
  if (input.customer_id && !account) throw new ToolError(`Account ${input.customer_id} not found.`);
  if (input.occurred_at && Number.isNaN(Date.parse(input.occurred_at))) throw new ToolError("occurred_at must be an ISO date-time.");
  const external_id = clean(input.external_id);
  if (external_id) {
    const dup = check(await db.from("sales_touches").select("id, occurred_at, direction").eq("channel", input.channel).eq("external_id", external_id).maybeSingle(), "Could not check for a duplicate");
    if (dup) return { touch: dup, created: false, duplicate: true, dry_run: !!input.dry_run };
  }
  if (input.direction === "out") {
    const v = canContact(contact, account, input.channel);
    if (!v.allowed) throw new ToolError(`Not logged: ${v.reason}.`);
  }
  const row: Record<string, unknown> = {
    contact_id: contact?.id ?? null,
    customer_id: account?.id ?? contact?.customer_id ?? null,
    channel: input.channel,
    direction: input.direction,
    occurred_at: input.occurred_at ?? new Date().toISOString(),
    body: clean(input.body),
    subject: clean(input.subject),
    sender_account: clean(input.sender_account),
    external_id,
    auto_sent: !!input.auto_sent,
    is_drip: !!input.is_drip,
    drip_issue: clean(input.drip_issue),
    variant: clean(input.variant),
    test_name: clean(input.test_name),
    angle: clean(input.angle),
    persona: clean(input.persona),
    step: input.step ?? null,
    opener_type: clean(input.opener_type),
    word_count: input.direction === "out" ? wordCount(input.body) : null,
    logged_by: clean(input.logged_by),
  };
  // Same rule as the app's Log message (stageAfterTouch in sales-core). An older message logged late (a sync
  // catching up) never brings a Not now account back: only a reply after it was parked does.
  const occurredAt = (row.occurred_at as string);
  const parkedLater = account?.sales_stage === "not_now" && !!account.sales_stage_changed_at && occurredAt < account.sales_stage_changed_at;
  const stageMove = account && !parkedLater
    ? stageAfterTouch(account.sales_stage, input.direction, !!input.engaged)
    : null;
  if (input.dry_run) return { touch: row, created: false, dry_run: true, stage_move: stageMove, marks_engaged: !!input.engaged && !!contact && !contact.engaged };
  const touch = check(await db.from("sales_touches").insert(row).select("id, channel, direction, occurred_at, customer_id, contact_id").single(), "Could not log the touch");
  if (input.engaged && contact && !contact.engaged) check(await db.from("contacts").update({ engaged: true }).eq("id", contact.id), "Could not mark the contact engaged");
  if (stageMove && account) {
    await setSalesStage(db, { customer_id: account.id, stage: stageMove, reason: input.direction === "in" ? `Reply on ${input.channel}` : `First ${input.channel} message sent` });
  }
  return { touch, created: true, dry_run: false, stage_move: stageMove };
}

// ---------- stages ----------

export type SetStageInput = { customer_id: string; stage: SalesStage; reason: string; not_now_until?: string; actor?: string; dry_run?: boolean };

/** Move an account's stage with a one-line reason (logged on sales_stage_events). Do not contact is set with set_do_not_contact. */
export async function setSalesStage(db: Db, input: SetStageInput) {
  if (!ALL_SALES_STAGES.includes(input.stage)) throw new ToolError(`Unknown stage ${input.stage}.`);
  if (input.stage === "dnc") throw new ToolError("Use set_do_not_contact for removal requests, so every sender is told.");
  const reason = input.reason?.trim();
  if (!reason) throw new ToolError("Give a one-line reason for the move.");
  if (input.stage === "not_now" && !(input.not_now_until && isValidYmd(input.not_now_until))) throw new ToolError("Not now needs not_now_until as YYYY-MM-DD.");
  const account = check(await db.from("customers").select(ACCOUNT_COLUMNS).eq("id", input.customer_id).maybeSingle(), "Could not read the account");
  if (!account) throw new ToolError(`Account ${input.customer_id} not found.`);
  if (account.dnc) throw new ToolError(`${account.company ?? account.name} is on do not contact; only Caleb can clear that in PD HQ.`);
  const patch: Record<string, unknown> = { sales_stage: input.stage, not_now_until: input.stage === "not_now" ? input.not_now_until : null };
  if (input.dry_run) return { from: account.sales_stage, to: input.stage, patch, changed: account.sales_stage !== input.stage, dry_run: true };
  if (account.sales_stage === input.stage && (input.stage !== "not_now" || account.not_now_until === input.not_now_until)) return { from: account.sales_stage, to: input.stage, changed: false, dry_run: false };
  check(await db.from("customers").update(patch).eq("id", account.id), "Could not move the stage");
  // The trigger logged the move; write the reason and actor on that newest row.
  const ev = check(await db.from("sales_stage_events").select("id").eq("customer_id", account.id).eq("to_stage", input.stage).order("occurred_at", { ascending: false }).limit(1), "Could not read the stage log") ?? [];
  if (ev.length) check(await db.from("sales_stage_events").update({ reason, ...(input.actor ? { actor: input.actor } : {}) }).eq("id", ev[0].id), "Could not save the reason");
  return { from: account.sales_stage, to: input.stage, changed: true, dry_run: false };
}

// ---------- brief ----------

export type SaveBriefInput = { customer_id: string; parts: Brief; next_step?: string; next_step_date?: string; dry_run?: boolean };

/** Save the 8-part brief at the top of the account page (each part with its source link). Parts not given are kept. */
export async function saveBrief(db: Db, input: SaveBriefInput) {
  const unknown = Object.keys(input.parts ?? {}).filter(k => !BRIEF_PARTS.includes(k as never));
  if (unknown.length) throw new ToolError(`Unknown brief parts: ${unknown.join(", ")}. Use: ${BRIEF_PARTS.join(", ")}.`);
  if (input.next_step_date && !isValidYmd(input.next_step_date)) throw new ToolError("next_step_date must be YYYY-MM-DD.");
  const account = check(await db.from("customers").select("id, company, name, brief").eq("id", input.customer_id).maybeSingle(), "Could not read the account");
  if (!account) throw new ToolError(`Account ${input.customer_id} not found.`);
  const brief = { ...(account.brief ?? {}), ...input.parts };
  const patch: Record<string, unknown> = { brief, brief_updated_at: new Date().toISOString() };
  if (input.next_step) patch.next_step = input.next_step.trim();
  if (input.next_step_date) patch.next_step_date = input.next_step_date;
  if (input.dry_run) return { customer_id: account.id, brief, dry_run: true };
  check(await db.from("customers").update(patch).eq("id", account.id), "Could not save the brief");
  return { customer_id: account.id, parts: Object.keys(brief), dry_run: false };
}

// ---------- follow-ups ----------

export type SaveFollowUpInput = {
  task_id?: string;
  customer_id?: string;
  contact_id?: string;
  title?: string;
  due_date?: string;
  nudge_step?: number;
  draft_text?: string;
  draft_channel?: TouchChannel;
  draft_status?: "draft" | "approved" | "sent" | "skipped";
  assignee?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  /** Create it even though Caleb marked this account's Needs you item done or ignored (only when he asked). */
  override_dismissal?: boolean;
  dry_run?: boolean;
};

/** A follow-up is an ordinary task on the account, carrying the nudge step and an editable draft for Caleb to approve. */
export async function saveFollowUp(db: Db, input: SaveFollowUpInput) {
  if (input.due_date && !isValidYmd(input.due_date)) throw new ToolError("due_date must be YYYY-MM-DD.");
  if (input.nudge_step != null && (input.nudge_step < 1 || input.nudge_step > 3)) throw new ToolError("nudge_step is 1, 2 or 3; after 3 the account goes to Not now.");
  if (input.task_id) {
    const t = check(await db.from("tasks").select("id, title, status, draft_status").eq("id", input.task_id).maybeSingle(), "Could not read the task");
    if (!t) throw new ToolError(`Task ${input.task_id} not found.`);
    const patch: Record<string, unknown> = {};
    for (const k of ["due_date", "nudge_step", "draft_text", "draft_channel", "draft_status", "priority"] as const) if (input[k] != null) patch[k] = input[k];
    if (input.title) patch.title = input.title.trim();
    if (input.draft_status === "sent" || input.draft_status === "skipped") { patch.status = "done"; patch.completed_at = new Date().toISOString(); }
    if (input.dry_run) return { task: { ...t, ...patch }, created: false, dry_run: true };
    const task = check(await db.from("tasks").update(patch).eq("id", t.id).select("id, title, due_date, draft_status, nudge_step").single(), "Could not update the follow-up");
    return { task, created: false, dry_run: false };
  }
  if (!input.customer_id) throw new ToolError("A new follow-up needs customer_id.");
  if (!input.due_date) throw new ToolError("A new follow-up needs due_date.");
  const { contact, account } = await resolveWho(db, { customer_id: input.customer_id, contact_id: input.contact_id });
  if (!account) throw new ToolError(`Account ${input.customer_id} not found.`);
  if (!input.override_dismissal) {
    // Caleb's Done / Ignore holds until a new message comes in; a re-run must not put the account back on Needs you.
    const held = await activeAccountDismissals(db, account);
    if (held.length) {
      const d = held[0];
      const what = d.action === "done" ? "marked it done" : d.until ? `ignored it until ${d.until}` : "ignored it";
      throw new ToolError(`No follow-up saved: Caleb ${what} on Needs you (${d.item_key}, ${d.dismissed_at.slice(0, 10)}) and no new message has come in since. Pass override_dismissal only if he asked for this follow-up.`);
    }
  }
  if (input.draft_text && input.draft_channel) {
    // Judged on the due date, so a draft for the end of a Not now period is fine.
    const v = canContact(contact, account, input.draft_channel, input.due_date);
    if (!v.allowed) throw new ToolError(`No draft saved: ${v.reason}.`);
  }
  const who = contact?.full_name ? ` (${contact.full_name})` : "";
  const name = account.company ?? account.name;
  const row = {
    title: (input.title?.trim() || (input.nudge_step ? `Nudge ${input.nudge_step}: ${name}${who}` : `Reply to ${name}${who}`)).slice(0, 500),
    status: "open",
    priority: input.priority ?? (input.nudge_step ? "normal" : "high"),
    due_date: input.due_date,
    assignee: (input.assignee ?? account.owner ?? "CQ").toUpperCase(),
    customer_id: account.id,
    association_type: "customer",
    association_id: account.id,
    association_label: name,
    contact_id: contact?.id ?? null,
    nudge_step: input.nudge_step ?? null,
    draft_text: clean(input.draft_text),
    draft_channel: input.draft_channel ?? null,
    draft_status: input.draft_text ? (input.draft_status ?? "draft") : (input.draft_status ?? null),
    source_event: "sales_follow_up",
  };
  if (input.dry_run) return { task: row, created: false, dry_run: true };
  const task = check(await db.from("tasks").insert(row).select("id, title, due_date, draft_status, nudge_step").single(), "Could not create the follow-up");
  return { task, created: true, dry_run: false };
}

// ---------- job runs ----------

export type LogJobRunInput = {
  job: string;
  status?: "ok" | "partial" | "failed" | "skipped";
  started_at?: string;
  finished_at?: string;
  summary?: string;
  counts?: Record<string, number>;
  credits?: Record<string, number>;
  cost_usd?: number;
  needs_review?: number;
  run_by?: string;
  dry_run?: boolean;
};

export async function logJobRun(db: Db, input: LogJobRunInput) {
  const job = input.job?.trim();
  if (!job) throw new ToolError("Give the job name, e.g. crm-watchdog.");
  const row = {
    job,
    status: input.status ?? "ok",
    started_at: input.started_at ?? new Date().toISOString(),
    finished_at: input.finished_at ?? new Date().toISOString(),
    summary: clean(input.summary),
    counts: input.counts ?? {},
    credits: input.credits ?? {},
    cost_usd: input.cost_usd ?? null,
    needs_review: input.needs_review ?? 0,
    run_by: clean(input.run_by),
  };
  if (input.dry_run) return { run: row, created: false, dry_run: true };
  const run = check(await db.from("job_runs").insert(row).select("id, job, status, started_at").single(), "Could not log the run");
  return { run, created: true, dry_run: false };
}

// ---------- read ----------

export type ListPipelineInput = { stage?: SalesStage; customer_id?: string; include_touches?: number; limit?: number };

/** Accounts in the pipeline with their contacts and latest touches, for the watchdog and outreach jobs. */
export async function listPipeline(db: Db, input: ListPipelineInput) {
  let q = db.from("customers").select(ACCOUNT_COLUMNS).not("sales_stage", "is", null);
  if (input.customer_id) q = db.from("customers").select(ACCOUNT_COLUMNS).eq("id", input.customer_id);
  else if (input.stage) q = q.eq("sales_stage", input.stage);
  const accounts = check(await q.order("sales_stage_changed_at", { ascending: false }).limit(Math.min(input.limit ?? 100, 500)), "Could not read the pipeline") ?? [];
  if (!accounts.length) return { accounts: [], count: 0 };
  const ids = accounts.map((a: { id: string }) => a.id);
  const contacts = check(await db.from("contacts").select(CONTACT_COLUMNS).in("customer_id", ids), "Could not read contacts") ?? [];
  const n = Math.min(input.include_touches ?? 5, 50);
  const touches = n
    ? check(await db.from("sales_touches").select("id, customer_id, contact_id, channel, direction, occurred_at, body, auto_sent, is_drip").in("customer_id", ids).order("occurred_at", { ascending: false }).limit(n * ids.length), "Could not read touches") ?? []
    : [];
  const tasks = check(await db.from("tasks").select("id, customer_id, title, due_date, status, nudge_step, draft_status").in("customer_id", ids).eq("status", "open"), "Could not read follow-ups") ?? [];
  // What Caleb marked done or ignored on Needs you and is still holding (a new inbound message or the Ignore date ends it).
  const live = await liveDismissals(db, ids);
  const heldBy = new Map<string, { item: string; action: string; until: string | null; dismissed_at: string; note: string | null }[]>();
  if (live.length) {
    const withD = [...new Set(live.map(d => d.customer_id))];
    const recent = check(await db.from("sales_touches").select("customer_id, direction, occurred_at").in("customer_id", withD).order("occurred_at", { ascending: false }).limit(5000), "Could not read messages") ?? [];
    const lastIn = new Map<string, string>();
    const lastAny = new Map<string, string>();
    for (const t of recent as { customer_id: string; direction: string; occurred_at: string }[]) {
      if (!lastAny.has(t.customer_id) || t.occurred_at > lastAny.get(t.customer_id)!) lastAny.set(t.customer_id, t.occurred_at);
      if (t.direction === "in" && (!lastIn.has(t.customer_id) || t.occurred_at > lastIn.get(t.customer_id)!)) lastIn.set(t.customer_id, t.occurred_at);
    }
    const stageAt = new Map<string, string | null>(accounts.map((a: { id: string; sales_stage_changed_at?: string | null }) => [a.id, a.sales_stage_changed_at ?? null] as [string, string | null]));
    const today = new Date().toISOString().slice(0, 10);
    const seen = new Set<string>();
    for (const d of live) {
      const k = `${d.customer_id}|${d.item_key}`;
      if (seen.has(k)) continue; // newest per item wins (liveDismissals is newest first)
      seen.add(k);
      if (!isDismissalActive(d, { lastInboundAt: lastIn.get(d.customer_id) ?? null, lastTouchAt: lastAny.get(d.customer_id) ?? null, stageChangedAt: stageAt.get(d.customer_id) ?? null, today })) continue;
      (heldBy.get(d.customer_id) ?? heldBy.set(d.customer_id, []).get(d.customer_id)!).push({ item: d.item_key, action: d.action, until: d.until ?? null, dismissed_at: d.dismissed_at, note: d.note });
    }
  }
  // Every job reads this into Claude's context: leave out empty fields and the parent id repeated on each child.
  const lean = ({ customer_id: _, ...row }: Record<string, unknown>) => dropNulls(row);
  const of = (rows: { customer_id: string }[], id: string) => rows.filter((r) => r.customer_id === id).map(lean);
  return {
    count: accounts.length,
    accounts: accounts.map((a: { id: string }) => ({
      ...dropNulls(a),
      contacts: of(contacts, a.id),
      touches: of(touches, a.id).slice(0, n),
      open_follow_ups: of(tasks, a.id),
      needs_you_held: heldBy.get(a.id) ?? [],
    })),
  };
}

const dropNulls = (row: object) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null));
