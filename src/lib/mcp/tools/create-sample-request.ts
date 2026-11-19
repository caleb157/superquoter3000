import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, isValidYmd, ok, todayInIndia, ToolError, withUserDb, type Db } from "../shared";

export type SampleRequestInput = {
  inquiry_id: string;
  product_ids: string[];
  customer_requested_date?: string;
  required_by_date?: string;
  notes?: string;
  allow_duplicate?: boolean;
  dry_run?: boolean;
};

/**
 * Create one sample request with a line per product, like the inquiry's "Request samples" button.
 * The database moves each product's sample stage and runs the "Sample requested" task rules.
 */
export async function createSampleRequest(db: Db, input: SampleRequestInput, today = todayInIndia()) {
  const ids = [...new Set(input.product_ids)];
  if (!ids.length) throw new ToolError("Pick at least one product.");
  for (const k of ["customer_requested_date", "required_by_date"] as const) {
    const v = input[k];
    if (v && !isValidYmd(v)) throw new ToolError(`${k} must be a real date as YYYY-MM-DD.`);
  }
  const inquiry = check(
    await db.from("customer_rfqs").select("id, rfq_number, title").eq("id", input.inquiry_id).maybeSingle(),
    "Could not read the inquiry",
  );
  if (!inquiry) throw new ToolError(`Inquiry ${input.inquiry_id} not found or not visible to you.`);

  const products = check(
    await db.from("products").select("id, sku, name, customer_rfq_id, archived_at").in("id", ids),
    "Could not read the products",
  ) ?? [];
  const bad = ids.filter(id => !products.some((p: { id: string; customer_rfq_id: string | null; archived_at: string | null }) =>
    p.id === id && p.customer_rfq_id === input.inquiry_id && !p.archived_at));
  if (bad.length) throw new ToolError(`These products are not live products on ${inquiry.rfq_number}: ${bad.join(", ")}`);

  const pending = check(
    await db.from("samples").select("id, product_id, request_id, requested_date").eq("customer_rfq_id", input.inquiry_id).eq("status", "pending").in("product_id", ids),
    "Could not check open sample requests",
  ) ?? [];
  if (pending.length && !input.allow_duplicate) {
    return { inquiry, created: false, already_requested: pending, dry_run: !!input.dry_run };
  }

  const request = {
    customer_rfq_id: input.inquiry_id,
    requested_date: today,
    customer_requested_date: input.customer_requested_date ?? null,
    required_by_date: input.required_by_date ?? null,
    notes: input.notes?.trim() || null,
  };
  if (input.dry_run) return { inquiry, created: false, would_create: { ...request, products: products.map((p: { sku: string | null; name: string }) => p.sku || p.name) }, dry_run: true };

  const req = check(
    await db.from("sample_requests").insert(request).select("id, request_number").single(),
    "Could not create the sample request",
  );
  const lines = ids.map(pid => ({
    request_id: req.id, product_id: pid, customer_rfq_id: input.inquiry_id, status: "pending",
    requested_date: today, required_by_date: input.required_by_date ?? null,
  }));
  const lineRes = await db.from("samples").insert(lines);
  if (lineRes.error) {
    // Same as the app: remove the request this call just made so no empty request is left behind.
    await db.from("sample_requests").delete().eq("id", req.id);
    throw new ToolError(`Could not add the sample lines, so the request was not kept: ${lineRes.error.message}`);
  }
  return { inquiry, created: true, request: { ...req, ...request }, lines: ids.length, dry_run: false };
}

export default defineTool({
  name: "create_sample_request",
  title: "Request samples",
  description:
    "Create a sample request on an inquiry with one line per product, the same as the inquiry's Request samples button. The products' sample stage moves to requested, and PD HQ adds any \"Sample requested\" tasks. If any of the products already has a pending sample on this inquiry, nothing is created unless allow_duplicate is true. Use dry_run to preview.",
  inputSchema: {
    inquiry_id: z.string().uuid(),
    product_ids: z.array(z.string().uuid()).min(1).max(100).describe("Products on this inquiry to sample."),
    customer_requested_date: z.string().optional().describe("YYYY-MM-DD the customer asked for samples."),
    required_by_date: z.string().optional().describe("YYYY-MM-DD the samples are needed by."),
    notes: z.string().max(5000).optional().describe("Finish, size or other instructions for the samples."),
    allow_duplicate: z.boolean().optional().describe("Create even if a product already has a pending sample."),
    dry_run: z.boolean().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: withUserDb(async (db, input: SampleRequestInput) => {
    const r = await createSampleRequest(db, input);
    const text = "already_requested" in r && r.already_requested
      ? `Not created: ${r.already_requested.length} of these products already have a pending sample on ${r.inquiry.rfq_number}. Pass allow_duplicate to request again.`
      : r.dry_run
        ? `Dry run: would request ${input.product_ids.length} sample(s) on ${r.inquiry.rfq_number}.`
        : `Created sample request ${"request" in r ? r.request?.request_number : ""} on ${r.inquiry.rfq_number} with ${"lines" in r ? r.lines : 0} line(s).`;
    return ok(text, r as Record<string, unknown>);
  }),
});
