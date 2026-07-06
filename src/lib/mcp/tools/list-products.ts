import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_products",
  title: "List products",
  description: "List products visible to the signed-in user, optionally filtered by a name search or inquiry (customer_rfq) id.",
  inputSchema: {
    search: z.string().optional().describe("Optional substring to match on product name."),
    customer_rfq_id: z.string().uuid().optional().describe("Optional inquiry/RFQ UUID to filter by."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, customer_rfq_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("products")
      .select("id, name, product_type, customer_rfq_id, quantity, design_stage, quote_stage, sample_stage, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (search && search.trim()) {
      const s = search.trim().replace(/[%,]/g, "");
      q = q.ilike("name", `%${s}%`);
    }
    if (customer_rfq_id) q = q.eq("customer_rfq_id", customer_rfq_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
