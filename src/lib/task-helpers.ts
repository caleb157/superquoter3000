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
  if (p === 'high' || p === 'urgent') return 'bg-red-500';
  if (p === 'low') return 'bg-muted-foreground/30';
  return 'bg-amber-400';
}
