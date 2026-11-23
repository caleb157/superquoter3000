// Traction page and Content tab rules: rings, idea ordering, inquiries per channel, post A/B results.
// Pure, no imports, so the connector can bundle it through a relative path.

export const RINGS = ["inner", "engine", "promising", "long_shot", "off"] as const;
export type Ring = (typeof RINGS)[number];
export const RING_LABELS: Record<Ring, string> = {
  inner: "Inner ring (testing now)",
  engine: "Always on",
  promising: "Promising",
  long_shot: "Long shot",
  off: "Off",
};
/** Caleb, 23 Nov 2026: three channels in the inner ring at once. */
export const INNER_RING_MAX = 3;
/** Inner-ring channels are judged on real buyer inquiries by this date. */
export const INNER_RING_DEADLINE = "2027-03-31";

export const IDEA_STATUSES = ["idea", "proposed", "approved", "running", "done", "dropped", "not_for_now"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  idea: "Idea", proposed: "Proposed", approved: "Approved", running: "Running", done: "Done", dropped: "Dropped", not_for_now: "Not for now (paid)",
};
const CLOSED: ReadonlySet<string> = new Set(["done", "dropped"]);

export const COMMUNITY_STATUSES = ["candidate", "joined", "active", "dropped"] as const;

export type IdeaLite = { id: string; channel_id: number; rank: number; status: string; free_or_paid: string };

/** The ideas a channel shows: open ones by rank (free before paid when ranks tie), closed ones after. */
export function orderIdeas<T extends IdeaLite>(ideas: T[]): T[] {
  return [...ideas].sort((a, b) =>
    Number(CLOSED.has(a.status)) - Number(CLOSED.has(b.status))
    || a.rank - b.rank
    || Number(a.free_or_paid === "paid") - Number(b.free_or_paid === "paid"));
}

/** Can this channel move into `to`? The inner ring holds INNER_RING_MAX. */
export function canMoveRing(channels: { id: number; ring: string }[], id: number, to: string): { ok: boolean; reason: string | null } {
  if (!(RINGS as readonly string[]).includes(to)) return { ok: false, reason: `Unknown ring ${to}` };
  if (to !== "inner") return { ok: true, reason: null };
  const inner = channels.filter(c => c.ring === "inner" && c.id !== id).length;
  return inner >= INNER_RING_MAX
    ? { ok: false, reason: `The inner ring already holds ${INNER_RING_MAX} channels. Move one out first.` }
    : { ok: true, reason: null };
}

/** Inquiries stored with a source channel (its id as text, or its name) counted per channel id. */
export function inquiriesPerChannel(channels: { id: number; name: string }[], inquiries: { source_channel?: string | null }[]) {
  const byName = new Map(channels.map(c => [c.name.toLowerCase(), c.id]));
  const counts = new Map<number, number>();
  let untagged = 0;
  for (const q of inquiries) {
    const v = q.source_channel?.trim();
    if (!v) { untagged++; continue; }
    const id = /^\d+$/.test(v) ? Number(v) : byName.get(v.toLowerCase());
    if (id == null) { untagged++; continue; }
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return { counts, untagged };
}

export const CONTENT_STATUSES = ["idea", "draft", "review", "approved", "scheduled", "posted", "dropped"] as const;
export const CONTENT_KINDS = ["post", "article", "case_study", "chart", "design", "drip", "video", "other"] as const;
export const SLOT_STATUSES = ["planned", "scheduled", "posted", "skipped"] as const;

/** A post test needs this many posts per variant before a winner is called (content playbook rule 6). */
export const MIN_POSTS_PER_VARIANT = 6;

export type SlotScore = { test_id?: string | null; variant?: string | null; status: string; qualified_comments?: number | null; comments?: number | null; profile_views_3d?: number | null; accepts_3d?: number | null; impressions?: number | null };

/** Post A/B results: judged on qualified comments per post, backed by profile views and accepts. */
export function postExperiments(slots: SlotScore[]) {
  const g = new Map<string, { test: string; variant: string; posts: number; qualified: number; views: number; accepts: number; impressions: number }>();
  for (const s of slots) {
    if (s.status !== "posted" || !s.test_id || !s.variant) continue;
    const k = `${s.test_id}|${s.variant}`;
    const r = g.get(k) ?? { test: s.test_id, variant: s.variant, posts: 0, qualified: 0, views: 0, accepts: 0, impressions: 0 };
    r.posts++; r.qualified += s.qualified_comments ?? 0; r.views += s.profile_views_3d ?? 0; r.accepts += s.accepts_3d ?? 0; r.impressions += s.impressions ?? 0;
    g.set(k, r);
  }
  const list = [...g.values()].map(r => ({ ...r, perPost: r.posts ? r.qualified / r.posts : 0, enough: r.posts >= MIN_POSTS_PER_VARIANT, winner: false }));
  const tests = new Map<string, typeof list>();
  for (const r of list) (tests.get(r.test) ?? tests.set(r.test, []).get(r.test)!).push(r);
  for (const vs of tests.values()) {
    vs.sort((a, b) => b.perPost - a.perPost);
    if (vs.length >= 2 && vs.every(v => v.enough) && vs[0].perPost > 0 && vs[0].perPost >= 1.5 * vs[1].perPost) vs[0].winner = true;
  }
  return [...tests.values()].flat();
}
