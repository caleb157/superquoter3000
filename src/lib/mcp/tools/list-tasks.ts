import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, ok, withUserDb, type Db } from "../shared";

// The app stores task status as "open" or "done" and the owner in "assignee" (e.g. CQ, PH).
export const TASK_COLUMNS =
  "id, title, description, status, priority, due_date, assignee, association_type, association_id, association_label, inquiry_id, customer_id, source_event, created_at";

type Input = { only_open?: boolean; inquiry_id?: string; customer_id?: string; project_id?: string; assignee?: string; limit?: number };

export async function listTasks(db: Db, input: Input) {
  let q = db
    .from("tasks")
    .select(TASK_COLUMNS)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(input.limit ?? 50);
  if (input.only_open) q = q.eq("status", "open");
  if (input.inquiry_id) q = q.eq("inquiry_id", input.inquiry_id);
  if (input.customer_id) q = q.eq("customer_id", input.customer_id);
  if (input.project_id) q = q.eq("association_type", "project").eq("association_id", input.project_id);
  if (input.assignee) q = q.eq("assignee", input.assignee.trim().toUpperCase());
  return check(await q, "Could not list tasks") ?? [];
}

export default defineTool({
  name: "list_tasks",
  title: "List tasks",
  description:
    "List tasks visible to the signed-in user, soonest due first. Filter to open tasks, or by inquiry, customer, project or assignee code (e.g. CQ).",
  inputSchema: {
    only_open: z.boolean().optional().describe("If true, only tasks with status open."),
    inquiry_id: z.string().uuid().optional().describe("Only tasks on this inquiry."),
    customer_id: z.string().uuid().optional().describe("Only tasks on this customer."),
    project_id: z.string().uuid().optional().describe("Only tasks on this project (see list_lookups)."),
    assignee: z.string().optional().describe("Only tasks for this assignee code (see list_lookups)."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: Input) => {
    const tasks = await listTasks(db, input);
    return ok(JSON.stringify(tasks), { tasks });
  }),
});
