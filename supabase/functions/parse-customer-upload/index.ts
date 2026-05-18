import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const systemPrompt = `You are a CRM data extraction assistant. The user uploads a CSV/XLSX of leads or customers from sources like Apollo, Waalaxy, LinkedIn exports, HubSpot, etc. Map each row to our customer schema.

Return ONLY a valid JSON object (no markdown, no backticks, no explanation):
{
  "customers": [
    {
      "name": "full name (required, never null)",
      "email": "email or null",
      "phone": "phone or null",
      "company": "company/organization or null",
      "linkedin_url": "linkedin profile URL or null",
      "source": "data source if identifiable (Apollo, Waalaxy, LinkedIn, Referral, etc.) or null",
      "lead_status": "lead | active | inactive | churned (default 'lead' if not present)",
      "notes": "any extra context worth preserving (title, location, tags) or null",
      "confidence": "high | medium | low"
    }
  ],
  "detected_columns": { "name": "Full Name", "email": "Email Address", ... }
}

RULES:
- If first/last name are separate columns, combine them into name.
- Strip surrounding whitespace from all fields.
- Email: lowercase, must look valid or be null.
- LinkedIn URL: must start with http; otherwise null.
- Skip rows where you can't determine a name (mark as low confidence with name="(missing)").
- Map common status values: 'Active'/'Customer' → active, 'Lead'/'Prospect' → lead, 'Lost'/'Churned' → churned.
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth check
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
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { file } = await req.json();
    if (!file?.data || !file?.name) {
      return new Response(JSON.stringify({ error: "No file provided" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Convert any spreadsheet/csv to CSV text for the model
    let csvText = "";
    try {
      if (file.name.match(/\.(xlsx|xls)$/i)) {
        const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
        const wb = XLSX.read(bytes, { type: "array" });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(firstSheet);
      } else {
        // CSV: file.data is base64
        csvText = atob(file.data);
      }
    } catch (e: any) {
      return new Response(JSON.stringify({ error: `Could not read file: ${e.message}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap to ~6000 chars of CSV (≈ first 100 rows). The model just needs to figure out columns.
    const truncated = csvText.length > 60000 ? csvText.slice(0, 60000) + "\n...[truncated]" : csvText;

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Parse this CSV of customers/leads and return JSON. File: ${file.name}\n\n${truncated}`,
        }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      const msg = response.status === 429 ? "Rate limited — try again shortly."
        : response.status === 402 ? "AI credits exhausted."
        : `AI error (${response.status})`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    let parsed: any = {};
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    } catch {
      return new Response(JSON.stringify({ error: "AI returned unparseable response", raw: text.slice(0, 500) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      customers: parsed.customers || [],
      detected_columns: parsed.detected_columns || {},
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("parse-customer-upload error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
