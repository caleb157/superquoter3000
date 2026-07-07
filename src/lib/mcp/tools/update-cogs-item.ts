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
  name: "update_cogs_item",
  title: "Update COGS item on a product",
  description:
    "Update fields (typically unit_cost_inr) on an existing COGS line for a specific product. Identify the row EITHER by `cogs_item_id` OR by (`product_id` + `component_name`, optionally scoped by `cogs_type`). First resolve the product with `list_products`, then optionally call `list_cogs_items` to see current lines. Only provided fields are changed. Refuses to update auto-calculated rows unless `force=true`.",
  inputSchema: {
    cogs_item_id: z.string().uuid().optional().describe("Direct UUID of the cogs_items row to update."),
    product_id: z.string().uuid().optional().describe("Product UUID (required if cogs_item_id not given)."),
    component_name: z.string().optional().describe("Component name to match (case-insensitive) when cogs_item_id not given."),
    cogs_type: z.enum(COGS_TYPES).optional().describe("Optional category to disambiguate the match."),
    unit_cost_inr: z.number().nonnegative().optional().describe("New unit cost in INR."),
    vendor_name: z.string().optional().describe("New vendor name."),
    units: z.string().optional().describe("New unit of measure."),
    components_per_product: z.number().nonnegative().optional().describe("New quantity per product."),
    waste_factor: z.number().min(0).max(1).optional().describe("New waste factor (0-1)."),
    include: z.enum(["Yes", "No"]).optional().describe("Include in totals."),
    new_component_name: z.string().optional().describe("Rename the component."),
    force: z.boolean().optional().describe("Allow updating rows flagged is_auto_calculated."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);

    // Locate the row.
    let rowId = input.cogs_item_id ?? null;
    let existing: any = null;

    if (rowId) {
      const { data, error } = await sb.from("cogs_items").select("*").eq("id", rowId).maybeSingle();
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      existing = data;
    } else {
      if (!input.product_id || !input.component_name) {
        return {
          content: [{ type: "text", text: "Provide cogs_item_id, or both product_id and component_name." }],
          isError: true,
        };
      }
      let q = sb
        .from("cogs_items")
        .select("*")
        .eq("product_id", input.product_id)
        .ilike("component_name", input.component_name);
      if (input.cogs_type) q = q.eq("cogs_type", input.cogs_type);
      const { data, error } = await q.limit(5);
      if (error) return { content: [{ type: "text", text: error.message }], isError: true };
      if (!data || data.length === 0) {
        return { content: [{ type: "text", text: `No COGS line matched "${input.component_name}" on that product.` }], isError: true };
      }
      if (data.length > 1) {
        return {
          content: [{
            type: "text",
            text: `Multiple COGS lines matched "${input.component_name}". Pass cogs_type to disambiguate, or use cogs_item_id. Matches: ${data.map((r: any) => `${r.cogs_type}/${r.component_name} (${r.id})`).join("; ")}`,
          }],
          isError: true,
        };
      }
      existing = data[0];
      rowId = existing.id;
    }

    if (!existing || !rowId) {
      return { content: [{ type: "text", text: "COGS line not found or not accessible." }], isError: true };
    }

    if (existing.is_auto_calculated && !input.force) {
      return {
        content: [{
          type: "text",
          text: `Refusing to update auto-calculated row "${existing.component_name}". Re-run with force=true to override.`,
        }],
        isError: true,
      };
    }

    const patch: Record<string, unknown> = {};
    if (input.unit_cost_inr !== undefined) patch.unit_cost_inr = input.unit_cost_inr;
    if (input.vendor_name !== undefined) patch.vendor_name = input.vendor_name;
    if (input.units !== undefined) patch.units = input.units;
    if (input.components_per_product !== undefined) patch.components_per_product = input.components_per_product;
    if (input.waste_factor !== undefined) patch.waste_factor = input.waste_factor;
    if (input.include !== undefined) patch.include = input.include;
    if (input.new_component_name !== undefined) patch.component_name = input.new_component_name;

    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text", text: "No fields provided to update." }], isError: true };
    }

    const { data, error } = await sb.from("cogs_items").update(patch).eq("id", rowId).select().single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const changed = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ");
    return {
      content: [{ type: "text", text: `Updated COGS line "${existing.component_name}" (${changed}).` }],
      structuredContent: { cogs_item: data },
    };
  },
});
