import type { Tables } from '@/integrations/supabase/types';

export type Task = Tables<'tasks'>;

export type TaskWithRefs = Task & {
  inquiry?: { id: string; rfq_number: string; title: string | null } | null;
  customer?: { id: string; name: string } | null;
  product?: { id: string; name: string } | null;
};

export type TaskContext = {
  inquiryId?: string;
  productId?: string;
  customerId?: string;
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = typeof PRIORITIES[number];

export const DUE_WINDOWS = ['all', 'overdue', 'today', 'this_week'] as const;
export type DueWindow = typeof DUE_WINDOWS[number];

export const ASSIGNEES = ['CQ', 'PH'] as const;

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export type TaskSortKey = 'title' | 'inquiry' | 'due_date' | 'priority' | 'assignee' | 'created_at';
export type TaskSortDir = 'asc' | 'desc';
