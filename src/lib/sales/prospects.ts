// Prospects: the whole TAM in PD HQ. Labels, filters and the load-file reader shared by the Prospects tab and tests.
// No imports outside this folder (the connector reuses it).

export const PROSPECT_TIERS = ["A", "B", "C", "D", "X"] as const;
export type ProspectTier = (typeof PROSPECT_TIERS)[number];
export const TIER_LABELS: Record<ProspectTier, string> = {
  A: "A: best fit", B: "B: strong", C: "C: maybe", D: "D: long tail", X: "X: did not pass the fit gate",
};
export const PROSPECT_STATUSES = ["new", "researching", "ready", "promoted", "excluded"] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "New", researching: "Researching", ready: "Ready to reach", promoted: "In the pipeline", excluded: "Excluded",
};
export const LIST_KIND_ORDER = ["weekly_outreach", "tam_filtered", "research", "trade_research", "waalaxy", "apollo", "linkedin", "customers", "custom", "tam_raw"] as const;
export const LIST_KIND_LABELS: Record<string, string> = {
  weekly_outreach: "This week's outreach", tam_filtered: "Filtered TAM", research: "Research", trade_research: "Trade research",
  waalaxy: "Waalaxy", apollo: "Apollo", linkedin: "LinkedIn", customers: "Customers", custom: "Other lists", tam_raw: "Full TAM",
};
export const PROSPECT_TYPE_LABELS: Record<string, string> = {
  "furniture-brand": "Furniture brand", "decor-importer": "Decor importer", "trade-switchers": "Trade buyer (not in Apollo)",
  "trade-other-origin": "US importer, other origin", "maker-small": "Small maker", rental: "Rental and staging", "marketplace-seller": "Marketplace seller",
};
export const TAG_LABELS: Record<string, string> = {
  trade_buyer: "Trade buyer", in_apollo: "In Apollo", amazon_seller: "Amazon seller", wayfair: "Wayfair", top_priority: "Jodhpur buyer",
  responsive: "Responsive", customer: "Customer", other_origin: "Buys from other countries", no_route_yet: "No contact yet",
  country_inferred: "Country guessed", apollo_do_not_prospect: "Apollo: do not prospect",
};
export const typeLabel = (t: string | null | undefined) => (t ? PROSPECT_TYPE_LABELS[t] ?? t : "—");

/** One tier up (+1) or down (-1) on the A-D scale; X (failed the gate) moves into D. */
export function moveTier(current: string | null | undefined, move: number): ProspectTier {
  const scale = ["A", "B", "C", "D"];
  const i = scale.indexOf(current ?? "D");
  const from = i < 0 ? 4 : i;
  return scale[Math.max(0, Math.min(3, from - move))] as ProspectTier;
}

export type ProspectFilters = {
  q?: string; lists?: string[]; types?: string[]; tiers?: string[]; countries?: string[]; tags?: string[]; status?: string[];
  inCrm?: boolean | null; hasPeople?: boolean | null; sort?: "rank" | "name" | "trade" | "recent";
};

/** Default view hides companies that failed the fit gate unless the full TAM list is chosen or a status is picked. */
export function searchArgs(f: ProspectFilters, page: number, pageSize: number) {
  const arr = (v?: string[]) => (v && v.length ? v : null);
  const wantsRaw = (f.lists ?? []).includes("tam-raw");
  const status = arr(f.status) ?? (wantsRaw ? null : ["new", "researching", "ready", "promoted"]);
  return {
    p_q: f.q?.trim() || null, p_lists: arr(f.lists), p_types: arr(f.types), p_tiers: arr(f.tiers), p_countries: arr(f.countries),
    p_tags: arr(f.tags), p_status: status, p_in_crm: f.inCrm ?? null, p_has_people: f.hasPeople ?? null,
    p_sort: f.sort ?? "rank", p_limit: pageSize, p_offset: page * pageSize,
  };
}

/** Filters <-> URL query, so a filtered view can be bookmarked or shared. */
export function filtersToParams(f: ProspectFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.pq = f.q;
  for (const k of ["lists", "types", "tiers", "countries", "tags", "status"] as const) if (f[k]?.length) out[`p_${k}`] = f[k]!.join(",");
  if (f.inCrm != null) out.p_crm = String(f.inCrm);
  if (f.hasPeople != null) out.p_people = String(f.hasPeople);
  if (f.sort && f.sort !== "rank") out.p_sort = f.sort;
  return out;
}
export function paramsToFilters(get: (k: string) => string | null): ProspectFilters {
  const list = (k: string) => (get(k) ? get(k)!.split(",").filter(Boolean) : undefined);
  const bool = (k: string) => (get(k) == null ? null : get(k) === "true");
  return {
    q: get("pq") ?? undefined, lists: list("p_lists"), types: list("p_types"), tiers: list("p_tiers"), countries: list("p_countries"),
    tags: list("p_tags"), status: list("p_status"), inCrm: bool("p_crm"), hasPeople: bool("p_people"),
    sort: (get("p_sort") as ProspectFilters["sort"]) ?? "rank",
  };
}

// ---------- load file (pdhq-prospects-<date>.jsonl[.gz], written by playbooks/prospect-list-building/files/pdhq_export.py) ----------
export type LoadRecord = { t: "list" | "p" | "pp"; [k: string]: unknown };
export type LoadBatch = { kind: "lists" | "prospects" | "people"; rows: Record<string, unknown>[]; start: number };

/**
 * Turns the file's records into batches in file order: lists first, then prospects, then people.
 * A batch never mixes kinds, so people always load after the companies they belong to.
 * `start` is the index of the batch's first record, used to resume a load that stopped.
 */
export class Batcher {
  private cur: LoadBatch | null = null;
  private i = 0;
  constructor(private size = 500) {}
  /** Adds one record; returns a finished batch when the kind changes or the batch is full. */
  push(r: LoadRecord): LoadBatch | null {
    const kind = r.t === "list" ? "lists" : r.t === "p" ? "prospects" : r.t === "pp" ? "people" : null;
    let out: LoadBatch | null = null;
    if (kind) {
      if (this.cur && (this.cur.kind !== kind || this.cur.rows.length >= this.size)) { out = this.cur; this.cur = null; }
      const { t: _t, ...row } = r;
      if (!this.cur) this.cur = { kind, rows: [], start: this.i };
      this.cur.rows.push(row);
    }
    this.i++;
    return out;
  }
  flush(): LoadBatch | null { const out = this.cur; this.cur = null; return out; }
  get seen() { return this.i; }
}

export function* batchRecords(records: Iterable<LoadRecord>, size = 500): Generator<LoadBatch> {
  const b = new Batcher(size);
  for (const r of records) { const out = b.push(r); if (out) yield out; }
  const last = b.flush();
  if (last) yield last;
}

/** Splits text into JSON lines, keeping the unfinished tail for the next chunk. */
export function splitLines(buffer: string): { lines: LoadRecord[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const lines: LoadRecord[] = [];
  for (const p of parts) { const s = p.trim(); if (s) lines.push(JSON.parse(s)); }
  return { lines, rest };
}
