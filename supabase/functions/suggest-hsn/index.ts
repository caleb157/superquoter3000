// Manual "AI suggest" for a final product's HSN code: only runs when a user clicks the button.
// Returns up to three 8-digit Indian HSN codes with a plain-language description each.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createOpenAI } from 'npm:@ai-sdk/openai';
import { streamText, Output, NoObjectGeneratedError } from 'npm:ai';
import { z } from 'npm:zod@3';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  name: z.string().trim().min(1).max(500),
  details: z.string().trim().max(1500).optional().nullable(),
});
const Schema = z.object({
  suggestions: z.array(z.object({ code: z.string(), description: z.string(), reason: z.string(), gstRate: z.number().nullable() })),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: authErr } = await sb.auth.getClaims(auth.replace('Bearer ', ''));
    if (authErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const { data: ok } = await sb.rpc('is_admin_or_team', { _user_id: claims.claims.sub });
    if (!ok) return json({ error: 'Not allowed.' }, 403);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: 'Give the product name.' }, 400);
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) return json({ error: 'AI is not set up.' }, 500);

    // Known codes help the model stay consistent with how the company already files products.
    const { data: known } = await sb.from('hsn_codes').select('code, description').order('code');
    const knownList = (known ?? []).map(k => `${k.code} ${k.description}`).join('\n');

    const provider = createOpenAI({
      baseURL: 'https://ai.gateway.lovable.dev/v1',
      apiKey,
      headers: { 'Lovable-API-Key': apiKey, 'X-Lovable-AIG-SDK': 'vercel-ai-sdk' },
    });
    // deno-lint-ignore no-explicit-any
    const result = streamText({
      model: provider.responses('openai/gpt-6-astra'),
      system: 'You classify export products from India under the Indian Customs Tariff / GST HSN (ITC-HS) schedule. Always answer with full 8-digit codes. Give up to 3 candidates, best first. description = the official tariff line in plain English; reason = one short sentence why it fits. gstRate = the current GST rate in percent for that code under the GST 2.0 rate structure (Sept 2025 onwards), or null if unsure.',
      messages: [{
        role: 'user',
        content: `Product: ${parsed.data.name}\n${parsed.data.details ? `Details: ${parsed.data.details}\n` : ''}\nCodes this company already uses (prefer one if it truly fits):\n${knownList}`,
      }],
      output: Output.object({ schema: Schema }),
      experimental_output: Output.object({ schema: Schema }),
      abortSignal: req.signal,
      providerOptions: { openai: { store: false, forceReasoning: true, reasoningEffort: 'low', reasoningSummary: 'auto', include: ['reasoning.encrypted_content'] } },
    });
    let out: z.infer<typeof Schema>;
    try {
      // deno-lint-ignore no-explicit-any
      const r = result as any;
      out = await (r.output ?? r.experimental_output);
      if (!out) { const t = await result.text; out = JSON.parse(t); }
    } catch (e) {
      if (NoObjectGeneratedError.isInstance(e)) return json({ error: 'AI gave no usable answer. Try again.' }, 502);
      throw e;
    }
    const suggestions = (out?.suggestions ?? [])
      .map(s => ({ ...s, code: String(s.code).replace(/\D/g, '') }))
      .filter(s => /^\d{8}$/.test(s.code))
      .slice(0, 3);
    return json({ suggestions });
  } catch (e) {
    const err = e as { statusCode?: number; message?: string };
    const status = err?.statusCode ?? 500;
    const msg = status === 402 ? 'Out of AI credits. Add credits in Settings → Plans & credits.'
      : status === 429 ? 'AI is busy. Wait a moment and try again.'
      : err?.message || 'AI suggestion failed.';
    return json({ error: msg }, status >= 400 && status < 600 ? status : 500);
  }
});
