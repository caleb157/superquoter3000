import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { searchOdooProducts } from '@/lib/odoo-products';
import { displayName, type OdooProduct } from '@/lib/odoo-bom';

type Props = {
  value: OdooProduct | null;
  initialQuery?: string;
  onPick: (p: OdooProduct) => void;
};

/** Live Odoo product search. When the lookup isn't available, a SKU / name / unit can be typed instead. */
export function OdooProductPicker({ value, initialQuery = '', onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<OdooProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState({ sku: '', name: '', uom: 'Units' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchOdooProducts(query);
        if (!cancelled) { setRows(r); setError(null); }
      } catch (e) {
        if (!cancelled) { setRows([]); setError(e instanceof Error ? e.message : String(e)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between h-8 text-xs font-normal">
          <span className="truncate text-left">
            {value ? (value.display_name || displayName(value.sku, value.name)) : <span className="text-muted-foreground">Pick Odoo product…</span>}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] max-w-[90vw] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search Odoo by SKU or name…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Odoo…</div>}
            {!loading && error && (
              <div className="p-3 space-y-2">
                <div className="text-xs text-destructive">{error}</div>
                <div className="text-xs text-muted-foreground">Type the Odoo product instead:</div>
                <div className="flex gap-1.5">
                  <Input className="h-8 text-xs" placeholder="SKU" value={manual.sku} onChange={e => setManual({ ...manual, sku: e.target.value })} />
                  <Input className="h-8 text-xs w-24" placeholder="Unit" value={manual.uom} onChange={e => setManual({ ...manual, uom: e.target.value })} />
                </div>
                <Input className="h-8 text-xs" placeholder="Name as in Odoo" value={manual.name} onChange={e => setManual({ ...manual, name: e.target.value })} />
                <Button size="sm" className="h-7 text-xs" disabled={!manual.sku.trim() || !manual.name.trim()}
                  onClick={() => {
                    onPick({ id: null, sku: manual.sku.trim(), name: manual.name.trim(), display_name: displayName(manual.sku, manual.name), uom: manual.uom.trim() || 'Units' });
                    setOpen(false);
                  }}>Use this product</Button>
              </div>
            )}
            {!loading && !error && <CommandEmpty>No Odoo products found.</CommandEmpty>}
            {!loading && !error && rows.length > 0 && (
              <CommandGroup>
                {rows.map(p => (
                  <CommandItem key={p.id ?? p.sku} value={String(p.id)} onSelect={() => { onPick(p); setOpen(false); }}>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-xs">{p.display_name}</span>
                      <span className="text-[11px] text-muted-foreground truncate">
                        {[p.uom, p.category, p.tracked ? 'tracked' : 'not tracked'].filter(Boolean).join(' · ')}
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
