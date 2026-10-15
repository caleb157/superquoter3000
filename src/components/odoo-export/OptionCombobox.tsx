import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type Option = { value: string; hint?: string };
type Props = {
  value: string;
  options: (string | Option)[];
  onChange: (v: string) => void;
  placeholder?: string;
  /** Allows a value that isn't in the list (typed in the search box). */
  allowCustom?: boolean;
  className?: string;
  loading?: boolean;
};

/** A real searchable dropdown (the native datalist only showed options after typing). */
export function OptionCombobox({ value, options, onChange, placeholder = 'Pick…', allowCustom, className, loading }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const opts: Option[] = options.map(o => (typeof o === 'string' ? { value: o } : o));
  const ql = q.trim().toLowerCase();
  const shown = ql ? opts.filter(o => `${o.value} ${o.hint ?? ''}`.toLowerCase().includes(ql)) : opts;
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={cn('w-full justify-between h-8 text-xs font-normal', className)}>
          <span className={cn('truncate text-left', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[360px] max-w-[90vw] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading from Odoo…' : 'Nothing found.'}</CommandEmpty>
            {allowCustom && q.trim() && !opts.some(o => o.value.toLowerCase() === ql) && (
              <CommandGroup>
                <CommandItem value={`custom:${q}`} onSelect={() => pick(q.trim())}>Use "{q.trim()}"</CommandItem>
              </CommandGroup>
            )}
            {shown.length > 0 && (
              <CommandGroup>
                {shown.slice(0, 300).map(o => (
                  <CommandItem key={o.value} value={o.value} onSelect={() => pick(o.value)}>
                    <Check className={cn('mr-1.5 h-3.5 w-3.5', o.value === value ? 'opacity-100' : 'opacity-0')} />
                    <div className="flex flex-col min-w-0">
                      <span className="truncate text-xs">{o.value}</span>
                      {o.hint && <span className="truncate text-[11px] text-muted-foreground">{o.hint}</span>}
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
