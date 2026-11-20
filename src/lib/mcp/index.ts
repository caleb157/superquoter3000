import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listCustomersTool from "./tools/list-customers";
import listInquiriesTool from "./tools/list-inquiries";
import listProductsTool from "./tools/list-products";
import listTasksTool from "./tools/list-tasks";
import addCogsItemTool from "./tools/add-cogs-item";
import listCogsItemsTool from "./tools/list-cogs-items";
import updateCogsItemTool from "./tools/update-cogs-item";
import listLookupsTool from "./tools/list-lookups";
import findOrCreateCustomerTool from "./tools/find-or-create-customer";
import createInquiryTool from "./tools/create-inquiry";
import importCostingIntakeTool from "./tools/import-costing-intake";
import attachProductPhotoTool from "./tools/attach-product-photo";
import createSampleRequestTool from "./tools/create-sample-request";
import createTaskTool from "./tools/create-task";
import getSalesAnalyticsTool from "./tools/get-sales-analytics";

// Build the OAuth issuer from the Supabase project ref so it stays on the
// direct supabase.co host (not the .lovable.cloud proxy). Vite inlines this
// literal at build time, keeping the module import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export const TOOLS = [
  whoamiTool,
  listLookupsTool,
  listCustomersTool,
  listInquiriesTool,
  listProductsTool,
  listTasksTool,
  listCogsItemsTool,
  getSalesAnalyticsTool,
  findOrCreateCustomerTool,
  createInquiryTool,
  importCostingIntakeTool,
  attachProductPhotoTool,
  createSampleRequestTool,
  createTaskTool,
  addCogsItemTool,
  updateCogsItemTool,
];

export default defineMcp({
  name: "product-hq-mcp",
  title: "Product HQ",
  version: "0.3.0",
  instructions:
    "Tools for the Product HQ costing, quoting, sampling and CRM app. Use `whoami` to check the connection. " +
    "Read: `list_lookups` (names PD HQ matches on), `list_customers`, `list_inquiries`, `list_products`, `list_tasks`, `list_cogs_items`, and `get_sales_analytics` (the Analytics page's real and projected revenue by month, quarter and year, split trading / manufacturing). " +
    "To turn a customer inquiry into PD HQ work: `find_or_create_customer`, then `create_inquiry` (PD HQ adds the Inquiry created tasks), " +
    "then `import_costing_intake` with one Costing Intake row per SKU, `attach_product_photo` for the customer's pictures, " +
    "`create_sample_request` when samples are agreed, and `create_task` for anything else. " +
    "Every write tool takes dry_run; run it first and show the person the plan before writing. Never invent costs or prices. " +
    "COGS lines: `add_cogs_item` and `update_cogs_item`. All tools run under the signed-in user's Row-Level Security policies. No tool deletes a customer, inquiry, product or task; import_costing_intake with update_existing replaces a category's manual COGS lines, like the app's Bulk Editor.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: TOOLS,
});
