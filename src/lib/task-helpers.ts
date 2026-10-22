import { format, isToday, isTomorrow, isPast, startOfDay } from 'date-fns';

/** Local calendar date as yyyy-MM-dd (toISOString would give yesterday in India before 05:30). */
export const localDateStr = (d: Date = new Date()) => format(d, 'yyyy-MM-dd');

export function taskDueDateError(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Due date is required';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) || localDateStr(date) !== value ? 'Choose a valid due date' : null;
}

export function taskDueState(date: string | null, status: string, today = localDateStr()): 'overdue' | 'today' | 'other' {
  if (!date || status !== 'open') return 'other';
  return date < today ? 'overdue' : date === today ? 'today' : 'other';
}

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

/** Text colour for the priority flag icon. */
export function priorityText(p: string): string {
  if (p === 'urgent') return 'text-highlight';
  if (p === 'high') return 'text-destructive';
  if (p === 'low') return 'text-muted-foreground/50';
  return 'text-warning';
}

/** Border colour for the Todoist-style checkbox ring. */
export function priorityRing(p: string): string {
  if (p === 'urgent') return 'border-highlight data-[state=checked]:bg-highlight';
  if (p === 'high') return 'border-destructive data-[state=checked]:bg-destructive';
  if (p === 'low') return 'border-muted-foreground/40';
  return 'border-warning data-[state=checked]:bg-warning';
}

/** Left-edge accent stripe for important rows. */
export function priorityStripe(p: string): string {
  if (p === 'urgent') return 'border-l-[3px] border-l-highlight';
  if (p === 'high') return 'border-l-[3px] border-l-destructive';
  return 'border-l-[3px] border-l-transparent';
}

export const PRIORITY_LABEL: Record<string, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
