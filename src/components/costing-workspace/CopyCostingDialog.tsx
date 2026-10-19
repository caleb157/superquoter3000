// Makes the ticked SKUs cost like another SKU, one step at a time (COGS, labour, shipping).
// Undo (Ctrl+Z) puts them back.
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { copyCosting, type Apply, type Bundle, type CopySteps, type WorkspaceRow } from '@/lib/costing-workspace';
import { inr } from './cells';

const STEPS: { key: keyof CopySteps; label: string; what: string }[] = [
  { key: 'cogs', label: '1. COGS', what: 'Source location and every typed cost line (raw piece quotes, subcontract, hardware, finishing, other). Replaces the targets’ lines.' },
  { key: 'labour', label: '2. Labour', what: 'Product type, finish, wood %, running-inch override and the hours on every labour row.' },
  { key: 'shipping', label: '3. Shipping', what: 'Packaging type, carton settings and shipping type. Piece size stays each SKU’s own.' },
];

export function CopyCostingDialog({ open, onOpenChange, ids, rows, bundle, apply }: {
  open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; rows: WorkspaceRow[]; bundle: Bundle; apply: Apply;
}) {
  const [sourceId, setSourceId] = useState('');
  const [steps, setSteps] = useState<CopySteps>({ cogs: true });
  const sources = useMemo(() => rows, [rows]);
  const targets = ids.filter(id => id !== sourceId);
  const run = () => {
    apply(b => copyCosting(b, sourceId, targets, steps));
    onOpenChange(false);
  };
  const ready = !!sourceId && targets.length > 0 && Object.values(steps).some(Boolean);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy costing from another SKU</DialogTitle>
          <DialogDescription>The {ids.length} selected SKU{ids.length === 1 ? '' : 's'} take on the chosen steps of the source. Quantity, size, price and target stay their own. Ctrl+Z undoes it.</DialogDescription>
        </DialogHeader>
        <label className="block text-sm">
          <span className="text-xs text-muted-foreground">Copy from</span>
          <select className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm" value={sourceId} onChange={e => setSourceId(e.target.value)}>
            <option value="">Pick a SKU…</option>
            {sources.map(r => <option key={r.p.id} value={r.p.id}>{r.p.sku ? `${r.p.sku} · ` : ''}{r.p.name} ({inr(r.costInr)})</option>)}
          </select>
        </label>
        <div className="space-y-2.5">
          {STEPS.map(s => (
            <label key={s.key} className="flex items-start gap-2.5 text-sm">
              <Checkbox className="mt-0.5" checked={!!steps[s.key]} onCheckedChange={c => setSteps(st => ({ ...st, [s.key]: !!c }))} />
              <span><span className="font-medium">{s.label}</span><span className="block text-xs text-muted-foreground">{s.what}</span></span>
            </label>
          ))}
        </div>
        {sourceId && ids.includes(sourceId) && <p className="text-xs text-muted-foreground">The source is selected too; it is left as it is.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready} onClick={run}>Copy to {targets.length} SKU{targets.length === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
