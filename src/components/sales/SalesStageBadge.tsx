import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';

export const SALES_STAGE_COLORS: Record<string, string> = {
  queued: 'bg-muted text-muted-foreground',
  in_outreach: 'bg-primary/10 text-primary',
  responded: 'bg-warning/15 text-warning',
  in_conversation: 'bg-warning/25 text-warning',
  inquiry: 'bg-success/15 text-success',
  customer: 'bg-success/25 text-success',
  not_now: 'bg-muted text-muted-foreground',
  not_a_fit: 'bg-muted text-muted-foreground line-through',
  dnc: 'bg-destructive/15 text-destructive',
};

export function SalesStageBadge({ stage, className }: { stage: string | null | undefined; className?: string }) {
  if (!stage) return null;
  return (
    <Badge variant="secondary" className={cn(SALES_STAGE_COLORS[stage] ?? SALES_STAGE_COLORS.queued, 'text-[10px] font-medium', className)}>
      {SALES_STAGE_LABELS[stage as SalesStage] ?? stage}
    </Badge>
  );
}
