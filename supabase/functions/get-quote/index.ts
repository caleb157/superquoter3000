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
    // Fetch quote snapshot by share_token
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

    // Fetch entity details if entity_id exists
    let entity = null;
    if (snapshot.entity_id) {
      const { data } = await supabase
        .from("company_entities")
        .select("name, legal_name, entity_type, logo_url, address_line1, city, state, postal_code, country, phone, email, website, bank_name, bank_branch, account_name, account_number, routing_number, ifsc_code, swift_code")
        .eq("id", snapshot.entity_id)
        .single();
      entity = data;
    }

    // Fetch project info
    let project = null;
    if (snapshot.project_id) {
      const { data } = await supabase
        .from("projects")
        .select("name, customer_name, customer_email")
        .eq("id", snapshot.project_id)
        .single();
      project = data;

      // Fetch product variants for each product
      const { data: products } = await supabase
        .from("products")
        .select("id, name, sku, photo_url, width_inch, depth_inch, height_inch, weight_kg, moq, quantity")
        .eq("project_id", snapshot.project_id);

      if (products && products.length > 0) {
        const productIds = products.map((p: any) => p.id);
        const { data: variants } = await supabase
          .from("product_variants")
          .select("id, product_id, variant_name, photo_url, wood_price_factor")
          .in("product_id", productIds);

        // Attach variants to snapshot products
        const snapshotProducts = (snapshot.products as any[]) || [];
        for (const sp of snapshotProducts) {
          const dbProduct = products.find((p: any) => p.name === sp.name || p.sku === sp.sku);
          if (dbProduct) {
            sp.product_id = dbProduct.id;
            sp.photo_url = dbProduct.photo_url;
            sp.moq = dbProduct.moq;
            sp.width_inch = dbProduct.width_inch;
            sp.depth_inch = dbProduct.depth_inch;
            sp.height_inch = dbProduct.height_inch;
            sp.weight_kg = dbProduct.weight_kg;
            sp.variants = (variants || []).filter((v: any) => v.product_id === dbProduct.id);
          }
        }
        snapshot.products = snapshotProducts;
      }
    }

    // Mark as viewed
    if (!snapshot.viewed_at) {
      await supabase
        .from("quote_snapshots")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", snapshot.id);
    }

    return new Response(JSON.stringify({ snapshot, entity, project }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    // Save customer selections
    const body = await req.json();
    const { customer_selections, customer_name, customer_email, confirmed } = body;

    const updateData: any = { customer_selections };
    if (confirmed) {
      updateData.status = "approved";
      updateData.approved_at = new Date().toISOString();
      updateData.approved_by = customer_name || customer_email || "Customer";
    }

    const { error } = await supabase
      .from("quote_snapshots")
      .update(updateData)
      .eq("share_token", token);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
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
