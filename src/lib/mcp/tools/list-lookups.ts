import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { INTAKE_COLS } from "../../costing-intake-core";
import { check, ok, withUserDb, type Db } from "../shared";

/** The names other tools and the Costing Intake sheet expect, read live so they never go stale. */
export async function listLookups(db: Db, input: { include_intake_columns?: boolean }) {
  const [types, locations, shipping, finishing, chems, currencies, people, entities] = await Promise.all([
    db.from("product_types").select("id, name").order("name"),
    db.from("local_transport_locations").select("id, name, active").order("sort_order"),
    db.from("shipping_types").select("id, name").order("name"),
    db.from("finishing_difficulty").select("name").order("sort_order"),
    db.from("chemical_prices").select("name, category").order("name"),
    db.from("currencies").select("code, name").order("sort_priority"),
    db.from("profiles").select("assignee_code, display_name").not("assignee_code", "is", null),
    db.from("company_entities").select("id, name, entity_type").order("name"),
  ]);
  const result: Record<string, unknown> = {
    product_types: check(types, "Could not read product types") ?? [],
    source_locations: (check(locations, "Could not read source locations") ?? []).filter((l: { active?: boolean | null }) => l.active !== false),
    shipping_types: check(shipping, "Could not read shipping types") ?? [],
    finishing_difficulties: (check(finishing, "Could not read finishing difficulty") ?? []).map((f: { name: string }) => f.name),
    chemicals: check(chems, "Could not read chemicals") ?? [],
    currencies: check(currencies, "Could not read currencies") ?? [],
    assignees: check(people, "Could not read assignee codes") ?? [],
    company_entities: check(entities, "Could not read company entities") ?? [],
    packaging_types: ["ic_only", "ic_mc", "bulk_pack", "no_packaging"],
    task_priorities: ["low", "normal", "high", "urgent"],
  };
  if (input.include_intake_columns) {
    result.intake_columns = INTAKE_COLS.map(c => ({ header: c.header, key: c.key, type: c.type, section: c.group, help: c.help }));
  }
  return result;
}

export default defineTool({
  name: "list_lookups",
  title: "List lookup values",
  description:
    "Return the names PD HQ matches on: product types, source locations, shipping types, finishing difficulty, chemicals, currencies, assignee codes and company entities. Call this before import_costing_intake or create_task so names match exactly. Set include_intake_columns to also get every Costing Intake column (header, key, type, how to fill).",
  inputSchema: {
    include_intake_columns: z.boolean().optional().describe("Also return the Costing Intake column list (about 150 columns)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: withUserDb(async (db, input: { include_intake_columns?: boolean }) => {
    const lookups = await listLookups(db, input);
    return ok(JSON.stringify(lookups), lookups);
  }),
});
