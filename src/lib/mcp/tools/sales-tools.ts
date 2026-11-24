// Sales CRM tools: accounts, contacts, touches, stages, do not contact, briefs, follow-ups, job runs.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, withUserDb } from "../shared";
import {
  checkCanContact, listPipeline, logJobRun, logTouch, saveBrief, saveFollowUp, setDoNotContact, setSalesStage, upsertAccount, upsertContact,
  type CheckCanContactInput, type ListPipelineInput, type LogJobRunInput, type LogTouchInput, type SaveBriefInput, type SaveFollowUpInput,
  type SetDncInput, type SetStageInput, type UpsertAccountInput, type UpsertContactInput,
} from "../sales";
import { ALL_SALES_STAGES, BRIEF_PARTS, TOUCH_CHANNELS } from "../../sales/sales-core";

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const json = (r: unknown) => r as Record<string, unknown>;
const stage = z.enum(ALL_SALES_STAGES);
const channel = z.enum(TOUCH_CHANNELS);
const who = {
  contact_id: z.string().uuid().optional(),
  email: z.string().max(320).optional(),
  linkedin_url: z.string().max(500).optional(),
  customer_id: z.string().uuid().optional().describe("The account (customers row)."),
};

export const upsertSalesAccountTool = defineTool({
  name: "upsert_sales_account",
  title: "Find or add a sales account",
  description:
    "Find an account by domain, then exact company name, or add it as a prospect in Queued (prospects fire no Lead task rules). On a match, fills empty fields and updates persona, type, fit score and owner; the stage only moves through set_sales_stage. Use dry_run first.",
  inputSchema: {
    company: z.string().min(1).max(300),
    domain: z.string().max(300).optional(),
    website: z.string().max(500).optional(),
    country: z.string().max(100).optional(),
    persona: z.string().max(100).optional(),
    customer_type: z.string().max(100).optional().describe("e.g. furniture importer, decor e-commerce, Amazon seller."),
    fit_score: z.number().min(0).max(100).optional(),
    owner: z.string().max(10).optional().describe("Assignee code, e.g. CQ."),
    source: z.string().max(200).optional().describe("e.g. Apollo TAM, Waalaxy list name, website form."),
    linkedin_url: z.string().max(500).optional().describe("Company page."),
    notes: z.string().max(5000).optional(),
    sales_stage: stage.optional().describe("Only used when the account has no stage yet. Default queued."),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: UpsertAccountInput) => {
    const r = await upsertAccount(db, input);
    const a = r.account as { company?: string; name?: string };
    const verb = r.dry_run ? (("would_create" in r && r.would_create) ? "Dry run: would add" : "Dry run: matched") : r.created ? "Added" : "Matched";
    return ok(`${verb} ${a.company ?? a.name}${r.matched_on ? ` on ${r.matched_on}` : ""}.`, json(r));
  }),
});

export const upsertContactTool = defineTool({
  name: "upsert_contact",
  title: "Find or add a contact",
  description:
    "Find a person by LinkedIn URL, then email, or add them (a new person needs one of the two). Sets engaged (said more than thanks), drip enrolment, email lookup results and Waalaxy/Apollo ids. Never sets or clears do not contact: use set_do_not_contact. Use dry_run first.",
  inputSchema: {
    customer_id: z.string().uuid().optional().describe("Their account."),
    full_name: z.string().min(1).max(200),
    title: z.string().max(200).optional(),
    persona: z.string().max(100).optional(),
    email: z.string().max(320).optional(),
    email_source: z.string().max(100).optional().describe("e.g. apollo, waalaxy, website, pattern+verify."),
    email_check_result: z.string().max(100).optional().describe("e.g. valid, catch-all, invalid."),
    lookup_cost_usd: z.number().min(0).max(100).optional(),
    linkedin_url: z.string().max(500).optional(),
    phone: z.string().max(50).optional(),
    whatsapp: z.string().max(50).optional(),
    engaged: z.boolean().optional().describe("True once they say more than thanks for connecting. Only engaged people get nudges."),
    never_email: z.boolean().optional().describe("Bounced or unsubscribed."),
    drip_enrolled: z.boolean().optional().describe("Really interested: on the long-term update drip."),
    drip_track: z.string().max(100).optional(),
    waalaxy_prospect_id: z.string().max(100).optional(),
    apollo_contact_id: z.string().max(100).optional(),
    linkedin_account: z.string().max(100).optional().describe("Which seat they are connected to, e.g. Caleb or Parker."),
    notes: z.string().max(5000).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: UpsertContactInput) => {
    const r = await upsertContact(db, input);
    const c = r.contact as { full_name?: string };
    const verb = r.dry_run ? (("would_create" in r && r.would_create) ? "Dry run: would add" : "Dry run: matched") : r.created ? "Added" : "Matched";
    return ok(`${verb} ${c.full_name}${r.updated?.length ? ` (updates ${r.updated.join(", ")})` : ""}.`, json(r));
  }),
});

