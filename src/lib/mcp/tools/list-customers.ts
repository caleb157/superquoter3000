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
  name: "list_customers",
  title: "List customers",
  description: "List customers visible to the signed-in user, optionally filtered by a search string on name/company/email.",
  inputSchema: {
    search: z.string().optional().describe("Optional substring to match against name, company, or email."),
    limit: z.number().int().min(1).max(200).optional().describe("Max rows to return (default 50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("customers")
      .select("id, name, company, email, phone, lead_status, source, created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 50);
    if (search && search.trim()) {
      const s = search.trim().replace(/[%,]/g, "");
      q = q.or(`name.ilike.%${s}%,company.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { customers: data ?? [] },
    };
  },
});
