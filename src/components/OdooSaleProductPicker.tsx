import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { searchOdooSaleProducts, type OdooSaleLine } from '@/lib/repeat-cost';

/** Searchable dropdown of products on past Odoo sales orders, queried live as you type. */
export function OdooSaleProductPicker({ value, label, onPick, initialSearch }: {
  value: number | null;   // picked sale_line_id
  label: string;
  onPick: (line: OdooSaleLine) => void;
  /** What the search starts with (the product's SKU), so the likely match is first. */
  initialSearch?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialSearch ?? '');
  const [lines, setLines] = useState<OdooSaleLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await searchOdooSaleProducts(query);
        if (!cancelled) { setLines(rows); setError(null); }
      } catch (e) {
        if (!cancelled) { setLines([]); setError(e instanceof Error ? e.message : String(e)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full sm:w-[420px] justify-between h-9 text-sm font-normal">
          <span className="truncate">{value ? label : 'Pick the product from a past Odoo sales order…'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search SO number, customer, SKU or product…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Odoo…</div>}
            {!loading && error && <div className="px-3 py-3 text-xs text-destructive">{error}</div>}
            {!loading && !error && <CommandEmpty>No sales order products found in Odoo.</CommandEmpty>}
            {!loading && !error && lines.length > 0 && (
              <CommandGroup>
                {lines.map(l => (
                  <CommandItem key={l.sale_line_id} value={String(l.sale_line_id)} onSelect={() => { onPick(l); setOpen(false); }}>
                    <Check className={cn('mr-2 h-4 w-4 shrink-0', value === l.sale_line_id ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{l.sku ? `[${l.sku}] ` : ''}{l.name}</span>
                      <span className="text-xs text-muted-foreground truncate tabular-nums">
                        {[l.order, l.customer, l.date, `${l.quantity} pcs @ ${l.price_unit.toFixed(2)} ${l.currency}`].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

