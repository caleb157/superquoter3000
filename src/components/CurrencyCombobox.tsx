import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Currency = {
  code: string;
  name: string;
  is_featured: boolean;
  sort_priority: number;
};

let cache: Currency[] | null = null;
let inflight: Promise<Currency[]> | null = null;
const subs = new Set<(c: Currency[]) => void>();

export async function loadCurrencies(force = false): Promise<Currency[]> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    const { data } = await (supabase as any)
      .from('currencies')
      .select('code, name, is_featured, sort_priority')
      .order('is_featured', { ascending: false })
      .order('sort_priority', { ascending: true })
      .order('code', { ascending: true });
    cache = (data || []) as Currency[];
    inflight = null;
    subs.forEach(fn => fn(cache!));
    return cache;
  })();
  return inflight;
}

export function invalidateCurrencies() {
  cache = null;
  loadCurrencies(true);
}

type Props = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  className?: string;
};

export function CurrencyCombobox({ value, onChange, disabled, className }: Props) {
  const [open, setOpen] = useState(false);
  const [currencies, setCurrencies] = useState<Currency[]>(cache || []);

  useEffect(() => {
    const fn = (c: Currency[]) => setCurrencies(c);
    subs.add(fn);
    loadCurrencies().then(setCurrencies);
    return () => { subs.delete(fn); };
  }, []);

  const featured = currencies.filter(c => c.is_featured);
  const rest = currencies.filter(c => !c.is_featured);

  const selected = currencies.find(c => c.code === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 px-3 text-sm font-normal justify-between w-full', className)}
        >
          <span className="truncate">
            {selected ? `${selected.code} — ${selected.name}` : (value || 'Select currency…')}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align="start">
        <Command>
          <CommandInput placeholder="Search currency…" className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty className="py-2 px-2 text-xs text-muted-foreground">No currency found.</CommandEmpty>
            {featured.length > 0 && (
              <CommandGroup heading="Featured">
                {featured.map(c => (
                  <CommandItem
                    key={c.code}
                    value={`${c.code} ${c.name}`}
                    onSelect={() => { onChange(c.code); setOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3', value === c.code ? 'opacity-100' : 'opacity-0')} />
                    <span className="font-medium mr-1.5">{c.code}</span>
                    <span className="text-muted-foreground">— {c.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {featured.length > 0 && rest.length > 0 && <CommandSeparator />}
            {rest.length > 0 && (
              <CommandGroup heading="All currencies">
                {rest.map(c => (
                  <CommandItem
                    key={c.code}
                    value={`${c.code} ${c.name}`}
                    onSelect={() => { onChange(c.code); setOpen(false); }}
                    className="text-xs"
                  >
                    <Check className={cn('mr-2 h-3 w-3', value === c.code ? 'opacity-100' : 'opacity-0')} />
                    <span className="font-medium mr-1.5">{c.code}</span>
                    <span className="text-muted-foreground">— {c.name}</span>
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
