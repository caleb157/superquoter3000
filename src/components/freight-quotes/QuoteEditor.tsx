import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { BASES, BUCKETS, BUCKET_LABEL, computeQuote, type Bucket } from '@/lib/freight-quotes/calculations';
import { blankLine, money, usd, type FqLine, type FqQuote, type FqRef } from '@/lib/freight-quotes/data';

export type EditableQuote = FqQuote & { vendor_name?: string | null; customer_name?: string | null; product_name?: string | null };

const LOW = 0.7;
const numOrNull = (v: string) => (v === '' ? null : Number(v));

export function SourceViewer({ path, text }: { path: string | null; text: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null); setFileText(null);
    if (!path) return;
    supabase.storage.from('fq-documents').createSignedUrl(path, 3600).then(async ({ data }) => {
      if (!data?.signedUrl) return;
      if (/\.(txt|eml)$/i.test(path)) setFileText(await (await fetch(data.signedUrl)).text());
      else setUrl(data.signedUrl);
    });
  }, [path]);
  return (
    <div className="space-y-2 h-full">
      {path && url && /\.pdf$/i.test(path) && <iframe src={url} className="w-full h-[70vh] rounded border" title="Source PDF" />}
      {path && url && /\.(png|jpe?g|webp|gif)$/i.test(path) && <img src={url} alt="Source quote" className="w-full rounded border" />}
      {fileText && <pre className="text-[11px] whitespace-pre-wrap bg-muted/40 p-2 rounded border max-h-[50vh] overflow-auto">{fileText}</pre>}
      {text && <pre className="text-[11px] whitespace-pre-wrap bg-muted/40 p-2 rounded border max-h-[60vh] overflow-auto">{text}</pre>}
      {!path && !text && <p className="text-xs text-muted-foreground">No source document.</p>}
    </div>
  );
}

function Field({ label, children, low }: { label: string; children: React.ReactNode; low?: boolean }) {
  return (
    <div className={cn('space-y-0.5', low && 'rounded ring-2 ring-warning/60 p-0.5')}>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}{low && ' · check'}</Label>
      {children}
    </div>
  );
}

