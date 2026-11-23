// Traction board and Content logic for the PD HQ connector: (db, input) functions, tested with the fake db.
// Relative imports only (see AGENTS.md). The jobs read the bullseye and fill ideas, communities and content;
// only Caleb moves a channel between rings, so nothing here writes traction_channels.ring.
import { check, isValidYmd, ToolError, type Db } from "./shared";
import {
  COMMUNITY_STATUSES, CONTENT_KINDS, CONTENT_STATUSES, IDEA_STATUSES, SLOT_STATUSES, inquiriesPerChannel, orderIdeas,
} from "../sales/traction";

const clean = (v?: string | null) => (v?.trim() ? v.trim() : null);
const pick = <T extends Record<string, unknown>>(o: T, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k, v]) => keys.includes(k) && v !== undefined)) as Partial<T>;

export const IDEA_COLUMNS = "id, channel_id, rank, title, pitch, free_or_paid, hours_per_week, reach, soonest_inquiry, deadline, evidence, status, proposed_at, decision_note, task_id";

// ---------- read ----------

export type ListTractionInput = { channel_id?: number; include_closed?: boolean; community_status?: string };

/** The bullseye (rings), each channel's top ideas, communities and inquiries per channel. */
export async function listTractionBoard(db: Db, input: ListTractionInput) {
  const channels = check(await db.from("traction_channels").select("id, name, ring, fit, cost, test_ends, map_note, ring_changed_at, ring_changed_by").order("sort_order"), "Could not read the Traction channels") ?? [];
  let iq = db.from("traction_ideas").select(IDEA_COLUMNS);
  if (input.channel_id) iq = iq.eq("channel_id", input.channel_id);
  const ideas = orderIdeas(check(await iq.order("rank"), "Could not read the ideas") ?? []);
  let cq = db.from("communities").select("id, name, grp, status, priority, high_value, interaction_plan, who_acts, next_touch, link, promotion_allowed");
  if (input.community_status) cq = cq.eq("status", input.community_status);
  const communities = check(await cq.order("name"), "Could not read the communities") ?? [];
  const inquiries = check(await db.from("customer_rfqs").select("source_channel, status"), "Could not read inquiries") ?? [];
  const per = inquiriesPerChannel(channels, inquiries);
  const board = channels
    .filter((c: { id: number }) => !input.channel_id || c.id === input.channel_id)
    .map((c: { id: number }) => ({
      ...c,
      inquiries: per.counts.get(c.id) ?? 0,
      ideas: ideas.filter((i: { channel_id: number; status: string }) => i.channel_id === c.id && (input.include_closed || !["done", "dropped"].includes(i.status))).slice(0, input.include_closed ? 50 : 5),
    }));
  return {
    channels: board,
    inner_ring: board.filter((c: { ring: string }) => c.ring === "inner").map((c: { name: string }) => c.name),
    communities,
    untagged_inquiries: per.untagged,
  };
}

// ---------- ideas ----------

export type SaveIdeaInput = {
  id?: string; channel_id?: number; rank?: number; title?: string; pitch?: string; free_or_paid?: "free" | "paid";
  hours_per_week?: number; reach?: string; soonest_inquiry?: string; deadline?: string; evidence?: string;
  status?: (typeof IDEA_STATUSES)[number]; decision_note?: string; dry_run?: boolean;
};

