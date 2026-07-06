import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listCustomersTool from "./tools/list-customers";
import listInquiriesTool from "./tools/list-inquiries";
import listProductsTool from "./tools/list-products";
import listTasksTool from "./tools/list-tasks";

// Build the OAuth issuer from the Supabase project ref so it stays on the
// direct supabase.co host (not the .lovable.cloud proxy). Vite inlines this
// literal at build time, keeping the module import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "product-hq-mcp",
  title: "Product HQ",
  version: "0.1.0",
  instructions:
    "Tools for the Product HQ costing & CRM app. Use `whoami` to verify the connection, then `list_customers`, `list_inquiries`, `list_products`, and `list_tasks` to read the signed-in user's data. All tools are read-only and run under the user's Row-Level Security policies.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listCustomersTool, listInquiriesTool, listProductsTool, listTasksTool],
});
