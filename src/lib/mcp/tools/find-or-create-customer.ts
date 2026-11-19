import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, ok, ToolError, withUserDb, type Db } from "../shared";
import { CUSTOMER_COLUMNS } from "./list-customers";

export const LEAD_STATUSES = ["lead", "active", "won", "inactive", "churned"] as const;

export type FindOrCreateCustomerInput = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  source?: string;
  notes?: string;
  lead_status?: (typeof LEAD_STATUSES)[number];
  dry_run?: boolean;
};

/** Case-insensitive exact match: escape LIKE wildcards so "a_b" only matches "a_b". */
const exact = (v: string) => v.trim().replace(/[\\%_]/g, m => `\\${m}`);

/**
 * Find a customer by email, then company, then name (each an exact, case-insensitive match),
 * and only create one when none matches. Mirrors the app's inline "new customer" defaults.
 */
export async function findOrCreateCustomer(db: Db, input: FindOrCreateCustomerInput) {
  const name = input.name?.trim() || "";
  const company = input.company?.trim() || "";
  const email = input.email?.trim() || "";
  if (!name && !company && !email) throw new ToolError("Give at least a name, company or email.");

  const tries: [string, string][] = [];
  if (email) tries.push(["email", email]);
  if (company) tries.push(["company", company]);
  if (name) tries.push(["name", name]);
  for (const [field, value] of tries) {
    const rows = check(
      await db.from("customers").select(CUSTOMER_COLUMNS).ilike(field, exact(value)).order("created_at", { ascending: true }).limit(5),
      "Could not search customers",
    ) ?? [];
    if (rows.length) {
      return { customer: rows[0], created: false, matched_on: field, other_matches: rows.slice(1), dry_run: !!input.dry_run };
    }
  }

  if (!name && !company) throw new ToolError(`No customer has the email ${email}. Give a name or company to create one.`);
  const row = {
    name: name || company,
    company: company || null,
    email: email || null,
    phone: input.phone?.trim() || null,
    linkedin_url: input.linkedin_url?.trim() || null,
    source: input.source?.trim() || null,
    notes: input.notes?.trim() || null,
    lead_status: input.lead_status ?? "active",
  };
  if (input.dry_run) return { customer: row, created: false, would_create: true, matched_on: null, dry_run: true };
  const customer = check(await db.from("customers").insert(row).select(CUSTOMER_COLUMNS).single(), "Could not create the customer");
  return { customer, created: true, matched_on: null, dry_run: false };
}

export default defineTool({
  name: "find_or_create_customer",
  title: "Find or create a customer",
  description:
    "Look up a customer by email, then company, then name (exact, case-insensitive). Returns the existing record when one matches and creates a new customer only when none does. New customers default to lead_status active, like the app; lead_status lead also starts the \"Customer set to Lead\" task rule. Use dry_run to see what would happen without writing.",
  inputSchema: {
    name: z.string().max(200).optional().describe("Contact or customer name."),
    company: z.string().max(200).optional().describe("Company name."),
    email: z.string().max(320).optional().describe("Email address; checked first for a match."),
    phone: z.string().max(60).optional(),
    linkedin_url: z.string().max(500).optional(),
    source: z.string().max(100).optional().describe("Where the lead came from, e.g. Email, LinkedIn, Referral."),
    notes: z.string().max(5000).optional(),
    lead_status: z.enum(LEAD_STATUSES).optional().describe("Only used when creating. Default active."),
    dry_run: z.boolean().optional().describe("Report the match or the record that would be created, without writing."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: FindOrCreateCustomerInput) => {
    const r = await findOrCreateCustomer(db, input);
    const who = (r.customer as { company?: string | null; name: string }).company || (r.customer as { name: string }).name;
    const text = r.matched_on
      ? `Found existing customer ${who} (matched on ${r.matched_on}).`
      : r.dry_run
        ? `Dry run: no match, would create customer ${who}.`
        : `Created customer ${who}.`;
    return ok(text, r as Record<string, unknown>);
  }),
});
