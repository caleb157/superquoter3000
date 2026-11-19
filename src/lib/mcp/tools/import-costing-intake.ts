import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  applyIntakeRows,
  checkIntakeRowNames,
  intakeRowFromRecord,
  loadIntakeLookups,
  matchProduct,
  type IntakeRow,
} from "../../costing-intake-core";
import { check, ok, ToolError, withUserDb, type Db } from "../shared";

export const MAX_INTAKE_ROWS = 100;

export type ImportIntakeInput = {
  inquiry_id: string;
  rows: Record<string, unknown>[];
  create_missing?: boolean;
  update_existing?: boolean;
  dry_run?: boolean;
};

/**
 * Run Costing Intake rows into an inquiry with the same importer the app's "Import products" and
 * Bulk Costing Editor use. Rows are keyed by sheet headers ("Piece W (in)") or column keys ("width_inch").
 */
export async function importCostingIntake(db: Db, input: ImportIntakeInput) {
  if (!input.rows.length) throw new ToolError("No rows given.");
  if (input.rows.length > MAX_INTAKE_ROWS) throw new ToolError(`At most ${MAX_INTAKE_ROWS} rows per call; split the sheet.`);
  const createMissing = input.create_missing ?? true;
  const updateExisting = input.update_existing ?? false;

  const inquiry = check(
    await db.from("customer_rfqs").select("id, rfq_number, title, status").eq("id", input.inquiry_id).maybeSingle(),
    "Could not read the inquiry",
  );
  if (!inquiry) throw new ToolError(`Inquiry ${input.inquiry_id} not found or not visible to you.`);

  const warnings: string[] = [];
  const unknown = new Set<string>();
  const rows: IntakeRow[] = [];
  input.rows.forEach((rec, i) => {
    const { row, unknown: u } = intakeRowFromRecord(rec, i + 2); // sheet row numbers: header is row 1
    u.forEach(k => unknown.add(k));
    if (!row.sku && !row.name) warnings.push(`row ${i + 2}: no SKU or product name, skipped`);
    else rows.push(row);
  });
  if (unknown.size) warnings.push(`Columns not on the Costing Intake sheet were ignored: ${[...unknown].join(", ")}`);

  const L = await loadIntakeLookups(db);
  const existing = check(
    await db.from("products").select("id, sku, name, sort_order").eq("customer_rfq_id", input.inquiry_id).is("archived_at", null),
    "Could not read the inquiry's products",
  ) ?? [];
  const plan = rows.map(r => {
    const m = matchProduct(existing, r);
    const action = m ? (updateExisting ? "update" : "skip (exists; set update_existing to change it)") : createMissing ? "create" : "skip (new; create_missing is off)";
    return { row: r._row, sku: r.sku ?? null, name: r.name ?? null, action, product_id: m?.id ?? null };
  });
  for (const r of rows) warnings.push(...checkIntakeRowNames(r, L));

  if (input.dry_run) {
    return { inquiry, dry_run: true, plan, created: 0, updated: 0, warnings };
  }

  const res = await applyIntakeRows(db, input.inquiry_id, rows, L, { createMissing, updateExisting });
  return {
    inquiry,
    dry_run: false,
    plan,
    created: res.created,
    updated: res.updated,
    product_ids: res.ids,
    // applyRow repeats the name warnings it hits; keep each message once.
    warnings: [...new Set([...warnings, ...res.warnings])],
  };
}

export default defineTool({
  name: "import_costing_intake",
  title: "Import Costing Intake rows",
  description:
    "Add or update products on an inquiry from Costing Intake rows, using the same importer as the app's Import products button. Each row is an object keyed by the sheet's headers (e.g. \"SKU\", \"Product name\", \"Piece W (in)\", \"Raw piece ₹\") or column keys; call list_lookups with include_intake_columns for the full list. Blank or missing cells leave values unchanged. Rows match existing products on the inquiry by SKU, then name. New products are created by default; existing ones are only changed when update_existing is true, and then any category ₹ total or named line item replaces that category's manual COGS rows. Never invent costs: leave ₹ cells out unless the customer or vendor gave them. Run with dry_run first to see the plan and any unknown names. Cached prices and CBM are recalculated by the app when the inquiry is next opened.",
  inputSchema: {
    inquiry_id: z.string().uuid().describe("Inquiry UUID (from create_inquiry or list_inquiries)."),
    rows: z
      .array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .min(1)
      .max(MAX_INTAKE_ROWS)
      .describe("One object per SKU, keyed by Costing Intake header or key."),
    create_missing: z.boolean().optional().describe("Create products for rows that match nothing (default true)."),
    update_existing: z.boolean().optional().describe("Update products that already exist on the inquiry (default false)."),
    dry_run: z.boolean().optional().describe("Return the plan and warnings without writing."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: withUserDb(async (db, input: ImportIntakeInput) => {
    const r = await importCostingIntake(db, input);
    const head = r.dry_run
      ? `Dry run for ${r.inquiry.rfq_number}: ${r.plan.filter(p => p.action === "create").length} to create, ${r.plan.filter(p => p.action === "update").length} to update.`
      : `${r.inquiry.rfq_number}: created ${r.created}, updated ${r.updated}. Open the inquiry in PD HQ to refresh cached prices and CBM.`;
    const text = r.warnings.length ? `${head}\nWarnings:\n- ${r.warnings.join("\n- ")}` : head;
    return ok(text, r as unknown as Record<string, unknown>);
  }),
});
