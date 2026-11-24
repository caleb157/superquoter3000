import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db";
import { TOOLS } from "../index";
import { importProspects, promoteProspect, searchProspects, setProspectRank } from "../prospects";

const ID = "00000000-0000-4000-8000-0000000000a1";
const DNC = "00000000-0000-4000-8000-0000000000a2";

/** FakeDb plus a recorded rpc(). */
class RpcDb extends FakeDb {
  calls: { fn: string; args: Record<string, unknown> }[] = [];
  answers: Record<string, unknown> = {};
  async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ fn, args });
    const a = this.answers[fn];
    return a instanceof Error ? { data: null, error: { message: a.message } } : { data: a ?? null, error: null };
  }
}
const seed = () => new RpcDb({
  prospects: [
    { id: ID, name: "Ardent Home", domain: "ardenthome.com", tier: "B", tier_override: null, effective_tier: "B", pinned: false, dnc: false, customer_id: null, status: "new", people_count: 3 },
    { id: DNC, name: "Nope Co", domain: "nope.com", tier: "A", tier_override: null, effective_tier: "A", pinned: false, dnc: true, customer_id: null, status: "new", people_count: 0 },
  ],
});

describe("prospect connector tools", () => {
  it("registers the four tools", () => {
    const names = TOOLS.map(t => (t as { name: string }).name);
    for (const n of ["search_prospects", "set_prospect_rank", "promote_prospect", "import_prospects"]) expect(names).toContain(n);
  });

  it("searches with the page defaults and hides gate failures", async () => {
    const db = seed();
    db.answers.search_prospects = { total: 1, rows: [{ id: ID }] };
    const r = await searchProspects(db, { q: "ardent", lists: ["weekly-main-2026-11-23"], offset: 50, limit: 25 });
    expect(r.total).toBe(1);
    const a = db.calls[0].args;
    expect(a.p_q).toBe("ardent");
    expect(a.p_offset).toBe(50);
    expect(a.p_limit).toBe(25);
    expect(a.p_status).toEqual(["new", "researching", "ready", "promoted"]);
  });

  it("requires a reason to move a tier and logs the connector as the actor", async () => {
    const db = seed();
    await expect(setProspectRank(db, { id: ID, move: 1, reason: " " })).rejects.toThrow(/reason/);
    db.answers.set_prospect_rank = { effective_tier: "A", tier_override: "A", pinned: false };
    const r = await setProspectRank(db, { id: ID, move: 1, reason: "Replied on LinkedIn" });
    expect(r.from_tier).toBe("B");
    expect((r.prospect as { effective_tier: string }).effective_tier).toBe("A");
    expect(db.calls[0].args).toMatchObject({ p_id: ID, p_move: 1, p_reason: "Replied on LinkedIn", p_actor: "PD HQ connector" });
  });

  it("dry run changes nothing", async () => {
    const db = seed();
    const r = await setProspectRank(db, { id: ID, tier: "A", reason: "test", dry_run: true });
    expect(r.dry_run).toBe(true);
    expect(db.calls).toHaveLength(0);
  });

  it("refuses to promote do not contact", async () => {
    const db = seed();
    await expect(promoteProspect(db, { id: DNC })).rejects.toThrow(/do not contact/);
    db.answers.promote_prospect = { customer_id: "c1", created_account: true, contacts_added: 3 };
    const r = await promoteProspect(db, { id: ID, reason: "Top of the weekly list" });
    expect(r.created_account).toBe(true);
    expect(db.calls.map(c => c.fn)).toEqual(["promote_prospect"]);
  });

  it("imports onto a list, never sets a hand-set tier, and caps batch size", async () => {
    const db = seed();
    await expect(importProspects(db, { rows: [{ name: "X", tier_override: "A" }] })).rejects.toThrow(/tier_override/);
    await expect(importProspects(db, { rows: Array.from({ length: 501 }, (_, i) => ({ name: `C${i}` })) })).rejects.toThrow(/500/);
    db.answers.import_prospects = { created: 1, updated: 0, linked_to_accounts: 0, skipped: 0 };
    db.answers.import_prospect_people = { created: 1, updated: 0, skipped: 0 };
    const list = { id: "weekly-main-2026-11-30", name: "Weekly main 30 Nov", kind: "weekly_outreach" };
    const r = await importProspects(db, { list, replace_list: true, rows: [{ name: "New Co", domain: "newco.com" }], people: [{ full_name: "Ana", domain: "newco.com" }] });
    expect(r.created).toBe(1);
    expect(db.calls.map(c => c.fn)).toEqual(["upsert_prospect_lists", "import_prospects", "import_prospect_people", "refresh_prospect_counts"]);
    expect(db.calls[1].args).toMatchObject({ p_list_id: list.id, p_replace_list: true });
    expect((db.calls[2].args.p_rows as { lists: unknown }[])[0].lists).toEqual([list.id]);
  });
});
