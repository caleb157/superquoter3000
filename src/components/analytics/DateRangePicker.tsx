import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { RANGE_LABELS, type RangePreset, rangeFromPreset, type DateRange } from '@/lib/analytics-helpers';

type Props = {
  preset: RangePreset;
  customFrom?: string;
  customTo?: string;
  onChange: (preset: RangePreset, custom?: { from?: string; to?: string }) => void;
};

const PRESETS: RangePreset[] = ['7d', '14d', '30d', 'this_q', 'last_q', 'this_fy', 'last_fy', 'custom'];

export function DateRangePicker({ preset, customFrom, customTo, onChange }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const range: DateRange = rangeFromPreset(preset, { from: customFrom, to: customTo });

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 gap-2">
            <CalendarIcon className="h-3.5 w-3.5" />
            {RANGE_LABELS[preset]}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {PRESETS.map(p => (
            <DropdownMenuItem
              key={p}
              onSelect={() => {
                if (p === 'custom') setCustomOpen(true);
                else onChange(p);
              }}
            >
              {RANGE_LABELS[p]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {preset === 'custom' && (
        <Popover open={customOpen} onOpenChange={setCustomOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn('h-9 gap-2', !customFrom && 'text-muted-foreground')}
            >
              {customFrom && customTo
                ? `${format(new Date(customFrom), 'MMM d')} – ${format(new Date(customTo), 'MMM d')}`
                : 'Pick range'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              mode="range"
              defaultMonth={customFrom ? new Date(customFrom) : new Date()}
              selected={{
                from: customFrom ? new Date(customFrom) : undefined,
                to: customTo ? new Date(customTo) : undefined,
              }}
              onSelect={(r) => {
                if (!r) return;
                onChange('custom', {
                  from: r.from ? format(r.from, 'yyyy-MM-dd') : undefined,
                  to: r.to ? format(r.to, 'yyyy-MM-dd') : undefined,
                });
              }}
              className={cn('p-3 pointer-events-auto')}
            />
          </PopoverContent>
        </Popover>
      )}

      <span className="hidden md:inline text-[11px] text-muted-foreground">
        {format(range.from, 'MMM d, yyyy')} – {format(range.to, 'MMM d, yyyy')}
      </span>
    </div>
  );
}
