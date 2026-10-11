import { useState } from 'react';
import { fmtDays } from '@/lib/analytics-helpers';
import type { MonthPoint } from '@/lib/timing-kpis';
import { cn } from '@/lib/utils';

/** Median days per month as bars, with the target as a dashed line. Lower is better. */
export function MonthlyTrend({ points, goal, label }: { points: MonthPoint[]; goal: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const H = 96;
  const max = Math.max(goal * 1.25, ...points.map(p => p.median ?? 0), 1);
  const y = (v: number) => (v / max) * H;
  const shown = hover != null ? points[hover] : null;

  return (
    <div className="rounded-md border px-3 pt-2 pb-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {shown ? `${shown.label}: ${shown.median != null ? `${fmtDays(shown.median)} median, ${shown.n} counted` : 'none counted'}` : `target ≤ ${goal}d`}
        </span>
      </div>
      <div className="relative mt-2" style={{ height: H }} role="img"
        aria-label={`${label}: ${points.map(p => `${p.label} ${p.median != null ? fmtDays(p.median) : 'none'}`).join(', ')}`}>
        <div className="absolute inset-x-0 border-t border-dashed border-muted-foreground/60" style={{ bottom: y(goal) }} />
        <div className="absolute inset-0 flex items-end gap-0.5">
          {points.map((p, i) => (
            <div key={p.key} className="flex h-full flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {p.median != null ? (
                <div className={cn('w-full max-w-10 rounded-t-[4px] bg-primary transition-opacity', hover != null && hover !== i && 'opacity-50')}
                  style={{ height: Math.max(2, y(p.median)) }} />
              ) : (
                <div className="w-full max-w-10 border-b border-border" />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-0.5 border-t pt-1 text-[10px] text-muted-foreground">
        {points.map((p, i) => (
          <span key={p.key} className={cn('flex-1 text-center', hover === i && 'text-foreground')}>{p.label}</span>
        ))}
      </div>
    </div>
  );
}
