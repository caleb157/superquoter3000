import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ChevronsUpDown, Loader2 } from 'lucide-react';
import { searchOdooEmployees, type OdooEmployee } from '@/lib/notes';

/** Live Odoo employee search (hr.employee). */
export function EmployeePicker({ value, onPick }: { value: string; onPick: (e: OdooEmployee) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<OdooEmployee[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try { const r = await searchOdooEmployees(query); if (!cancelled) { setRows(r); setError(null); } }
      catch (e) { if (!cancelled) { setRows([]); setError(e instanceof Error ? e.message : String(e)); } }
      finally { if (!cancelled) setLoading(false); }
    }, query ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-sm font-normal">
          <span className="truncate">{value || 'Select employee from Odoo...'}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search employee name..." value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Odoo…</div>}
            {!loading && error && <div className="px-3 py-3 text-xs text-destructive">{error}</div>}
            {!loading && !error && <CommandEmpty>No employees found.</CommandEmpty>}
            {!loading && !error && rows.length > 0 && (
              <CommandGroup>
                {rows.map(e => (
                  <CommandItem key={e.id} value={String(e.id)} onSelect={() => { onPick(e); setOpen(false); }}>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{e.name}</span>
                      {(e.job || e.department) && <span className="text-xs text-muted-foreground truncate">{[e.job, e.department].filter(Boolean).join(' · ')}</span>}
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
