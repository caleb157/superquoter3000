import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const COLORS: Record<string, string> = {
  lead: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  inactive: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  churned: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

const LABELS: Record<string, string> = {
  lead: 'Lead',
  active: 'Active',
  inactive: 'Inactive',
  churned: 'Churned',
};

export function LeadStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = (status || 'lead').toLowerCase();
  return (
    <Badge variant="secondary" className={cn(COLORS[s] || COLORS.lead, 'text-[10px] font-medium', className)}>
      {LABELS[s] || status}
    </Badge>
  );
}