/** Add an idea to a channel, or update one by id. Paid ideas default to not for now. */
export async function saveTractionIdea(db: Db, input: SaveIdeaInput) {
  if (input.deadline && !isValidYmd(input.deadline)) throw new ToolError("deadline must be YYYY-MM-DD.");
  if (input.status && !(IDEA_STATUSES as readonly string[]).includes(input.status)) throw new ToolError(`status must be one of ${IDEA_STATUSES.join(", ")}.`);
  const fields = pick({
    rank: input.rank, title: clean(input.title) ?? undefined, pitch: input.pitch === undefined ? undefined : clean(input.pitch),
    free_or_paid: input.free_or_paid, hours_per_week: input.hours_per_week, reach: input.reach, soonest_inquiry: input.soonest_inquiry,
    deadline: input.deadline, evidence: input.evidence, status: input.status, decision_note: input.decision_note,
  }, ["rank", "title", "pitch", "free_or_paid", "hours_per_week", "reach", "soonest_inquiry", "deadline", "evidence", "status", "decision_note"]);
  if (input.id) {
    const found = check(await db.from("traction_ideas").select(IDEA_COLUMNS).eq("id", input.id).maybeSingle(), "Could not read the idea");
    if (!found) throw new ToolError(`No idea with id ${input.id}.`);
    if (input.dry_run) return { idea: { ...found, ...fields }, created: false, dry_run: true };
    const idea = check(await db.from("traction_ideas").update(fields).eq("id", input.id).select(IDEA_COLUMNS).single(), "Could not update the idea");
    return { idea, created: false, dry_run: false };
  }
  if (!input.channel_id) throw new ToolError("Give channel_id (1-19, see list_traction_board) for a new idea.");
  if (!fields.title) throw new ToolError("Give the idea a title.");
  const channel = check(await db.from("traction_channels").select("id, name").eq("id", input.channel_id).maybeSingle(), "Could not read the channel");
  if (!channel) throw new ToolError(`No Traction channel ${input.channel_id}.`);
  let rank = input.rank;
  if (rank == null) {
    const existing = check(await db.from("traction_ideas").select("id, rank").eq("channel_id", input.channel_id), "Could not read the ideas") ?? [];
    rank = existing.reduce((m: number, r: { rank: number }) => Math.max(m, r.rank), 0) + 1;
  }
  const paid = input.free_or_paid === "paid";
  const row = { channel_id: input.channel_id, ...fields, rank, free_or_paid: paid ? "paid" : "free", status: input.status ?? (paid ? "not_for_now" : "proposed"), proposed_at: new Date().toISOString().slice(0, 10) };
  if (input.dry_run) return { idea: row, channel: channel.name, created: false, would_create: true, dry_run: true };
  const idea = check(await db.from("traction_ideas").insert(row).select(IDEA_COLUMNS).single(), "Could not add the idea");
  return { idea, channel: channel.name, created: true, dry_run: false };
}

// ---------- communities ----------

export type SaveCommunityInput = {
  name: string; grp?: string; audience?: string; cost?: string; promotion_allowed?: string; link?: string;
  status?: (typeof COMMUNITY_STATUSES)[number]; priority?: string; high_value?: boolean; interaction_plan?: string; who_acts?: string;
  hours_per_month?: number; last_touch?: string; next_touch?: string; notes?: string; dry_run?: boolean;
};

/** Find a community by exact name and update it, or add it as a candidate. */
export async function saveCommunity(db: Db, input: SaveCommunityInput) {
  const name = input.name?.trim();
  if (!name) throw new ToolError("Give the community's name.");
  for (const k of ["last_touch", "next_touch"] as const) if (input[k] && !isValidYmd(input[k]!)) throw new ToolError(`${k} must be YYYY-MM-DD.`);
  const fields = pick(input as Record<string, unknown>, ["grp", "audience", "cost", "promotion_allowed", "link", "status", "priority", "high_value", "interaction_plan", "who_acts", "hours_per_month", "last_touch", "next_touch", "notes"]);
  const found = (check(await db.from("communities").select("id, name, status").ilike("name", name.replace(/[\\%_]/g, m => `\\${m}`)).limit(1), "Could not search communities") ?? [])[0];
  if (found) {
    if (input.dry_run) return { community: { ...found, ...fields }, created: false, dry_run: true };
    const community = check(await db.from("communities").update(fields).eq("id", found.id).select("id, name, status, interaction_plan, next_touch").single(), "Could not update the community");
    return { community, created: false, dry_run: false };
  }
  const row = { name, status: "candidate", ...fields };
  if (input.dry_run) return { community: row, created: false, would_create: true, dry_run: true };
  const community = check(await db.from("communities").insert(row).select("id, name, status").single(), "Could not add the community");
  return { community, created: true, dry_run: false };
}

// ---------- content ----------

export type ListContentInput = { status?: string; from?: string; to?: string; limit?: number };

