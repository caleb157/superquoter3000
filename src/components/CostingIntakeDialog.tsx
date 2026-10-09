import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { applyIntake, downloadIntakeTemplate, matchProduct, parseIntakeFile, COST_COLS, LABOR_COLS, SLOTS, cogsToIntake, type IntakeRow } from '@/lib/costing-intake';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  inquiryId: string;
  /** "create" = Import products (new SKUs); "update" = Bulk Editor (existing SKUs, optionally add new). */
  mode: 'create' | 'update';
  initialFile?: File | null;
  onApplied: () => void;
};

export function CostingIntakeDialog({ open, onOpenChange, inquiryId, mode, initialFile, onApplied }: Props) {
  const [rows, setRows] = useState<IntakeRow[] | null>(null);
  const [existing, setExisting] = useState<any[]>([]);
  const [createMissing, setCreateMissing] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) { setRows(null); setProgress(0); return; }
    setCreateMissing(true); setUpdateExisting(true);
    (supabase as any).from('products').select('id, sku, name').eq('customer_rfq_id', inquiryId).is('archived_at', null)
      .then(({ data }: any) => setExisting(data || []));
    if (initialFile) void loadFile(initialFile);
  }, [open, initialFile]); // eslint-disable-line

  const loadFile = async (f: File) => {
    try {
      const parsed = await parseIntakeFile(f);
      if (!parsed) { toast.error('This file is not a Costing Intake sheet — download the template first.'); return; }
      if (!parsed.length) { toast.error('No product rows found'); return; }
      setRows(parsed);
    } catch (e: any) { toast.error('Could not read file: ' + e.message); }
  };

  const exportCurrent = async () => {
    const { data } = await (supabase as any).from('products').select('*').eq('customer_rfq_id', inquiryId).is('archived_at', null).order('sort_order');
    const ps: any[] = data || [];
    if (!ps.length) { downloadIntakeTemplate(); return; }
    const ids = ps.map(p => p.id);
    const [cogs, oh, cbm, ship, st, pt, loc, chems] = await Promise.all([
      (supabase as any).from('cogs_items').select('*').in('product_id', ids),
      (supabase as any).from('overhead_items').select('*').in('product_id', ids),
      (supabase as any).from('cbm_estimates').select('*').in('product_id', ids),
      (supabase as any).from('shipping_items').select('*').in('product_id', ids),
      (supabase as any).from('shipping_types').select('id, name'),
      (supabase as any).from('product_types').select('id, name'),
      (supabase as any).from('local_transport_locations').select('id, name'),
      (supabase as any).from('chemical_prices').select('id, name'),
    ]);
    const nm = (list: any, id: any) => (list.data || []).find((x: any) => x.id === id)?.name ?? '';
    const out = ps.map(p => {
      const c = (cbm.data || []).find((x: any) => x.product_id === p.id) || {};
      const r: any = {
        sku: p.sku, name: p.name, product_type: nm(pt, p.product_type_id), quantity: p.quantity, moq: p.moq,
        target_price_usd: p.target_price_usd, source_location: nm(loc, p.source_location_id), finishing_difficulty: p.finishing_difficulty,
        percent_wood: p.percent_wood != null ? Math.round(p.percent_wood * 100) : '', is_component: p.is_component ? 'Yes' : 'No', notes: p.notes,
        width_inch: p.width_inch, depth_inch: p.depth_inch, height_inch: p.height_inch, weight_kg: p.weight_kg,
        packaging_type: p.packaging_type, ic_type: c.ic_type, products_per_ic: c.products_per_ic, ic_width: c.ic_width, ic_depth: c.ic_depth, ic_height: c.ic_height,
        include_mc: c.include_mc == null ? '' : c.include_mc ? 'Yes' : 'No', bulk_pieces_per_box: p.bulk_pieces_per_box,
        is_outsourced: p.is_outsourced ? 'Yes' : 'No', outsourced_unit_cost_inr: p.outsourced_unit_cost_inr,
        shipping_type: nm(st, (ship.data || []).find((s: any) => s.product_id === p.id)?.shipping_type_id),
        markup_pct: p.markup_percent != null ? Math.round(p.markup_percent * 10000) / 100 : '',
        cost_of_capital: p.cost_of_capital_enabled == null ? '' : p.cost_of_capital_enabled ? 'Yes' : 'No',
        coc_monthly_rate: p.cost_of_capital_monthly_rate, coc_months: p.cost_of_capital_months,
      };
      const mine = (cogs.data || []).filter((x: any) => x.product_id === p.id && x.include === 'Yes' && !x.is_auto_calculated);
      cogsToIntake(r, (cogs.data || []).filter((x: any) => x.product_id === p.id), chems.data || []);
      r.raw_vendor = mine.find((x: any) => x.cogs_type === 'Raw Piece')?.vendor_name ?? '';
      for (const lc of LABOR_COLS) {
        const o = (oh.data || []).find((x: any) => x.product_id === p.id && x.labor_type === lc.laborType && !x.is_auto_estimated);
        if (o) r[lc.key] = o.man_hours_per_unit;
      }
      return r;
    });
    downloadIntakeTemplate(out, 'costing-intake-current.xlsx');
  };

  const matched = rows ? rows.filter(r => matchProduct(existing, r)).length : 0;
  const fresh = rows ? rows.length - matched : 0;

  const apply = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await applyIntake(inquiryId, rows, {
        createMissing: mode === 'create' ? true : createMissing,
        updateExisting: mode === 'create' ? updateExisting : true,
        onProgress: (d, t) => setProgress(Math.round((d / t) * 100)),
      });
      toast.success(`Costing intake: ${res.created} created, ${res.updated} updated`);
      res.warnings.slice(0, 6).forEach(w => toast.warning(w));
      onApplied();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Costing intake</DialogTitle>
          <DialogDescription>
            One row per SKU: sizes, boxes, every COGS line, labor hours, shipping type and NPM. Blank cells leave values unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadIntakeTemplate()}><Download className="h-3.5 w-3.5 mr-1" /> Blank template</Button>
          {mode === 'update' && <Button variant="outline" size="sm" onClick={() => void exportCurrent()}><Download className="h-3.5 w-3.5 mr-1" /> Export current inquiry</Button>}
          <Button size="sm" onClick={() => inputRef.current?.click()}><Upload className="h-3.5 w-3.5 mr-1" /> Choose filled sheet</Button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
        </div>

        {rows && (
          <div className="flex-1 overflow-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left p-1.5">SKU</th><th className="text-left p-1.5">Name</th><th className="p-1.5">Action</th>
                  <th className="text-right p-1.5">Piece W×D×H</th><th className="text-right p-1.5">Box W×D×H</th>
                  <th className="text-right p-1.5">COGS ₹</th><th className="text-right p-1.5">Hours</th><th className="text-right p-1.5">NPM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const m = matchProduct(existing, r);
                  const cogs = COST_COLS.reduce((a, c) => a + (r[c.key] || 0), 0) + SLOTS.reduce((a, sl) => a + (r[sl.costKey] || 0) * (r[sl.qtyKey] ?? 1), 0);
                  const hrs = LABOR_COLS.reduce((a, c) => a + (r[c.key] || 0), 0);
                  const dims = (a: any, b: any, c: any) => (a ?? b ?? c) == null ? '—' : `${a ?? '·'}×${b ?? '·'}×${c ?? '·'}`;
                  return (
                    <tr key={r._row} className="border-t">
                      <td className="p-1.5 font-mono">{r.sku || '—'}</td>
                      <td className="p-1.5 truncate max-w-[180px]">{r.name || m?.name || '—'}</td>
                      <td className="p-1.5 text-center"><Badge variant={m ? 'secondary' : 'default'} className="text-[10px]">{m ? 'Update' : 'New'}</Badge></td>
                      <td className="p-1.5 text-right tabular-nums">{dims(r.width_inch, r.depth_inch, r.height_inch)}</td>
                      <td className="p-1.5 text-right tabular-nums">{dims(r.ic_width, r.ic_depth, r.ic_height)}</td>
                      <td className="p-1.5 text-right tabular-nums">{cogs ? cogs.toLocaleString('en-IN') : '—'}</td>
                      <td className="p-1.5 text-right tabular-nums">{hrs ? hrs.toFixed(2) : '—'}</td>
                      <td className="p-1.5 text-right tabular-nums">{r.markup_pct != null ? `${(r.markup_pct * 100).toFixed(1)}%` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows && (
          <div className="flex flex-wrap gap-4 text-xs">
            <span>{matched} match existing SKUs · {fresh} new</span>
            {mode === 'update' && fresh > 0 && (
              <label className="flex items-center gap-1.5"><Checkbox checked={createMissing} onCheckedChange={v => setCreateMissing(!!v)} /> Add the {fresh} new SKUs</label>
            )}
            {mode === 'create' && matched > 0 && (
              <label className="flex items-center gap-1.5"><Checkbox checked={updateExisting} onCheckedChange={v => setUpdateExisting(!!v)} /> Also update the {matched} existing SKUs</label>
            )}
          </div>
        )}
        {busy && <Progress value={progress} className="h-2" />}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={apply} disabled={!rows || busy}>
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />} Apply {rows?.length ?? 0} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
