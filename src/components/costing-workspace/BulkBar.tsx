// Floating action bar for the ticked SKUs: set any field, scale a cost bucket, or run
// one of the pricing shortcuts (price to target, target = price, cheapest quote wins).
import { useMemo, useState } from 'react';
import { Crosshair, Percent, Trophy, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  EDITABLE_BUCKETS, chooseCheapestQuotes, markupToTarget, scaleBucket, targetFromPrice,
  type Apply, type Bundle, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { parseNum } from './cells';
import { bulkFields, fullLabel } from './columns';

const selectCls = 'h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/20';

export function BulkBar({ ids, rows, bundle, apply, onClear }: {
  ids: string[]; rows: WorkspaceRow[]; bundle: Bundle; apply: Apply; onClear: () => void;
}) {
  const fields = useMemo(() => bulkFields(), []);
  const [fieldId, setFieldId] = useState('npm');
  const [value, setValue] = useState('');
  const [bucket, setBucket] = useState('raw_piece');
  const [scale, setScale] = useState('');

  const field = fields.find(f => f.id === fieldId)!;
  const sel = rows.filter(r => ids.includes(r.p.id));
  const withTarget = sel.filter(r => r.targetUsd != null).length;
  const withQuotes = sel.filter(r => r.quotes.filter(q => q.price > 0).length > 1).length;
  const opts = field.edit?.kind === 'select' ? field.edit.options?.(bundle) ?? [] : field.edit?.kind === 'bool'
    ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : null;

  const runSet = () => {
    if (!field.edit) return;
    const raw = opts && !value ? opts[0]?.value ?? '' : value;
    apply(b => field.edit!.write(b, ids, raw));
    if (!opts) setValue('');
  };
  const runScale = () => {
    const n = parseNum(scale);
    if (n == null || n <= -100) return;
    apply(b => scaleBucket(b, ids, bucket, n / 100));
    setScale('');
  };

  return (
    <div className="pointer-events-auto mx-auto flex max-w-[min(1340px,calc(100vw-2rem))] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card/95 px-4 py-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{ids.length}</span>
        <span className="text-sm font-medium hidden xl:inline">selected</span>
        <button onClick={onClear} className="text-muted-foreground hover:text-foreground" aria-label="Clear selection"><X className="h-4 w-4" /></button>
      </div>

      <div className="h-6 w-px bg-border" />

      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); runSet(); }}>
        <span className="text-xs text-muted-foreground">Set</span>
        <select className={`${selectCls} w-36`} value={fieldId} onChange={e => { setFieldId(e.target.value); setValue(''); }}>
          {fields.map(f => <option key={f.id} value={f.id}>{fullLabel(f).replace(/ ₹$/, '')}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">to</span>
        {opts ? (
          <select className={`${selectCls} max-w-[180px]`} value={value || opts[0]?.value} onChange={e => setValue(e.target.value)}>
            {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <Input className="h-8 w-24" value={value} onChange={e => setValue(e.target.value)}
            placeholder={field.label.includes('₹') ? '₹' : field.label.includes('%') ? '%' : ''} />
        )}
        <Button size="sm" type="submit" className="h-8">Apply</Button>
      </form>

      <div className="h-6 w-px bg-border" />

      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); runScale(); }}>
        <Percent className="h-3.5 w-3.5 text-muted-foreground" />
        <select className={`${selectCls} w-32`} value={bucket} onChange={e => setBucket(e.target.value)}>
          {EDITABLE_BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <Input className="h-8 w-16" value={scale} onChange={e => setScale(e.target.value)} placeholder="±%" />
        <Button size="sm" variant="outline" type="submit" className="h-8">Adjust</Button>
      </form>

      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!withTarget} onClick={() => apply(b => markupToTarget(b, rows, ids))}>
              <Crosshair className="h-3.5 w-3.5" /> Price to target
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">Sets each SKU’s margin so its price lands exactly on its target ({withTarget} of {ids.length} have one)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => apply(b => targetFromPrice(b, rows, ids))}>
              <Undo2 className="h-3.5 w-3.5" /> Target = price
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copies today’s price into the target</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!withQuotes} onClick={() => apply(b => chooseCheapestQuotes(b, ids))}>
              <Trophy className="h-3.5 w-3.5" /> Cheapest
            </Button>
          </TooltipTrigger>
          <TooltipContent>Picks the cheapest raw-piece quote for each SKU ({withQuotes} have several)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
