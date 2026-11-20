/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeDb, schemaColumns } from "./fake-db";
import { supabaseForUser, withUserDb, isValidYmd, todayInIndia, cleanSearch } from "../shared";
import { CUSTOMER_COLUMNS, listCustomers } from "../tools/list-customers";
import { INQUIRY_COLUMNS, listInquiries } from "../tools/list-inquiries";
import { PRODUCT_COLUMNS, listProducts } from "../tools/list-products";
import { TASK_COLUMNS, listTasks } from "../tools/list-tasks";
import { listLookups } from "../tools/list-lookups";
import { findOrCreateCustomer } from "../tools/find-or-create-customer";
import { createInquiry } from "../tools/create-inquiry";
import { importCostingIntake } from "../tools/import-costing-intake";
import { attachProductPhoto } from "../tools/attach-product-photo";
import { createSampleRequest } from "../tools/create-sample-request";
import { createTask } from "../tools/create-task";
import { TOOLS } from "../index";

const types = readFileSync(path.resolve(__dirname, "../../../integrations/supabase/types.ts"), "utf8");
// Keys the fake database adds on insert, not sent by the tools.
const FAKE_KEYS = new Set(["id", "created_at", "rfq_number", "request_number"]);
const cols = (list: string) => list.split(",").map(s => s.trim()).filter(Boolean);

const CUST = "11111111-1111-4111-8111-111111111111";
const INQ = "22222222-2222-4222-8222-222222222222";
const OTHER_INQ = "22222222-2222-4222-8222-999999999999";
const P1 = "33333333-3333-4333-8333-333333333331";
const P2 = "33333333-3333-4333-8333-333333333332";
const P_OTHER = "33333333-3333-4333-8333-333333333339";

function seed() {
  return new FakeDb({
    customers: [{ id: CUST, name: "Jordan Lee", company: "CCT Furniture", email: "Jordan@cct.example", lead_status: "active", created_at: "2026-01-01" }],
    customer_rfqs: [
      { id: INQ, customer_id: CUST, rfq_number: "RFQ-2026-001", title: "Accent tables", status: "active", updated_at: "2026-11-01" },
      { id: OTHER_INQ, customer_id: CUST, rfq_number: "RFQ-2026-002", title: "Old order", status: "complete", updated_at: "2026-10-01" },
    ],
    company_entities: [
      { id: "e-dkt", name: "Desert Kingdom Traders", entity_type: "US" },
      { id: "e-pv", name: "Parable Ventures", entity_type: "India" },
    ],
    products: [
      { id: P1, customer_rfq_id: INQ, sku: "CCT-AT3335", name: "Accent Table 33x35", sort_order: 1, archived_at: null, photo_url: null },
      { id: P2, customer_rfq_id: INQ, sku: "CCT-AT2020", name: "Accent Table 20x20", sort_order: 2, archived_at: null, photo_url: "https://x/old.jpg" },
      { id: P_OTHER, customer_rfq_id: OTHER_INQ, sku: "OLD-1", name: "Old", sort_order: 1, archived_at: null },
    ],
    profiles: [{ assignee_code: "CQ", display_name: "Caleb" }, { assignee_code: "PH", display_name: "Parker" }],
    product_types: [{ id: "pt-1", name: "Wood Side/End Table" }],
    local_transport_locations: [{ id: "loc-1", name: "Jodhpur", active: true, sort_order: 1 }],
    shipping_types: [{ id: "st-1", name: "Sea LCL" }],
    finishing_difficulty: [{ name: "Medium", sort_order: 3 }],
    chemical_prices: [{ id: "ch-1", name: "PU Lacquer", category: "Lacquer", price_per_litre_inr: 400, unit_type: "L" }],
    currencies: [{ code: "USD", name: "US Dollar", sort_priority: 1 }],
    global_settings: [{ mc_height_buffer_inch: 2.5 }],
    samples: [],
    sample_requests: [],
    projects: [
      { id: "proj-sales", name: "Sales Office", status: "in_progress" },
      { id: "proj-old", name: "Old launch", status: "done" },
    ],
    tasks: [],
    inquiry_projections: [],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("connector setup", () => {
  it("falls back to SUPABASE_ANON_KEY when the publishable key is not set", () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-test-key");
    const client = supabaseForUser({ getToken: () => "t" } as any);
    expect(typeof client.from).toBe("function");
  });

  it("names the missing variable instead of failing silently", () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    expect(() => supabaseForUser({ getToken: () => "t" } as any)).toThrow(/SUPABASE_ANON_KEY/);
  });

  it("returns thrown errors as readable tool errors and refuses signed-out calls", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const h = withUserDb(async () => ({ content: [{ type: "text" as const, text: "never" }] }));
    const signedOut = await h({}, { isAuthenticated: () => false } as any);
    expect(signedOut).toMatchObject({ isError: true, content: [{ text: "Not authenticated" }] });
    const broken = await h({}, { isAuthenticated: () => true, getToken: () => "t" } as any);
    expect(broken.isError).toBe(true);
    expect(broken.content[0].text).toMatch(/SUPABASE_URL/);
  });

  it("registers each tool once and gives every write tool a dry run", () => {
    const names = TOOLS.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
    const writeTools = ["find_or_create_customer", "create_inquiry", "import_costing_intake", "attach_product_photo", "create_sample_request", "create_task"];
    for (const n of writeTools) {
      const t: any = TOOLS.find((x: any) => x.name === n);
      expect(t, n).toBeTruthy();
      expect(Object.keys(t.inputSchema ?? {}), n).toContain("dry_run");
    }
  });

  it("validates dates and search text", () => {
    expect(isValidYmd("2026-02-28")).toBe(true);
    expect(isValidYmd("2026-02-30")).toBe(false);
    expect(isValidYmd("28/02/2026")).toBe(false);
    expect(todayInIndia(new Date("2026-11-18T20:00:00Z"))).toBe("2026-11-19");
    expect(cleanSearch(" a,b(c)%  ")).toBe("a b c");
  });
});

