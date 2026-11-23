import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FakeDb, schemaColumns } from "./fake-db";
import { TOOLS } from "../index";
import {
  checkCanContact, listPipeline, logJobRun, logTouch, saveBrief, saveFollowUp, setDoNotContact, setSalesStage, upsertAccount, upsertContact,
} from "../sales";
import { canContact, isForgotten, nextNudge, normalizeDomain, normalizeLinkedin, sortNeedsYou } from "../../sales/sales-core";

const types = readFileSync(path.resolve(__dirname, "../../../integrations/supabase/types.ts"), "utf8");

const ACME = "00000000-0000-4000-8000-00000000a001";
const ANN = "00000000-0000-4000-8000-00000000c001";
const BOB = "00000000-0000-4000-8000-00000000c002";

const seed = () => new FakeDb({
  customers: [
    { id: ACME, name: "Acme Decor", company: "Acme Decor", domain: "acmedecor.com", lead_status: "prospect", sales_stage: "queued", dnc: false, owner: "CQ", brief: null, created_at: "2026-11-01" },
  ],
  contacts: [
    { id: ANN, customer_id: ACME, full_name: "Ann Buyer", email: "ann@acmedecor.com", linkedin_url: "https://www.linkedin.com/in/annbuyer", engaged: false, dnc: false, never_email: false, drip_enrolled: false },
    { id: BOB, customer_id: ACME, full_name: "Bob Owner", email: null, linkedin_url: "https://www.linkedin.com/in/bobowner", engaged: true, dnc: false, never_email: false, drip_enrolled: true, waalaxy_prospect_id: "wx1" },
  ],
  sales_touches: [],
  sales_stage_events: [],
  send_blocks: [],
  tasks: [],
  job_runs: [],
});

describe("sales rules", () => {
  it("normalizes LinkedIn URLs and domains", () => {
    expect(normalizeLinkedin("linkedin.com/in/AnnBuyer/?trk=x")).toBe("https://www.linkedin.com/in/annbuyer");
    expect(normalizeLinkedin("https://uk.linkedin.com/in/ann/")).toBe("https://www.linkedin.com/in/ann");
    expect(normalizeLinkedin("https://example.com/in/ann")).toBeNull();
    expect(normalizeDomain("https://www.AcmeDecor.com/shop")).toBe("acmedecor.com");
    expect(normalizeDomain("ann@acmedecor.com")).toBe("acmedecor.com");
    expect(normalizeDomain("ann@gmail.com")).toBeNull();
  });

  it("blocks every channel for do not contact and email for never-email", () => {
    expect(canContact({ dnc: true, email: "a@b.co" }, null, "linkedin").allowed).toBe(false);
    expect(canContact({ email: "a@b.co" }, { dnc: true }, "whatsapp").reason).toMatch(/Account/);
    expect(canContact({ email: "a@b.co", never_email: true }, null, "email").allowed).toBe(false);
    expect(canContact({ email: "a@b.co", never_email: true, linkedin_url: "x" }, null, "linkedin").allowed).toBe(true);
    expect(canContact(null, { sales_stage: "not_now", not_now_until: "2027-05-01" }, "email", "2026-11-23").reason).toMatch(/Not now until/);
    expect(canContact(null, { sales_stage: "not_now", not_now_until: "2026-11-01" }, "email", "2026-11-23").allowed).toBe(true);
  });

  it("finds forgotten conversations after 4 days and spaces nudges 1 week, 1 month, 1 quarter", () => {
    const now = new Date("2026-11-23T10:00:00Z");
    expect(isForgotten([{ direction: "out", occurred_at: "2026-11-10T00:00:00Z" }, { direction: "in", occurred_at: "2026-11-18T09:00:00Z" }], now)).toEqual({ forgotten: true, waitingDays: 5 });
    expect(isForgotten([{ direction: "in", occurred_at: "2026-11-21T09:00:00Z" }], now).forgotten).toBe(false);
    expect(isForgotten([{ direction: "in", occurred_at: "2026-11-01T00:00:00Z" }, { direction: "out", occurred_at: "2026-11-02T00:00:00Z" }], now).forgotten).toBe(false);
    expect(nextNudge("2026-11-01T00:00:00Z", 0)).toEqual({ kind: "nudge", step: 1, due: "2026-11-08" });
    expect(nextNudge("2026-11-08T00:00:00Z", 1)).toEqual({ kind: "nudge", step: 2, due: "2026-12-08" });
    expect(nextNudge("2026-12-08T00:00:00Z", 2)).toEqual({ kind: "nudge", step: 3, due: "2027-03-08" });
    expect(nextNudge("2027-03-08T00:00:00Z", 3)).toEqual({ kind: "not_now", until: "2027-09-06" });
  });

  it("orders Needs you: forgotten, qualified, nudges, then the rest", () => {
    const items = sortNeedsYou([
      { kind: "task" as const, due_date: "2026-11-20" },
      { kind: "nudge" as const, due_date: "2026-11-22" },
      { kind: "forgotten" as const, waitingDays: 5 },
      { kind: "qualified" as const },
      { kind: "forgotten" as const, waitingDays: 9 },
    ]);
    expect(items.map(i => `${i.kind}${i.waitingDays ?? ""}`)).toEqual(["forgotten9", "forgotten5", "qualified", "nudge", "task"]);
  });
});

