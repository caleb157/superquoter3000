// Open-task summary per inquiry for the home page: how many open tasks each inquiry has and which
// one is due next (earliest due date, undated last, higher priority first on ties).
import { format } from 'date-fns';
import { PRIORITY_RANK } from '@/lib/task-types';

export type OpenTaskLite = {
  id: string;
  title: string;
  due_date: string | null;
  priority: string;
  assignee: string | null;
  inquiry_id: string | null;
};

export type InquiryTaskSummary = {
  openCount: number;
  /** Open tasks due today or earlier. */
  dueCount: number;
  next: OpenTaskLite;
};

/** Local calendar date as yyyy-MM-dd (toISOString would give yesterday east of UTC before 05:30). */
export const localDateStr = (d: Date = new Date()) => format(d, 'yyyy-MM-dd');

const byNext = (a: OpenTaskLite, b: OpenTaskLite) => {
  if (a.due_date !== b.due_date) {
    if (a.due_date == null) return 1;
    if (b.due_date == null) return -1;
    return a.due_date.localeCompare(b.due_date);
  }
  return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
};

export function summarizeInquiryTasks(
  tasks: OpenTaskLite[],
  today: string = localDateStr(),
): Record<string, InquiryTaskSummary> {
  const out: Record<string, InquiryTaskSummary> = {};
  for (const t of tasks) {
    if (!t.inquiry_id) continue;
    const due = t.due_date != null && t.due_date <= today ? 1 : 0;
    const s = out[t.inquiry_id];
    if (!s) {
      out[t.inquiry_id] = { openCount: 1, dueCount: due, next: t };
    } else {
      s.openCount += 1;
      s.dueCount += due;
      if (byNext(t, s.next) < 0) s.next = t;
    }
  }
  return out;
}
