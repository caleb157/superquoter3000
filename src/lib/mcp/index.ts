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
import { SALES_TOOLS } from "./tools/sales-tools";
import { TRACTION_TOOLS } from "./tools/traction-tools";
import { PROSPECT_TOOLS } from "./tools/prospect-tools";
import { COMMAND_CENTER_TOOLS } from "./tools/command-center-tools";

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
  ...SALES_TOOLS,
  ...TRACTION_TOOLS,
  ...PROSPECT_TOOLS,
  ...COMMAND_CENTER_TOOLS,
];

export default defineMcp({
  name: "product-hq-mcp",
  title: "Product HQ",
  version: "0.7.0",
  instructions:
    "Tools for the Product HQ costing, quoting, sampling and CRM app. Use `whoami` to check the connection. " +
    "Read: `list_lookups` (names PD HQ matches on), `list_customers`, `list_inquiries`, `list_products`, `list_tasks`, `list_cogs_items`, and `get_sales_analytics` (the Analytics page's real and projected revenue by month, quarter and year, split trading / manufacturing). " +
    "To turn a customer inquiry into PD HQ work: `find_or_create_customer`, then `create_inquiry` (PD HQ adds the Inquiry created tasks), " +
    "then `import_costing_intake` with one Costing Intake row per SKU, `attach_product_photo` for the customer's pictures, " +
    "`create_sample_request` when samples are agreed, and `create_task` for anything else. " +
    "Every write tool takes dry_run; run it first and show the person the plan before writing. Never invent costs or prices. " +
    "COGS lines: `add_cogs_item` and `update_cogs_item`. All tools run under the signed-in user's Row-Level Security policies. No tool deletes a customer, inquiry, product or task; import_costing_intake with update_existing replaces a category's manual COGS lines, like the app's Bulk Editor. " +
    "Sales CRM: `list_sales_pipeline`; `upsert_sales_account` and `upsert_contact` (match on domain, LinkedIn URL, email); `log_touch` for every message in or out (external_id keeps syncs idempotent); `set_sales_stage` with a reason; `save_brief`; `save_follow_up` for replies and nudges with drafts for approval; `log_job_run` at the end of every job. " +
    "Do not contact is one master flag: every sender calls `check_can_contact` right before sending, and removal requests go through `set_do_not_contact`. " +
    "Traction and content: `list_traction_board` (bullseye rings, top ideas per channel, communities, inquiries per channel; only Caleb moves rings, in the app), `save_traction_idea`, `save_community`, `list_content` and `save_content` (pieces plus posting calendar slots and their 3-day scores). " +
    "Prospects (the whole TAM, the filtered TAM, persona lists, weekly picks, trade buyers, Waalaxy and Apollo people): `search_prospects` with list, type, tier, country and tag filters; `set_prospect_rank` moves one up or down a tier or pins it, always with a reason, and never undoes a tier Caleb set unless he asks; `promote_prospect` puts one into the pipeline as Queued with its people; `import_prospects` loads up to 500 companies onto a list (the weekly list run). Imports never overwrite a tier set by hand. " +
    "Inquiries created for a pipeline account move it to Inquiry and are tagged to the Sales channel automatically; a PO moves it to Customer. " +
    "Command center (the Sales landing page): `get_sales_overview` gives the week in numbers against last week and the targets, the funnel vs a week ago, every scheduled run with its state and next fire, usage and tasks due; `log_usage` records Claude plan use and tool balances; `sync_schedules` copies the scheduled tasks' last and next fires onto the run board; `mark_bounced` records an email bounce (hard bounces set never-email).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: TOOLS,
});
