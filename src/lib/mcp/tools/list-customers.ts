import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, cleanSearch, ok, withUserDb, type Db } from "../shared";

export const CUSTOMER_COLUMNS = "id, name, company, email, phone, linkedin_url, lead_status, source, notes, created_at";

export async function listCustomers(db: Db, input: { search?: string; limit?: number }) {
  let q = db.from("customers").select(CUSTOMER_COLUMNS).order("created_at", { ascending: false }).limit(input.limit ?? 50);
  const s = input.search ? cleanSearch(input.search) : "";
  if (s) q = q.or(`name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%`);
  return check(await q, "Could not list customers") ?? [];
}

export default defineTool({
  name: "list_customers",
  title: "List customers",
  description: "List customers visible to the signed-in user, optionally filtered by a search string on name, company or email.",
  inputSchema: {
    search: z.string().optional().describe("Optional text to match against name, company or email."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: { search?: string; limit?: number }) => {
    const customers = await listCustomers(db, input);
    return ok(JSON.stringify(customers), { customers });
  }),
});
