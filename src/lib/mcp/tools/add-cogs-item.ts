import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const COGS_TYPES = [
  "Raw Piece",
  "Subcontracting",
  "Finishing Materials",
  "Packaging",
  "Hardware",
  "Accessories",
] as const;

export default defineTool({
  name: "add_cogs_item",
  title: "Add COGS item to a product",
  description:
    "Add a COGS line to a specific product. Resolve the product first with `list_products` (or pass its UUID). Example: to add '520/- raw mango tray' to the HFM Serving Tray, call with product_id, cogs_type='Raw Piece', component_name='Raw Mango Tray', unit_cost_inr=520. cogs_type must be one of: Raw Piece, Subcontracting, Finishing Materials, Packaging, Hardware, Accessories.",
  inputSchema: {
    product_id: z.string().uuid().describe("UUID of the target product."),
    cogs_type: z.enum(COGS_TYPES).describe("Category of the COGS line."),
    component_name: z.string().min(1).describe("Display name of the component, e.g. 'Raw Mango Tray'."),
    unit_cost_inr: z.number().nonnegative().describe("Unit cost in INR."),
    vendor_name: z.string().optional().describe("Optional vendor name."),
    units: z.string().optional().describe("Unit of measure (default 'pc')."),
    components_per_product: z.number().nonnegative().optional().describe("Quantity per product (default 1)."),
    waste_factor: z.number().min(0).max(1).optional().describe("Waste factor as a decimal (e.g. 0.05 for 5%)."),
    include: z.enum(["Yes", "No"]).optional().describe("Whether to include this line in totals (default Yes)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);

    // Confirm product exists / is visible to this user.
    const { data: product, error: prodErr } = await sb
      .from("products")
      .select("id, name")
      .eq("id", input.product_id)
      .maybeSingle();
    if (prodErr) return { content: [{ type: "text", text: prodErr.message }], isError: true };
    if (!product) {
      return {
        content: [{ type: "text", text: `Product ${input.product_id} not found or not accessible.` }],
        isError: true,
      };
    }

    // Place new row at the end of its category-ish; use max(sort_order)+1 for the product.
    const { data: maxRow } = await sb
      .from("cogs_items")
      .select("sort_order")
      .eq("product_id", input.product_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSort = ((maxRow?.sort_order as number | undefined) ?? -1) + 1;

    const row = {
      product_id: input.product_id,
      cogs_type: input.cogs_type,
      component_name: input.component_name,
      unit_cost_inr: input.unit_cost_inr,
      vendor_name: input.vendor_name ?? null,
      units: input.units ?? "pc",
      components_per_product: input.components_per_product ?? 1,
      waste_factor: input.waste_factor ?? 0,
      include: input.include ?? "Yes",
      is_auto_calculated: false,
      sort_order: nextSort,
    };

    const { data, error } = await sb.from("cogs_items").insert(row).select().single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    return {
      content: [
        {
          type: "text",
          text: `Added COGS line "${input.component_name}" (${input.cogs_type}, ₹${input.unit_cost_inr}) to product "${product.name}".`,
        },
      ],
      structuredContent: { cogs_item: data, product: { id: product.id, name: product.name } },
    };
  },
});
