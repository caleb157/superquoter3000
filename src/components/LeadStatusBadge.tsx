import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const LEAD_STATUS_COLORS: Record<string, string> = {
  lead: 'bg-muted text-muted-foreground',
  active: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  won: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  inactive: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  churned: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

export const LEAD_STATUS_LABELS: Record<string, string> = {
  lead: 'Lead',
  active: 'Live Inquiry',
  won: 'Won',
  inactive: 'Inactive',
  churned: 'Churned',
};

export const LEAD_STATUS_ORDER = ['lead', 'active', 'won', 'inactive', 'churned'] as const;
export type LeadStatus = typeof LEAD_STATUS_ORDER[number];

export function LeadStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = (status || 'lead').toLowerCase();
  return (
    <Badge variant="secondary" className={cn(LEAD_STATUS_COLORS[s] || LEAD_STATUS_COLORS.lead, 'text-[10px] font-medium', className)}>
      {LEAD_STATUS_LABELS[s] || status}
    </Badge>
  );
}
