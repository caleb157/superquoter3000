// Pre-built trigger catalog for automated task sets.
// Odoo events: keep in sync with supabase/functions/odoo-task-webhook (TRIGGERS).
// HQ events: fired by database triggers (run_hq_task_automation) — no webhook needed.

export const TASK_TRIGGERS = [
  { value: 'inquiry_created', label: 'Inquiry created', hint: 'A new inquiry is created in HQ', source: 'hq' },
  { value: 'customer_status_lead', label: 'Customer set to Lead', hint: 'A customer is added as, or changed to, Lead status in HQ', source: 'hq' },
  { value: 'so_created', label: 'Sales order created', hint: 'Quotation created in Odoo', source: 'odoo' },
  { value: 'so_confirmed', label: 'Sales order confirmed', hint: 'Quotation confirmed into a sales order', source: 'odoo' },
  { value: 'so_closed', label: 'Sales order closed', hint: 'All deliveries done / order locked', source: 'odoo' },
  { value: 'mo_created', label: 'Manufacturing order created', hint: 'MO generated in Odoo', source: 'odoo' },
  { value: 'mo_confirmed', label: 'Manufacturing order confirmed', hint: 'MO confirmed / scheduled', source: 'odoo' },
  { value: 'mo_closed', label: 'Manufacturing order done', hint: 'MO marked done', source: 'odoo' },
] as const;

export const ODOO_TRIGGERS = TASK_TRIGGERS.filter(t => t.source === 'odoo');

export type TaskTrigger = typeof TASK_TRIGGERS[number]['value'];

export type TaskTemplate = {
  title: string;
  description?: string;
  assignee?: string | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  due_offset_days?: number | null;
};

export const TEMPLATE_VARIABLES = ['so_number', 'mo_number', 'customer', 'customer_ref', 'sku'] as const;
export const HQ_TEMPLATE_VARIABLES: Record<string, string[]> = {
  inquiry_created: ['rfq_number', 'inquiry_title', 'customer'],
  customer_status_lead: ['customer', 'company'],
};
