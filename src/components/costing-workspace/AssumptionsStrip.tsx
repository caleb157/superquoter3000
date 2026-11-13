// The inquiry-level settings that drive every SKU's costing, right above the sheet: change
// one and the whole sheet recalculates. They used to sit in the inquiry's Settings tab.
// Blank means "use the live rate / global default", shown as the placeholder.
import { useEffect, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CurrencyCombobox } from '@/components/CurrencyCombobox';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { markupToNpm, npmToMarkup } from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { patchInquiry, type Apply, type Bundle } from '@/lib/costing-workspace';
import { parseNum } from './cells';

const box = 'h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/20';

/** A number that overrides a default: blank goes back to the default (the placeholder). */
function NumField({ label, value, placeholder, onCommit, width = 'w-24', hint }: {
  label: string; value: number | null | undefined; placeholder: string; onCommit: (n: number | null) => void; width?: string; hint?: string;
}) {
  const shown = value == null ? '' : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const t = draft.trim();
    if (t === shown) return;
    if (t === '') { onCommit(null); return; }
    const n = parseNum(t);
    if (n == null || n < 0) { setDraft(shown); return; }
    onCommit(n);
  };
  return (
    <label className="flex items-center gap-1.5" title={hint}>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <input className={cn(box, width, 'text-right tabular-nums', value != null && 'border-primary/50 font-medium')} inputMode="decimal"
        value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(shown); e.currentTarget.blur(); } }} />
    </label>
  );
}

