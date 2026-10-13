// One part of an assembly: name, section (shape + sizes, with common-size presets), length and
// count per piece. Two compact lines that wrap on a phone; errors sit under the field at fault.
import { useEffect, useState } from 'react';
import { Copy, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SHAPES, type ShapeKey, type Unit } from '@/lib/iron-weight-core';
import {
  DIM_UNITS, LENGTH_UNITS, PRESETS, SHAPE_ORDER, dimsForShape, kg, partIssue, presetLabel, rupees, unitLabel,
  type EditPart,
} from '@/lib/iron-weight';
import { cn } from '@/lib/utils';
import { SectionThumb } from './SectionThumb';

export const fieldCls = 'h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 min-w-0';

/** Number input that keeps what you type ("1.", "") and reports NaN for empty. */
export function NumInput({ value, onChange, className, invalid, label, integer }: {
  value: number; onChange: (n: number) => void; className?: string; invalid?: boolean; label: string; integer?: boolean;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    // Only overwrite what's typed when the value changed from outside (preset, reset, load).
    const shown = text.trim() === '' ? NaN : Number(text);
    const same = Number.isFinite(value) ? shown === value : !Number.isFinite(shown);
    if (!same) setText(Number.isFinite(value) ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      aria-label={label}
      inputMode={integer ? 'numeric' : 'decimal'}
      className={cn(fieldCls, 'tabular-nums text-right', invalid && 'border-destructive focus:border-destructive focus:ring-destructive/20', className)}
      value={text}
      onFocus={e => e.target.select()}
      onChange={e => {
        const t = e.target.value.replace(',', '.');
        setText(t);
        onChange(t.trim() === '' ? NaN : Number(t));
      }}
    />
  );
}

export function PartRow({ p, kgPerPiece, price, onChange, onRemove, onDuplicate }: {
  p: EditPart;
  /** Weight of this part per piece of the assembly (null while invalid). */
  kgPerPiece: number | null;
  price: number | null;
  onChange: (patch: Partial<EditPart>) => void;
  onRemove?: () => void;
  onDuplicate: () => void;
}) {
  const s = SHAPES[p.shape];
  const issue = partIssue(p);
  // Any hand edit makes a photo estimate the user's own number.
  const edit = (patch: Partial<EditPart>) => onChange({ ...patch, estimate: undefined });
  const presetValue = PRESETS[p.shape].findIndex(v => p.dimUnit === 'mm' && s.fields.every(([k]) => v[k] === p.dims[k]));

  return (
    <div className={cn('rounded-lg border bg-background p-2.5 sm:p-3', issue && 'border-destructive/50')}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionThumb p={p} />
        <input aria-label="Part name" className={cn(fieldCls, 'flex-1 min-w-[8rem] font-medium')} value={p.name} onChange={e => onChange({ name: e.target.value })} />
        {/* On a phone the shape gets its own line so the name stays readable. */}
        <select aria-label="Shape" className={cn(fieldCls, 'order-last w-full sm:order-none sm:w-[9.5rem] shrink-0')} value={p.shape}
          onChange={e => { const shape = e.target.value as ShapeKey; edit({ shape, ...dimsForShape(shape, p.dims, p.dimUnit) }); }}>
          <optgroup label="Pipe / tube">{SHAPE_ORDER.filter(k => SHAPES[k].form === 'pipe').map(k => <option key={k} value={k}>{SHAPES[k].label}</option>)}</optgroup>
          <optgroup label="Solid">{SHAPE_ORDER.filter(k => SHAPES[k].form === 'solid').map(k => <option key={k} value={k}>{SHAPES[k].label}</option>)}</optgroup>
        </select>
        <div className="hidden sm:block w-28 shrink-0 text-right">
          <Weight kgPerPiece={kgPerPiece} price={price} />
        </div>
        <div className="flex shrink-0">
          <Tooltip><TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onDuplicate} aria-label="Duplicate part"><Copy className="h-3.5 w-3.5" /></Button>
          </TooltipTrigger><TooltipContent>Duplicate part</TooltipContent></Tooltip>
          {onRemove && (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`Remove ${p.name || 'part'}`}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2 sm:pl-12">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] text-muted-foreground">{s.fields.map(([, l]) => l).join(' × ')}</div>
          <div className="flex flex-wrap items-center gap-1">
            {s.fields.map(([k, l], i) => (
              <span key={k} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">×</span>}
                <NumInput label={l} value={p.dims[k]} invalid={issue?.field === 'dims'} className="w-14"
                  onChange={n => edit({ dims: { ...p.dims, [k]: n } })} />
              </span>
            ))}
            <select aria-label="Size unit" className={cn(fieldCls, 'w-16')} value={p.dimUnit} onChange={e => edit({ dimUnit: e.target.value as Unit })}>
              {DIM_UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
            </select>
            <select aria-label="Common sizes" className={cn(fieldCls, 'w-[4.5rem] px-1.5 text-muted-foreground')} value=""
              title="Pick a common size" onChange={e => { const v = PRESETS[p.shape][Number(e.target.value)]; if (v) edit({ dims: { ...v }, dimUnit: 'mm' }); }}>
              <option value="" disabled>Sizes</option>
              {PRESETS[p.shape].map((v, i) => <option key={i} value={i}>{i === presetValue ? '✓ ' : ''}{presetLabel(p.shape, v)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Length</div>
          <div className="flex items-center gap-1">
            <NumInput label="Length" value={p.length} invalid={issue?.field === 'length'} className="w-20" onChange={n => edit({ length: n })} />
            <select aria-label="Length unit" className={cn(fieldCls, 'w-16')} value={p.lengthUnit} onChange={e => edit({ lengthUnit: e.target.value as Unit })}>
              {LENGTH_UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
            </select>
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Count per piece</div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">×</span>
            <NumInput label="Count per piece" integer value={p.count} invalid={issue?.field === 'count'} className="w-14" onChange={n => edit({ count: n })} />
          </div>
        </div>
        <div className="ml-auto sm:hidden text-right"><Weight kgPerPiece={kgPerPiece} price={price} /></div>
      </div>

      {issue && <p className="mt-2 text-xs font-medium text-destructive sm:pl-12">{issue.message}</p>}
      {p.estimate && !issue && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-warning sm:pl-12">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Estimated from photo ({p.estimate.confidence} confidence){p.estimate.note ? ` — ${p.estimate.note}` : ''}. Edit any field to confirm.</span>
        </p>
      )}
    </div>
  );
}

function Weight({ kgPerPiece, price }: { kgPerPiece: number | null; price: number | null }) {
  if (kgPerPiece == null) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="leading-tight">
      <div className="text-sm font-semibold tabular-nums">{kg(kgPerPiece)} kg</div>
      {price ? <div className="text-xs text-muted-foreground tabular-nums">{rupees(kgPerPiece * price)}</div> : null}
    </div>
  );
}
