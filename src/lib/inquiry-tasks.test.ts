import { describe, expect, it } from 'vitest';
import { localDateStr, summarizeInquiryTasks, type OpenTaskLite } from './inquiry-tasks';

const t = (id: string, inquiry_id: string | null, due_date: string | null, priority = 'normal'): OpenTaskLite =>
  ({ id, title: id, due_date, priority, assignee: null, inquiry_id });

describe('summarizeInquiryTasks', () => {
  it('counts open and due tasks and picks the earliest due as next', () => {
    const s = summarizeInquiryTasks([
      t('a', 'i1', '2026-10-20'),
      t('b', 'i1', '2026-10-10'),
      t('c', 'i1', null),
      t('d', 'i1', '2026-10-12'),
    ], '2026-10-12');
    expect(s.i1.openCount).toBe(4);
    expect(s.i1.dueCount).toBe(2);
    expect(s.i1.next.id).toBe('b');
  });

  it('puts undated tasks last and breaks ties on priority', () => {
    const s = summarizeInquiryTasks([
      t('x', 'i1', null, 'urgent'),
      t('y', 'i1', '2026-11-01', 'low'),
      t('z', 'i1', '2026-11-01', 'high'),
    ], '2026-10-12');
    expect(s.i1.next.id).toBe('z');
  });

  it('ignores tasks without an inquiry', () => {
    expect(summarizeInquiryTasks([t('a', null, '2026-10-01')], '2026-10-12')).toEqual({});
  });
});

describe('localDateStr', () => {
  it('uses the local calendar date', () => {
    expect(localDateStr(new Date(2026, 9, 12, 0, 30))).toBe('2026-10-12');
  });
});
