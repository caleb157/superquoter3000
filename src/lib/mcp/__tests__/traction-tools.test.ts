import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FakeDb, schemaColumns } from "./fake-db";
import { TOOLS } from "../index";
import { listContent, listTractionBoard, saveCommunity, saveContent, saveTractionIdea } from "../traction";

const types = readFileSync(path.resolve(__dirname, "../../../integrations/supabase/types.ts"), "utf8");
const IDEA = "00000000-0000-4000-8000-0000000000e1";
const PIECE = "00000000-0000-4000-8000-0000000000f1";

const seed = () => new FakeDb({
  traction_channels: [
    { id: 4, name: "Sales", ring: "inner", sort_order: 4, fit: 5 },
    { id: 10, name: "Community building", ring: "promising", sort_order: 10, fit: 4 },
  ],
  traction_ideas: [
    { id: IDEA, channel_id: 4, rank: 1, title: "Personal emails to the top 50", status: "approved", free_or_paid: "free" },
    { id: "i2", channel_id: 4, rank: 2, title: "Old idea", status: "dropped", free_or_paid: "free" },
    { id: "i3", channel_id: 10, rank: 1, title: "Answer sourcing questions", status: "proposed", free_or_paid: "free" },
  ],
  communities: [{ id: "c1", name: "Home Decor Sellers", status: "candidate", priority: "A" }],
  customer_rfqs: [{ id: "r1", source_channel: "4", status: "costing" }, { id: "r2", source_channel: null, status: "po" }],
  content_pieces: [{ id: PIECE, slug: "li-post-01", title: "Why we sit in the factory", status: "draft", kind: "post", created_at: "2026-11-01" }],
  content_slots: [{ id: "s1", piece_id: PIECE, channel: "linkedin", slot_date: "2026-11-25", status: "planned" }],
  tasks: [],
});

const checkColumns = (db: FakeDb) => {
  for (const w of db.writes) {
    const have = schemaColumns(types, w.table);
    const cols = [...(w.rows ?? []).flatMap(r => Object.keys(r)), ...Object.keys(w.patch ?? {})].filter(c => c !== "id" && c !== "created_at");
    for (const c of cols) expect(have.has(c), `${w.table}.${c}`).toBe(true);
  }
};

describe("traction and content connector", () => {
  it("registers the five tools", () => {
    const names = TOOLS.map(t => (t as { name: string }).name);
    for (const n of ["list_traction_board", "save_traction_idea", "save_community", "list_content", "save_content"]) expect(names).toContain(n);
  });

  it("reads the bullseye with open ideas, inquiries per channel and communities", async () => {
    const r = await listTractionBoard(seed(), {});
    expect(r.inner_ring).toEqual(["Sales"]);
    const sales = r.channels.find((c: { id: number }) => c.id === 4) as { inquiries: number; ideas: { title: string }[] };
    expect(sales.inquiries).toBe(1);
    expect(sales.ideas.map(i => i.title)).toEqual(["Personal emails to the top 50"]);
    expect(r.untagged_inquiries).toBe(1);
    expect(r.communities).toHaveLength(1);
  });

  it("adds ideas at the next rank, paid ones as not for now, and never touches the ring", async () => {
    const db = seed();
    const dry = await saveTractionIdea(db, { channel_id: 10, title: "Sponsor a newsletter", free_or_paid: "paid", dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, would_create: true });
    expect(db.writes).toHaveLength(0);
    const r = await saveTractionIdea(db, { channel_id: 10, title: "Sponsor a newsletter", free_or_paid: "paid" });
    expect(r.idea).toMatchObject({ rank: 2, status: "not_for_now", channel_id: 10 });
    await saveTractionIdea(db, { id: IDEA, status: "running", evidence: "3 replies from 20" });
    expect(db.rows("traction_ideas").find(i => i.id === IDEA)).toMatchObject({ status: "running", evidence: "3 replies from 20" });
    expect(db.writes.some(w => w.table === "traction_channels")).toBe(false);
    checkColumns(db);
    await expect(saveTractionIdea(db, { channel_id: 99, title: "x" })).rejects.toThrow(/No Traction channel/);
    await expect(saveTractionIdea(db, { channel_id: 4 })).rejects.toThrow(/title/);
  });

  it("updates a community by name or adds a candidate", async () => {
    const db = seed();
    const u = await saveCommunity(db, { name: "home decor sellers", status: "joined", interaction_plan: "Answer 2 questions a week", next_touch: "2026-11-27" });
    expect(u.created).toBe(false);
    expect(db.rows("communities")[0]).toMatchObject({ status: "joined", next_touch: "2026-11-27" });
    const n = await saveCommunity(db, { name: "Furniture Importers Forum" });
    expect(n.created).toBe(true);
    expect(db.rows("communities")).toHaveLength(2);
    await expect(saveCommunity(db, { name: "x", next_touch: "27/11" })).rejects.toThrow(/YYYY-MM-DD/);
    checkColumns(db);
  });

  it("lists the calendar and saves a piece with slots by slug, updating an existing slot", async () => {
    const db = seed();
    const l = await listContent(db, { from: "2026-11-01", to: "2026-12-31" });
    expect(l.pieces).toHaveLength(1);
    expect(l.slots).toHaveLength(1);
    const r = await saveContent(db, { slug: "li-post-01", status: "posted", slots: [{ slot_date: "2026-11-25", status: "posted", variant: "A", test_id: "hook", qualified_comments: 2 }] });
    expect(r.created).toBe(false);
    expect(db.rows("content_slots")).toHaveLength(1);
    expect(db.rows("content_slots")[0]).toMatchObject({ status: "posted", variant: "A", qualified_comments: 2 });
    const c = await saveContent(db, { slug: "chart-lead-times", title: "Lead times chart", kind: "chart", parent_slug: "li-post-01", slots: [{ slot_date: "2026-12-02" }] });
    expect(c.created).toBe(true);
    expect(db.rows("content_pieces").find(p => p.slug === "chart-lead-times")).toMatchObject({ parent_id: PIECE, status: "draft" });
    expect(db.rows("content_slots")).toHaveLength(2);
    await expect(saveContent(db, { slug: "new-one" })).rejects.toThrow(/title/);
    await expect(saveContent(db, { slug: "x", title: "x", parent_slug: "nope" })).rejects.toThrow(/No piece/);
    checkColumns(db);
  });
});