export const checkCanContactTool = defineTool({
  name: "check_can_contact",
  title: "Check before sending",
  description:
    "Every sender (LinkedIn invites and messages, email, drip, WhatsApp, anything new) calls this right before sending. Returns allowed or the reason it is blocked: do not contact on the person or account, not a fit, not now until a date, never email, missing address. Blocked sends are logged. People PD HQ does not know come back allowed with known false.",
  inputSchema: {
    channel,
    people: z.array(z.object(who)).min(1).max(200),
    sender: z.string().max(100).optional().describe("e.g. waalaxy:caleb, gmail:caleb, drip."),
    log_blocks: z.boolean().optional().describe("Default true."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: CheckCanContactInput) => {
    const r = await checkCanContact(db, input);
    return ok(`${r.allowed} allowed, ${r.blocked} blocked on ${r.channel}.`, json(r));
  }),
});

export const setDoNotContactTool = defineTool({
  name: "set_do_not_contact",
  title: "Set do not contact",
  description:
    "Removal request: sets the master do-not-contact flag on the person (or the whole account), which stops their drip, sets never-email, skips open drafts and moves a whole account to Do not contact. Only Caleb can clear it, in PD HQ. The reply lists what to do outside PD HQ (Waalaxy, email lists). Use dry_run first.",
  inputSchema: {
    ...who,
    reason: z.string().min(1).max(500).describe("e.g. 'Asked to be removed, LinkedIn 23 Nov'."),
    source: z.string().min(1).max(100).describe("Where they asked: linkedin, email, whatsapp, call, other."),
    whole_account: z.boolean().optional().describe("Also flag the account, covering every contact there."),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SetDncInput) => {
    const r = await setDoNotContact(db, input);
    const names = [r.contact?.name, r.account?.name].filter(Boolean).join(" and ");
    return ok(`${r.dry_run ? "Dry run: would set" : "Set"} do not contact on ${names}. Next: ${r.follow_ups.join(" ")}`, json(r));
  }),
});

export const logTouchTool = defineTool({
  name: "log_touch",
  title: "Log a message",
  description:
    "Log one message in or out on LinkedIn, email, WhatsApp, a call or a meeting. Pass the channel's message id as external_id so repeated syncs never double-log. Outbound to do not contact is refused. An inbound message moves a Queued or In outreach account to Responded; a first outbound moves Queued to In outreach. A/B fields (variant, test_name, angle, persona, step, opener_type) go on outbound messages. Use dry_run first.",
  inputSchema: {
    contact_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    channel,
    direction: z.enum(["in", "out"]),
    occurred_at: z.string().optional().describe("ISO date-time. Default now."),
    subject: z.string().max(500).optional(),
    body: z.string().max(20000).optional(),
    sender_account: z.string().max(100).optional().describe("Our side, e.g. linkedin:caleb, linkedin:parker, gmail:caleb."),
    external_id: z.string().max(300).optional(),
    auto_sent: z.boolean().optional().describe("Sent by a job without Caleb's review (e.g. thanks for connecting)."),
    is_drip: z.boolean().optional(),
    drip_issue: z.string().max(200).optional(),
    variant: z.string().max(100).optional(),
    test_name: z.string().max(100).optional(),
    angle: z.string().max(100).optional(),
    persona: z.string().max(100).optional(),
    step: z.number().int().min(0).max(20).optional(),
    opener_type: z.string().max(100).optional(),
    engaged: z.boolean().optional().describe("Inbound that says more than thanks: marks the person engaged."),
    logged_by: z.string().max(100).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: LogTouchInput) => {
    const r = await logTouch(db, input);
    const head = r.dry_run ? "Dry run: would log" : "duplicate" in r && r.duplicate ? "Already logged" : "Logged";
    return ok(`${head} ${input.direction === "in" ? "inbound" : "outbound"} ${input.channel} message${r.stage_move ? `; stage to ${r.stage_move}` : ""}.`, json(r));
  }),
});

export const setSalesStageTool = defineTool({
  name: "set_sales_stage",
  title: "Move an account's stage",
  description:
    "Move an account to queued, in_outreach, responded, in_conversation, inquiry, customer, not_now (needs not_now_until) or not_a_fit, with a one-line reason kept on the stage log. For removal requests use set_do_not_contact. Use dry_run first.",
  inputSchema: {
    customer_id: z.string().uuid(),
    stage: stage,
    reason: z.string().min(1).max(500),
    not_now_until: z.string().optional().describe("YYYY-MM-DD, required for not_now."),
    actor: z.string().max(100).optional().describe("e.g. crm-watchdog. Default the signed-in user."),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SetStageInput) => {
    const r = await setSalesStage(db, input);
    return ok(r.changed ? `${r.dry_run ? "Dry run: would move" : "Moved"} from ${r.from ?? "none"} to ${r.to}.` : `Already ${r.to}.`, json(r));
  }),
});

