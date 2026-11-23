import { describe, expect, it } from "vitest";
import { buildNeedsYou, type AccountRow } from "../needs-you";
import { breakdown, emailTargetToday, experiments, funnel, sendPace, weekStart, winLoss, type SendTouch } from "../prospecting";
import { canMoveRing, inquiriesPerChannel, orderIdeas, postExperiments } from "../traction";

const now = new Date("2026-11-25T10:00:00Z"); // a Wednesday
const acct = (id: string, stage: string, extra: Partial<AccountRow> = {}): AccountRow => ({ id, name: id, company: id, sales_stage: stage, dnc: false, ...extra });

describe("Needs you: warm accounts with nothing planned, and not-now accounts coming back", () => {
  it("adds quiet and back items after the urgent kinds, engaged accounts first", () => {
    const accounts = [
      acct("Q1", "responded"), acct("Q2", "responded"), acct("Q3", "responded"), acct("Q4", "responded"),
      acct("B1", "not_now", { not_now_until: "2026-11-20" }), acct("B2", "not_now", { not_now_until: "2027-02-01" }),
    ];
    const touches = [
      { customer_id: "Q3", direction: "out" as const, occurred_at: "2026-11-22T08:00:00Z", channel: "linkedin" },
    ];
    const tasks = [{ id: "t", customer_id: "Q4", title: "Call", due_date: "2026-12-20", status: "open" }];
    const list = buildNeedsYou(accounts, touches, tasks, now, 7, new Set(["Q2"]));
    expect(list.map(e => `${e.kind}:${e.account.id}`)).toEqual(["quiet:Q2", "quiet:Q1", "back:B1"]);
  });
});

