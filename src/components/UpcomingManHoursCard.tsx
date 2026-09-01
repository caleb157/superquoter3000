import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useUpcomingManHours } from '@/hooks/use-upcoming-man-hours';

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(n >= 100 ? 0 : 1);

/**
 * Summary card: total + pipeline-weighted man-hours across all active,
 * non-PO inquiries (active weighted by product stage, projected POs by
 * certainty — same weighting as the weighted pipeline).
 */
export function UpcomingManHoursCard() {
  const { totalMh, weightedMh, loading } = useUpcomingManHours();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card>
          <CardContent className="pt-3 pb-2.5 sm:pt-4 sm:pb-3">
            <div className="text-xl sm:text-2xl font-bold tabular-nums">
              {loading ? '…' : `${fmt(weightedMh)} MH`}
            </div>
            <div className="text-[11px] sm:text-xs text-muted-foreground">
              Upcoming MH <span className="text-muted-foreground/70">({loading ? '…' : fmt(totalMh)} raw)</span>
            </div>
          </CardContent>
        </Card>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px] text-xs">
        Projected man-hours for all active + projected-PO inquiries (PO excluded).
        Weighted like the pipeline: product stage weight for active inquiries,
        certainty % for projected POs. Raw total shown in parentheses.
      </TooltipContent>
    </Tooltip>
  );
}
