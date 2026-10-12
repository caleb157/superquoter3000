import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { orderLabel, orderStateLabel, searchOdooOrders, type OdooOrder, type OdooOrderKind } from '@/lib/odoo-orders';

type Props = {
  kind: OdooOrderKind;
  value: string;              // picked order number (association_id)
  label: string;              // saved label (association_label)
  onPick: (name: string, label: string | null) => void;
};

/** Searchable dropdown that queries Odoo live as you type; nothing is cached or stored. */
export function OdooOrderPicker({ kind, value, label, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [orders, setOrders] = useState<OdooOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const rows = await searchOdooOrders(kind, query);
        if (!cancelled) { setOrders(rows); setError(null); }
      } catch (e) {
        if (!cancelled) { setOrders([]); setError(e instanceof Error ? e.message : String(e)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query, kind]);

  const noun = kind === 'so' ? 'sales order' : 'manufacturing order';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal mt-1.5">
          <span className="truncate">
            {value ? <>{value}{label && <span className="text-muted-foreground"> — {label}</span>}</> : `Select ${noun} from Odoo...`}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={kind === 'so' ? 'Search SO number, customer or reference...' : 'Search MO number, SKU or source...'}
            value={query} onValueChange={setQuery}
          />
          <CommandList>
            {loading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Odoo…</div>}
            {!loading && error && <div className="px-3 py-3 text-xs text-destructive">{error}</div>}
            {!loading && !error && <CommandEmpty>No {noun}s found in Odoo.</CommandEmpty>}
            {!loading && !error && orders.length > 0 && (
              <CommandGroup>
                {orders.map(o => (
                  <CommandItem key={o.id} value={String(o.id)} onSelect={() => { onPick(o.name, orderLabel(kind, o)); setOpen(false); }}>
                    <Check className={cn('mr-2 h-4 w-4 shrink-0', value === o.name ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{o.name} <span className="text-muted-foreground">· {orderStateLabel(kind, o.state)}</span></span>
                      <span className="text-xs text-muted-foreground truncate">
                        {kind === 'so' ? [o.customer, o.reference].filter(Boolean).join(' · ') : [o.sku || o.product, o.reference].filter(Boolean).join(' · ')}
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