describe("Prospecting maths", () => {
  it("counts the funnel as reached-at-least with step rates", () => {
    const f = funnel([{ sales_stage: "queued" }, { sales_stage: "queued" }, { sales_stage: "in_outreach" }, { sales_stage: "responded" }, { sales_stage: "customer" }, { sales_stage: "dnc" }]);
    expect(f[0]).toMatchObject({ stage: "queued", reached: 5, rate: null });
    expect(f[1]).toMatchObject({ stage: "in_outreach", reached: 3 });
    expect(f[1].rate).toBeCloseTo(0.6);
    expect(f.at(-1)).toMatchObject({ stage: "customer", reached: 1 });
  });

  it("groups small tails into Other", () => {
    const rows = ["a", "a", "b", "c", "d", null].map(x => ({ x }));
    expect(breakdown(rows, r => r.x, 2)).toEqual([{ label: "a", n: 2 }, { label: "b", n: 1 }, { label: "Other", n: 3 }]);
  });

  it("ramps email 8, 12, 16, 20 by week and paces sends", () => {
    expect(weekStart(now).toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(emailTargetToday(null, now)).toBe(8);
    expect(emailTargetToday("2026-11-16T09:00:00Z", now)).toBe(12);
    expect(emailTargetToday("2026-09-01T09:00:00Z", now)).toBe(20);
    const touches: SendTouch[] = [
      ...Array.from({ length: 40 }, (_, i) => ({ customer_id: `a${i}`, channel: "linkedin", direction: "out" as const, occurred_at: "2026-11-24T05:00:00Z" })),
      { customer_id: "x", channel: "email", direction: "out", occurred_at: "2026-11-25T05:00:00Z" },
      { customer_id: "x", channel: "email", direction: "out", occurred_at: "2026-11-25T05:00:00Z", is_drip: true },
      { customer_id: "y", channel: "linkedin", direction: "out", occurred_at: "2026-11-20T05:00:00Z" },
      { customer_id: "a1", channel: "linkedin", direction: "in", occurred_at: "2026-11-25T06:00:00Z" },
    ];
    const p = sendPace(touches, now, null);
    expect(p.linkedin).toMatchObject({ week: 40, today: 0, weekTarget: 175, dueSoFar: 105, overCap: false });
    expect(p.email).toMatchObject({ week: 1, today: 1, dailyTarget: 8, dueSoFar: 24 });
    expect(p.repliesThisWeek).toBe(1);
  });

  it("calls an A/B winner only with 100 sends a side and 1.5x the reply rate", () => {
    const sends = (variant: string, n: number, replies: number): SendTouch[] => Array.from({ length: n }, (_, i) => [
      { customer_id: `${variant}${i}`, contact_id: `${variant}${i}`, channel: "linkedin", direction: "out" as const, occurred_at: "2026-11-01T05:00:00Z", variant, test_name: "opener" },
      ...(i < replies ? [{ customer_id: `${variant}${i}`, contact_id: `${variant}${i}`, channel: "linkedin", direction: "in" as const, occurred_at: "2026-11-10T05:00:00Z" }] : []),
    ]).flat();
    const small = experiments([...sends("A", 50, 10), ...sends("B", 50, 2)]);
    expect(small.find(v => v.variant === "A")).toMatchObject({ sends: 50, replied: 10, winner: false, enough: false });
    const big = experiments([...sends("A", 100, 15), ...sends("B", 100, 8)]);
    expect(big.find(v => v.variant === "A")?.winner).toBe(true);
    const close = experiments([...sends("A", 100, 10), ...sends("B", 100, 8)]);
    expect(close.some(v => v.winner)).toBe(false);
    // a reply after the window does not count
    const late = experiments([
      { customer_id: "z", contact_id: "z", channel: "email", direction: "out", occurred_at: "2026-09-01T00:00:00Z", variant: "A" },
      { customer_id: "z", contact_id: "z", channel: "email", direction: "in", occurred_at: "2026-11-01T00:00:00Z" },
    ]);
    expect(late[0].replied).toBe(0);
  });

  it("splits inquiries into won, lost and open by channel", () => {
    const w = winLoss([
      { id: "1", status: "po", customer_id: "a", source_channel: "4" },
      { id: "2", status: "cancelled", customer_id: "b", source_channel: "4" },
      { id: "3", status: "costing", customer_id: "c", source_channel: null },
    ]);
    expect(w).toMatchObject({ open: 1, won: 1, lost: 1, winRate: 0.5 });
    expect(w.byChannel.get("4")).toEqual({ open: 0, won: 1, lost: 1 });
    expect(w.byChannel.get("")).toEqual({ open: 1, won: 0, lost: 0 });
  });
});

describe("Traction rules", () => {
  const channels = [{ id: 1, ring: "inner", name: "Sales" }, { id: 2, ring: "inner", name: "SEO" }, { id: 3, ring: "inner", name: "Trade shows" }, { id: 4, ring: "promising", name: "Community building" }];
  it("keeps at most 3 channels in the inner ring", () => {
    expect(canMoveRing(channels, 4, "inner").ok).toBe(false);
    expect(canMoveRing(channels, 1, "inner").ok).toBe(true);
    expect(canMoveRing(channels, 4, "engine").ok).toBe(true);
    expect(canMoveRing(channels, 4, "nowhere").ok).toBe(false);
  });
  it("orders open ideas by rank, free before paid, closed last", () => {
    const ideas = [
      { id: "a", channel_id: 1, rank: 1, status: "done", free_or_paid: "free" },
      { id: "b", channel_id: 1, rank: 2, status: "proposed", free_or_paid: "paid" },
      { id: "c", channel_id: 1, rank: 2, status: "proposed", free_or_paid: "free" },
      { id: "d", channel_id: 1, rank: 3, status: "approved", free_or_paid: "free" },
    ];
    expect(orderIdeas(ideas).map(i => i.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("counts inquiries per channel by id or name", () => {
    const r = inquiriesPerChannel(channels, [{ source_channel: "1" }, { source_channel: "seo" }, { source_channel: "Unknown" }, { source_channel: null }]);
    expect(r.counts.get(1)).toBe(1);
    expect(r.counts.get(2)).toBe(1);
    expect(r.untagged).toBe(2);
  });
  it("judges post tests on qualified comments per post after 6 posts a side", () => {
    const posts = (variant: string, n: number, q: number) => Array.from({ length: n }, () => ({ test_id: "hook", variant, status: "posted", qualified_comments: q }));
    expect(postExperiments([...posts("A", 5, 3), ...posts("B", 5, 1)]).some(v => v.winner)).toBe(false);
    const r = postExperiments([...posts("A", 6, 3), ...posts("B", 6, 1), { test_id: "hook", variant: "B", status: "planned", qualified_comments: 99 }]);
    expect(r.find(v => v.variant === "A")).toMatchObject({ posts: 6, winner: true });
    expect(r.find(v => v.variant === "B")?.posts).toBe(6);
  });
});
