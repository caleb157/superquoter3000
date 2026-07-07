import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listCustomersTool from "./tools/list-customers";
import listInquiriesTool from "./tools/list-inquiries";
import listProductsTool from "./tools/list-products";
import listTasksTool from "./tools/list-tasks";
import addCogsItemTool from "./tools/add-cogs-item";
import listCogsItemsTool from "./tools/list-cogs-items";
import updateCogsItemTool from "./tools/update-cogs-item";

// Build the OAuth issuer from the Supabase project ref so it stays on the
// direct supabase.co host (not the .lovable.cloud proxy). Vite inlines this
// literal at build time, keeping the module import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "product-hq-mcp",
  title: "Product HQ",
  version: "0.1.0",
  instructions:
    "Tools for the Product HQ costing & CRM app. Use `whoami` to verify the connection. Read tools: `list_customers`, `list_inquiries`, `list_products`, `list_tasks`, `list_cogs_items`. Write tools: `add_cogs_item` and `update_cogs_item` (first resolve the product UUID via `list_products`; for updates you can also call `list_cogs_items` to find the specific line). All tools run under the signed-in user's Row-Level Security policies.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [whoamiTool, listCustomersTool, listInquiriesTool, listProductsTool, listTasksTool, listCogsItemsTool, addCogsItemTool, updateCogsItemTool],
});
