// Floating action bar for the ticked SKUs: set any field, scale a cost bucket, add price-list
// items, copy costing from another SKU, paste copied lines, duplicate, or run one of the
// pricing shortcuts (the Target menu: target = last quoted price, target = today's price,
// price = target, price = last quoted price; and cheapest quote wins).
import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronsUpDown, ClipboardPaste, Copy, CopyPlus, Crosshair, FileText, ListPlus, Loader2, LockOpen, Percent, Target, Trophy, Undo2, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  EDITABLE_BUCKETS, canLockPrice, canPriceAt, chooseCheapestQuotes, markupToTarget, pasteCogsLines, priceToQuoted, setPrice, scaleBucket, targetFromPrice, targetFromQuoted, targetIsQuoted,
  type Apply, type Bundle, type WorkspaceRow,
} from '@/lib/costing-workspace';
import { parseNum } from './cells';
import { AddItemsDialog } from './AddItemsDialog';
import { CopyCostingDialog } from './CopyCostingDialog';
import { useCopiedLines } from './line-clipboard';
import { bulkFieldGroups, bulkLabel, type Col } from './columns';
import { quoteCurrencyOf } from '@/lib/quote-currency';

const selectCls = 'h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/20';

export function BulkBar({ ids, rows, bundle, apply, onClear, onQuote, quoting, onDuplicate, duplicating, extra }: {
  ids: string[]; rows: WorkspaceRow[]; bundle: Bundle; apply: Apply; onClear: () => void;
  /** Copy the ticked SKUs, with all their costing, into this inquiry. Left out, the button is not shown. */
  onDuplicate?: () => void; duplicating?: boolean;
  /** Make a draft customer quote from the ticked SKUs at the prices shown. Left out, the button is not shown. */
  onQuote?: () => void; quoting?: boolean;
  /** Shown at the end of the bar (the inquiry page adds Undo and a link to the workspace). */
  extra?: React.ReactNode;
}) {
  const cur = quoteCurrencyOf(bundle.inq);
  const groups = useMemo(() => bulkFieldGroups(cur), [cur]);
  const fields = useMemo(() => groups.flatMap(g => g.cols), [groups]);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const copied = useCopiedLines();
  const [fieldId, setFieldId] = useState('npm');
  const [value, setValue] = useState('');
  const [bucket, setBucket] = useState('raw_piece');
  const [scale, setScale] = useState('');

  const field = fields.find(f => f.id === fieldId)!;
  const sel = rows.filter(r => ids.includes(r.p.id));
  const withTarget = sel.filter(r => r.target != null).length;
  const withQuoted = sel.filter(r => r.quoted && !targetIsQuoted(r)).length;
  const everQuoted = sel.filter(r => r.quoted).length;
  const locked = !sel.some(r => canPriceAt(bundle, r.p));
  const lockedNote = 'This inquiry sets one margin for every SKU (Assumptions → More → Uniform NPM). Clear it to price SKUs one by one.';
  const holds = sel.some(r => canLockPrice(r.p));
  const lockedCount = sel.filter(r => r.locked).length;
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
        <FieldPicker groups={groups} value={field} onChange={id => { setFieldId(id); setValue(''); }} />
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

      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setAdding(true)}>
            <ListPlus className="h-3.5 w-3.5" /> Add items
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">Add hardware, accessories or other materials from the price list to the selected SKUs, with a quantity per unit</TooltipContent>
      </Tooltip>
      <AddItemsDialog open={adding} onOpenChange={setAdding} ids={ids} bundle={bundle} apply={apply} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setCopying(true)}>
            <Copy className="h-3.5 w-3.5" /> Copy from…
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">Make the selected SKUs cost like another SKU: its COGS lines, labour and/or shipping</TooltipContent>
      </Tooltip>
      <CopyCostingDialog open={copying} onOpenChange={setCopying} ids={ids} rows={rows} bundle={bundle} apply={apply} />
      {copied && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => apply(b => pasteCogsLines(b, ids, copied.lines))}>
              <ClipboardPaste className="h-3.5 w-3.5" /> Paste {copied.lines.length} line{copied.lines.length === 1 ? '' : 's'}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">Add the cost lines copied from {copied.from} to each selected SKU</TooltipContent>
        </Tooltip>
      )}
      {onDuplicate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={duplicating} onClick={onDuplicate}>
              {duplicating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CopyPlus className="h-3.5 w-3.5" />} Duplicate
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">Copy the selected SKUs, with all their costing, as new SKUs in this inquiry (named “(copy)”, SKU code left blank)</TooltipContent>
        </Tooltip>
      )}

      <div className="h-6 w-px bg-border" />

      <div className="flex items-center gap-1.5">
        <TargetMenu
          actions={[
            { icon: Target, label: 'Target = last quoted price', disabled: !withQuoted,
              note: withQuoted ? `Makes the price on the customer’s latest quote the target (${withQuoted} of ${ids.length} have been quoted)` : 'None of the selected SKUs has been quoted yet',
              run: () => apply(b => targetFromQuoted(b, rows, ids)) },
            { icon: Undo2, label: 'Target = today’s price', note: 'Copies today’s calculated price into the target',
              run: () => apply(b => targetFromPrice(b, rows, ids)) },
            { icon: Crosshair, label: 'Price = target', disabled: !withTarget || locked,
              note: locked ? lockedNote : `Prices each SKU exactly on its target${holds ? ' and holds it there: the margin floats as costs move' : ''} (${withTarget} of ${ids.length} have one)`,
              run: () => apply(b => markupToTarget(b, rows, ids)) },
            { icon: FileText, label: 'Price = last quoted price', disabled: !everQuoted || locked,
              note: locked ? lockedNote : everQuoted ? `Prices each SKU exactly at what the customer was last quoted${holds ? ', holds it there' : ''} and makes that the target (${everQuoted} of ${ids.length} have been quoted)` : 'None of the selected SKUs has been quoted yet',
              run: () => apply(b => priceToQuoted(b, rows, ids)) },
            ...(holds ? [{ icon: LockOpen, label: 'Unlock price', disabled: !lockedCount,
              note: lockedCount ? `Lets the price follow the cost again at today’s margin (${lockedCount} of ${ids.length} are locked)` : 'None of the selected SKUs has a locked price',
              run: () => apply(b => setPrice(b, ids, null)) }] : []),
          ]}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={!withQuotes} onClick={() => apply(b => chooseCheapestQuotes(b, ids))}>
              <Trophy className="h-3.5 w-3.5" /> Cheapest
            </Button>
          </TooltipTrigger>
          <TooltipContent>Picks the cheapest raw-piece quote for each SKU ({withQuotes} have several)</TooltipContent>
        </Tooltip>
      </div>

      {onQuote && (
        <>
          <div className="h-6 w-px bg-border" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" className="h-8 gap-1.5" disabled={quoting} onClick={onQuote}>
                {quoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Generate quote
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">Makes a draft customer quote from the {ids.length} selected SKU{ids.length === 1 ? '' : 's'} at the prices shown, then opens it to edit</TooltipContent>
          </Tooltip>
        </>
      )}
      {extra}
    </div>
  );
}

