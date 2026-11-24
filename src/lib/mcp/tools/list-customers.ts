import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, cleanSearch, ok, withUserDb, type Db } from "../shared";
import { ALL_SALES_STAGES, type SalesStage } from "../../sales/sales-core";

export const CUSTOMER_COLUMNS = "id, name, company, email, phone, linkedin_url, sales_stage, not_now_until, source, notes, created_at";

type ListCustomersInput = { search?: string; stage?: SalesStage[]; limit?: number };

/** sales_stage is the one status of a customer; the old lead_status is a mirror and is not returned. */
export async function listCustomers(db: Db, input: ListCustomersInput) {
  let q = db.from("customers").select(CUSTOMER_COLUMNS).order("created_at", { ascending: false }).limit(input.limit ?? 50);
  if (input.stage?.length) q = q.in("sales_stage", input.stage);
  const s = input.search ? cleanSearch(input.search) : "";
  if (s) q = q.or(`name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%`);
  return check(await q, "Could not list customers") ?? [];
}

export default defineTool({
  name: "list_customers",
  title: "List customers",
  description: "List customers (accounts) visible to the signed-in user with their sales stage, optionally filtered by stage and by a search string on name, company or email. The sales stage is the customer's only status: Queued, In outreach, Responded, In conversation, Inquiry, Customer, Not now, Not a fit, Do not contact.",
  inputSchema: {
    search: z.string().optional().describe("Optional text to match against name, company or email."),
    stage: z.array(z.enum(ALL_SALES_STAGES)).optional().describe("Only these sales stages, e.g. [\"customer\"] or [\"responded\",\"in_conversation\"]."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: ListCustomersInput) => {
    const customers = await listCustomers(db, input);
    return ok(JSON.stringify(customers), { customers });
  }),
});
