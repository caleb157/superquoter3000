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

HARDWARE DETECTION — Look carefully for and estimate:
- **Drawers:** Count drawers visible. Each drawer needs 1 pair of drawer slides.
- **Doors/Cabinets:** Count doors. Each door needs 1 pair of hinges.
- **Pulls/Knobs:** Count visible handles, pulls, or knobs on drawers and doors.
- **Shelves:** Count visible or likely shelves. Each adjustable shelf needs 4 shelf pins.
- **Legs:** If the piece has legs that sit on a floor, estimate rubber leg caps needed (typically 4).
- **Grommets:** If it's a desk or table with cable management holes, note grommets.
- **Wall mounting:** If the piece looks like it would be wall-mounted, note a wall mounting kit.

Even if you can't see the hardware directly, INFER what would be needed based on the type of furniture.

COMPONENTS: If the product has distinct shippable parts, identify them as components.

DIMENSIONS: If dimensions are in cm, convert to inches (÷ 2.54). If in mm, convert to inches (÷ 25.4).
For furniture: width = side-to-side, depth = front-to-back, height = floor-to-top.`;

function parseDktIntake(workbook: XLSX.WorkBook, fileName: string): any[] {
  const skuSheet = workbook.Sheets["SKU_Data"];
  if (!skuSheet) return [];

  const skuRows: any[][] = XLSX.utils.sheet_to_json(skuSheet, { header: 1, defval: null });

  // Build COGS lookup from COGS_Detail sheet
  const cogsMap: Record<string, any[]> = {};
  if (workbook.SheetNames.includes("COGS_Detail")) {
    const cogsRows: any[][] = XLSX.utils.sheet_to_json(workbook.Sheets["COGS_Detail"], { header: 1, defval: null });
    for (const row of cogsRows.slice(2)) {
      const skuName = row[0];
      if (!skuName || !row[2]) continue;
      if (!cogsMap[skuName]) cogsMap[skuName] = [];
      cogsMap[skuName].push({
        cogs_type: row[2],
        component_name: row[3] ?? (row[2] === "Raw Piece" ? "Raw Piece" : null),
        include: row[4] ?? "Yes",
        units: row[5],
        components_per_product: row[6] ?? 0,
        unit_cost_inr: row[7] ?? 0,
        waste_factor: row[8] ?? 0,
      });
    }
  }

  // Parse SKU rows — skip first 2 header rows
  const products: any[] = [];
  for (const row of skuRows.slice(2)) {
    const name = row[1];
    // Skip group headers: name missing or all data cols (B–T i.e. indices 2–19) empty
    if (!name || (!row[2] && !row[3] && !row[4])) continue;

    const num = (v: any) => (v !== null && v !== undefined && v !== "" && !isNaN(Number(v))) ? Number(v) : null;

    products.push({
      name,
      sku: null,
      width_inch: num(row[3]),
      depth_inch: num(row[4]),
      height_inch: num(row[5]),
      weight_kg: num(row[6]),
      quantity: num(row[2]),
      product_type: row[7] ?? null,
      finishing_difficulty: row[8] ?? "Medium",
      percent_wood: num(row[9]) ?? 1,
      target_price_usd: num(row[10]),
      is_component: row[17] === "component",
      sourced_externally: row[18] === "Yes" || row[18] === true,
      notes: row[19] ?? null,
      hardware_detected: [],
      cogs_rows: cogsMap[name] || [],
      confidence: "high",
      source_file: fileName,
      ic_type: row[11] ?? null,
      products_per_ic: num(row[12]),
      ic_width: num(row[13]),
      ic_depth: num(row[14]),
      ic_height: num(row[15]),
      include_mc: row[16] === "Yes" || row[16] === true,
    });
  }

  return products;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { files } = await req.json();
    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(JSON.stringify({ error: "No files provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allProducts: any[] = [];
    const errors: string[] = [];

    for (const file of files) {
      try {
        // Try structured DKT intake parse first for Excel files
        if (file.name?.toLowerCase().endsWith(".xlsx") || file.name?.toLowerCase().endsWith(".xls")) {
          try {
            const binaryData = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
            const workbook = XLSX.read(binaryData, { type: "array" });

            if (workbook.SheetNames.includes("SKU_Data")) {
              const parsed = parseDktIntake(workbook, file.name);
              if (parsed.length > 0) {
                allProducts.push(...parsed);
                continue; // skip AI call for this file
              }
            }
          } catch (xlsxErr: any) {
            console.error("XLSX structured parse failed, falling back to AI:", xlsxErr.message);
          }
        }

        // --- AI parsing fallback ---
        if (!ANTHROPIC_API_KEY) {
          return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const messages: any[] = [];

        if (file.type?.startsWith("image/")) {
          messages.push({
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: file.type, data: file.data } },
              { type: "text", text: "Extract product information from this image. Look for dimensions, product names, SKUs, materials. Analyze the product to determine what hardware it would need. Estimate finishing difficulty and percent wood." },
            ],
          });
        } else if (file.pages && Array.isArray(file.pages) && file.pages.length > 0) {
          const content: any[] = [];
          for (const page of file.pages) {
            content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: page.data } });
          }
          content.push({ type: "text", text: `Extract all product information from these ${file.pages.length} page images of a PDF document (${file.name}).` });
          messages.push({ role: "user", content });
        } else if (file.type === "application/pdf") {
          messages.push({
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } },
              { type: "text", text: `Extract all product information from this PDF document (${file.name}).` },
            ],
          });
        } else {
          messages.push({ role: "user", content: `Extract product information from this spreadsheet data:\n\n${file.data}\n\nParse each row as a product if it appears to contain product data.` });
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
          errors.push(response.status === 429
            ? `Rate limited while parsing ${file.name}. Please try again later.`
            : response.status === 402
            ? `Credits exhausted while parsing ${file.name}. Please add funds.`
            : `AI error for ${file.name}: status ${response.status}`);
          allProducts.push({ name: `Error parsing ${file.name}`, notes: `API status ${response.status}`, confidence: "low", source_file: file.name, hardware_detected: [] });
          continue;
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || "";
        try {
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          if (parsed.products) {
            allProducts.push(...parsed.products.map((p: any) => ({ ...p, source_file: file.name, hardware_detected: p.hardware_detected || p.hardware_guess || [] })));
          }
        } catch {
          allProducts.push({ name: `Unparsed from ${file.name}`, notes: "AI could not extract structured data.", confidence: "low", source_file: file.name, hardware_detected: [] });
        }
      } catch (fileErr: any) {
        console.error("Error processing file:", file.name, fileErr);
        errors.push(`Error processing ${file.name}: ${fileErr.message}`);
        allProducts.push({ name: `Error: ${file.name}`, notes: fileErr.message, confidence: "low", source_file: file.name, hardware_detected: [] });
      }
    }

    return new Response(JSON.stringify({ products: allProducts, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("parse-product-upload error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
