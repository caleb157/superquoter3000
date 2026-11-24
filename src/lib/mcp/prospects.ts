// Prospects logic for the PD HQ connector: search the whole TAM, move a company up or down by hand, put one into the
// pipeline, and load a weekly list run. (db, input) functions, tested with a stand-in db. Relative imports only (see AGENTS.md).
import { ToolError, type Db } from "./shared";
import { PROSPECT_STATUSES, PROSPECT_TIERS, searchArgs, type ProspectFilters } from "../sales/prospects";

const ACTOR = "PD HQ connector";
const rpc = async (db: Db, fn: string, args: Record<string, unknown>, what: string) => {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new ToolError(`${what}: ${error.message}`);
  return data;
};

export type SearchProspectsInput = ProspectFilters & { in_crm?: boolean; has_people?: boolean; limit?: number; offset?: number; include_facets?: boolean };

export async function searchProspects(db: Db, input: SearchProspectsInput) {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500);
  const args = searchArgs({ ...input, inCrm: input.in_crm ?? null, hasPeople: input.has_people ?? null }, 0, limit);
  args.p_offset = Math.max(input.offset ?? 0, 0);
  const res = await rpc(db, "search_prospects", args, "Could not search prospects");
  const facets = input.include_facets ? await rpc(db, "prospect_facets", {}, "Could not read the list counts") : undefined;
  return { total: res?.total ?? 0, offset: args.p_offset, rows: res?.rows ?? [], ...(facets ? { facets } : {}) };
}

export type SetRankInput = { id: string; tier?: "A" | "B" | "C" | "D" | "auto"; move?: -1 | 1; pinned?: boolean; reason: string; dry_run?: boolean };

/** Move a company up or down a tier, set one, pin it, or hand it back to the score. Always with a reason; logged. */
export async function setProspectRank(db: Db, input: SetRankInput) {
  if (!input.reason?.trim()) throw new ToolError("Give a reason. Every tier move is logged with why.");
  if (input.tier == null && input.move == null && input.pinned == null) throw new ToolError("Give tier, move or pinned.");
  if (input.tier && input.tier !== "auto" && !(PROSPECT_TIERS as readonly string[]).includes(input.tier)) throw new ToolError("tier must be A, B, C, D or auto.");
  const { data: cur, error } = await db.from("prospects").select("id, name, tier, tier_override, effective_tier, pinned, dnc").eq("id", input.id).maybeSingle();
  if (error) throw new ToolError(`Could not read the prospect: ${error.message}`);
  if (!cur) throw new ToolError(`No prospect with id ${input.id}.`);
  if (input.dry_run) return { prospect: cur, would_set: { tier: input.tier, move: input.move, pinned: input.pinned }, dry_run: true };
  const after = await rpc(db, "set_prospect_rank", { p_id: input.id, p_tier: input.tier ?? null, p_move: input.move ?? null, p_pinned: input.pinned ?? null, p_reason: input.reason.trim(), p_actor: ACTOR }, "Could not change the tier");
  return { prospect: { ...cur, ...after }, from_tier: cur.effective_tier, dry_run: false };
}

export type PromoteInput = { id: string; reason?: string; owner?: string; dry_run?: boolean };

/** Put a prospect into the pipeline as a Queued account (or link it to the account already there), with its people. */
export async function promoteProspect(db: Db, input: PromoteInput) {
  const { data: p, error } = await db.from("prospects").select("id, name, domain, dnc, customer_id, status, people_count").eq("id", input.id).maybeSingle();
  if (error) throw new ToolError(`Could not read the prospect: ${error.message}`);
  if (!p) throw new ToolError(`No prospect with id ${input.id}.`);
  if (p.dnc) throw new ToolError(`${p.name} is on do not contact. It cannot go into the pipeline.`);
  if (input.dry_run) return { prospect: p, already_in_crm: !!p.customer_id, would_add_people: p.people_count, dry_run: true };
  const r = await rpc(db, "promote_prospect", { p_id: input.id, p_reason: input.reason?.trim() || null, p_owner: input.owner ?? "CQ" }, "Could not promote");
  return { prospect: { ...p, customer_id: r?.customer_id, status: "promoted" }, ...r, dry_run: false };
}

export type ImportList = { id: string; name: string; kind?: string; description?: string; run_date?: string };
export type ImportProspectsInput = {
  list?: ImportList; replace_list?: boolean; source?: string;
  rows?: Record<string, unknown>[]; people?: Record<string, unknown>[]; dry_run?: boolean;
};

/** Load a small batch (up to 500 companies and 2,000 people): a weekly pick list, research results, new finds. */
export async function importProspects(db: Db, input: ImportProspectsInput) {
  const rows = input.rows ?? [];
  const people = input.people ?? [];
  if (!rows.length && !people.length && !input.list) throw new ToolError("Give rows, people or a list.");
  if (rows.length > 500) throw new ToolError("At most 500 companies per call. Bigger loads go through Sales > Prospects > Load file.");
  if (people.length > 2000) throw new ToolError("At most 2,000 people per call.");
  const bad = rows.filter(r => !String(r.name ?? "").trim()).length;
  for (const r of rows) {
    if (r.status && !(PROSPECT_STATUSES as readonly string[]).includes(String(r.status))) throw new ToolError(`status must be one of ${PROSPECT_STATUSES.join(", ")}.`);
    if ("tier_override" in r || "pinned" in r) throw new ToolError("Imports never set tier_override or pinned; those are Caleb's calls. Use set_prospect_rank.");
  }
  if (input.dry_run) return { would_import: rows.length - bad, without_name: bad, people: people.length, list: input.list ?? null, replace_list: !!input.replace_list, dry_run: true };
  const source = input.source ?? (input.list ? `connector: ${input.list.id}` : "connector");
  if (input.list) await rpc(db, "upsert_prospect_lists", { p_lists: [{ kind: "custom", ...input.list }] }, "Could not save the list");
  const res = rows.length || input.replace_list
    ? await rpc(db, "import_prospects", { p_list_id: input.list?.id ?? null, p_rows: rows, p_source: source, p_replace_list: !!input.replace_list }, "Could not import")
    : { created: 0, updated: 0, linked_to_accounts: 0, skipped: 0 };
  const ppl = people.length
    ? await rpc(db, "import_prospect_people", { p_rows: input.list ? people.map(x => ({ lists: [input.list!.id], ...x })) : people, p_source: source }, "Could not import people")
    : null;
  await rpc(db, "refresh_prospect_counts", {}, "Could not refresh list counts");
  return { ...res, people: ppl, list: input.list?.id ?? null, dry_run: false };
}
