// Photo intake — product estimate. Given one to three photos of a furniture piece and its outer
// W × D × H, asks Claude for a draft costing: product type, % wood, finishing difficulty, raw piece
// cost, man-hours and likely hardware lines. Recent costed products are passed as references so the
// rupee figures follow this factory's own numbers. Returns a draft only; the app writes it as costing
// inputs (src/lib/photo-intake.ts) and the costing engine derives every other number.
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const IN_PER: Record<string, number> = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4 };
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];
// COGS categories a drafted line item may use (the Costing Intake slot categories plus Subcontracting).
const LINE_TYPES = [
  "Handles + Knobs", "Handles/Latches", "Feet/Buffers", "Other Hardware", "Accessories",
  "Components", "Inserts + Instructions", "Subcontracting", "Other",
];

function schema(typeNames: string[], difficulties: string[]) {
  const pick = (names: string[], description: string) =>
    names.length ? { type: "string", enum: [...names, ""], description } : { type: "string", description };
  return {
    type: "object", additionalProperties: false,
    required: ["name", "summary", "product_type", "percent_wood", "finishing_difficulty", "materials", "weight_kg",
      "raw_piece_inr", "raw_piece_basis", "mh_manufacturing", "mh_assembly", "line_items", "assumptions", "confidence"],
    properties: {
      name: { type: "string", description: "Short catalogue name, e.g. \"Mango Wood Console 3 Drawer\"." },
      summary: { type: "string", description: "One or two sentences: what the piece is and how it is built." },
      product_type: pick(typeNames, "The closest product type from the list, or empty if none fits."),
      percent_wood: { type: "number", description: "Share of the visible surface that is wood and gets wood finishing, 0–100." },
      finishing_difficulty: pick(difficulties, "Finishing difficulty for the wood finish."),
      materials: { type: "string", description: "Main materials and finish in a few words." },
      weight_kg: { type: "number", description: "Estimated net weight of one piece in kg." },
      raw_piece_inr: { type: "number", description: "Estimated cost in ₹ of the raw (unfinished) piece from the maker, per unit." },
      raw_piece_basis: { type: "string", description: "How the raw piece cost was reached, in a few words (e.g. which reference it follows)." },
      mh_manufacturing: { type: "number", description: "In-house manufacturing man-hours per unit; 0 if the raw piece is bought complete." },
      mh_assembly: { type: "number", description: "Assembly man-hours per unit; 0 if none." },
      line_items: {
        type: "array",
        description: "Bought-in items visible or implied (handles, knobs, hinges, slides, glides, glass, mirror, cushions, metal parts made outside). Not the raw piece, finishing materials or packaging.",
        items: {
          type: "object", additionalProperties: false,
          required: ["cogs_type", "name", "qty", "unit_inr"],
          properties: {
            cogs_type: { type: "string", enum: LINE_TYPES },
            name: { type: "string", description: "Shop-floor name, e.g. \"Brass knob 30 mm\"." },
            qty: { type: "number", description: "Pieces per product." },
            unit_inr: { type: "number", description: "₹ per piece." },
          },
        },
      },
      assumptions: { type: "array", items: { type: "string" }, description: "Each assumption a person should check, short." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
  };
}

const SYSTEM = `You draft costings for a furniture manufacturer and exporter in Jodhpur, India. The factory buys raw pieces (unfinished wood or metal furniture) from local makers, then does its own sanding, finishing, assembly and export packing. Some pieces are made in-house from raw material.

From the photos and the stated outer dimensions, produce a first-draft costing a person will review in the costing workspace:
- Identify the piece, its construction and materials. Pick the closest product type and finishing difficulty from the lists given.
- percent_wood is the share of the piece that receives wood finishing (100 for an all-wood table, ~40 for a wood top on an iron base, 0 for all metal).
- raw_piece_inr is the price of the unfinished piece from the maker. Anchor it on the reference products below: find the most similar ones by type, size and construction and scale by size and complexity. Say which reference you followed in raw_piece_basis. When no reference is close, estimate from Jodhpur market rates and say so in assumptions.
- Man-hours are per unit for this factory's own work. Leave finishing and packaging labour out — the costing engine estimates those from size and wood share. Follow the references' man-hours where they are close.
- List only bought-in items that a costing sheet would carry as separate lines (hardware, glass, mirror, cushions, castors, outsourced metal or upholstery work). Do not list finishing chemicals or packaging; the engine adds those.
- Use whole rupees. When the photo hides something, make a best guess and say so in assumptions.
- If the photo is not furniture, set every number to 0, leave line_items empty and explain in summary.`;

function bad(msg: string) { return json({ error: msg }, 400); }
const r0 = (n: number) => Math.round(n);

/** Recent costed products as a compact reference table for the prompt. */
async function loadReferences(db: any, typeName: Map<string, string>) {
  const { data: prods } = await db.from("products")
    .select("id, name, product_type_id, width_inch, depth_inch, height_inch, percent_wood, finishing_difficulty, is_outsourced")
    .is("archived_at", null).not("is_component", "is", true).not("width_inch", "is", null)
    .order("updated_at", { ascending: false }).limit(150);
  const list = (prods || []).filter((p: any) => !p.is_outsourced);
  if (!list.length) return "";
  const ids = list.map((p: any) => p.id);
  const [cogs, oh] = await Promise.all([
    db.from("cogs_items").select("product_id, cogs_type, components_per_product, unit_cost_inr, include, is_auto_calculated").in("product_id", ids),
    db.from("overhead_items").select("product_id, labor_type, man_hours_per_unit, include").in("product_id", ids).in("labor_type", ["Manufacturing", "Assembly"]),
  ]);
  const raw = new Map<string, number>(); const hw = new Map<string, number>();
  for (const c of cogs.data || []) {
    if (c.include === "No" || c.is_auto_calculated) continue;
    const v = (Number(c.components_per_product) || 0) * (Number(c.unit_cost_inr) || 0);
    if (!v) continue;
    const m = c.cogs_type === "Raw Piece" ? raw : LINE_TYPES.includes(c.cogs_type) ? hw : null;
    if (m) m.set(c.product_id, (m.get(c.product_id) || 0) + v);
  }
  const mh = new Map<string, { m: number; a: number }>();
  for (const o of oh.data || []) {
    if (o.include === "No") continue;
    const e = mh.get(o.product_id) || { m: 0, a: 0 };
    if (o.labor_type === "Manufacturing") e.m += Number(o.man_hours_per_unit) || 0; else e.a += Number(o.man_hours_per_unit) || 0;
    mh.set(o.product_id, e);
  }
  const rows = list.filter((p: any) => (raw.get(p.id) || 0) > 0).slice(0, 60).map((p: any) => {
    const h = mh.get(p.id) || { m: 0, a: 0 };
    return [p.name, typeName.get(p.product_type_id) || "", `${p.width_inch}×${p.depth_inch ?? "?"}×${p.height_inch ?? "?"}`,
      r0((Number(p.percent_wood) || 0) * 100), p.finishing_difficulty || "", r0(raw.get(p.id)!), h.m, h.a, r0(hw.get(p.id) || 0)].join(" | ");
  });
  if (!rows.length) return "";
  return "Reference products (recent costings from this factory):\nname | type | W×D×H in | % wood | finishing | raw piece ₹ | mfg MH | assembly MH | hardware & other lines ₹\n" + rows.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: cErr } = await userClient.auth.getClaims(auth.slice(7));
    if (cErr || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const { data: ok } = await userClient.rpc("is_admin_or_team", { _user_id: claims.claims.sub });
    if (!ok) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const images = (Array.isArray(body.images) ? body.images : []).slice(0, 3)
      .filter((i: any) => typeof i?.data === "string" && i.data.length > 0);
    if (!images.length) return bad("Attach a photo.");
    if (images.reduce((s: number, i: any) => s + i.data.length, 0) > 12_000_000) return bad("The photos are too large (keep them under about 9 MB together).");
    const unit = IN_PER[body.unit] ? body.unit : "in";
    const [w, d, h] = [body.width, body.depth, body.height].map(Number);
    if (![w, d, h].every(n => n > 0 && n < 100000)) return bad("Enter the outer width, depth and height.");
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : "";
    const givenName = typeof body.name === "string" ? body.name.slice(0, 200) : "";
    const inch = (n: number) => Math.round(n * IN_PER[unit] * 10) / 10;

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY is not set for this project's edge functions." }, 500);

    const [pt, fd] = await Promise.all([
      userClient.from("product_types").select("id, name").order("name"),
      userClient.from("finishing_difficulty").select("name").order("sort_order"),
    ]);
    const types = (pt.data || []) as { id: string; name: string }[];
    const difficulties = ((fd.data || []) as { name: string }[]).map(x => x.name);
    const refs = await loadReferences(userClient, new Map(types.map(t => [t.id, t.name]))).catch(() => "");

    const client = new Anthropic({ apiKey: key });
    const params: any = {
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: schema(types.map(t => t.name), difficulties) } },
      system: SYSTEM + (refs ? `\n\n${refs}` : "\n\nNo reference products are available yet."),
      messages: [{
        role: "user",
        content: [
          ...images.map((i: any) => ({ type: "image", source: { type: "base64", media_type: MEDIA.includes(i.media_type) ? i.media_type : "image/jpeg", data: i.data } })),
          {
            type: "text",
            text: `Outer dimensions: ${w} × ${d} × ${h} ${unit} (W × D × H) = ${inch(w)} × ${inch(d)} × ${inch(h)} in.` +
              (givenName ? `\nName given: ${givenName}` : "") +
              (notes ? `\nAbout this piece: ${notes}` : "") +
              "\nDraft its costing.",
          },
        ],
      }],
    };
    const res: any = await client.beta.messages.create(params);

    if (res.stop_reason === "refusal") return json({ error: "The estimator declined this photo. Try a different photo or add the product by hand." }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "The estimate was too long to finish. Add a note about what the piece is and try again." }, 502);
    const text = (res.content || []).find((c: any) => c.type === "text")?.text;
    if (!text) return json({ error: "No estimate came back. Please try again." }, 502);
    const est = JSON.parse(text);
    return json({ ...est, model: res.model, references_used: refs ? refs.split("\n").length - 2 : 0 });
  } catch (e: any) {
    console.error("estimate-product:", e?.status, e?.message);
    const status = e?.status === 429 || e?.status === 529 ? 429 : 500;
    return json({ error: status === 429 ? "The estimator is busy. Try again in a minute." : e?.message || "Estimate failed" }, status);
  }
});
