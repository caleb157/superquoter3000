// "Postpone" dropdown for a task: 1 day / 1 week / 1 month, each showing the date it lands on.
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { POSTPONE_OPTIONS, postponeDate, shortDate } from '@/lib/task-postpone';
import { cn } from '@/lib/utils';

export function PostponeMenu({ due, onPick, variant = 'icon', className, disabled }: {
  due: string | null | undefined;
  onPick: (newDue: string) => void;
  /** icon: compact icon button for list rows; button: labelled button for the task card. */
  variant?: 'icon' | 'button';
  className?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {variant === 'icon' ? (
          <Button variant="ghost" size="icon" className={cn('h-7 w-7 shrink-0', className)} aria-label="Postpone" title="Postpone"
            onClick={e => e.stopPropagation()}>
            <CalendarClock className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" className={cn('h-9 gap-1.5', className)}>
            <CalendarClock className="h-3.5 w-3.5" /> Postpone
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Postpone by</DropdownMenuLabel>
        {POSTPONE_OPTIONS.map(o => {
          const next = postponeDate(due, o.by);
          return (
            <DropdownMenuItem key={o.by} onSelect={() => onPick(next)} className="justify-between gap-6">
              <span>{o.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{shortDate(next)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
