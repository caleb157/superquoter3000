// Postponing a task: push its due date out by a day, a week or a month. Counts from the later of
// today and the current due date, so an overdue task lands in the future instead of staying overdue.
import { addDays, addMonths, addWeeks, format, startOfDay } from 'date-fns';

export type PostponeBy = 'day' | 'week' | 'month';
export const POSTPONE_OPTIONS: { by: PostponeBy; label: string }[] = [
  { by: 'day', label: '1 day' },
  { by: 'week', label: '1 week' },
  { by: 'month', label: '1 month' },
];

const toDate = (s: string) => new Date(`${s}T00:00:00`);

/** New due date (yyyy-MM-dd) for a task due on `due` (yyyy-MM-dd or null). */
export function postponeDate(due: string | null | undefined, by: PostponeBy, today: Date = new Date()): string {
  const t = startOfDay(today);
  const d = due ? toDate(due) : null;
  const base = d && d > t ? d : t;
  const next = by === 'day' ? addDays(base, 1) : by === 'week' ? addWeeks(base, 1) : addMonths(base, 1);
  return format(next, 'yyyy-MM-dd');
}

export const shortDate = (s: string) => format(toDate(s), 'EEE, MMM d');
