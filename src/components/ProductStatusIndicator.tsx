import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertCircle, Circle, CheckCircle2 } from 'lucide-react';

interface ProductStatusIndicatorProps {
  cbm_done: boolean;
  cogs_done: boolean;
  overhead_done: boolean;
  shipping_done: boolean;
  revenue_done: boolean;
  hasReview?: boolean;
}

export function getStatusLevel(p: { cbm_done?: boolean; cogs_done?: boolean; overhead_done?: boolean; shipping_done?: boolean; revenue_done?: boolean }) {
  const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
  const done = flags.filter(Boolean).length;
  if (done === 5) return 3; // complete
  if (done > 0) return 2; // in progress
  return 1; // not started
}

export function ProductStatusIndicator({ cbm_done, cogs_done, overhead_done, shipping_done, revenue_done, hasReview }: ProductStatusIndicatorProps) {
  const flags = [cbm_done, cogs_done, overhead_done, shipping_done, revenue_done];
  const done = flags.filter(Boolean).length;

  const tick = (v: boolean) => v ? '✓' : '✗';

  const tooltip = (
    <div className="text-[11px] space-y-0.5">
      <div>CBM: {tick(cbm_done)}</div>
      <div>COGS: {tick(cogs_done)}</div>
      <div>Overhead: {tick(overhead_done)}</div>
      <div>Shipping: {tick(shipping_done)}</div>
      <div>Revenue: {tick(revenue_done)}</div>
      {hasReview && <div className="text-red-400 font-medium mt-1">⚠ Items flagged for review</div>}
    </div>
  );

  let icon: React.ReactNode;
  if (hasReview) {
    icon = <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
  } else if (done === 5) {
    icon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  } else if (done > 0) {
    icon = (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" className="text-amber-500" strokeWidth="1.5" />
        <path d="M8 1A7 7 0 0 1 8 15" fill="currentColor" className="text-amber-500" />
      </svg>
    );
  } else {
    icon = <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help">{icon}</span>
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
