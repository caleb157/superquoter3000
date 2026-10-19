// Adds price-list items (Settings → Materials & hardware) to every ticked SKU at a quantity
// per unit. Prices come from the list as it is now; nothing is copied into a new list.
import { useMemo, useState } from 'react';
import { ChevronsUpDown, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCogsCategories } from '@/lib/cogs-categories';
import { addPriceListLines, priceListItems, type Apply, type Bundle, type PriceListItem } from '@/lib/costing-workspace';
import { cn } from '@/lib/utils';
import { inr, parseNum } from './cells';

type Line = { uid: number; item: PriceListItem | null; qty: string };

/** Raw pieces are vendor quotes, not list items. */
const SKIP = new Set(['Raw Piece']);

export function AddItemsDialog({ open, onOpenChange, ids, bundle, apply }: {
  open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; bundle: Bundle; apply: Apply;
}) {
  const categories = useCogsCategories();
  // Grouped in costing-sheet category order, names A–Z within each.
  const items = useMemo(() => {
    const cats = categories.filter(c => !SKIP.has(c));
    return priceListItems(bundle, cats).sort((x, y) => cats.indexOf(x.category) - cats.indexOf(y.category));
  }, [bundle, categories]);
  const [lines, setLines] = useState<Line[]>([{ uid: 0, item: null, qty: '1' }]);

  const set = (uid: number, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.uid === uid ? { ...l, ...patch } : l)));
  const ready = lines.flatMap(l => {
    const qty = parseNum(l.qty);
    return l.item && qty != null && qty > 0 ? [{ item: l.item, qty }] : [];
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setLines([{ uid: 0, item: null, qty: '1' }]);
  };
  const run = () => {
    if (!ready.length) return;
    apply(b => addPriceListLines(b, ids, ready));
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add items to {ids.length} SKU{ids.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>
            Pick from the Materials &amp; hardware price list and set how many go on each unit. A SKU that already has the item gets its quantity and price updated instead of a second line.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-2" onSubmit={e => { e.preventDefault(); run(); }}>
          <div className="grid grid-cols-[1fr_88px_96px_28px] gap-2 px-0.5 text-xs font-medium text-muted-foreground">
            <span>Item</span><span className="text-right">Qty / unit</span><span className="text-right">₹ / unit</span><span />
          </div>
          {lines.map(l => {
            const qty = parseNum(l.qty);
            return (
              <div key={l.uid} className="grid grid-cols-[1fr_88px_96px_28px] items-center gap-2">
                <ItemPicker items={items} value={l.item} onChange={item => set(l.uid, { item })} />
                <Input className="h-9 text-right" inputMode="decimal" value={l.qty} onChange={e => set(l.uid, { qty: e.target.value })} aria-label="Quantity per unit" />
                <span className="text-right text-sm tabular-nums text-muted-foreground">
                  {l.item && qty != null ? inr(l.item.unitCostInr * qty, 2) : '—'}
                </span>
                <button type="button" className="text-muted-foreground/60 hover:text-destructive disabled:opacity-30" disabled={lines.length === 1}
                  onClick={() => setLines(ls => ls.filter(x => x.uid !== l.uid))} aria-label="Remove row">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground"
            onClick={() => setLines(ls => [...ls, { uid: Math.max(...ls.map(x => x.uid)) + 1, item: null, qty: '1' }])}>
            <Plus className="h-3.5 w-3.5" /> Another item
          </Button>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready.length}>Add to {ids.length} SKU{ids.length === 1 ? '' : 's'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Searchable price-list picker, grouped by category. */
function ItemPicker({ items, value, onChange }: { items: PriceListItem[]; value: PriceListItem | null; onChange: (i: PriceListItem) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, PriceListItem[]>();
    for (const i of items) m.set(i.category, [...(m.get(i.category) || []), i]);
    return [...m];
  }, [items]);
  return (
    // Modal so the list scrolls with the wheel while the dialog behind it locks scrolling.
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-9 min-w-0 justify-between font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? <>{value.name} <span className="text-muted-foreground">· {value.category}</span></> : 'Choose an item…'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search the price list…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No item found. Add it in Settings → Materials &amp; hardware.</CommandEmpty>
            {groups.map(([cat, list]) => (
              <CommandGroup key={cat} heading={cat}>
                {list.map((i, n) => (
                  <CommandItem key={i.key} value={`${i.name} ${cat} #${n}`} onSelect={() => { onChange(i); setOpen(false); }}>
                    <span className="flex-1 truncate">{i.name}</span>
                    <span className="ml-3 shrink-0 text-xs tabular-nums text-muted-foreground">{inr(i.unitCostInr, 2)}/{i.units}</span>
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
