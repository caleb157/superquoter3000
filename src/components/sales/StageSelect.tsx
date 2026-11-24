// The one status picker for an account (Customers list, customer page, Sales tab all use the same stages).
// Do not contact is never picked here: it is set with its own button so every sender is told.
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ALL_SALES_STAGES, SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';
import { SalesStageBadge } from './SalesStageBadge';
import { cn } from '@/lib/utils';

export const PICKABLE_STAGES = ALL_SALES_STAGES.filter(s => s !== 'dnc');

export function StageSelect({ stage, dnc, onChange, className, badge }: {
  stage: string | null | undefined;
  dnc?: boolean | null;
  onChange: (next: SalesStage) => void;
  className?: string;
  /** Show the coloured badge as the trigger (page headers) instead of a plain select box. */
  badge?: boolean;
}) {
  if (dnc || stage === 'dnc') return <SalesStageBadge stage="dnc" />;
  return (
    <Select value={stage ?? ''} onValueChange={v => { if (v !== stage) onChange(v as SalesStage); }}>
      <SelectTrigger
        aria-label="Sales stage"
        className={cn(badge ? 'h-auto w-auto border-none p-0 bg-transparent shadow-none focus:ring-0 hover:bg-muted/60 rounded px-1 -mx-1 [&>svg]:hidden gap-0' : 'h-7 text-xs w-[150px]', className)}
      >
        {badge ? <SalesStageBadge stage={stage} /> : <SelectValue placeholder="Stage" />}
      </SelectTrigger>
      <SelectContent>
        {PICKABLE_STAGES.map(s => <SelectItem key={s} value={s}>{SALES_STAGE_LABELS[s]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
