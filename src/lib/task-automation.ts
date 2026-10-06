// Pre-built trigger catalog for automated task sets. Keep in sync with
// supabase/functions/odoo-task-webhook (TRIGGERS).

export const TASK_TRIGGERS = [
  { value: 'so_created', label: 'Sales order created', hint: 'Quotation created in Odoo' },
  { value: 'so_confirmed', label: 'Sales order confirmed', hint: 'Quotation confirmed into a sales order' },
  { value: 'so_closed', label: 'Sales order closed', hint: 'All deliveries done / order locked' },
  { value: 'mo_created', label: 'Manufacturing order created', hint: 'MO generated in Odoo' },
  { value: 'mo_confirmed', label: 'Manufacturing order confirmed', hint: 'MO confirmed / scheduled' },
  { value: 'mo_closed', label: 'Manufacturing order done', hint: 'MO marked done' },
] as const;

export type TaskTrigger = typeof TASK_TRIGGERS[number]['value'];

export type TaskTemplate = {
  title: string;
  description?: string;
  assignee?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  due_offset_days?: number | null;
};

export const TEMPLATE_VARIABLES = ['so_number', 'mo_number', 'customer', 'customer_ref', 'sku'] as const;