type TargetAction = { icon: LucideIcon; label: string; note: string; disabled?: boolean; run: () => void };

/** Everything you do with targets and prices, in one menu: each says what it will do before you click. */
function TargetMenu({ actions }: { actions: TargetAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5"><Target className="h-3.5 w-3.5" /> Target <ChevronDown className="h-3.5 w-3.5 opacity-60" /></Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1.5" align="center" side="top">
        {actions.map(a => (
          <button key={a.label} disabled={a.disabled} onClick={() => { a.run(); setOpen(false); }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent">
            <a.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{a.label}</span>
              <span className="block text-xs text-muted-foreground">{a.note}</span>
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Searchable field menu in sections (Pricing, Cost per unit, Packaging & size, Labor, Product setup). */
function FieldPicker({ groups, value, onChange }: { groups: { label: string; cols: Col[] }[]; value: Col; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-8 w-40 justify-between px-2 font-normal">
          <span className="truncate">{bulkLabel(value)}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" side="top">
        <Command>
          <CommandInput placeholder="Find a field…" />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty>No field found.</CommandEmpty>
            {groups.map(g => (
              <CommandGroup key={g.label} heading={g.label}>
                {g.cols.map(c => (
                  <CommandItem key={c.id} value={`${bulkLabel(c)} ${g.label}`} onSelect={() => { onChange(c.id); setOpen(false); }}>
                    <Check className={cn('mr-2 h-3.5 w-3.5', c.id === value.id ? 'opacity-100' : 'opacity-0')} />
                    {bulkLabel(c)}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
