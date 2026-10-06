import { format, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';

export function formatDueDate(dateStr: string | null): { text: string; isOverdue: boolean } {
  if (!dateStr) return { text: 'No date', isOverdue: false };
  const d = new Date(dateStr + 'T00:00:00');
  const today = startOfDay(new Date());
  if (isToday(d)) return { text: 'Today', isOverdue: false };
  if (isTomorrow(d)) return { text: 'Tomorrow', isOverdue: false };
  if (isPast(d) && d < today) {
    const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
    return { text: `Overdue ${days}d`, isOverdue: true };
  }
  return { text: format(d, 'EEE, MMM d'), isOverdue: false };
}

export function priorityColor(p: string): string {
  if (p === 'urgent') return 'bg-purple-600';
  if (p === 'high') return 'bg-red-500';
  if (p === 'low') return 'bg-muted-foreground/30';
  return 'bg-amber-400';
}

/** Text colour for the priority flag icon. */
export function priorityText(p: string): string {
  if (p === 'urgent') return 'text-purple-600';
  if (p === 'high') return 'text-red-500';
  if (p === 'low') return 'text-muted-foreground/50';
  return 'text-amber-500';
}

/** Border colour for the Todoist-style checkbox ring. */
export function priorityRing(p: string): string {
  if (p === 'urgent') return 'border-purple-600 data-[state=checked]:bg-purple-600';
  if (p === 'high') return 'border-red-500 data-[state=checked]:bg-red-500';
  if (p === 'low') return 'border-muted-foreground/40';
  return 'border-amber-500 data-[state=checked]:bg-amber-500';
}

/** Left-edge accent stripe for important rows. */
export function priorityStripe(p: string): string {
  if (p === 'urgent') return 'border-l-[3px] border-l-purple-600';
  if (p === 'high') return 'border-l-[3px] border-l-red-500';
  return 'border-l-[3px] border-l-transparent';
}

export const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
