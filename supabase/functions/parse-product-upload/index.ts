import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const systemPrompt = `You are a product data extraction assistant for a furniture import company that sources from India and exports to the US. Analyze the provided content and extract detailed product information.

Return ONLY a valid JSON object (no markdown, no backticks, no explanation) with this structure:
{
  "products": [
    {
      "name": "descriptive product name",
      "sku": "SKU or model number if visible, otherwise null",
      "width_inch": number or null,
      "depth_inch": number or null,
      "height_inch": number or null,
      "weight_kg": number or null,
      "quantity": number or null,
      "product_type": "best match from: Wood Small, Wood Table, Wood Chair, Wood Sofa, Wood Chest/Dresser, Wood Side/End Table, Wood Stool, Wood Console, Wood Bed, Iron Small, Iron Chair, Iron Sofa, Iron Shelf, Marble Small, Marble Table Top, Iron Table Base, Wood Table Top",
      "material_guess": "e.g. Mango Wood, Sheesham, Acacia, Oak, Iron, Marble",
      "target_price_usd": number or null,
      "finishing_difficulty": "Very Easy, Easy, Medium, Hard, or Very Hard",
      "percent_wood": number between 0 and 1,
      "is_component": false,
      "hardware_detected": [
        { "item": "name", "quantity_per_product": number, "notes": "spec" }
      ],
      "construction_notes": "...",
      "notes": "...",
      "confidence": "high" or "medium" or "low"
    }
  ]
}

DIMENSIONS: If dimensions are in cm, convert to inches (÷ 2.54). If in mm, convert to inches (÷ 25.4).
For furniture: width = side-to-side, depth = front-to-back, height = floor-to-top.`;

// Normalize header text to a comparable key
function normHeader(h: any): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const HEADER_ALIASES: Record<string, string> = {
  // name
  name: "name", product_name: "name", sku_name: "name", item: "name", item_name: "name", title: "name", description: "name",
  // sku
  sku: "sku", sku_code: "sku", code: "sku", model: "sku", model_number: "sku",
  // dims
  width_in: "width_inch", width_inch: "width_inch", width: "width_inch", w: "width_inch", w_in: "width_inch",
  depth_in: "depth_inch", depth_inch: "depth_inch", depth: "depth_inch", d: "depth_inch", d_in: "depth_inch", length: "depth_inch", l: "depth_inch",
  height_in: "height_inch", height_inch: "height_inch", height: "height_inch", h: "height_inch", h_in: "height_inch",
  weight_kg: "weight_kg", weight: "weight_kg", weight_kgs: "weight_kg", wt_kg: "weight_kg",
  // qty / moq / price
  qty: "quantity", quantity: "quantity", order_qty: "quantity", units: "quantity",
  moq: "moq", min_order: "moq", min_order_qty: "moq",
  target_price: "target_price_usd", target_price_usd: "target_price_usd", price: "target_price_usd", price_usd: "target_price_usd", target_usd: "target_price_usd",
  // type / category
  product_type: "product_type", type: "product_type", category: "product_type", piece_type: "product_type",
  finishing_difficulty: "finishing_difficulty", difficulty: "finishing_difficulty", finish_difficulty: "finishing_difficulty",
  percent_wood: "percent_wood", wood_percent: "percent_wood", wood_pct: "percent_wood", wood_fraction: "percent_wood",
  is_component: "is_component", component: "is_component",
  source_location_name: "source_location_name", source_location: "source_location_name", location: "source_location_name",
  // notes
  notes: "notes", note: "notes", remarks: "notes", description_notes: "notes", comments: "notes",
  // collection (kept as note prefix)
  collection: "collection",
};

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[, $]/g, ""));
  return isNaN(n) ? null : n;
}

function toBool(v: any): boolean {
  if (v === true) return true;
  if (v === false || v === null || v === undefined) return false;
  const s = String(v).trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" || s === "1" || s === "x";
}

