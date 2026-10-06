// Todoist-style recurrence. A recurring task is a single living record:
// completing it logs a "done" copy and rolls the original's due date forward.
import { addDays, addMonths, addYears, format, getDaysInMonth, startOfWeek, differenceInCalendarWeeks } from 'date-fns';

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceMode = 'due' | 'completion';

export type RecurrenceRule = {
  freq: RecurrenceFreq;
  interval: number;          // every N units
  weekdays?: number[];       // weekly only, 0=Sun..6=Sat
  monthDay?: number;         // monthly only, 1..31
  mode: RecurrenceMode;      // 'due' = from due date (every), 'completion' = from completion (every!)
};

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseRule(v: unknown): RecurrenceRule | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as any;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  return {
    freq: r.freq,
    interval: Math.max(1, Number(r.interval) || 1),
    weekdays: Array.isArray(r.weekdays) ? r.weekdays.filter((n: any) => n >= 0 && n <= 6) : undefined,
    monthDay: r.monthDay ? Math.min(31, Math.max(1, Number(r.monthDay))) : undefined,
    mode: r.mode === 'completion' ? 'completion' : 'due',
  };
}

export function ruleLabel(rule: RecurrenceRule | null, dueDate?: string | null): string {
  if (!rule) return 'Does not repeat';
  const n = rule.interval;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
  let s = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (rule.freq === 'weekly' && rule.weekdays?.length) {
    s += ' on ' + [...rule.weekdays].sort().map(d => WD[d]).join(', ');
  } else if (rule.freq === 'monthly') {
    const d = rule.monthDay ?? (dueDate ? Number(dueDate.slice(8, 10)) : null);
    if (d) s += ` on day ${d}`;
  } else if (rule.freq === 'yearly' && dueDate) {
    s += ` on ${format(new Date(dueDate + 'T00:00:00'), 'MMM d')}`;
  }
  if (rule.mode === 'completion') s += ' (after completion)';
  return s;
}

function step(rule: RecurrenceRule, base: Date): Date {
  switch (rule.freq) {
    case 'daily':
      return addDays(base, rule.interval);
    case 'weekly': {
      const days = rule.weekdays?.length ? rule.weekdays : [base.getDay()];
      const baseWeek = startOfWeek(base);
      for (let i = 1; i <= 7 * rule.interval + 7; i++) {
        const d = addDays(base, i);
        const wk = differenceInCalendarWeeks(startOfWeek(d), baseWeek);
        if (days.includes(d.getDay()) && (wk === 0 || wk % rule.interval === 0)) return d;
      }
      return addDays(base, 7 * rule.interval);
    }
    case 'monthly': {
      const m = addMonths(base, rule.interval);
      const want = rule.monthDay ?? base.getDate();
      m.setDate(Math.min(want, getDaysInMonth(m)));
      return m;
    }
    case 'yearly':
      return addYears(base, rule.interval);
  }
}

/** Next due date (YYYY-MM-DD) after completing a task today. */
export function nextDueDate(rule: RecurrenceRule, currentDue: string | null, today = new Date()): string {
  const t = new Date(today); t.setHours(0, 0, 0, 0);
  if (rule.mode === 'completion' || !currentDue) return format(step(rule, t), 'yyyy-MM-dd');
  let d = step(rule, new Date(currentDue + 'T00:00:00'));
  let guard = 0;
  while (d <= t && guard++ < 1000) d = step(rule, d);
  return format(d, 'yyyy-MM-dd');
}
