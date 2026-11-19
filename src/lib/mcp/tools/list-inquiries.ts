import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, cleanSearch, ok, withUserDb, type Db } from "../shared";

// Inquiries live in customer_rfqs. The earlier version of this tool read a table that does not exist.
export const INQUIRY_COLUMNS =
  "id, rfq_number, title, status, priority, customer_id, received_date, quoted_date, target_completion_date, quoting_currency, requirements, notes, drive_url, created_at, updated_at";

export const INQUIRY_STATUSES = ["active", "paused", "projected_po", "po", "complete", "cancelled"] as const;

type Input = { status?: (typeof INQUIRY_STATUSES)[number]; customer_id?: string; search?: string; limit?: number };

export async function listInquiries(db: Db, input: Input) {
  let q = db
    .from("customer_rfqs")
    .select(`${INQUIRY_COLUMNS}, customer:customers(name, company)`)
    .order("updated_at", { ascending: false })
    .limit(input.limit ?? 50);
  if (input.status) q = q.eq("status", input.status);
  if (input.customer_id) q = q.eq("customer_id", input.customer_id);
  const s = input.search ? cleanSearch(input.search) : "";
  if (s) q = q.or(`title.ilike.%${s}%,rfq_number.ilike.%${s}%`);
  return check(await q, "Could not list inquiries") ?? [];
}

export default defineTool({
  name: "list_inquiries",
  title: "List inquiries",
  description:
    "List inquiries visible to the signed-in user, newest activity first. Filter by status, customer, or text in the title or inquiry number.",
  inputSchema: {
    status: z.enum(INQUIRY_STATUSES).optional().describe("Optional status filter."),
    customer_id: z.string().uuid().optional().describe("Optional customer UUID to filter by."),
    search: z.string().optional().describe("Optional text to match in the title or inquiry number (e.g. RFQ-2026-014)."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: Input) => {
    const inquiries = await listInquiries(db, input);
    return ok(JSON.stringify(inquiries), { inquiries });
  }),
});