describe("read tools match the real schema", () => {
  it.each([
    ["customers", CUSTOMER_COLUMNS],
    ["customer_rfqs", INQUIRY_COLUMNS],
    ["products", PRODUCT_COLUMNS],
    ["tasks", TASK_COLUMNS],
  ])("%s columns exist", (table, list) => {
    const have = schemaColumns(types, table);
    expect(cols(list).filter(c => !have.has(c))).toEqual([]);
  });

  it("list_inquiries reads customer_rfqs and searches title or number", async () => {
    const db = seed();
    const rows = await listInquiries(db, { search: "RFQ-2026-001" });
    expect(rows.map((r: any) => r.id)).toEqual([INQ]);
    expect(await listInquiries(db, { status: "complete" })).toHaveLength(1);
  });

  it("list_products leaves archived products out by default", async () => {
    const db = seed();
    db.rows("products").push({ id: "p-arch", customer_rfq_id: INQ, name: "Gone", archived_at: "2026-11-01" });
    expect((await listProducts(db, { customer_rfq_id: INQ })).map((p: any) => p.id).sort()).toEqual([P1, P2].sort());
    expect(await listProducts(db, { customer_rfq_id: INQ, include_archived: true })).toHaveLength(3);
  });

  it("list_tasks filters open tasks by the app's status and assignee", async () => {
    const db = seed();
    db.rows("tasks").push(
      { id: "t1", title: "Open", status: "open", assignee: "CQ", due_date: "2026-11-20" },
      { id: "t2", title: "Done", status: "done", assignee: "CQ", due_date: "2026-11-19" },
    );
    expect((await listTasks(db, { only_open: true, assignee: "cq" })).map((t: any) => t.id)).toEqual(["t1"]);
  });

  it("list_customers matches on company", async () => {
    expect(await listCustomers(seed(), { search: "cct" })).toHaveLength(1);
  });

  it("list_lookups returns names and, on request, the intake columns", async () => {
    const r: any = await listLookups(seed(), { include_intake_columns: true });
    expect(r.product_types[0].name).toBe("Wood Side/End Table");
    expect(r.assignees.map((a: any) => a.assignee_code)).toEqual(["CQ", "PH"]);
    expect(r.projects.map((p: any) => p.name)).toEqual(["Sales Office"]);
    expect(r.intake_columns.find((c: any) => c.key === "sku").header).toBe("SKU");
  });
});