function Pick({ label, value, options, onChange, width = 'w-40', hint }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; width?: string; hint?: string;
}) {
  return (
    <label className="flex items-center gap-1.5" title={hint}>
      <span className="whitespace-nowrap text-xs text-muted-foreground">{label}</span>
      <select className={cn(box, width, value && 'border-primary/50 font-medium')} value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function AssumptionsStrip({ bundle, apply }: { bundle: Bundle; apply: Apply }) {
  const inq = bundle.inq || {};
  // What applies when a field is left blank: the live rates and the global defaults.
  const base: any = mergeSettingsWithInquiry(bundle.gs, null) || {};
  const set = (patch: Record<string, any>) => apply(b => patchInquiry(b, patch));
  const [entities, setEntities] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let off = false;
    (supabase as any).from('company_entities').select('id, name').order('name').then((r: any) => { if (!off) setEntities(r?.data || []); });
    return () => { off = true; };
  }, []);

  const cur = inq.quoting_currency || 'USD';
  const dflt = (v: any, d = 0) => (Number(v) > 0 ? `${(+Number(v).toFixed(d)).toLocaleString('en-IN')}` : 'default');
  const npm = inq.markup_percent_override == null ? null : +(markupToNpm(Number(inq.markup_percent_override)) * 100).toFixed(2);
  const moreSet = [inq.markup_percent_override, inq.fob_pool_cbm_override, inq.fob_pool_cartons_override, inq.quoting_currency_rate_override].filter(v => v != null).length
    + (inq.fob_fumigation && inq.fob_fumigation !== 'none' ? 1 : 0) + (inq.fob_wlc && inq.fob_wlc !== 'none' ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/70 bg-card px-3 py-2 shadow-sm">
      <span className="flex items-center gap-1.5 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Assumptions</span>
      <label className="flex items-center gap-1.5" title="The currency this customer is quoted in. INR shows the whole sheet in rupees with no exchange rate.">
        <span className="whitespace-nowrap text-xs text-muted-foreground">Quote in</span>
        <CurrencyCombobox value={cur} onChange={v => { if (v && v !== cur) set({ quoting_currency: v }); }} className="h-8 w-28" />
      </label>
      {cur !== 'INR' && (
        <NumField label="₹ / $" value={inq.exchange_rate_override} placeholder={`${dflt(base.exchange_rate, 2)} live`}
          onCommit={n => set({ exchange_rate_override: n })} hint="Rupees per US dollar. Blank uses the live Odoo rate." />
      )}
      <Pick label="Ship via" value={inq.shipping_type_id_override || ''} onChange={v => set({ shipping_type_id_override: v || null })}
        options={[{ value: '', label: 'Per SKU' }, ...bundle.shipTypes.map((s: any) => ({ value: s.id, label: s.name }))]}
        hint="One shipping type for every SKU. Per SKU uses each product's own." />
      <NumField label="Overhead / man-hour ₹" value={inq.indirect_overhead_per_mh_override} placeholder={`${dflt(base.indirect_overhead_per_mh)} live`}
        onCommit={n => set({ indirect_overhead_per_mh_override: n })} hint="Indirect overhead per man-hour. Blank uses the live LaborTrax figure." />
      <NumField label="Packaging ₹ / CBM" value={inq.packaging_cost_per_cbm_override} placeholder={dflt(base.packaging_cost_per_cbm)}
        onCommit={n => set({ packaging_cost_per_cbm_override: n })} />
      <NumField label="Auto transport ₹ / CBM" value={inq.auto_transport_cost_per_cbm_override} placeholder={dflt(base.auto_transport_cost_per_cbm)}
        onCommit={n => set({ auto_transport_cost_per_cbm_override: n })} />
      <NumField label="Local transport ₹ / CBM" value={inq.local_transport_cost_per_cbm_override} placeholder={dflt(base.local_transport_cost_per_cbm)}
        onCommit={n => set({ local_transport_cost_per_cbm_override: n })} />
      <Pick label="Quoting entity" value={inq.quoting_entity_id || ''} onChange={v => set({ quoting_entity_id: v || null })} width="w-44"
        options={[{ value: '', label: 'Pick at quote time' }, ...entities.map(e => ({ value: e.id, label: e.name }))]} />

      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="ml-auto h-8 gap-1 text-muted-foreground">
            More{moreSet > 0 && <span className="rounded-full bg-primary/15 px-1.5 text-xs font-semibold text-primary">{moreSet}</span>} <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] space-y-2.5 p-3">
          <div className="text-xs text-muted-foreground">Used less often. Blank or None means the normal calculation.</div>
          <div className="grid grid-cols-1 gap-2 [&_label]:justify-between">
            <NumField label="Uniform NPM % (every SKU)" value={npm} placeholder="per SKU" width="w-28"
              onCommit={n => { if (n == null) set({ markup_percent_override: null }); else if (n < 100) set({ markup_percent_override: npmToMarkup(n / 100) }); }}
              hint="One net margin for every SKU, overriding each SKU's own. A locked price still holds." />
            <Pick label="Fumigation" value={inq.fob_fumigation || 'none'} onChange={v => set({ fob_fumigation: v })} width="w-28"
              options={[{ value: 'none', label: 'None' }, { value: 'normal', label: 'Normal' }, { value: 'ispm', label: 'ISPM-15' }]}
              hint="Per container, FCL only. Australia and New Zealand need ISPM." />
            <Pick label="Wildlife certificate" value={inq.fob_wlc || 'none'} onChange={v => set({ fob_wlc: v })} width="w-28"
              options={[{ value: 'none', label: 'None' }, { value: 'leather', label: 'Leather' }, { value: 'bone_mop', label: 'Bone / MOP' }]}
              hint="Once per shipment, FCL only." />
            <NumField label="FOB shipment CBM" value={inq.fob_pool_cbm_override} placeholder="sum of SKUs" width="w-28" onCommit={n => set({ fob_pool_cbm_override: n })} />
            <NumField label="FOB carton count" value={inq.fob_pool_cartons_override} placeholder="sum of SKUs" width="w-28"
              onCommit={n => set({ fob_pool_cartons_override: n == null ? null : Math.round(n) })} />
            {cur !== 'INR' && cur !== 'USD' && (
              <NumField label={`Quote FX (₹ per ${cur})`} value={inq.quoting_currency_rate_override} placeholder="currencies table" width="w-28"
                onCommit={n => set({ quoting_currency_rate_override: n })} hint="Frozen into generated quotes for this currency." />
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
