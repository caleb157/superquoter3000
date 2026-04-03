import { corsHeaders } from "@supabase/supabase-js/cors";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { files } = await req.json();
    if (!files || !Array.isArray(files) || files.length === 0) {
      return new Response(JSON.stringify({ error: "No files provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allProducts: any[] = [];

    const systemPrompt = `You are a product data extraction assistant for a furniture import company based in India that exports to the US. Analyze the provided content and extract product information.

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
      "notes": "any other details: finish type, number of drawers/shelves, hardware, special features",
      "confidence": "high" or "medium" or "low"
    }
  ]
}

Rules:
- If dimensions are in centimeters, convert to inches (divide by 2.54)
- If dimensions are in millimeters, convert to inches (divide by 25.4)
- If you see multiple products, return all of them
- If no dimensions are visible, leave as null
- Guess the product_type based on visual appearance or description
- For furniture: width = side-to-side, depth = front-to-back, height = floor-to-top`;

    for (const file of files) {
      try {
        let messages: any[];

        if (file.type?.startsWith("image/")) {
          messages = [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: file.type, data: file.data },
              },
              {
                type: "text",
                text: "Extract product information from this image. Look for dimensions, product names, SKUs, materials, and any other relevant details.",
              },
            ],
          }];
        } else if (file.type === "application/pdf") {
          messages = [{
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: file.data },
              },
              {
                type: "text",
                text: "Extract all product information from this PDF. It may be a spec sheet, catalog, customer RFQ, or price list.",
              },
            ],
          }];
        } else {
          // Spreadsheet data sent as text
          messages = [{
            role: "user",
            content: `Extract product information from this spreadsheet data:\n\n${file.data}\n\nParse each row as a product if it appears to contain product data. Ignore header rows, summary rows, and empty rows.`,
          }];
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: systemPrompt,
            messages,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("Anthropic API error:", response.status, errText);
          allProducts.push({
            name: `Error parsing ${file.name}`,
            notes: `AI API returned status ${response.status}. Please enter product details manually.`,
            confidence: "low",
            source_file: file.name,
          });
          continue;
        }

        const data = await response.json();
        const text = data.content?.[0]?.text || "";

        try {
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          if (parsed.products) {
            allProducts.push(...parsed.products.map((p: any) => ({ ...p, source_file: file.name })));
          }
        } catch {
          allProducts.push({
            name: `Unparsed from ${file.name}`,
            notes: "AI could not extract structured data from this file. Please enter product details manually.",
            confidence: "low",
            source_file: file.name,
          });
        }
      } catch (fileErr: any) {
        console.error("Error processing file:", file.name, fileErr);
        allProducts.push({
          name: `Error: ${file.name}`,
          notes: fileErr.message || "Unknown error processing file",
          confidence: "low",
          source_file: file.name,
        });
      }
    }

    return new Response(JSON.stringify({ products: allProducts }), {
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