describe("find_or_create_customer", () => {
  it("finds by email, ignoring case, without writing", async () => {
    const db = seed();
    const r = await findOrCreateCustomer(db, { email: "jordan@CCT.example", company: "Someone Else" });
    expect(r).toMatchObject({ created: false, matched_on: "email" });
    expect(db.writes).toEqual([]);
  });

  it("does not treat LIKE wildcards in a name as a match for everything", async () => {
    const db = seed();
    const r = await findOrCreateCustomer(db, { company: "%", dry_run: true });
    expect(r).toMatchObject({ would_create: true, matched_on: null });
  });

  it("creates with the app's defaults when nothing matches, and dry run writes nothing", async () => {
    const db = seed();
    const dry = await findOrCreateCustomer(db, { name: "Sam Ortiz", company: "Luxe Designs", dry_run: true });
    expect(dry).toMatchObject({ would_create: true });
    expect(db.writes).toEqual([]);
    const r: any = await findOrCreateCustomer(db, { name: "Sam Ortiz", company: "Luxe Designs" });
    expect(r.created).toBe(true);
    expect(r.customer).toMatchObject({ name: "Sam Ortiz", company: "Luxe Designs", lead_status: "active" });
    const have = schemaColumns(types, "customers");
    expect(Object.keys(db.writesTo("customers", "insert")[0].rows![0]).filter(k => !FAKE_KEYS.has(k) && !have.has(k))).toEqual([]);
  });

  it("needs a name, company or email", async () => {
    await expect(findOrCreateCustomer(seed(), {})).rejects.toThrow(/at least/);
  });
});

