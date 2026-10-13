import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const LEAD_STATUS_COLORS: Record<string, string> = {
  lead: 'bg-muted text-muted-foreground',
  active: 'bg-warning/15 text-warning',
  won: 'bg-success/15 text-success',
  inactive: 'bg-muted text-muted-foreground',
  churned: 'bg-destructive/15 text-destructive',
};

// Stored values stay as they are; only the labels people see change.
export const LEAD_STATUS_LABELS: Record<string, string> = {
  lead: 'Lead',
  active: 'Live inquiry',
  won: 'Customer',
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
