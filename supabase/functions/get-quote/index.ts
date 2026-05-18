import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (req.method === "GET") {
    const { data: snapshot, error } = await supabase
      .from("quote_snapshots")
      .select("*")
      .eq("share_token", token)
      .single();

    if (error || !snapshot) {
      return new Response(JSON.stringify({ error: "Quote not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prefer frozen snapshot data. Fall back to live entity lookup for legacy quotes.
    let entity = (snapshot as any).entity ?? null;
    let customer = (snapshot as any).customer ?? null;
    let inquiry = (snapshot as any).inquiry ?? null;

    if (!entity && snapshot.entity_id) {
      const { data } = await supabase
        .from("company_entities")
        .select("id, name, legal_name, entity_type, logo_url, address_line1, address_line2, city, state, postal_code, country, phone, email, website, bank_name, bank_branch, account_name, account_number, routing_number, ifsc_code, swift_code, gst_number, ein_number")
        .eq("id", snapshot.entity_id)
        .maybeSingle();
      entity = data;
    }

    // Legacy quotes: try to derive customer + inquiry from customer_rfq_id if missing.
    if (!customer && snapshot.customer_rfq_id) {
      const { data: inqRow } = await supabase
        .from("customer_rfqs")
        .select("id, rfq_number, title, customers(id, name, company, email, logo_url)")
        .eq("id", snapshot.customer_rfq_id)
        .maybeSingle();
      if (inqRow) {
        if (!inquiry) inquiry = { id: inqRow.id, rfq_number: inqRow.rfq_number, title: inqRow.title };
        const c: any = (inqRow as any).customers;
        if (c) customer = { id: c.id, name: c.name, company: c.company, email: c.email, logo_url: c.logo_url };
      }
    }

    // Mark as viewed (don't await to keep response fast).
    if (!snapshot.viewed_at) {
      supabase
        .from("quote_snapshots")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", snapshot.id)
        .then(() => {});
    }

    return new Response(JSON.stringify({ snapshot, entity, customer, inquiry }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    const contentLength = Number(req.headers.get("content-length") || "0");
    if (contentLength > 64 * 1024) {
      return new Response(JSON.stringify({ error: "Payload too large" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: any;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { customer_selections, customer_name, customer_email, confirmed } = body || {};

    const nameStr = typeof customer_name === "string" ? customer_name.trim().slice(0, 200) : "";
    const emailStr = typeof customer_email === "string" ? customer_email.trim().slice(0, 200) : "";
    if (emailStr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (customer_selections !== undefined && customer_selections !== null) {
      if (typeof customer_selections !== "object" || Array.isArray(customer_selections)) {
        return new Response(JSON.stringify({ error: "Invalid selections" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const products = (customer_selections as any).products;
      if (products !== undefined && (!Array.isArray(products) || products.length > 500)) {
        return new Response(JSON.stringify({ error: "Invalid selections" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const updateData: any = { customer_selections };
    if (confirmed) {
      updateData.status = "approved";
      updateData.approved_at = new Date().toISOString();
      updateData.approved_by = nameStr || emailStr || "Customer";
    }

    const { error } = await supabase
      .from("quote_snapshots")
      .update(updateData)
      .eq("share_token", token);

    if (error) {
      console.error("quote update error:", error.message);
      return new Response(JSON.stringify({ error: "Failed to save selection. Please try again." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
