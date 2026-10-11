// Iron Weight Calculator — photo estimate. Given a photo of an iron furniture piece and its outer
// W × D × H, asks Claude for the iron members (section, size, cut length, count) grouped into
// assemblies. Returns a draft only; the app computes every weight with iron-weight-core.ts.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SHAPES = ["round_bar", "square_bar", "flat_bar", "hex_bar", "round_pipe", "square_tube", "rect_tube"];
const MM_PER: Record<string, number> = { mm: 1, cm: 10, in: 25.4 };
const MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Every size key is present on every part (0 when the shape doesn't use it) so the schema stays strict.
const DIMS = {
  type: "object", additionalProperties: false,
  required: ["d", "a", "w", "h", "t", "af", "od"],
  properties: {
    d: { type: "number", description: "round_bar diameter" },
    a: { type: "number", description: "square_bar side, or square_tube outer side" },
    w: { type: "number", description: "flat_bar width, or rect_tube outer width" },
    h: { type: "number", description: "rect_tube outer height" },
    t: { type: "number", description: "wall thickness (round_pipe, square_tube, rect_tube) or flat_bar thickness" },
    af: { type: "number", description: "hex_bar across flats" },
    od: { type: "number", description: "round_pipe outer diameter" },
  },
};
const SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["summary", "assumptions", "assemblies"],
  properties: {
    summary: { type: "string", description: "One or two sentences: what the piece is and how its iron is built." },
    assumptions: { type: "array", items: { type: "string" }, description: "Each assumption a person should check, short." },
    assemblies: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "qty", "parts"],
        properties: {
          name: { type: "string" },
          qty: { type: "integer", description: "How many identical copies of this assembly the piece has." },
          parts: {
            type: "array",
            items: {
              type: "object", additionalProperties: false,
              required: ["name", "shape", "dims", "length_mm", "count", "confidence", "note"],
              properties: {
                name: { type: "string" },
                shape: { type: "string", enum: SHAPES },
                dims: { ...DIMS, description: "Section sizes in millimetres; 0 for keys the shape does not use." },
                length_mm: { type: "number", description: "Cut length of one piece in millimetres." },
                count: { type: "integer", description: "How many of this part in ONE copy of the assembly." },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                note: { type: "string", description: "Why this size/length, in a few words. Empty if obvious." },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You estimate the iron content of furniture for a manufacturer in India that builds wrought-iron and mild-steel furniture (tables, bases, frames, shelving, stools, consoles).

From the photo and the stated outer dimensions, list every visible iron or steel member and size it:
- Use the outer dimensions to scale the photo. Lengths are cut lengths in mm; members meeting at a corner each run to the outside of the frame unless the photo clearly shows otherwise. Subtract section sizes where one member sits between two others.
- Pick the section that matches what you see: rect_tube or square_tube for boxy hollow members, round_pipe for hollow round, flat_bar for straps and thin plates, round_bar / square_bar for solid rods. Use common Indian stock sizes (e.g. 40×20×1.5, 50×25×2, 25×25×1.5 tube; 25×5, 40×5 flat; 10, 12, 16 mm bar). Wall thickness 1.5–2 mm for light furniture, 3 mm for heavy bases, unless the photo suggests otherwise.
- Group members into assemblies the way the piece is built: identical legs or side frames become one assembly with qty = how many; one-off frames have qty 1. count is per copy of the assembly, so the piece's total is qty × count. Never count a member twice.
- Include only iron/steel. Leave out wood, stone or glass tops, cushions, glides and fasteners. Small welded tabs and plates may be listed as flat_bar if they are a meaningful amount of steel.
- When the photo hides something (back rails, under-top supports), include your best guess at low confidence and say so in assumptions.
- If the photo is not furniture with visible iron, return no assemblies and explain in summary.
Keep names short and shop-floor friendly ("Leg", "Top frame long rail", "Stretcher").`;

function bad(msg: string) { return json({ error: msg }, 400); }

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
    const image = typeof body.image === "string" ? body.image : "";
    const mediaType = MEDIA.includes(body.media_type) ? body.media_type : "image/jpeg";
    const unit = MM_PER[body.unit] ? body.unit : "in";
    const [w, d, h] = [body.width, body.depth, body.height].map(Number);
    if (!image || image.length > 8_000_000) return bad("Attach a photo (under about 6 MB).");
    if (![w, d, h].every(n => n > 0 && n < 100000)) return bad("Enter the outer width, depth and height.");
    const notes = typeof body.notes === "string" ? body.notes.slice(0, 1000) : "";
    const mm = (n: number) => Math.round(n * MM_PER[unit]);

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return json({ error: "ANTHROPIC_API_KEY is not set for this project's edge functions." }, 500);
    const client = new Anthropic({ apiKey: key });

    const params: any = {
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          {
            type: "text",
            text: `Outer dimensions: ${w} × ${d} × ${h} ${unit} (W × D × H) = ${mm(w)} × ${mm(d)} × ${mm(h)} mm.` +
              (notes ? `\nAbout this piece: ${notes}` : "") +
              "\nList the iron members as assemblies and parts.",
          },
        ],
      }],
    };
    const res: any = await client.beta.messages.create(params);

    if (res.stop_reason === "refusal") return json({ error: "The estimator declined this photo. Try a different photo or enter the parts by hand." }, 422);
    if (res.stop_reason === "max_tokens") return json({ error: "The estimate was too long to finish. Add a note about what the piece is and try again." }, 502);
    const text = (res.content || []).find((c: any) => c.type === "text")?.text;
    if (!text) return json({ error: "No estimate came back. Please try again." }, 502);
    const est = JSON.parse(text);
    return json({ ...est, model: res.model });
  } catch (e: any) {
    console.error("estimate-iron-parts:", e?.status, e?.message);
    const status = e?.status === 429 || e?.status === 529 ? 429 : 500;
    return json({ error: status === 429 ? "The estimator is busy. Try again in a minute." : e?.message || "Estimate failed" }, status);
  }
});
