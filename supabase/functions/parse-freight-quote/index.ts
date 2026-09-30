// Freight Quote Tracker — extraction only. Returns structured drafts; never computes totals.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BUCKETS = ["FOB_ORIGIN", "OCEAN_FREIGHT", "DEST_PORT", "DOOR_DELIVERY", "CUSTOMS_IMPORT", "DUTIES_TAXES", "OTHER"];
const BASES = ["flat", "per_cbm", "per_wm", "per_bl", "per_shipment", "per_pallet", "per_container", "percent_of_value", "at_actuals", "per_kg", "other"];

const nullable = (t: string) => ({ type: [t, "null"] });
const LINE = {
  type: "object", additionalProperties: false,
  required: ["raw_label", "normalized_name", "bucket", "charge_basis", "rate", "currency", "minimum_amount", "applicable", "applicable_reason", "is_optional", "notes", "confidence"],
  properties: {
    raw_label: { type: "string" }, normalized_name: { type: "string" },
    bucket: { type: "string", enum: BUCKETS }, charge_basis: { type: "string", enum: BASES },
    rate: nullable("number"), currency: { type: "string" }, minimum_amount: nullable("number"),
    applicable: { type: "boolean" }, applicable_reason: nullable("string"), is_optional: { type: "boolean" },
    notes: nullable("string"), confidence: { type: "number", description: "0-1" },
  },
};
const QUOTE = {
  type: "object", additionalProperties: false,
  required: ["vendor_name", "quote_date", "valid_until", "reference_no", "direction", "origin_city", "origin_port", "destination_city", "destination_port", "destination_country", "mode", "container_size", "cbm", "gross_weight_kg", "pallet_count", "wm_kg_per_cbm", "field_confidence", "lines"],
  properties: {
    vendor_name: nullable("string"), quote_date: { ...nullable("string"), description: "YYYY-MM-DD" }, valid_until: nullable("string"),
    reference_no: nullable("string"), direction: { type: "string", enum: ["export", "import"] },
    origin_city: nullable("string"), origin_port: nullable("string"), destination_city: nullable("string"),
    destination_port: nullable("string"), destination_country: nullable("string"),
    mode: { type: "string", enum: ["LCL", "FCL", "air"] }, container_size: nullable("string"),
    cbm: nullable("number"), gross_weight_kg: nullable("number"), pallet_count: nullable("number"),
    wm_kg_per_cbm: { ...nullable("number"), description: "Only if the quote states a W/M rule, e.g. 1 CBM = 363 kg" },
    field_confidence: {
      type: "object", additionalProperties: false,
      required: ["vendor_name", "quote_date", "lane", "mode", "cbm", "gross_weight_kg"],
      properties: Object.fromEntries(["vendor_name", "quote_date", "lane", "mode", "cbm", "gross_weight_kg"].map(k => [k, { type: "number" }])),
    },
    lines: { type: "array", items: LINE },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["quotes"], properties: { quotes: { type: "array", items: QUOTE } } };

function systemPrompt(keywords: any[]) {
  const kw = (keywords || []).map((k: any) => `- "${k.keyword}": origin-side → ${k.origin}, destination-side → ${k.destination}`).join("\n");
  return `You extract freight forwarder quotes into structured data. You ONLY extract — never add, multiply, convert currencies or compute totals.
Rules:
- Return every charge as a line with raw_label exactly as written, rate, currency (ISO code: INR, USD, AUD…), basis, minimum, notes.
- Keep each line in its own currency. Never convert.
- Detect conditional wording ("if required", "if applicable", "at actuals against receipt", "applicable if cargo exceeds 5 MT"). Do NOT drop these lines. Set charge_basis "at_actuals" (rate null) for at-actuals items; set is_optional true for optional extras (tail gate, appointment); set applicable=false with applicable_reason when the stated condition clearly does not apply to the cargo described (e.g. DG surcharge on non-hazardous cargo, weight thresholds not met); otherwise applicable=true with the condition in applicable_reason.
- Capture a W/M rule if stated (e.g. "1 CBM = 363 kg" → wm_kg_per_cbm 363).
- Buckets: FOB_ORIGIN (origin-side charges before the ship: pickup/trucking, terminal/handling, measurement, BL fees, export customs, fumigation/certificates, ACD, stuffing), OCEAN_FREIGHT (incl. origin-pickup surcharges like ONC), DEST_PORT (THC, port security, DO, stripping, chassis, PSS, fuel, doc transfer), DOOR_DELIVERY (trucking, warehouse, tail gate, residential, pallets), CUSTOMS_IMPORT (ISF, import clearance, bond, handling, exam), DUTIES_TAXES (only if the quote lists them), OTHER.
- percent_of_value: rate is the percent number (e.g. 0.5 for 0.5%).
- Give a 0-1 confidence per line and per key field; use low values for ambiguous items.
- One source may contain several quotes (e.g. two forwarders or LCL vs FCL options) — return them as separate quotes.
Keyword hints:
${kw || "(none)"}`;
}

async function viaAnthropic(key: string, system: string, content: any[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-5", max_tokens: 8000, system,
      tools: [{ name: "record_quotes", description: "Record the extracted freight quotes", input_schema: SCHEMA }],
      tool_choice: { type: "tool", name: "record_quotes" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw Object.assign(new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  const data = await res.json();
  const tool = (data.content || []).find((c: any) => c.type === "tool_use");
  if (!tool) throw new Error("No structured output returned");
  return tool.input;
}

async function viaGateway(key: string, system: string, content: any[]) {
  const input = content.map((c: any) => {
    if (c.type === "text") return { type: "input_text", text: c.text };
    if (c.type === "image") return { type: "input_image", image_url: `data:${c.source.media_type};base64,${c.source.data}` };
    if (c.type === "document") return { type: "input_file", filename: "quote.pdf", file_data: `data:application/pdf;base64,${c.source.data}` };
    return null;
  }).filter(Boolean);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Lovable-API-Key": key, "Content-Type": "application/json", "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra", stream: true, store: false, instructions: system,
      reasoning: { effort: "low" },
      input: [{ role: "user", content: input }],
      text: { format: { type: "json_schema", name: "record_quotes", strict: true, schema: SCHEMA } },
    }),
  });
  if (!res.ok || !res.body) throw Object.assign(new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 300)}`), { status: res.status });
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", out = "";
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim(); if (d === "[DONE]") continue;
      try { const ev = JSON.parse(d); if (ev.type === "response.output_text.delta") out += ev.delta; } catch { /* partial */ }
    }
  }
  return JSON.parse(out);
}

function b64(bytes: Uint8Array) {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
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
    const text = typeof body.text === "string" ? body.text.slice(0, 100000) : "";
    const filePath = typeof body.file_path === "string" ? body.file_path : null;
    const keywords = Array.isArray(body.keywords) ? body.keywords.slice(0, 100) : [];
    if (!text.trim() && !filePath) return json({ error: "Provide text or a file" }, 400);

    const content: any[] = [];
    if (filePath) {
      const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: blob, error } = await admin.storage.from("fq-documents").download(filePath);
      if (error || !blob) return json({ error: "Could not read uploaded file" }, 400);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const lower = filePath.toLowerCase();
      if (lower.endsWith(".pdf")) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) } });
      else if (/\.(png|jpe?g|webp|gif)$/.test(lower)) {
        const ext = lower.split(".").pop()!; const mt = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        content.push({ type: "image", source: { type: "base64", media_type: mt, data: b64(bytes) } });
      } else content.push({ type: "text", text: `Attached file (${filePath.split("/").pop()}):\n${new TextDecoder().decode(bytes).slice(0, 100000)}` });
    }
    if (text.trim()) content.push({ type: "text", text: `Pasted quote text:\n${text}` });
    content.push({ type: "text", text: "Extract every freight quote in the source above using the record_quotes schema." });

    const system = systemPrompt(keywords);
    const anthropic = Deno.env.get("ANTHROPIC_API_KEY");
    let result: any, provider = "anthropic";
    if (anthropic) {
      try { result = await viaAnthropic(anthropic, system, content); }
      catch (e) {
        const lk = Deno.env.get("LOVABLE_API_KEY");
        if (!lk) throw e;
        console.error("Anthropic failed, using gateway:", (e as Error).message);
        result = await viaGateway(lk, system, content); provider = "lovable";
      }
    } else {
      result = await viaGateway(Deno.env.get("LOVABLE_API_KEY")!, system, content); provider = "lovable";
    }
    return json({ quotes: result?.quotes || [], provider });
  } catch (e: any) {
    console.error(e);
    return json({ error: e?.message || "Extraction failed" }, e?.status === 429 || e?.status === 402 ? e.status : 500);
  }
});
