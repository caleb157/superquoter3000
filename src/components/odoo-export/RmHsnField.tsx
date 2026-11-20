// Optional 6-digit HSN for a new raw material. Suggestions come from Odoo's own raw materials
// with similar names (their HSN cut to 6 digits); AI runs only on a click (suggest-hsn, 6 digits).
import { useEffect, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { matchHsn, type HsnCode } from '@/lib/hsn-match';
import { odooRmHsn } from '@/lib/odoo-products';
import { rmHsn } from '@/lib/odoo-bom';

let listCache: Promise<HsnCode[]> | null = null;
const rmList = () => (listCache ||= odooRmHsn()
  .then(rows => rows.map(r => ({ code: r.code, description: r.examples.slice(0, 2).join(', '), keywords: [], examples: r.examples })))
  .catch(() => { listCache = null; return []; }));

export function RmHsnField({ value, name, category, onChange }: { value: string; name: string; category: string; onChange: (v: string) => void }) {
  const [list, setList] = useState<HsnCode[]>([]);
  const [ai, setAi] = useState<{ loading?: boolean; error?: string; items?: { code: string; description: string; reason: string }[] }>({});
  useEffect(() => { let live = true; rmList().then(l => { if (live) setList(l); }); return () => { live = false; }; }, []);
  const matches = matchHsn(name, list).filter(m => m.code !== value);
  const bad = value !== '' && value.length !== 6;
  const askAi = async () => {
    setAi({ loading: true });
    const { data, error } = await supabase.functions.invoke('suggest-hsn', { body: { name, details: category ? `Raw material, ${category}` : 'Raw material', digits: 6 } });
    if (error) {
      let msg = error.message;
      if (error instanceof FunctionsHttpError) { try { msg = (await error.context.json())?.error || msg; } catch { /* keep */ } }
      setAi({ error: msg }); return;
    }
    const items = (data?.suggestions ?? []) as { code: string; description: string; reason: string }[];
    setAi(items.length ? { items } : { error: 'No suggestion.' });
  };
  return (
    <div className="space-y-1">
      <Input className={`h-8 text-xs font-mono ${bad ? 'border-destructive' : ''}`} placeholder="HSN (6 digits, optional)" inputMode="numeric"
        value={value} onChange={e => onChange(rmHsn(e.target.value))} />
      {bad && <div className="text-[10px] text-destructive">HSN needs 6 digits.</div>}
      <div className="flex flex-wrap items-center gap-1 text-[10px]">
        {matches.map(m => (
          <button key={m.code} type="button" title={m.description} onClick={() => onChange(m.code)} className="rounded-full border px-1.5 py-0.5 font-mono hover:bg-accent">{m.code}</button>
        ))}
        <Button type="button" variant="ghost" size="sm" className="h-5 px-1.5 gap-1 text-[10px]" disabled={ai.loading || !name.trim()} onClick={askAi}>
          {ai.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} AI
        </Button>
        {ai.error && <span className="text-destructive">{ai.error}</span>}
        {ai.items?.map(m => (
          <button key={m.code} type="button" title={`${m.description} - ${m.reason}`} onClick={() => onChange(m.code)} className="rounded-full border border-primary/40 px-1.5 py-0.5 font-mono hover:bg-accent">{m.code}</button>
        ))}
      </div>
    </div>
  );
}
