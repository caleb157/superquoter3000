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
  /** Start a new task linked to this customer complaint. */
  complaintId?: string;
  /** Start a new task already tagged as an app fix. */
  appFix?: boolean;
};

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = typeof PRIORITIES[number];

/** 'due_by_today' = due today or overdue (the home page's today list). */
export const DUE_WINDOWS = ['all', 'overdue', 'today', 'due_by_today', 'this_week'] as const;
export type DueWindow = typeof DUE_WINDOWS[number];

export const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export type TaskSortKey = 'title' | 'inquiry' | 'due_date' | 'priority' | 'status' | 'assignee' | 'created_at';
export type TaskSortDir = 'asc' | 'desc';
