import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { check, cleanSearch, ok, withUserDb, type Db } from "../shared";

export const PRODUCT_COLUMNS =
  "id, sku, name, customer_rfq_id, product_type_id, quantity, target_price_usd, photo_url, design_stage, quote_stage, sample_stage, calculated_unit_price_usd, created_at";

type Input = { search?: string; customer_rfq_id?: string; include_archived?: boolean; limit?: number };

export async function listProducts(db: Db, input: Input) {
  let q = db
    .from("products")
    .select(`${PRODUCT_COLUMNS}, product_type:product_types(name)`)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 50);
  if (!input.include_archived) q = q.is("archived_at", null);
  const s = input.search ? cleanSearch(input.search) : "";
  if (s) q = q.or(`name.ilike.%${s}%,sku.ilike.%${s}%`);
  if (input.customer_rfq_id) q = q.eq("customer_rfq_id", input.customer_rfq_id);
  return check(await q, "Could not list products") ?? [];
}

export default defineTool({
  name: "list_products",
  title: "List products",
  description:
    "List products visible to the signed-in user, optionally filtered by text in the name or SKU, or by inquiry (customer_rfq) id. Archived products are left out unless include_archived is true.",
  inputSchema: {
    search: z.string().optional().describe("Optional text to match in the product name or SKU."),
    customer_rfq_id: z.string().uuid().optional().describe("Optional inquiry UUID to filter by."),
    include_archived: z.boolean().optional().describe("Include archived products (default false)."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: Input) => {
    const products = await listProducts(db, input);
    return ok(JSON.stringify(products), { products });
  }),
});