describe("create_inquiry", () => {
  it("returns the open inquiry with the same title instead of a duplicate", async () => {
    const db = seed();
    const r: any = await createInquiry(db, { customer_id: CUST, title: "accent TABLES" });
    expect(r.created).toBe(false);
    expect(r.duplicate_of.id).toBe(INQ);
    expect(db.writes).toEqual([]);
  });

  it("creates the inquiry and the dialog's projection defaults", async () => {
    const db = seed();
    const r: any = await createInquiry(db, { customer_id: CUST, title: "Mango serving trays", requirements: "200 pcs" }, "2026-11-19");
    expect(r.created).toBe(true);
    expect(r.inquiry.rfq_number).toMatch(/^RFQ-/);
    const inq = db.writesTo("customer_rfqs", "insert")[0].rows![0];
    expect(inq).toMatchObject({ status: "active", priority: "normal", received_date: "2026-11-19", requirements: "200 pcs" });
    const proj = db.writesTo("inquiry_projections", "insert")[0].rows![0];
    expect(proj).toMatchObject({
      inquiry_id: r.inquiry.id, selling_entity_id: "e-dkt", producing_entity_id: "e-pv",
      shipping_method: "sea", duration_months: 3, start_month: "2026-11-01", shipping_month: "2027-02-01",
    });
    for (const [table, row] of [["customer_rfqs", inq], ["inquiry_projections", proj]] as const) {
      const have = schemaColumns(types, table);
      expect(Object.keys(row).filter(k => !FAKE_KEYS.has(k) && !have.has(k)), table).toEqual([]);
    }
  });

  it("keeps the inquiry when the projection fails, and says so", async () => {
    const db = seed().failOn("inquiry_projections", "insert", "permission denied");
    const r: any = await createInquiry(db, { customer_id: CUST, title: "Planters" });
    expect(r.created).toBe(true);
    expect(r.warnings[0]).toMatch(/Projection tab/);
  });

  it("rejects an unknown customer and bad dates", async () => {
    await expect(createInquiry(seed(), { customer_id: "44444444-4444-4444-8444-444444444444", title: "X" })).rejects.toThrow(/not found/);
    await expect(createInquiry(seed(), { customer_id: CUST, title: "X", received_date: "2026-13-01" })).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe("import_costing_intake", () => {
  const sheetRow = {
    SKU: "CCT-NEW1", "Product name": "Console 48", "Product type": "Wood Side/End Table", Quantity: 150,
    "Source location": "Jodhpur", "Piece W (in)": 48, "Raw piece ₹": "2,400", "Handle 1 name": '5" Gold Handle',
    "Handle 1 qty": 2, "Handle 1 ₹": 150, "Lacquer chemical": "No Such Lacquer", "Colour of the moon": "x",
  };

  it("dry run plans the rows, flags unknown names and columns, and writes nothing", async () => {
    const db = seed();
    const r: any = await importCostingIntake(db, {
      inquiry_id: INQ, dry_run: true,
      rows: [sheetRow, { sku: "CCT-AT3335", name: "Accent Table 33x35", quantity: 300 }, { Notes: "no id" }],
    });
    expect(r.plan.map((p: any) => p.action)).toEqual(["create", "skip (exists; set update_existing to change it)"]);
    expect(r.warnings.join("\n")).toMatch(/row 4: no SKU/);
    expect(r.warnings.join("\n")).toMatch(/Colour of the moon/);
    expect(r.warnings.join("\n")).toMatch(/Lacquer chemical "No Such Lacquer" not found/);
    expect(db.writes).toEqual([]);
  });

  it("creates products through the shared importer", async () => {
    const db = seed();
    const r: any = await importCostingIntake(db, { inquiry_id: INQ, rows: [sheetRow] });
    expect(r).toMatchObject({ created: 1, updated: 0 });
    const prod = db.rows("products").find(p => p.sku === "CCT-NEW1")!;
    expect(prod).toMatchObject({ customer_rfq_id: INQ, quantity: 150, product_type_id: "pt-1", source_location_id: "loc-1", width_inch: 48, sort_order: 3 });
    const cogs = db.rows("cogs_items").filter(c => c.product_id === prod.id && !c.is_auto_calculated);
    expect(cogs.map(c => [c.cogs_type, c.component_name, c.unit_cost_inr, c.components_per_product])).toEqual(
      expect.arrayContaining([["Raw Piece", "Raw Piece", 2400, 1], ["Handles + Knobs", '5" Gold Handle', 150, 2]]),
    );
    expect(r.product_ids).toEqual([prod.id]);
  });

  it("only changes existing products when asked", async () => {
    const db = seed();
    await importCostingIntake(db, { inquiry_id: INQ, rows: [{ SKU: "CCT-AT3335", Quantity: 500 }] });
    expect(db.rows("products").find(p => p.id === P1)!.quantity).toBeUndefined();
    const r: any = await importCostingIntake(db, { inquiry_id: INQ, update_existing: true, rows: [{ SKU: "cct-at3335", Quantity: 500 }] });
    expect(r.updated).toBe(1);
    expect(db.rows("products").find(p => p.id === P1)!.quantity).toBe(500);
  });

  it("rejects an unknown inquiry and oversized sheets", async () => {
    await expect(importCostingIntake(seed(), { inquiry_id: "44444444-4444-4444-8444-444444444444", rows: [{ SKU: "A" }] })).rejects.toThrow(/not found/);
    await expect(importCostingIntake(seed(), { inquiry_id: INQ, rows: Array.from({ length: 101 }, () => ({ SKU: "A" })) })).rejects.toThrow(/At most 100/);
  });
});

describe("attach_product_photo", () => {
  const png = Buffer.from("fake-image-bytes").toString("base64");

  it("refuses to overwrite a photo unless replace is set", async () => {
    const db = seed();
    const r: any = await attachProductPhoto(db, { product_id: P2, image_base64: png, media_type: "image/png" });
    expect(r.attached).toBe(false);
    expect(db.uploads).toEqual([]);
  });

  it("uploads like the app and links the photo with a cache-buster", async () => {
    const db = seed();
    const r: any = await attachProductPhoto(db, { product_id: P1, image_base64: `data:image/png;base64,${png}`, media_type: "image/png" }, 1700000000000);
    expect(r.attached).toBe(true);
    expect(db.uploads).toEqual([{ bucket: "product-photos", path: `${P1}.png`, bytes: 16, contentType: "image/png" }]);
    expect(db.rows("products").find(p => p.id === P1)!.photo_url).toBe(`https://storage.test/product-photos/${P1}.png?t=1700000000000`);
  });

  it("rejects text that is not base64", async () => {
    await expect(attachProductPhoto(seed(), { product_id: P1, image_base64: "not base64!", media_type: "image/jpeg" })).rejects.toThrow(/base64/);
  });
});

describe("create_sample_request", () => {
  it("only samples live products on the same inquiry", async () => {
    await expect(createSampleRequest(seed(), { inquiry_id: INQ, product_ids: [P1, P_OTHER] })).rejects.toThrow(P_OTHER);
  });

  it("creates one request with a pending line per product", async () => {
    const db = seed();
    const r: any = await createSampleRequest(db, { inquiry_id: INQ, product_ids: [P1, P2, P1], required_by_date: "2026-12-05" }, "2026-11-19");
    expect(r.created).toBe(true);
    expect(r.request.request_number).toMatch(/^SR-/);
    const lines = db.writesTo("samples", "insert")[0].rows!;
    expect(lines.map(l => [l.product_id, l.status, l.requested_date])).toEqual([[P1, "pending", "2026-11-19"], [P2, "pending", "2026-11-19"]]);
    for (const [table, row] of [["sample_requests", db.writesTo("sample_requests", "insert")[0].rows![0]], ["samples", lines[0]]] as const) {
      const have = schemaColumns(types, table);
      expect(Object.keys(row).filter(k => !FAKE_KEYS.has(k) && !have.has(k)), table).toEqual([]);
    }
  });

  it("does not double-request a product with a pending sample", async () => {
    const db = seed();
    db.rows("samples").push({ id: "s0", product_id: P1, customer_rfq_id: INQ, status: "pending", request_id: "r0" });
    const r: any = await createSampleRequest(db, { inquiry_id: INQ, product_ids: [P1] });
    expect(r.created).toBe(false);
    expect(r.already_requested).toHaveLength(1);
    expect(db.writes).toEqual([]);
  });

  it("removes only its own request when the lines fail", async () => {
    const db = seed().failOn("samples", "insert", "rls");
    db.rows("sample_requests").push({ id: "keep-me", customer_rfq_id: INQ });
    await expect(createSampleRequest(db, { inquiry_id: INQ, product_ids: [P1] })).rejects.toThrow(/not kept/);
    expect(db.rows("sample_requests").map(r => r.id)).toEqual(["keep-me"]);
  });
});

describe("create_task", () => {
  it("links to the inquiry with the app's label", async () => {
    const db = seed();
    const r: any = await createTask(db, { title: "Send quote", due_date: "2026-11-25", assignee: "cq", inquiry_id: INQ });
    expect(r.task).toMatchObject({ assignee: "CQ", association_label: "RFQ-2026-001 Accent tables" });
    const row = db.writesTo("tasks", "insert")[0].rows![0];
    expect(row).toMatchObject({ status: "open", priority: "normal", inquiry_id: INQ, association_type: "inquiry", association_id: INQ });
    const have = schemaColumns(types, "tasks");
    expect(Object.keys(row).filter(k => !FAKE_KEYS.has(k) && !have.has(k))).toEqual([]);
  });

  it("requires a real due date and a known assignee", async () => {
    await expect(createTask(seed(), { title: "X", due_date: "next week" })).rejects.toThrow(/due_date/);
    await expect(createTask(seed(), { title: "X", due_date: "2026-11-25", assignee: "ZZ" })).rejects.toThrow(/CQ, PH/);
    await expect(createTask(seed(), { title: "X", due_date: "2026-11-25", inquiry_id: INQ, customer_id: CUST })).rejects.toThrow(/not both/);
  });

  it("dry run writes nothing", async () => {
    const db = seed();
    await createTask(db, { title: "X", due_date: "2026-11-25", customer_id: CUST, dry_run: true });
    expect(db.writes).toEqual([]);
  });

  it("links to a project by name or id, like the app's project picker", async () => {
    const db = seed();
    const r: any = await createTask(db, { title: "Follow up", due_date: "2026-11-25", project: "sales office" });
    expect(r.task).toMatchObject({ association_label: "Sales Office" });
    const row = db.writesTo("tasks", "insert")[0].rows![0];
    expect(row).toMatchObject({ association_type: "project", association_id: "proj-sales" });
    expect(row.inquiry_id ?? null).toBeNull();
    expect((await createTask(seed(), { title: "Y", due_date: "2026-11-25", project_id: "proj-sales", dry_run: true }) as any).task.association_id).toBe("proj-sales");
    expect((await listTasks(db, { project_id: "proj-sales" })).map((t: any) => t.title)).toEqual(["Follow up"]);
  });

  it("refuses unknown, closed or doubled-up project links", async () => {
    await expect(createTask(seed(), { title: "X", due_date: "2026-11-25", project: "Nope" })).rejects.toThrow(/No project named/);
    await expect(createTask(seed(), { title: "X", due_date: "2026-11-25", project: "Old launch" })).rejects.toThrow(/done/);
    await expect(createTask(seed(), { title: "X", due_date: "2026-11-25", project: "Sales Office", inquiry_id: INQ })).rejects.toThrow(/one thing/);
  });
});
