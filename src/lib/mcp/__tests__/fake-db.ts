// In-memory stand-in for the parts of the Supabase client the connector tools use.
// Filters are applied for real so tests catch wrong columns and wrong matches; select lists and
// embeds are ignored (whole rows come back). Column names are checked against the schema separately.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;
type Op = "select" | "insert" | "update" | "delete";
export type Write = { table: string; op: Exclude<Op, "select">; rows?: Row[]; patch?: Row; matched?: number };

const likeToRegex = (pattern: string) => {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) { out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "is");
};

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export class FakeDb {
  tables: Record<string, Row[]>;
  writes: Write[] = [];
  uploads: { bucket: string; path: string; bytes: number; contentType?: string }[] = [];
  failures: { table: string; op: Op; message: string }[] = [];

  constructor(tables: Record<string, Row[]> = {}) {
    this.tables = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.map(r => ({ ...r }))]));
  }
  rows(table: string) { return (this.tables[table] ??= []); }
  failOn(table: string, op: Op, message = "forced failure") { this.failures.push({ table, op, message }); return this; }
  writesTo(table: string, op?: Write["op"]) { return this.writes.filter(w => w.table === table && (!op || w.op === op)); }

  from(table: string) { return new Query(this, table); }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, opts?: { contentType?: string }) => {
        this.uploads.push({ bucket, path, bytes: bytes.length, contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${bucket}/${path}` } }),
    }),
  };
}

class Query implements PromiseLike<any> {
  private op: Op = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private limitN: number | null = null;
  private rangeFrom: number | null = null;
  private mode: "many" | "single" | "maybe" = "many";
  private returning = false;
  private orderBy: { col: string; asc: boolean } | null = null;

  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, _opts?: any) { if (this.op !== "select") this.returning = true; return this; }
  insert(rows: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { this.filters.push(r => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push(r => r[c] !== v); return this; }
  is(c: string, v: any) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  in(c: string, vs: any[]) { this.filters.push(r => vs.includes(r[c])); return this; }
  ilike(c: string, p: string) { const re = likeToRegex(p); this.filters.push(r => re.test(String(r[c] ?? ""))); return this; }
  not(c: string, op: string, v: any) {
    if (op === "is") this.filters.push(r => (r[c] ?? null) !== v);
    else if (op === "in") { const vs = String(v).replace(/[()]/g, "").split(","); this.filters.push(r => !vs.includes(String(r[c]))); }
    else throw new Error(`fake db: not(${op}) unsupported`);
    return this;
  }
  or(expr: string) {
    const parts = expr.split(",").map(p => { const [col, op, ...rest] = p.split("."); return { col, op, val: rest.join(".") }; });
    this.filters.push(r => parts.some(p => (p.op === "ilike" ? likeToRegex(p.val).test(String(r[p.col] ?? "")) : String(r[p.col]) === p.val)));
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.limitN = n; return this; }
  range(from: number, to: number) { this.rangeFrom = from; this.limitN = to - from + 1; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }

  then<A, B>(ok?: ((v: any) => A | PromiseLike<A>) | null, bad?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }

  private shape(rows: Row[]) {
    if (this.mode === "many") return { data: rows, error: null, count: rows.length };
    if (rows.length === 1) return { data: rows[0], error: null };
    if (rows.length === 0 && this.mode === "maybe") return { data: null, error: null };
    return { data: null, error: { message: `expected one row, got ${rows.length}` } };
  }

  private run() {
    const fail = this.db.failures.find(f => f.table === this.table && f.op === this.op);
    if (fail) return { data: null, error: { message: fail.message } };
    const all = this.db.rows(this.table);
    const match = (r: Row) => this.filters.every(f => f(r));
    if (this.op === "insert") {
      const inserted = this.payload.map(p => {
        const row: Row = { id: newId(), created_at: new Date().toISOString(), ...p };
        if (this.table === "customer_rfqs" && !row.rfq_number) row.rfq_number = `RFQ-2026-${String(all.length + 1).padStart(3, "0")}`;
        if (this.table === "sample_requests" && !row.request_number) row.request_number = `SR-2026-${String(all.length + 1).padStart(3, "0")}`;
        all.push(row);
        return row;
      });
      this.db.writes.push({ table: this.table, op: "insert", rows: inserted });
      return this.returning || this.mode !== "many" ? this.shape(inserted) : { data: null, error: null };
    }
    if (this.op === "update") {
      const hit = all.filter(match);
      hit.forEach(r => Object.assign(r, this.patch));
      this.db.writes.push({ table: this.table, op: "update", patch: this.patch, matched: hit.length });
      return this.returning || this.mode !== "many" ? this.shape(hit) : { data: null, error: null };
    }
    if (this.op === "delete") {
      const keep = all.filter(r => !match(r));
      const matched = all.length - keep.length;
      this.db.tables[this.table] = keep;
      this.db.writes.push({ table: this.table, op: "delete", matched });
      return { data: null, error: null };
    }
    let rows = all.filter(match);
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => (a[col] ?? "") < (b[col] ?? "") ? (asc ? -1 : 1) : (a[col] ?? "") > (b[col] ?? "") ? (asc ? 1 : -1) : 0);
    }
    if (this.limitN != null) rows = rows.slice(this.rangeFrom ?? 0, (this.rangeFrom ?? 0) + this.limitN);
    return this.shape(rows.map(r => ({ ...r })));
  }
}

/** Columns of a table, read from the generated Supabase types so tests track the real schema. */
export function schemaColumns(typesSource: string, table: string): Set<string> {
  const m = typesSource.match(new RegExp(`\\n      ${table}: \\{\\n        Row: \\{([\\s\\S]*?)\\n        \\}`));
  if (!m) throw new Error(`table ${table} not in types.ts`);
  return new Set([...m[1].matchAll(/^\s+(\w+)\??:/gm)].map(x => x[1]));
}
