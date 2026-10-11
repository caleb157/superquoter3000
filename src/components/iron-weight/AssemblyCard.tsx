// One assembly (leg type, frame, base…): a name, how many of it, and its parts.
import { Copy, Minus, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { partWeight } from '@/lib/iron-weight-core';
import { kg, newId, qtyIssue, rupees, type EditLeg, type EditPart } from '@/lib/iron-weight';
import { cn } from '@/lib/utils';
import { NumInput, PartRow, fieldCls } from './PartRow';

export function AssemblyCard({ leg, price, onChange, onRemove, onDuplicate }: {
  leg: EditLeg;
  price: number | null;
  onChange: (next: EditLeg) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const weights = leg.parts.map(p => { const r = partWeight(p); return r.ok ? r.kgPerLeg : null; });
  const each = weights.every(w => w != null) ? weights.reduce((a, w) => a + (w as number), 0) : null;
  const qErr = qtyIssue(leg.qty);
  const setPart = (id: string, patch: Partial<EditPart>) => onChange({ ...leg, parts: leg.parts.map(p => (p.id === id ? { ...p, ...patch } : p)) });
  const insertAfter = (idx: number, p: EditPart) => onChange({ ...leg, parts: [...leg.parts.slice(0, idx + 1), p, ...leg.parts.slice(idx + 1)] });
  // A new part starts as a copy of the last one's section — most parts in an assembly share it.
  const addPart = () => {
    const last = leg.parts[leg.parts.length - 1];
    const p: EditPart = last
      ? { ...last, id: newId(), name: `Part ${leg.parts.length + 1}`, count: 1, estimate: undefined, dims: { ...last.dims } }
      : { id: newId(), name: 'Part 1', shape: 'rect_tube', dims: { w: 40, h: 20, t: 2 }, dimUnit: 'mm', length: 600, lengthUnit: 'mm', count: 1 };
    onChange({ ...leg, parts: [...leg.parts, p] });
  };

  return (
    <Card className="p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Assembly name" className={cn(fieldCls, 'flex-1 min-w-[10rem] text-base font-semibold')} value={leg.name}
          placeholder="e.g. U-frame leg" onChange={e => onChange({ ...leg, name: e.target.value })} />
        <div className="flex items-center gap-1" aria-label="How many">
          <span className="text-xs text-muted-foreground mr-1">How many</span>
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="One fewer" disabled={!(leg.qty > 1)}
            onClick={() => onChange({ ...leg, qty: Math.max(1, Math.round(leg.qty || 1) - 1) })}><Minus className="h-3.5 w-3.5" /></Button>
          <NumInput label="How many" integer value={leg.qty} invalid={!!qErr} className="w-14 text-center" onChange={n => onChange({ ...leg, qty: n })} />
          <Button variant="outline" size="icon" className="h-9 w-9" aria-label="One more"
            onClick={() => onChange({ ...leg, qty: Math.max(1, Math.round(leg.qty || 0) + 1) })}><Plus className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="flex">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={onDuplicate} aria-label="Duplicate assembly"><Copy className="h-4 w-4" /></Button>
          </TooltipTrigger><TooltipContent>Duplicate assembly</TooltipContent></Tooltip>
          <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`Remove ${leg.name || 'assembly'}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      {qErr && <p className="text-xs font-medium text-destructive">How many: {qErr}</p>}

      <div className="space-y-2">
        {leg.parts.map((p, i) => (
          <PartRow key={p.id} p={p} kgPerPiece={weights[i]} price={price}
            onChange={patch => setPart(p.id, patch)}
            onRemove={leg.parts.length > 1 ? () => onChange({ ...leg, parts: leg.parts.filter(x => x.id !== p.id) }) : undefined}
            onDuplicate={() => insertAfter(i, { ...p, id: newId(), name: `${p.name} (copy)`, dims: { ...p.dims } })} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={addPart}><Plus className="h-3.5 w-3.5" /> Add part</Button>
        <div className="text-sm tabular-nums text-right">
          {each == null || qErr ? (
            <span className="text-muted-foreground">Fix the highlighted fields to see this assembly</span>
          ) : (
            <>
              <span className="text-muted-foreground">Each {kg(each)} kg · </span>
              <span className="font-semibold">{leg.qty} × = {kg(each * leg.qty)} kg</span>
              {price ? <span className="text-muted-foreground"> · {rupees(each * leg.qty * price)}</span> : null}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
