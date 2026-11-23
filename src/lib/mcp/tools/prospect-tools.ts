// Prospects tools: search the whole TAM and the lists, move a company up or down (with a reason), put one into the pipeline,
// and load a weekly list run. Tier moves by hand stay through re-scores; imports never overwrite them.
import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, withUserDb } from "../shared";
import {
  importProspects, promoteProspect, searchProspects, setProspectRank,
  type ImportProspectsInput, type PromoteInput, type SearchProspectsInput, type SetRankInput,
} from "../prospects";
import { PROSPECT_STATUSES, PROSPECT_TIERS } from "../../sales/prospects";

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const read = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const json = (r: unknown) => r as Record<string, unknown>;
const strs = z.array(z.string().max(200)).max(50).optional();

export const searchProspectsTool = defineTool({
  name: "search_prospects",
  title: "Search prospects",
  description:
    "Search every company in Prospects (full TAM, filtered TAM, persona lists, weekly picks, trade buyers, Waalaxy, Apollo) by text and filter by list ids, prospect type, tier (A-D, X failed the fit gate), country, tag and status. Best first by default. Companies that failed the fit gate are hidden unless lists includes tam-raw or a status is given. include_facets adds the lists with counts.",
  inputSchema: {
    q: z.string().max(200).optional(),
    lists: strs, types: strs, countries: strs, tags: strs,
    tiers: z.array(z.enum(PROSPECT_TIERS)).optional(),
    status: z.array(z.enum(PROSPECT_STATUSES)).optional(),
    in_crm: z.boolean().optional(),
    has_people: z.boolean().optional(),
    sort: z.enum(["rank", "name", "trade", "recent"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
    include_facets: z.boolean().optional(),
  },
  annotations: read,
  handler: withUserDb(async (db, input: SearchProspectsInput) => {
    const r = await searchProspects(db, input);
    return ok(`${r.total} companies match; showing ${r.rows.length} from ${r.offset}.\n${JSON.stringify(r)}`, json(r));
  }),
});

export const setProspectRankTool = defineTool({
  name: "set_prospect_rank",
  title: "Move a prospect up or down",
  description:
    "Move a prospect one tier up (move 1) or down (move -1), set its tier (A-D, or auto to go back to the score), or pin it to the top of its tier. A reason is required and is logged. Caleb's own moves come first: do not undo a tier he set unless he asks. Use dry_run first.",
  inputSchema: {
    id: z.string().uuid(),
    tier: z.enum(["A", "B", "C", "D", "auto"]).optional(),
    move: z.union([z.literal(1), z.literal(-1)]).optional(),
    pinned: z.boolean().optional(),
    reason: z.string().min(3).max(1000),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: SetRankInput) => {
    const r = await setProspectRank(db, input);
    const p = r.prospect as { name: string; effective_tier: string };
    return ok(r.dry_run ? `Dry run: ${p.name} is tier ${p.effective_tier}.` : `${p.name}: tier ${r.from_tier} → ${p.effective_tier}.`, json(r));
  }),
});

export const promoteProspectTool = defineTool({
  name: "promote_prospect",
  title: "Put a prospect into the pipeline",
  description:
    "Add a prospect to the Sales pipeline as a Queued account with its people as contacts, or link it to the account already in the CRM (matched on domain, then name). Refuses do not contact. Use dry_run first.",
  inputSchema: {
    id: z.string().uuid(),
    reason: z.string().max(1000).optional(),
    owner: z.string().max(20).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: PromoteInput) => {
    const r = await promoteProspect(db, input);
    const p = r.prospect as { name: string };
    return ok(r.dry_run ? `Dry run: would put ${p.name} into the pipeline.` : `${p.name} is in the pipeline.`, json(r));
  }),
});

const row = z.object({
  name: z.string().max(300), domain: z.string().max(300).optional(), website: z.string().max(500).optional(),
  country: z.string().max(100).optional(), state: z.string().max(100).optional(), city: z.string().max(100).optional(),
  prospect_type: z.string().max(100).optional(), tags: z.array(z.string().max(100)).max(30).optional(), industry: z.string().max(200).optional(),
  employees: z.number().int().optional(), linkedin_url: z.string().max(500).optional(), email: z.string().max(300).optional(),
  products: z.string().max(4000).optional(), trade_value_2025: z.number().optional(), trade_shipments: z.number().int().optional(),
  score: z.number().optional(), tier: z.enum(PROSPECT_TIERS).optional(), rank: z.number().int().optional(),
  status: z.enum(PROSPECT_STATUSES).optional(), excluded_reason: z.string().max(500).optional(), dnc: z.boolean().optional(),
  list_rank: z.number().int().optional(), data: z.record(z.unknown()).optional(),
}).passthrough();

export const importProspectsTool = defineTool({
  name: "import_prospects",
  title: "Load prospects",
  description:
    "Load up to 500 companies (and their people) into Prospects, optionally onto a list, e.g. this week's picks (kind weekly_outreach, id weekly-main-YYYY-MM-DD). Matches on domain, then name and country, so nothing is doubled; links accounts already in the CRM and carries do not contact over. Never overwrites a tier set by hand. replace_list clears the list's old members first. The full monthly run goes through Sales > Prospects > Load file instead. Use dry_run first.",
  inputSchema: {
    list: z.object({
      id: z.string().min(1).max(100), name: z.string().min(1).max(200),
      kind: z.enum(["tam_raw", "tam_filtered", "research", "trade_research", "weekly_outreach", "waalaxy", "apollo", "linkedin", "customers", "custom"]).optional(),
      description: z.string().max(1000).optional(), run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).optional(),
    replace_list: z.boolean().optional(),
    source: z.string().max(200).optional(),
    rows: z.array(row).max(500).optional(),
    people: z.array(z.object({
      full_name: z.string().max(300), title: z.string().max(300).optional(), linkedin_url: z.string().max(500).optional(), email: z.string().max(300).optional(),
      company: z.string().max(300).optional(), domain: z.string().max(300).optional(), country: z.string().max(100).optional(),
      location: z.string().max(300).optional(), source: z.string().max(100).optional(), outreach_state: z.string().max(100).optional(),
      decision_maker: z.boolean().optional(), dnc: z.boolean().optional(), data: z.record(z.unknown()).optional(),
    }).passthrough()).max(2000).optional(),
    dry_run: z.boolean().optional(),
  },
  annotations: write,
  handler: withUserDb(async (db, input: ImportProspectsInput) => {
    const r = await importProspects(db, input);
    return ok(r.dry_run ? `Dry run: would load ${(r as { would_import: number }).would_import} companies.` : `Loaded: ${JSON.stringify(r)}`, json(r));
  }),
});

export const PROSPECT_TOOLS = [searchProspectsTool, setProspectRankTool, promoteProspectTool, importProspectsTool];