/** Pieces (optionally one status) and calendar slots in a date range (default: 2 weeks back to 8 weeks ahead). */
export async function listContent(db: Db, input: ListContentInput) {
  const day = 86_400_000;
  const from = input.from ?? new Date(Date.now() - 14 * day).toISOString().slice(0, 10);
  const to = input.to ?? new Date(Date.now() + 56 * day).toISOString().slice(0, 10);
  if (!isValidYmd(from) || !isValidYmd(to)) throw new ToolError("from and to must be YYYY-MM-DD.");
  let pq = db.from("content_pieces").select("id, slug, title, kind, pillar, status, body, proof, target_search, parent_id, notes, updated_at");
  if (input.status) pq = pq.eq("status", input.status);
  const pieces = check(await pq.order("created_at").limit(Math.min(input.limit ?? 200, 500)), "Could not read content pieces") ?? [];
  const all = check(await db.from("content_slots").select("id, piece_id, channel, slot_date, slot_time_ct, status, variant, test_id, post_url, qualified_comments, profile_views_3d, accepts_3d").order("slot_date"), "Could not read the calendar") ?? [];
  const slots = all.filter((s: { slot_date: string }) => s.slot_date >= from && s.slot_date <= to);
  return { pieces, slots, from, to };
}

export type SlotInput = {
  slot_date: string; channel?: "linkedin" | "website" | "drip" | "other"; slot_time_ct?: string; status?: (typeof SLOT_STATUSES)[number];
  variant?: string; test_id?: string; post_url?: string; impressions?: number; reactions?: number; comments?: number;
  qualified_comments?: number; profile_views_3d?: number; accepts_3d?: number; notes?: string;
};
export type SaveContentInput = {
  id?: string; slug?: string; title?: string; kind?: (typeof CONTENT_KINDS)[number]; pillar?: string; status?: (typeof CONTENT_STATUSES)[number];
  body?: string; format_note?: string; proof?: string; target_search?: string; parent_slug?: string; asset_url?: string; source?: string; notes?: string;
  slots?: SlotInput[]; dry_run?: boolean;
};

/** Add or update a content piece (by id or slug) and upsert its calendar slots (one per channel and date). */
export async function saveContent(db: Db, input: SaveContentInput) {
  for (const s of input.slots ?? []) if (!isValidYmd(s.slot_date)) throw new ToolError(`slot_date ${s.slot_date} must be YYYY-MM-DD.`);
  let found = null as Record<string, unknown> | null;
  if (input.id) found = check(await db.from("content_pieces").select("id, slug, title, status").eq("id", input.id).maybeSingle(), "Could not read the piece");
  else if (input.slug) found = check(await db.from("content_pieces").select("id, slug, title, status").eq("slug", input.slug.trim()).maybeSingle(), "Could not read the piece");
  if (input.id && !found) throw new ToolError(`No content piece with id ${input.id}.`);
  let parent_id: string | null | undefined;
  if (input.parent_slug) {
    const p = check(await db.from("content_pieces").select("id").eq("slug", input.parent_slug.trim()).maybeSingle(), "Could not read the parent piece");
    if (!p) throw new ToolError(`No piece with slug ${input.parent_slug} to cut from.`);
    parent_id = p.id;
  }
  const fields = {
    ...pick(input as Record<string, unknown>, ["title", "kind", "pillar", "status", "body", "format_note", "proof", "target_search", "asset_url", "source", "notes"]),
    ...(parent_id !== undefined ? { parent_id } : {}),
  };
  const slots = (input.slots ?? []).map(s => ({ channel: "linkedin", status: "planned", ...s }));
  if (!found && !clean(input.title)) throw new ToolError("Give a title for a new piece.");
  if (input.dry_run) return { piece: found ? { ...found, ...fields } : { slug: clean(input.slug), status: "draft", kind: "post", ...fields }, slots, created: false, would_create: !found, dry_run: true };
  const piece = found
    ? check(await db.from("content_pieces").update(fields).eq("id", found.id).select("id, slug, title, status").single(), "Could not update the piece")
    : check(await db.from("content_pieces").insert({ slug: clean(input.slug), status: "draft", kind: "post", ...fields }).select("id, slug, title, status").single(), "Could not add the piece");
  const savedSlots = [];
  for (const s of slots) {
    const existing = check(await db.from("content_slots").select("id").eq("piece_id", piece.id).eq("channel", s.channel).eq("slot_date", s.slot_date).maybeSingle(), "Could not read the slot");
    savedSlots.push(existing
      ? check(await db.from("content_slots").update(s).eq("id", existing.id).select("id, slot_date, status, variant, test_id").single(), "Could not update the slot")
      : check(await db.from("content_slots").insert({ piece_id: piece.id, ...s }).select("id, slot_date, status, variant, test_id").single(), "Could not add the slot"));
  }
  return { piece, slots: savedSlots, created: !found, dry_run: false };
}
