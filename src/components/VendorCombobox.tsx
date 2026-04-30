import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Vendor = { id: string; name: string };

// Module-level cache + subscribers so all comboboxes share & refresh together.
let vendorCache: Vendor[] | null = null;
let inflight: Promise<Vendor[]> | null = null;
const subs = new Set<(v: Vendor[]) => void>();

async function loadVendors(force = false): Promise<Vendor[]> {
  if (!force && vendorCache) return vendorCache;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase.from('vendors').select('id, name').order('name');
    vendorCache = (data || []) as Vendor[];
    inflight = null;
    subs.forEach(fn => fn(vendorCache!));
    return vendorCache;
  })();
  return inflight;
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
};

export function VendorCombobox({ value, onChange, className, placeholder = 'Vendor' }: Props) {
  const [open, setOpen] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>(vendorCache || []);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const fn = (v: Vendor[]) => setVendors(v);
    subs.add(fn);
    loadVendors().then(setVendors);
    return () => { subs.delete(fn); };
  }, []);

  const trimmedSearch = search.trim();
  const lowerNames = vendors.map(v => v.name.toLowerCase());
  const exactExists = trimmedSearch && lowerNames.includes(trimmedSearch.toLowerCase());

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
    setSearch('');
  };

  const createAndSelect = async () => {
    if (!trimmedSearch || creating) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('vendors')
      .insert({ name: trimmedSearch })
      .select('id, name')
      .single();
    setCreating(false);
    if (error) { toast.error(`Could not add vendor: ${error.message}`); return; }
    if (data) {
      // Refresh shared cache so other open comboboxes see it too.
      vendorCache = [...(vendorCache || []), data as Vendor].sort((a, b) => a.name.localeCompare(b.name));
      subs.forEach(fn => fn(vendorCache!));
      select((data as Vendor).name);
      toast.success(`Added vendor "${(data as Vendor).name}"`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'h-6 px-2 text-xs font-normal justify-between border border-transparent hover:border-input w-full',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown className="h-3 w-3 opacity-50 shrink-0 ml-1" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[240px]" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search vendor…"
            value={search}
            onValueChange={setSearch}
            className="h-8 text-xs"
          />
          <CommandList>
            <CommandEmpty className="py-2 px-2 text-xs text-muted-foreground">
              No vendor found.
            </CommandEmpty>
            {value && (
              <CommandGroup heading="Current">
                <CommandItem
                  value={`__clear_${value}`}
                  onSelect={() => select('')}
                  className="text-xs text-muted-foreground"
                >
                  Clear vendor
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading="Vendors">
              {vendors.map(v => (
                <CommandItem
                  key={v.id}
                  value={v.name}
                  onSelect={() => select(v.name)}
                  className="text-xs"
                >
                  <Check className={cn('mr-2 h-3 w-3', value === v.name ? 'opacity-100' : 'opacity-0')} />
                  {v.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {trimmedSearch && !exactExists && (
              <CommandGroup heading="Add new">
                <CommandItem
                  value={`__create_${trimmedSearch}`}
                  onSelect={createAndSelect}
                  className="text-xs"
                  disabled={creating}
                >
                  <Plus className="mr-2 h-3 w-3" />
                  Add "{trimmedSearch}" as new vendor
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
