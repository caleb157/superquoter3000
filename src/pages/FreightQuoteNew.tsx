import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { FqHeader } from '@/components/freight-quotes/FqHeader';
import { QuoteEditor, SourceViewer, type EditableQuote } from '@/components/freight-quotes/QuoteEditor';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Sparkles, X } from 'lucide-react';
import { fxSnapshotFor } from '@/lib/freight-quotes/calculations';
import { findDuplicate, loadRefs, type FqLine } from '@/lib/freight-quotes/data';
import { saveEditable, resolveRefs } from '@/lib/freight-quotes/editable';
import { useDocumentTitle } from '@/hooks/use-document-title';

type Refs = Awaited<ReturnType<typeof loadRefs>>;

export default function FreightQuoteNew() {
  useDocumentTitle('New freight quote');
  const nav = useNavigate();
  const [refs, setRefs] = useState<Refs | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<EditableQuote[]>([]);
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadRefs().then(setRefs); }, []);

  const extract = async () => {
    if (!text.trim() && !file) return toast.error('Paste text or choose a file');
    setBusy(true);
    try {
      let file_path: string | null = null;
      if (file) {
        const safe = file.name.replace(/[^\w.\-]+/g, '_');
        file_path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;
        const { error } = await supabase.storage.from('fq-documents').upload(file_path, file);
        if (error) throw error;
      }
      const { data, error } = await supabase.functions.invoke('parse-freight-quote', {
        body: { text, file_path, keywords: refs?.settings?.keyword_map || [] },
      });
      if (error) {
        const msg = (await (error as any).context?.json?.().catch(() => null))?.error || error.message;
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      const quotes: any[] = data?.quotes || [];
      if (!quotes.length) throw new Error('No quotes found in the source');
      const wmDefault = Number(refs?.settings?.default_wm_kg_per_cbm) || 1000;
      setDrafts(quotes.map(x => {
        const lines: FqLine[] = (x.lines || []).map((l: any, i: number) => ({
          sort_order: i, raw_label: l.raw_label || '', normalized_name: l.normalized_name || '', bucket: l.bucket || 'OTHER',
          charge_basis: l.charge_basis || 'flat', rate: l.rate ?? null, currency: (l.currency || 'USD').toUpperCase(),
          minimum_amount: l.minimum_amount ?? null, quantity_override: null, applicable: l.applicable !== false,
          applicable_reason: l.applicable_reason || null, is_optional: !!l.is_optional, optional_included: true,
          user_estimate: null, confidence: l.confidence, notes: l.notes,
        }));
        const fx = fxSnapshotFor(refs?.fx || [], x.quote_date);
        lines.forEach(l => { if (!(l.currency in fx)) fx[l.currency] = NaN as any; });
        Object.keys(fx).forEach(k => { if (isNaN(fx[k])) delete fx[k]; });
        return {
          vendor_id: null, customer_id: null, product_id: null, vendor_name: x.vendor_name,
          quote_date: x.quote_date || new Date().toISOString().slice(0, 10), valid_until: x.valid_until, reference_no: x.reference_no,
          direction: x.direction || 'export', origin_city: x.origin_city, origin_port: x.origin_port,
          destination_city: x.destination_city, destination_port: x.destination_port, destination_country: x.destination_country,
          mode: x.mode || 'LCL', container_size: x.container_size, cbm: x.cbm, gross_weight_kg: x.gross_weight_kg,
          pallet_count: x.pallet_count, wm_kg_per_cbm: x.wm_kg_per_cbm || wmDefault,
          declared_invoice_value_usd: null, duty_estimate_usd: null, insurance_usd: null,
          fx_snapshot: fx, status: 'received', notes: null, source_file_path: file_path, raw_text: text || null,
          lines, field_confidence: x.field_confidence,
        } as EditableQuote;
      }));
      setActive(0);
      toast.success(`Extracted ${quotes.length} quote${quotes.length > 1 ? 's' : ''} — review before saving`);
    } catch (e: any) {
      toast.error(e.message || 'Extraction failed');
    } finally { setBusy(false); }
  };

  const save = async () => {
    const d = drafts[active];
    setSaving(true);
    try {
      const dup = await findDuplicate(await resolveRefs(d));
      if (dup && !confirm('A quote with the same vendor, lane, date and CBM already exists. Save anyway?')) { setSaving(false); return; }
      const id = await saveEditable(d);
      toast.success('Quote saved');
      const rest = drafts.filter((_, i) => i !== active);
      if (rest.length) { setDrafts(rest); setActive(0); setRefs(await loadRefs()); }
      else nav(`/freight-quotes/${id}`);
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const d = drafts[active];

  return (
    <AppLayout>
      <div className="p-3 md:p-4 max-w-[1600px] mx-auto">
        <FqHeader title={drafts.length ? 'Review extracted quote' : 'New freight quote'}
          actions={drafts.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDrafts([])}>Discard</Button>
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : drafts.length > 1 ? `Save this quote (${active + 1}/${drafts.length})` : 'Save quote'}</Button>
            </>
          )} />

        {!drafts.length && (
          <Card><CardContent className="p-4 space-y-3">
            <Textarea className="min-h-[220px] text-xs font-mono" placeholder="Paste the forwarder's email or quote text here…" value={text} onChange={e => setText(e.target.value)} />
            <div className="flex items-center gap-2 flex-wrap">
              <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.eml,.txt" className="max-w-sm h-8 text-xs" onChange={e => setFile(e.target.files?.[0] || null)} />
              {file && <Button variant="ghost" size="sm" onClick={() => setFile(null)}><X className="h-3 w-3" /></Button>}
              <Button onClick={extract} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}Extract</Button>
              <Button variant="outline" onClick={() => {
                const fx = fxSnapshotFor(refs?.fx || []);
                setDrafts([{ vendor_id: null, customer_id: null, product_id: null, quote_date: new Date().toISOString().slice(0, 10), valid_until: null, reference_no: null, direction: 'export', origin_city: null, origin_port: null, destination_city: null, destination_port: null, destination_country: null, mode: 'LCL', container_size: null, cbm: null, gross_weight_kg: null, pallet_count: null, wm_kg_per_cbm: Number(refs?.settings?.default_wm_kg_per_cbm) || 1000, declared_invoice_value_usd: null, duty_estimate_usd: null, insurance_usd: null, fx_snapshot: fx, status: 'received', notes: null, source_file_path: null, raw_text: text || null, lines: [] }]);
              }}>Enter manually</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">The AI only reads the quote. All totals are calculated by the app, and nothing is saved until you review and press Save.</p>
          </CardContent></Card>
        )}

        {d && refs && (
          <>
            {drafts.length > 1 && (
              <div className="flex gap-1 mb-2">{drafts.map((x, i) => (
                <Button key={i} size="sm" variant={i === active ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setActive(i)}>{x.vendor_name || `Quote ${i + 1}`} · {x.mode}</Button>
              ))}</div>
            )}
            <div className="grid lg:grid-cols-[minmax(280px,2fr)_5fr] gap-3">
              <div className="lg:sticky lg:top-2 self-start"><SourceViewer path={d.source_file_path} text={d.raw_text} /></div>
              <QuoteEditor value={d} refs={refs} onChange={nq => setDrafts(drafts.map((x, i) => (i === active ? nq : x)))} />
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
