const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
      "finishing_difficulty": "Very Easy, Easy, Medium, Hard, or Very Hard — guess based on complexity of the piece, number of surfaces, curves, carvings, etc.",
      "percent_wood": number between 0 and 1 — estimate what fraction of the piece is wood vs iron/marble/glass/fabric,
      "is_component": false unless the image clearly shows a component piece (like just a table top or just a base, not a complete product),
      "hardware_detected": [
        {
          "item": "name of hardware item",
          "quantity_per_product": number,
          "notes": "size or spec if visible"
        }
      ],
      "construction_notes": "observations about how the piece is built — joinery, number of panels, shelves, legs, stretchers, doors, etc.",
      "notes": "any other details: finish type, color, special features, carvings, upholstery",
      "confidence": "high" or "medium" or "low"
    }
  ]
}

HARDWARE DETECTION — Look carefully for and estimate:
- **Drawers:** Count drawers visible. Each drawer needs 1 pair of drawer slides. Estimate slide length from drawer depth: small drawers (<14") use 14" slides, medium (14-18") use 16" slides, large (>18") use 18" or 20" slides.
- **Doors/Cabinets:** Count doors. Each door needs 1 pair of hinges.
- **Pulls/Knobs:** Count visible handles, pulls, or knobs on drawers and doors.
- **Shelves:** Count visible or likely shelves. Each adjustable shelf needs 4 shelf pins.
- **Legs:** If the piece has legs that sit on a floor, estimate rubber leg caps needed (typically 4).
- **Grommets:** If it's a desk or table with cable management holes, note grommets.
- **Wall mounting:** If the piece looks like it would be wall-mounted (shelves, hanging cabinets), note a wall mounting kit.

Even if you can't see the hardware directly, INFER what would be needed based on the type of furniture:
- A nightstand with 2 drawers → 2 pairs drawer slides, 2 pulls, 4 rubber leg caps
- A cabinet with 2 doors and 1 shelf → 2 pairs hinges, 2 pulls, 4 shelf pins, 4 rubber leg caps
- A wall shelf → wall mounting kit
- A desk with a grommet hole → 1 grommet

COMPONENTS: If the product has distinct shippable parts (e.g., a table with a detachable top and base), identify them as components and note that the product may ship in multiple cartons.

DIMENSIONS: If dimensions are in cm, convert to inches (÷ 2.54). If in mm, convert to inches (÷ 25.4).
For furniture: width = side-to-side, depth = front-to-back, height = floor-to-top.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
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
    const errors: string[] = [];

    for (const file of files) {
      try {
        let userContent: string;

        if (file.type?.startsWith("image/")) {
          // Send image as a data URL in the prompt
          const dataUrl = `data:${file.type};base64,${file.data}`;
          userContent = `Analyze this product image and extract product information. The image is provided as a data URL: ${dataUrl}\n\nLook for dimensions, product names, SKUs, materials. Analyze the product to determine what hardware it would need (drawer slides, hinges, pulls, knobs, foot pads, etc.). Estimate finishing difficulty and percent wood.`;
        } else if (file.type === "application/pdf") {
          // For PDFs, we receive page images from the client
          // If it's still raw PDF data, treat as text extraction
          userContent = `Extract all product information from this document content. It may be a spec sheet, catalog, customer RFQ, or price list.\n\nContent:\n${file.data.substring(0, 30000)}\n\nDetermine what hardware each product would need. Estimate finishing difficulty and percent wood.`;
        } else {
          // Spreadsheet data sent as text
          userContent = `Extract product information from this spreadsheet data:\n\n${file.data}\n\nParse each row as a product if it appears to contain product data. Ignore header rows, summary rows, and empty rows. Determine what hardware each product would need based on its type and description. Estimate finishing difficulty and percent wood.`;
        }

        // For image files, use vision-capable model
        const messages: any[] = [];
        
        if (file.type?.startsWith("image/")) {
          messages.push({
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${file.type};base64,${file.data}` },
              },
              {
                type: "text",
                text: "Extract product information from this image. Look for dimensions, product names, SKUs, materials. Analyze the product to determine what hardware it would need (drawer slides, hinges, pulls, knobs, foot pads, etc.). Estimate finishing difficulty and percent wood.",
              },
            ],
          });
        } else if (file.pages && Array.isArray(file.pages) && file.pages.length > 0) {
          // Multi-page PDF sent as page images
          const content: any[] = [];
          for (const page of file.pages) {
            content.push({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${page.data}` },
            });
          }
          content.push({
            type: "text",
            text: `Extract all product information from these ${file.pages.length} page images of a PDF document (${file.name}). It may be a spec sheet, catalog, customer RFQ, or price list. Determine what hardware each product would need. Estimate finishing difficulty and percent wood.`,
          });
          messages.push({ role: "user", content });
        } else {
          messages.push({ role: "user", content: userContent });
        }

        const response = await fetch(AI_GATEWAY_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: systemPrompt },
              ...messages,
            ],
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("AI gateway error:", response.status, errText);
          
          if (response.status === 429) {
            errors.push(`Rate limited while parsing ${file.name}. Please try again later.`);
          } else if (response.status === 402) {
            errors.push(`Credits exhausted while parsing ${file.name}. Please add funds.`);
          } else {
            errors.push(`AI error for ${file.name}: status ${response.status}`);
          }
          
          allProducts.push({
            name: `Error parsing ${file.name}`,
            notes: `AI API returned status ${response.status}. Please enter product details manually.`,
            confidence: "low",
            source_file: file.name,
            hardware_detected: [],
          });
          continue;
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "";

        try {
          const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
          if (parsed.products) {
            allProducts.push(...parsed.products.map((p: any) => ({
              ...p,
              source_file: file.name,
              // Normalize hardware field name
              hardware_detected: p.hardware_detected || p.hardware_guess || [],
            })));
          }
        } catch {
          allProducts.push({
            name: `Unparsed from ${file.name}`,
            notes: "AI could not extract structured data from this file. Please enter product details manually.",
            confidence: "low",
            source_file: file.name,
            hardware_detected: [],
          });
        }
      } catch (fileErr: any) {
        console.error("Error processing file:", file.name, fileErr);
        errors.push(`Error processing ${file.name}: ${fileErr.message}`);
        allProducts.push({
          name: `Error: ${file.name}`,
          notes: fileErr.message || "Unknown error processing file",
          confidence: "low",
          source_file: file.name,
          hardware_detected: [],
        });
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
