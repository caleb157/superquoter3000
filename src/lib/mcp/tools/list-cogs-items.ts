import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { withUserDb } from "../shared";

const inputSchema = {
  product_id: z.string().uuid().describe("UUID of the product."),
  search: z.string().optional().describe("Optional case-insensitive substring match on component_name."),
};
type Input = z.infer<z.ZodObject<typeof inputSchema>>;

export default defineTool({
  name: "list_cogs_items",
  title: "List COGS items for a product",
  description:
    "List the COGS lines on a specific product's costing sheet. Use to look up the id of a line before calling `update_cogs_item`, or to review current unit_cost_inr values.",
  inputSchema,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (sb, input: Input) => {
    let q = sb
      .from("cogs_items")
      .select("id, cogs_type, component_name, vendor_name, unit_cost_inr, units, components_per_product, waste_factor, include, is_auto_calculated, sort_order")
      .eq("product_id", input.product_id)
      .order("sort_order", { ascending: true });
    if (input.search) q = q.ilike("component_name", `%${input.search.replace(/[%_\\]/g, "")}%`);
    const { data, error } = await q.limit(500);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Found ${data?.length ?? 0} COGS line(s).` }],
      structuredContent: { cogs_items: data ?? [] },
    };
  }),
});
