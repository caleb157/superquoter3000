import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, cleanSearch, isValidYmd, ok, ToolError, withUserDb, type Db } from "../shared";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

const recurrence = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365),
  weekdays: z.array(z.number().int().min(0).max(6)).optional().describe("Weekly only. 0 = Sunday."),
  monthDay: z.number().int().min(1).max(31).optional().describe("Monthly only."),
  mode: z.enum(["due", "completion"]).describe("due = repeat from the due date; completion = repeat from when it is done."),
});

export type CreateTaskInput = {
  title: string;
  due_date: string;
  description?: string;
  priority?: (typeof PRIORITIES)[number];
  assignee?: string;
  inquiry_id?: string;
  customer_id?: string;
  project_id?: string;
  project?: string;
  recurrence_rule?: z.infer<typeof recurrence>;
  dry_run?: boolean;
};

/** Find one project by id, or by exact name (case-insensitive). Done and cancelled projects are refused, like the app's picker. */
async function findProject(db: Db, input: { project_id?: string; project?: string }) {
  let rows: { id: string; name: string; status: string }[];
  if (input.project_id) {
    rows = check(await db.from("projects").select("id, name, status").eq("id", input.project_id), "Could not read the project") ?? [];
    if (!rows.length) throw new ToolError(`Project ${input.project_id} not found or not visible to you.`);
  } else {
    const name = cleanSearch(input.project ?? "");
    if (!name) throw new ToolError("Give the project's name or id.");
    rows = check(await db.from("projects").select("id, name, status").ilike("name", name), "Could not read projects") ?? [];
    if (!rows.length) throw new ToolError(`No project named "${input.project}". See list_lookups for project names.`);
    if (rows.length > 1) throw new ToolError(`${rows.length} projects are named "${input.project}". Pass project_id instead.`);
  }
  const p = rows[0];
  if (p.status === "done" || p.status === "cancelled") throw new ToolError(`Project "${p.name}" is ${p.status}; tasks go on open projects.`);
  return p;
}

/** Create one task, linked like the app's task dialog does (association label = "RFQ-… title", customer name or project name). */
export async function createTask(db: Db, input: CreateTaskInput) {
  const title = input.title.trim();
  if (!title) throw new ToolError("Give the task a title.");
  if (!isValidYmd(input.due_date)) throw new ToolError("due_date must be a real date as YYYY-MM-DD.");
  const links = [input.inquiry_id, input.customer_id, input.project_id || input.project].filter(Boolean).length;
  if (links > 1) throw new ToolError("Link the task to one thing: an inquiry, a customer or a project, not both.");

  let assignee: string | null = null;
  if (input.assignee?.trim()) {
    assignee = input.assignee.trim().toUpperCase();
    const codes = (check(
      await db.from("profiles").select("assignee_code").not("assignee_code", "is", null),
      "Could not read assignee codes",
    ) ?? []).map((p: { assignee_code: string }) => p.assignee_code.toUpperCase());
    if (codes.length && !codes.includes(assignee)) throw new ToolError(`Unknown assignee "${assignee}". Use one of: ${codes.join(", ")}.`);
  }

  const row: Record<string, unknown> = {
    title: title.slice(0, 500),
    description: input.description?.trim() || null,
    status: "open",
    priority: input.priority ?? "normal",
    due_date: input.due_date,
    assignee,
    recurrence_rule: input.recurrence_rule ?? null,
    association_type: null,
    association_id: null,
    association_label: null,
    product_id: null,
  };
  if (input.inquiry_id) {
    const inq = check(await db.from("customer_rfqs").select("id, rfq_number, title").eq("id", input.inquiry_id).maybeSingle(), "Could not read the inquiry");
    if (!inq) throw new ToolError(`Inquiry ${input.inquiry_id} not found or not visible to you.`);
    Object.assign(row, { inquiry_id: inq.id, association_type: "inquiry", association_id: inq.id, association_label: `${inq.rfq_number} ${inq.title ?? ""}`.trim() });
  } else if (input.customer_id) {
    const c = check(await db.from("customers").select("id, name").eq("id", input.customer_id).maybeSingle(), "Could not read the customer");
    if (!c) throw new ToolError(`Customer ${input.customer_id} not found or not visible to you.`);
    Object.assign(row, { customer_id: c.id, association_type: "customer", association_id: c.id, association_label: c.name });
  } else if (input.project_id || input.project) {
    const p = await findProject(db, input);
    Object.assign(row, { association_type: "project", association_id: p.id, association_label: p.name });
  }
  if (input.dry_run) return { task: row, created: false, dry_run: true };
  const task = check(
    await db.from("tasks").insert(row).select("id, title, due_date, assignee, priority, association_label").single(),
    "Could not create the task",
  );
  return { task, created: true, dry_run: false };
}

export default defineTool({
  name: "create_task",
  title: "Create a task",
  description:
    "Create one task in PD HQ, optionally linked to an inquiry, a customer or a project (by id or exact name, e.g. Sales Office) and optionally recurring. A due date is required. Assignee is a code from list_lookups (e.g. CQ). Nobody is notified. Use dry_run to preview.",
  inputSchema: {
    title: z.string().min(1).max(500),
    due_date: z.string().describe("YYYY-MM-DD. Required."),
    description: z.string().max(5000).optional(),
    priority: z.enum(PRIORITIES).optional().describe("Default normal."),
    assignee: z.string().max(10).optional().describe("Assignee code, e.g. CQ."),
    inquiry_id: z.string().uuid().optional(),
    customer_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional().describe("Link to this project (see list_lookups)."),
    project: z.string().max(200).optional().describe("Or the project's exact name, e.g. Sales Office."),
    recurrence_rule: recurrence.optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: withUserDb(async (db, input: CreateTaskInput) => {
    const r = await createTask(db, input);
    const t = r.task as { title: string; due_date: string; association_label?: string | null };
    const where = t.association_label ? ` on ${t.association_label}` : "";
    return ok(r.dry_run ? `Dry run: would create "${t.title}" due ${t.due_date}${where}.` : `Created task "${t.title}" due ${t.due_date}${where}.`, r as Record<string, unknown>);
  }),
});
