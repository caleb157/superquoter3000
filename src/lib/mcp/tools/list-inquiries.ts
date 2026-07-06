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
  name: "list_inquiries",
  title: "List inquiries",
  description: "List inquiries (pipeline items) visible to the signed-in user, optionally filtered by status or customer.",
  inputSchema: {
    status: z.string().optional().describe("Optional status filter (e.g. active, paused, po, complete, cancelled)."),
    customer_id: z.string().uuid().optional().describe("Optional customer UUID to filter by."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, customer_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("pipeline_items")
      .select("id, name, description, status, customer_id, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit ?? 50);
    if (status) q = q.eq("status", status);
    if (customer_id) q = q.eq("customer_id", customer_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { inquiries: data ?? [] },
    };
  },
});
