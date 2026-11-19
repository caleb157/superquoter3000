import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { pickEntities } from "../../inquiry-list-totals";
import { defaultDurationMonths, deriveScheduleMonths } from "../../projections";
import { check, isValidYmd, ok, todayInIndia, ToolError, withUserDb, type Db } from "../shared";

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
const SHIP_METHODS = ["sea", "air", "ground"] as const;

export type CreateInquiryInput = {
  customer_id: string;
  title: string;
  received_date?: string;
  requirements?: string;
  notes?: string;
  priority?: (typeof PRIORITIES)[number];
  quoting_currency?: string;
  target_completion_date?: string;
  drive_url?: string;
  start_month?: string;
  shipping_method?: (typeof SHIP_METHODS)[number];
  allow_duplicate?: boolean;
  dry_run?: boolean;
};

const exact = (v: string) => v.trim().replace(/[\\%_]/g, m => `\\${m}`);

/**
 * Create an active inquiry the way the app's New Inquiry dialog does: the customer_rfqs row, then
 * its Projection row with the dialog's defaults. The database then runs the "Inquiry created" task rules.
 */
export async function createInquiry(db: Db, input: CreateInquiryInput, today = todayInIndia()) {
  const title = input.title.trim();
  if (!title) throw new ToolError("Give the inquiry a title.");
  for (const k of ["received_date", "target_completion_date"] as const) {
    const v = input[k];
    if (v && !isValidYmd(v)) throw new ToolError(`${k} must be a real date as YYYY-MM-DD.`);
  }
  const startMonth = input.start_month ?? today.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) throw new ToolError("start_month must be YYYY-MM.");

  const customer = check(
    await db.from("customers").select("id, name, company").eq("id", input.customer_id).maybeSingle(),
    "Could not read the customer",
  );
  if (!customer) throw new ToolError(`Customer ${input.customer_id} not found or not visible to you.`);

  const open = check(
    await db
      .from("customer_rfqs")
      .select("id, rfq_number, title, status, created_at")
      .eq("customer_id", input.customer_id)
      .ilike("title", exact(title))
      .not("status", "in", "(complete,cancelled)")
      .limit(5),
    "Could not check for duplicate inquiries",
  ) ?? [];
  if (open.length && !input.allow_duplicate) {
    return { inquiry: open[0], created: false, duplicate_of: open[0], dry_run: !!input.dry_run };
  }

  const row = {
    customer_id: input.customer_id,
    title,
    priority: input.priority ?? "normal",
    status: "active",
    received_date: input.received_date ?? today,
    requirements: input.requirements?.trim() || null,
    notes: input.notes?.trim() || null,
    quoting_currency: input.quoting_currency?.trim().toUpperCase() || null,
    target_completion_date: input.target_completion_date ?? null,
    drive_url: input.drive_url?.trim() || null,
  };

  const entities = check(
    await db.from("company_entities").select("id, name, entity_type").order("name"),
    "Could not read company entities",
  ) ?? [];
  const selling = entities[0]?.id ?? null;
  const producing = pickEntities(entities).pvId ?? selling;
  const method = input.shipping_method ?? "sea";
  const duration = defaultDurationMonths(method);
  const startDate = `${startMonth}-01`;
  const projection = {
    selling_entity_id: selling,
    producing_entity_id: producing,
    certainty_override: null,
    start_month: startDate,
    duration_months: duration,
    shipping_method: method,
    paying_shipping: false,
    repeat_order: false,
    projected_fob_revenue_usd: null,
    project_gpm: null,
    ...(deriveScheduleMonths(startDate, duration) ?? {}),
  };
  const entityName = (id: string | null) => entities.find((e: { id: string }) => e.id === id)?.name ?? null;
  const plan = { selling_entity: entityName(selling), producing_entity: entityName(producing) };

  if (input.dry_run) return { inquiry: row, projection, ...plan, created: false, would_create: true, dry_run: true };

  const inquiry = check(
    await db.from("customer_rfqs").insert(row).select("id, rfq_number, title, status, customer_id, received_date").single(),
    "Could not create the inquiry",
  );
  const projRes = await db.from("inquiry_projections").insert({ inquiry_id: inquiry.id, ...projection });
  const warnings: string[] = [];
  if (projRes.error) warnings.push(`Inquiry created, but its projection was not: ${projRes.error.message}. Fill it in on the Projection tab.`);
  return { inquiry, ...plan, created: true, dry_run: false, warnings };
}

export default defineTool({
  name: "create_inquiry",
  title: "Create an inquiry",
  description:
    "Create an active inquiry for an existing customer (find it first with find_or_create_customer), with the same Projection defaults as the app's New Inquiry dialog: first company entity sells, the PV entity produces, sea freight, start this month. PD HQ then adds the tasks from the \"Inquiry created\" rules. If the customer already has an open inquiry with the same title, that one is returned instead unless allow_duplicate is true. Use dry_run to preview.",
  inputSchema: {
    customer_id: z.string().uuid().describe("Customer UUID."),
    title: z.string().min(1).max(300).describe("Short title, e.g. 'Mango wood serving trays'."),
    received_date: z.string().optional().describe("YYYY-MM-DD the inquiry came in. Default today (India)."),
    requirements: z.string().max(20000).optional().describe("What the customer asked for: products, sizes, finishes, quantities, target prices."),
    notes: z.string().max(20000).optional().describe("Internal notes, e.g. where the inquiry came from and what was agreed."),
    priority: z.enum(PRIORITIES).optional().describe("Default normal."),
    quoting_currency: z.string().max(3).optional().describe("Currency code to quote in, e.g. USD. See list_lookups."),
    target_completion_date: z.string().optional().describe("YYYY-MM-DD the customer needs the quote or samples by."),
    drive_url: z.string().max(2000).optional().describe("Link to the shared folder with the customer's files and photos."),
    start_month: z.string().optional().describe("Projection start month, YYYY-MM. Default this month."),
    shipping_method: z.enum(SHIP_METHODS).optional().describe("Projection shipping method. Default sea."),
    allow_duplicate: z.boolean().optional().describe("Create even if an open inquiry with this title exists for the customer."),
    dry_run: z.boolean().optional().describe("Show what would be created, without writing."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: withUserDb(async (db, input: CreateInquiryInput) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = await createInquiry(db, input);
    const inq = r.inquiry as { rfq_number?: string; title: string };
    const text = r.duplicate_of
      ? `Not created: ${inq.rfq_number} "${inq.title}" is already open for this customer. Pass allow_duplicate to create another.`
      : r.dry_run
        ? `Dry run: would create inquiry "${inq.title}" (sold by ${r.selling_entity ?? "no entity"}, made by ${r.producing_entity ?? "no entity"}).`
        : `Created ${inq.rfq_number} "${inq.title}". PD HQ adds the "Inquiry created" tasks automatically.${r.warnings?.length ? ` ${r.warnings.join(" ")}` : ""}`;
    return ok(text, r as Record<string, unknown>);
  }),
});