// Generic header-based parser — works on any sheet whose first non-empty row
// has at least a "name"/"product_name" column.
function parseSheetByHeaders(rows: any[][], fileName: string, sheetName: string): any[] {
  // Find header row: first row that contains a recognizable name column
  let headerRowIdx = -1;
  let headerMap: Record<number, string> = {};
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const map: Record<number, string> = {};
    let hasName = false;
    rows[i].forEach((cell, idx) => {
      const key = HEADER_ALIASES[normHeader(cell)];
      if (key) {
        map[idx] = key;
        if (key === "name") hasName = true;
      }
    });
    if (hasName) {
      headerRowIdx = i;
      headerMap = map;
      break;
    }
  }
  if (headerRowIdx === -1) return [];

  const products: any[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;

    const obj: any = {
      name: null, sku: null, width_inch: null, depth_inch: null, height_inch: null,
      weight_kg: null, quantity: null, moq: null, product_type: null,
      finishing_difficulty: "Medium", percent_wood: 1, target_price_usd: null,
      is_component: false, source_location_name: null, notes: null,
      hardware_detected: [], confidence: "high", source_file: fileName,
    };
    let collection: string | null = null;

    for (const [idxStr, key] of Object.entries(headerMap)) {
      const idx = Number(idxStr);
      const val = row[idx];
      if (val === null || val === undefined || val === "") continue;
      switch (key) {
        case "name": obj.name = String(val).trim(); break;
        case "sku": obj.sku = String(val).trim(); break;
        case "width_inch": obj.width_inch = toNum(val); break;
        case "depth_inch": obj.depth_inch = toNum(val); break;
        case "height_inch": obj.height_inch = toNum(val); break;
        case "weight_kg": obj.weight_kg = toNum(val); break;
        case "quantity": obj.quantity = toNum(val); break;
        case "moq": obj.moq = toNum(val); break;
        case "target_price_usd": obj.target_price_usd = toNum(val); break;
        case "product_type": obj.product_type = String(val).trim(); break;
        case "finishing_difficulty": obj.finishing_difficulty = String(val).trim(); break;
        case "percent_wood": {
          const n = toNum(val); if (n !== null) obj.percent_wood = n > 1 ? n / 100 : n; break;
        }
        case "is_component": obj.is_component = toBool(val); break;
        case "source_location_name": obj.source_location_name = String(val).trim() || null; break;
        case "notes": obj.notes = String(val).trim(); break;
        case "collection": collection = String(val).trim(); break;
      }
    }

    // Skip rows missing a usable name
    if (!obj.name) continue;
    // Skip metadata/banner rows
    if (obj.name.length > 120 && !obj.width_inch && !obj.height_inch) continue;

    if (collection) {
      obj.notes = obj.notes ? `[${collection}] ${obj.notes}` : `[${collection}]`;
    }
    products.push(obj);
  }
  return products;
}

function parseWorkbook(workbook: XLSX.WorkBook, fileName: string): any[] {
  const all: any[] = [];
  for (const sheetName of workbook.SheetNames) {
    if (/^(cogs|metadata|notes|instructions|template)/i.test(sheetName)) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
    const parsed = parseSheetByHeaders(rows, fileName, sheetName);
    if (parsed.length > 0) all.push(...parsed);
  }
  return all;
}

function parseCsv(text: string, fileName: string): any[] {
  const wb = XLSX.read(text, { type: "string" });
  return parseWorkbook(wb, fileName);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth check — verify JWT and admin/team role before invoking paid AI
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabaseAuth = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: isAllowed } = await supabaseAuth.rpc("is_admin_or_team", { _user_id: userData.user.id });
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { files } = await req.json();
    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(JSON.stringify({ error: "No files provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allProducts: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        const lowerName = (file.name || "").toLowerCase();

        // Excel files: try header-based parser first across all sheets
        if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
          try {
            const binaryData = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
            const workbook = XLSX.read(binaryData, { type: "array" });
            const parsed = parseWorkbook(workbook, file.name);
            if (parsed.length > 0) {
              allProducts.push(...parsed);
              continue;
            }
          } catch (xlsxErr: any) {
            console.error("XLSX parse failed, falling back to AI:", xlsxErr.message);
          }
        }

        // CSV files: try header-based parser first
        if (lowerName.endsWith(".csv")) {
          try {
            const csvText = typeof file.data === "string" && !/^[A-Za-z0-9+/=]+$/.test(file.data.slice(0, 200))
              ? file.data
              : new TextDecoder().decode(Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0)));
            const parsed = parseCsv(csvText, file.name);
            if (parsed.length > 0) {
              allProducts.push(...parsed);
              continue;
            }
          } catch (csvErr: any) {
            console.error("CSV parse failed, falling back to AI:", csvErr.message);
          }
        }

        // --- AI parsing fallback ---
        if (!ANTHROPIC_API_KEY) {
          errors.push(`Could not parse ${file.name} and AI fallback not configured`);
          continue;
        }

        const messages: any[] = [];
        if (file.type?.startsWith("image/")) {
          messages.push({
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: file.type, data: file.data } },
              { type: "text", text: "Extract product information from this image." },
            ],
          });
        } else if (file.pages && Array.isArray(file.pages) && file.pages.length > 0) {
          const content: any[] = [];
          for (const page of file.pages) {
            content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: page.data } });
          }
          content.push({ type: "text", text: `Extract product information from these ${file.pages.length} page images of ${file.name}.` });
          messages.push({ role: "user", content });
        } else if (file.type === "application/pdf") {
          messages.push({
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } },
              { type: "text", text: `Extract product information from ${file.name}.` },
            ],
          });
        } else {
          messages.push({ role: "user", content: `Extract product information from this spreadsheet data:\n\n${file.data}` });
        }

        const response = await fetch(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, system: systemPrompt, messages }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("Anthropic API error:", response.status, errText);
          errors.push(`AI error for ${file.name}: status ${response.status}`);
          continue;
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || "";
        try {
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          if (parsed.products) {
            allProducts.push(...parsed.products.map((p: any) => ({ ...p, source_file: file.name, hardware_detected: p.hardware_detected || [] })));
          }
        } catch {
          errors.push(`AI could not extract structured data from ${file.name}`);
        }
      } catch (fileErr: any) {
        console.error("Error processing file:", file.name, fileErr);
        errors.push(`Error processing ${file.name}: ${fileErr.message}`);
      }
    }

    return new Response(JSON.stringify({ products: allProducts, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("parse-product-upload error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