export function QuoteEditor({ value, onChange, refs }: {
  value: EditableQuote; onChange: (q: EditableQuote) => void;
  refs: { vendors: FqRef[]; customers: FqRef[]; products: FqRef[] };
}) {
  const q = value;
  const set = (patch: Partial<EditableQuote>) => onChange({ ...q, ...patch });
  const setLine = (i: number, patch: Partial<FqLine>) => set({ lines: q.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const t = useMemo(() => computeQuote(q, q.lines), [q]);
  const fc = q.field_confidence || {};
  const low = (k: string) => fc[k] != null && fc[k] < LOW;
  const inp = 'h-7 text-xs';
  const txt = (k: keyof EditableQuote) => ({ className: inp, value: (q[k] as any) ?? '', onChange: (e: any) => set({ [k]: e.target.value || null } as any) });
  const nm = (k: keyof EditableQuote) => ({ className: inp + ' font-mono text-right', type: 'number', value: (q[k] as any) ?? '', onChange: (e: any) => set({ [k]: numOrNull(e.target.value) } as any) });
  const currencies = Object.keys(q.fx_snapshot || {});

  const grouped = BUCKETS.map(b => ({ b, rows: q.lines.map((l, i) => ({ l, i })).filter(({ l }) => (BUCKETS.includes(l.bucket as Bucket) ? l.bucket : 'OTHER') === b) }));

  return (
    <div className="space-y-3">
      <datalist id="fq-vendors">{refs.vendors.map(v => <option key={v.id} value={v.name} />)}</datalist>
      <datalist id="fq-customers">{refs.customers.map(v => <option key={v.id} value={v.name} />)}</datalist>
      <datalist id="fq-products">{refs.products.map(v => <option key={v.id} value={v.name} />)}</datalist>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="Vendor" low={low('vendor_name')}><Input list="fq-vendors" {...txt('vendor_name')} /></Field>
        <Field label="Customer"><Input list="fq-customers" {...txt('customer_name')} /></Field>
        <Field label="Product"><Input list="fq-products" {...txt('product_name')} /></Field>
        <Field label="Status">
          <Select value={q.status} onValueChange={v => set({ status: v })}>
            <SelectTrigger className={inp}><SelectValue /></SelectTrigger>
            <SelectContent>{['received', 'accepted', 'rejected', 'expired'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label="Quote date" low={low('quote_date')}><Input type="date" {...txt('quote_date')} /></Field>
        <Field label="Valid until"><Input type="date" {...txt('valid_until')} /></Field>
        <Field label="Reference #"><Input {...txt('reference_no')} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Direction">
            <Select value={q.direction} onValueChange={v => set({ direction: v })}>
              <SelectTrigger className={inp}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="export">export</SelectItem><SelectItem value="import">import</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Mode" low={low('mode')}>
            <Select value={q.mode} onValueChange={v => set({ mode: v })}>
              <SelectTrigger className={inp}><SelectValue /></SelectTrigger>
              <SelectContent>{['LCL', 'FCL', 'air'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Origin city" low={low('lane')}><Input {...txt('origin_city')} /></Field>
        <Field label="Origin port" low={low('lane')}><Input {...txt('origin_port')} /></Field>
        <Field label="Dest. city / port" low={low('lane')}>
          <div className="flex gap-1"><Input placeholder="city" {...txt('destination_city')} /><Input placeholder="port" {...txt('destination_port')} /></div>
        </Field>
        <Field label="Dest. country"><Input {...txt('destination_country')} /></Field>
        <Field label="CBM" low={low('cbm')}><Input step="0.01" {...nm('cbm')} /></Field>
        <Field label="Gross weight kg" low={low('gross_weight_kg')}><Input {...nm('gross_weight_kg')} /></Field>
        <Field label="Pallets"><Input {...nm('pallet_count')} /></Field>
        <Field label={`W/M kg per CBM · chargeable ${t.chargeable_wm.toFixed(2)}`}><Input {...nm('wm_kg_per_cbm')} /></Field>
        <Field label="Container size"><Input {...txt('container_size')} /></Field>
        <Field label="Declared value USD"><Input {...nm('declared_invoice_value_usd')} /></Field>
        <Field label="Insurance USD"><Input {...nm('insurance_usd')} /></Field>
        <Field label="Duty estimate USD"><Input {...nm('duty_estimate_usd')} /></Field>
      </div>

      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-3 items-center">
        <span className="font-medium">FX snapshot (USD per unit):</span>
        {currencies.map(c => (
          <span key={c} className="flex items-center gap-1">{c}
            <Input type="number" step="any" className="h-6 w-24 text-[11px] font-mono" value={q.fx_snapshot[c]}
              disabled={c === 'USD'} onChange={e => set({ fx_snapshot: { ...q.fx_snapshot, [c]: Number(e.target.value) } })} />
          </span>
        ))}
        {t.missing_fx.length > 0 && <span className="text-destructive">Missing rate for {t.missing_fx.join(', ')} — add it in Settings or here.</span>}
      </div>

      <div className="overflow-x-auto border rounded">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-1.5 py-1">Charge (as quoted)</th><th className="text-left px-1.5">Bucket</th><th className="text-left px-1.5">Basis</th>
              <th className="px-1.5">Rate</th><th className="px-1.5">Cur</th><th className="px-1.5">Min</th><th className="px-1.5">Qty</th>
              <th className="px-1.5">Est. (actuals)</th><th className="px-1.5 text-right">Amount</th><th className="px-1.5 text-right">USD</th>
              <th className="px-1.5" title="Applicable">Appl.</th><th className="px-1.5" title="Optional: include?">Opt.</th><th />
            </tr>
          </thead>
          <tbody>
            {grouped.map(g => (
              <GroupRows key={g.b} bucket={g.b} subtotal={t.buckets[g.b]}
                onAdd={() => set({ lines: [...q.lines, { ...blankLine(q.lines.length), bucket: g.b }] })}>
                {g.rows.map(({ l, i }) => {
                  const r = t.lines[i];
                  const off = r.status === 'not_applicable' || r.status === 'optional_off';
                  return (
                    <tr key={i} className={cn('border-t', off && 'opacity-45', l.confidence != null && l.confidence < LOW && 'bg-warning/10')}>
                      <td className="px-1 py-0.5 min-w-[160px]">
                        <Input className="h-6 text-xs" value={l.raw_label} onChange={e => setLine(i, { raw_label: e.target.value })} />
                        {(l.applicable_reason || off) && (
                          <Input className="h-5 mt-0.5 text-[10px] text-muted-foreground" placeholder="reason / condition" value={l.applicable_reason || ''} onChange={e => setLine(i, { applicable_reason: e.target.value || null })} />
                        )}
                      </td>
                      <td className="px-1"><Select value={l.bucket} onValueChange={v => setLine(i, { bucket: v })}>
                        <SelectTrigger className="h-6 text-[11px] w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>{BUCKETS.map(b => <SelectItem key={b} value={b}>{BUCKET_LABEL[b]}</SelectItem>)}</SelectContent>
                      </Select></td>
                      <td className="px-1"><Select value={l.charge_basis} onValueChange={v => setLine(i, { charge_basis: v })}>
                        <SelectTrigger className="h-6 text-[11px] w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>{BASES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                      </Select></td>
                      <td className="px-1"><Input type="number" step="any" className="h-6 w-20 text-xs font-mono text-right" value={l.rate ?? ''} onChange={e => setLine(i, { rate: numOrNull(e.target.value) })} /></td>
                      <td className="px-1"><Input className="h-6 w-14 text-xs uppercase" value={l.currency} onChange={e => setLine(i, { currency: e.target.value.toUpperCase() })} /></td>
                      <td className="px-1"><Input type="number" step="any" className="h-6 w-16 text-xs font-mono text-right" value={l.minimum_amount ?? ''} onChange={e => setLine(i, { minimum_amount: numOrNull(e.target.value) })} /></td>
                      <td className="px-1"><Input type="number" step="any" className="h-6 w-16 text-xs font-mono text-right" placeholder={r.quantity.toFixed(2)} value={l.quantity_override ?? ''} onChange={e => setLine(i, { quantity_override: numOrNull(e.target.value) })} /></td>
                      <td className="px-1">{l.charge_basis === 'at_actuals'
                        ? <Input type="number" step="any" className={cn('h-6 w-20 text-xs font-mono text-right', l.user_estimate == null && 'ring-1 ring-warning')} value={l.user_estimate ?? ''} onChange={e => setLine(i, { user_estimate: numOrNull(e.target.value) })} />
                        : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-1.5 text-right font-mono whitespace-nowrap">{r.amount_original == null ? <span className="text-warning">unpriced</span> : money(r.amount_original, l.currency, 0)}</td>
                      <td className="px-1.5 text-right font-mono">{usd(r.amount_usd, 2)}</td>
                      <td className="px-1 text-center"><Checkbox checked={l.applicable !== false} onCheckedChange={v => setLine(i, { applicable: !!v })} /></td>
                      <td className="px-1 text-center whitespace-nowrap">
                        <Checkbox checked={!!l.is_optional} onCheckedChange={v => setLine(i, { is_optional: !!v, optional_included: true })} title="Optional charge" />
                        {l.is_optional && <button className="ml-1 text-[10px] underline" onClick={() => setLine(i, { optional_included: l.optional_included === false })}>{l.optional_included === false ? 'off' : 'on'}</button>}
                      </td>
                      <td className="px-1"><Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => set({ lines: q.lines.filter((_, j) => j !== i) })}><Trash2 className="h-3 w-3" /></Button></td>
                    </tr>
                  );
                })}
              </GroupRows>
            ))}
          </tbody>
        </table>
        <div className="p-1 border-t"><Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => set({ lines: [...q.lines, blankLine(q.lines.length)] })}><Plus className="h-3 w-3 mr-1" />Add line</Button></div>
      </div>

      <TotalsBlock q={q} />

      <Field label="Notes"><Textarea className="text-xs min-h-[50px]" value={q.notes || ''} onChange={e => set({ notes: e.target.value || null })} /></Field>
    </div>
  );
}

function GroupRows({ bucket, subtotal, onAdd, children }: { bucket: Bucket; subtotal: number; onAdd: () => void; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-muted/30 border-t"><td colSpan={9} className="px-1.5 py-0.5 text-[10px] font-semibold uppercase">
        {BUCKET_LABEL[bucket]}
        <Button variant="ghost" size="sm" className="h-5 ml-2 px-1.5 text-[10px] normal-case font-normal" onClick={onAdd}><Plus className="h-3 w-3 mr-0.5" />Add row</Button>
      </td>
        <td className="px-1.5 text-right font-mono text-[11px] font-semibold">{usd(subtotal, 2)}</td><td colSpan={3} /></tr>
      {children}
    </>
  );
}

export function TotalsBlock({ q }: { q: FqQuote }) {
  const t = computeQuote(q, q.lines);
  const unpriced = q.lines.filter((_, i) => t.lines[i].status === 'unpriced');
  const Row = ({ label, v, inr, strong }: { label: string; v: number; inr?: number | null; strong?: boolean }) => (
    <tr className={cn('border-t', strong && 'font-semibold')}>
      <td className="px-2 py-1">{label}</td>
      <td className="px-2 text-right font-mono">{inr != null ? money(inr, '₹', 0) : ''}</td>
      <td className="px-2 text-right font-mono">{usd(v, 2)}</td>
      <td className="px-2 text-right font-mono text-muted-foreground">{t.per_cbm && q.cbm ? usd(v / Number(q.cbm), 2) : '—'}</td>
    </tr>
  );
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <table className="w-full text-xs border rounded">
        <thead className="text-[10px] uppercase text-muted-foreground bg-muted/50"><tr><th className="text-left px-2 py-1">Breakdown</th><th className="text-right px-2">INR</th><th className="text-right px-2">USD</th><th className="text-right px-2">$/CBM</th></tr></thead>
        <tbody>
          <Row label="(1) FOB total" v={t.fob_usd} inr={t.fob_inr} />
          <Row label="(2) Everything else" v={t.everything_else_usd} />
          <Row label="(3) Grand total (DDP)" v={t.ddp_usd} strong />
        </tbody>
      </table>
      <div className="space-y-1.5">
        <table className="w-full text-xs border rounded">
          <thead className="text-[10px] uppercase text-muted-foreground bg-muted/50"><tr><th className="text-left px-2 py-1">Incoterm</th><th className="text-right px-2">USD</th><th className="text-right px-2">$/CBM</th><th className="text-right px-2">$/W·M</th></tr></thead>
          <tbody>
            {(['fob', 'cif', 'ddp'] as const).map(k => (
              <tr key={k} className="border-t"><td className="px-2 py-1 uppercase">{k}</td>
                <td className="px-2 text-right font-mono">{usd(k === 'fob' ? t.fob_usd : k === 'cif' ? t.cif_usd : t.ddp_usd, 2)}</td>
                <td className="px-2 text-right font-mono">{usd(t.per_cbm[k], 2)}</td>
                <td className="px-2 text-right font-mono">{usd(t.per_wm[k], 2)}</td></tr>
            ))}
          </tbody>
        </table>
        {t.duty_missing && <p className="text-[11px] text-warning flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Duties not included — no duty estimate entered.</p>}
        {unpriced.length > 0 && (
          <div className="text-[11px] border border-warning/50 rounded p-1.5">
            <div className="font-medium text-warning">Unpriced / at actuals (excluded from totals)</div>
            {unpriced.map((l, i) => <div key={i}>• {l.raw_label || l.normalized_name} {l.applicable_reason ? `— ${l.applicable_reason}` : ''}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