describe("sales connector tools", () => {
  it("registers the sales tools, each write tool with a dry run", () => {
    const names = TOOLS.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["upsert_sales_account", "upsert_contact", "log_touch", "set_sales_stage", "set_do_not_contact", "save_brief", "save_follow_up", "log_job_run"]) {
      const t: any = TOOLS.find((x: any) => x.name === n);
      expect(t, n).toBeTruthy();
      expect(Object.keys(t.inputSchema ?? {}), n).toContain("dry_run");
    }
    expect(names).toContain("check_can_contact");
    expect(names).toContain("list_sales_pipeline");
  });

  it("writes only columns that exist", async () => {
    const db = seed();
    await upsertAccount(db, { company: "New Co", website: "https://newco.com", persona: "owner", fit_score: 72, owner: "cq" });
    await upsertContact(db, { full_name: "Cy New", linkedin_url: "linkedin.com/in/cy", customer_id: ACME, engaged: true });
    await logTouch(db, { contact_id: ANN, channel: "linkedin", direction: "out", body: "Hi Ann, quick one", variant: "A", external_id: "li-1" });
    await saveFollowUp(db, { customer_id: ACME, contact_id: BOB, due_date: "2026-11-30", nudge_step: 1, draft_text: "Hi Bob", draft_channel: "linkedin" });
    await setSalesStage(db, { customer_id: ACME, stage: "not_now", not_now_until: "2027-05-01", reason: "Budget set for spring" });
    await saveBrief(db, { customer_id: ACME, parts: { company: { text: "Decor importer", source: "https://acmedecor.com" } } });
    await logJobRun(db, { job: "crm-watchdog", counts: { forgotten: 2 }, cost_usd: 0.4 });
    await setDoNotContact(db, { contact_id: ANN, reason: "Asked to be removed", source: "linkedin" });
    await checkCanContact(db, { channel: "email", people: [{ contact_id: ANN }] });
    for (const w of db.writes) {
      const have = schemaColumns(types, w.table);
      const cols = [...(w.rows ?? []).flatMap(r => Object.keys(r)), ...Object.keys(w.patch ?? {})].filter(c => c !== "id" && c !== "created_at");
      for (const c of cols) expect(have.has(c), `${w.table}.${c}`).toBe(true);
    }
  });

  it("adds a new account as a prospect and matches an existing one on domain", async () => {
    const db = seed();
    const dry = await upsertAccount(db, { company: "Luxe Home", domain: "luxehome.com", dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, would_create: true });
    expect(db.writes).toHaveLength(0);
    const made = await upsertAccount(db, { company: "Luxe Home", domain: "luxehome.com" });
    expect(made.created).toBe(true);
    expect(db.writesTo("customers", "insert")[0].rows![0]).toMatchObject({ lead_status: "prospect", sales_stage: "queued", domain: "luxehome.com" });
    const again = await upsertAccount(db, { company: "Acme Decor Ltd", website: "www.acmedecor.com/about", fit_score: 80 });
    expect(again).toMatchObject({ created: false, matched_on: "domain", updated: ["fit_score"] });
  });

  it("matches contacts on LinkedIn then email, and refuses a new contact with neither", async () => {
    const db = seed();
    const r = await upsertContact(db, { full_name: "Ann B", linkedin_url: "https://linkedin.com/in/AnnBuyer/", title: "Head of buying" });
    expect(r).toMatchObject({ created: false, updated: ["title"] });
    const byEmail = await upsertContact(db, { full_name: "Ann", email: "ANN@acmedecor.com" });
    expect((byEmail.contact as any).id).toBe(ANN);
    await expect(upsertContact(db, { full_name: "Nobody" })).rejects.toThrow(/LinkedIn URL or an email/);
  });

  it("logs touches once per external id and moves the stage", async () => {
    const db = seed();
    const first = await logTouch(db, { contact_id: ANN, channel: "linkedin", direction: "out", body: "Hi Ann, we make cane and wood decor in Jodhpur", external_id: "li-1" });
    expect(first).toMatchObject({ created: true, stage_move: "in_outreach" });
    expect(db.writesTo("sales_touches", "insert")[0].rows![0]).toMatchObject({ customer_id: ACME, word_count: 10 });
    const dup = await logTouch(db, { contact_id: ANN, channel: "linkedin", direction: "out", external_id: "li-1" });
    expect(dup).toMatchObject({ created: false, duplicate: true });
    expect(db.writesTo("sales_touches", "insert")).toHaveLength(1);
    const reply = await logTouch(db, { contact_id: ANN, channel: "linkedin", direction: "in", body: "Send me your catalogue", engaged: true, external_id: "li-2" });
    expect(reply.stage_move).toBe("responded");
    expect(db.rows("customers")[0].sales_stage).toBe("responded");
    expect(db.rows("contacts")[0].engaged).toBe(true);
  });

  it("needs a reason and a date for Not now, and keeps the reason on the stage log", async () => {
    const db = seed();
    await expect(setSalesStage(db, { customer_id: ACME, stage: "not_now", reason: "later" })).rejects.toThrow(/not_now_until/);
    await expect(setSalesStage(db, { customer_id: ACME, stage: "dnc", reason: "x" })).rejects.toThrow(/set_do_not_contact/);
    // The real trigger writes the event row; the fake db stands in for it here.
    db.rows("sales_stage_events").push({ id: "ev1", customer_id: ACME, to_stage: "inquiry", occurred_at: "2026-11-23T10:00:00Z" });
    const r = await setSalesStage(db, { customer_id: ACME, stage: "inquiry", reason: "Asked for a rough price on 2 lamps", actor: "crm-watchdog" });
    expect(r).toMatchObject({ from: "queued", to: "inquiry", changed: true });
    expect(db.rows("customers")[0]).toMatchObject({ sales_stage: "inquiry", lead_status: "active" });
    expect(db.rows("sales_stage_events")[0]).toMatchObject({ reason: "Asked for a rough price on 2 lamps", actor: "crm-watchdog" });
  });

  it("sets do not contact as the master record and every sender's check honours it", async () => {
    const db = seed();
    db.rows("tasks").push({ id: "t1", customer_id: ACME, contact_id: BOB, draft_status: "draft", status: "open" });
    const dry = await setDoNotContact(db, { linkedin_url: "linkedin.com/in/bobowner", reason: "Please remove me", source: "linkedin", dry_run: true });
    expect(dry.follow_ups.join(" ")).toMatch(/Waalaxy/);
    expect(db.writes).toHaveLength(0);
    await setDoNotContact(db, { contact_id: BOB, reason: "Please remove me", source: "linkedin" });
    expect(db.rows("contacts")[1]).toMatchObject({ dnc: true, dnc_reason: "Please remove me" });
    expect(db.rows("tasks")[0].draft_status).toBe("skipped");

    const check = await checkCanContact(db, { channel: "linkedin", people: [{ contact_id: BOB }, { contact_id: ANN }, { email: "stranger@else.com" }], sender: "waalaxy:caleb" });
    expect(check).toMatchObject({ allowed: 2, blocked: 1 });
    expect(check.results[2]).toMatchObject({ known: false, allowed: true });
    expect(db.rows("send_blocks")).toHaveLength(1);
    await expect(logTouch(db, { contact_id: BOB, channel: "linkedin", direction: "out", body: "hi" })).rejects.toThrow(/do not contact/);
    await expect(saveFollowUp(db, { customer_id: ACME, contact_id: BOB, due_date: "2026-12-01", draft_text: "hi", draft_channel: "linkedin" })).rejects.toThrow(/do not contact/);

    await setDoNotContact(db, { customer_id: ACME, whole_account: true, reason: "Company asked", source: "email" });
    expect(db.rows("customers")[0].dnc).toBe(true);
    await expect(setSalesStage(db, { customer_id: ACME, stage: "in_conversation", reason: "x" })).rejects.toThrow(/only Caleb/);
  });

  it("saves follow-ups as tasks beside Caleb's other tasks", async () => {
    const db = seed();
    const r = await saveFollowUp(db, { customer_id: ACME, contact_id: BOB, due_date: "2026-11-30", nudge_step: 1, draft_text: "Hi Bob, one more idea", draft_channel: "linkedin" });
    expect(r.created).toBe(true);
    expect(db.rows("tasks")[0]).toMatchObject({ title: "Nudge 1: Acme Decor (Bob Owner)", assignee: "CQ", association_type: "customer", draft_status: "draft", source_event: "sales_follow_up" });
    await expect(saveFollowUp(db, { customer_id: ACME, due_date: "2026-11-30", nudge_step: 4 })).rejects.toThrow(/after 3/);
    await saveFollowUp(db, { task_id: db.rows("tasks")[0].id, draft_status: "sent" });
    expect(db.rows("tasks")[0]).toMatchObject({ status: "done", draft_status: "sent" });
  });

  it("keeps earlier brief parts and lists the pipeline", async () => {
    const db = seed();
    await saveBrief(db, { customer_id: ACME, parts: { company: { text: "Decor importer, 40 staff", source: "https://acmedecor.com/about" } } });
    await saveBrief(db, { customer_id: ACME, parts: { india_buying: { text: "Buys brass from Moradabad", source: null } }, next_step: "Send lamp catalogue", next_step_date: "2026-11-25" });
    expect(Object.keys(db.rows("customers")[0].brief)).toEqual(["company", "india_buying"]);
    await expect(saveBrief(db, { customer_id: ACME, parts: { gossip: { text: "x" } } as any })).rejects.toThrow(/Unknown brief parts/);
    const p = await listPipeline(db, {});
    expect(p.count).toBe(1);
    expect(p.accounts[0].contacts).toHaveLength(2);
  });
});