const briefPart = z.object({ text: z.string().min(1).max(4000), source: z.string().max(1000).nullable().optional() });

export const saveBriefTool = defineTool({
  name: "save_brief",
  title: "Save an account brief",
  description: `Save the brief shown at the top of the account page, part by part, each with its source link. Parts: ${BRIEF_PARTS.join(", ")}. Parts not given are kept. Optionally set the next step and its date. Use dry_run first.`,
  inputSchema: {
    customer_id: z.string().uuid(),
    parts: z.object(Object.fromEntries(BRIEF_PARTS.map(p => [p, briefPart.optional()]))),
    next_step: z.string().max(500).optional(),
    next_step_date: z.string().optional().describe("YYYY-MM-DD."),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SaveBriefInput) => {
    const r = await saveBrief(db, input);
    return ok(r.dry_run ? "Dry run: brief ready to save." : "Brief saved.", json(r));
  }),
});

export const saveFollowUpTool = defineTool({
  name: "save_follow_up",
  title: "Save a follow-up and its draft",
  description:
    "Create or update a follow-up task on an account, beside Caleb's other tasks: a reply he owes, or nudge 1 to 3 (1 week, 1 month, 1 quarter; engaged people only), with the drafted message for his approval. Statuses: draft, approved, sent, skipped (sent and skipped close the task). Refuses a draft to someone who cannot be contacted, and a new follow-up on an account Caleb marked Done or Ignored on Needs you until a new message comes in. Use dry_run first.",
  inputSchema: {
    task_id: z.string().uuid().optional().describe("Update this follow-up instead of creating one."),
    customer_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    title: z.string().max(500).optional(),
    due_date: z.string().optional().describe("YYYY-MM-DD."),
    nudge_step: z.number().int().min(1).max(3).optional(),
    draft_text: z.string().max(20000).optional(),
    draft_channel: channel.optional(),
    draft_status: z.enum(["draft", "approved", "sent", "skipped"]).optional(),
    assignee: z.string().max(10).optional().describe("Default the account owner, else CQ."),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    override_dismissal: z.boolean().optional().describe("Only when Caleb asked for this follow-up although he marked the account done or ignored on Needs you."),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SaveFollowUpInput) => {
    const r = await saveFollowUp(db, input);
    const t = r.task as { title?: string; due_date?: string };
    return ok(`${r.dry_run ? "Dry run: would save" : r.created ? "Created" : "Updated"} "${t.title}" due ${t.due_date}.`, json(r));
  }),
});

export const logJobRunTool = defineTool({
  name: "log_job_run",
  title: "Log a job run",
  description:
    "Every playbook job (crm-watchdog, outreach, list-building, waalaxy-ops, drip, ...) calls this at the end of a run: status, a one-line summary, counts, credits used, cost in USD and how many items wait for Caleb. Feeds the Jobs tab. Use dry_run first.",
  inputSchema: {
    job: z.string().min(1).max(100),
    status: z.enum(["ok", "partial", "failed", "skipped"]).optional(),
    started_at: z.string().optional(),
    finished_at: z.string().optional(),
    summary: z.string().max(2000).optional(),
    counts: z.record(z.number()).optional().describe("e.g. {\"invites\": 25, \"replies_logged\": 4}."),
    credits: z.record(z.number()).optional().describe("e.g. {\"waalaxy_email_finder\": 3}."),
    cost_usd: z.number().min(0).max(10000).optional(),
    needs_review: z.number().int().min(0).max(10000).optional(),
    run_by: z.string().max(100).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: LogJobRunInput) => {
    const r = await logJobRun(db, input);
    return ok(`${r.dry_run ? "Dry run: would log" : "Logged"} ${input.job} run.`, json(r));
  }),
});

export const listSalesPipelineTool = defineTool({
  name: "list_sales_pipeline",
  title: "List the sales pipeline",
  description: "Accounts in the pipeline (optionally one stage or one account) with their contacts, latest messages, open follow-ups and needs_you_held: the Needs you items Caleb marked Done or Ignored that still hold (do not re-flag those; a new inbound message or the Ignore date releases them). Empty (null) fields are left out.",
  inputSchema: {
    stage: stage.optional(),
    customer_id: z.string().uuid().optional(),
    include_touches: z.number().int().min(0).max(50).optional().describe("Latest messages per account (default 5)."),
    limit: z.number().int().min(1).max(500).optional().describe("Max accounts (default 100)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: ListPipelineInput) => {
    const r = await listPipeline(db, input);
    return ok(JSON.stringify(r), json(r));
  }),
});

export const SALES_TOOLS = [
  listSalesPipelineTool,
  checkCanContactTool,
  upsertSalesAccountTool,
  upsertContactTool,
  logTouchTool,
  setSalesStageTool,
  setDoNotContactTool,
  saveBriefTool,
  saveFollowUpTool,
  logJobRunTool,
];
