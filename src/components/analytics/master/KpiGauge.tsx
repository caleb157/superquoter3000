import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  /** Formatted display of the actual value. */
  display: string;
  /** Numeric actual (null = no data). */
  actual: number | null;
  /** Numeric goal for the period. */
  goal: number;
  goalDisplay: string;
  /** true = higher is better (revenue, OTD); false = lower is better (days, complaints). */
  higherIsBetter: boolean;
  sub?: string;
  onClick?: () => void;
};

/** Progress ratio 0..1+ where 1 = goal met. */
export function gaugeScore(actual: number | null, goal: number, higher: boolean) {
  if (actual == null) return null;
  if (!goal) return higher ? null : actual <= 0 ? 1.5 : 0.3;
  if (higher) return actual / goal;
  return actual <= 0 ? 1.5 : goal / actual;
}

export function KpiGauge({ label, display, actual, goal, goalDisplay, higherIsBetter, sub, onClick }: Props) {
  const score = gaugeScore(actual, goal, higherIsBetter);
  // Arc spans 0..1.5× goal so the goal tick sits at 2/3 of the sweep.
  const MAX = 1.5;
  const frac = score == null ? 0 : Math.min(score, MAX) / MAX;
  const tone = score == null ? 'muted-foreground' : score >= 1 ? 'success' : score >= (higherIsBetter ? 0.75 : 1 / 1.2) ? 'warning' : 'destructive';
  const R = 40, C = Math.PI * R;
  const goalAngle = Math.PI * (1 - 1 / MAX);
  const gx = 50 + R * Math.cos(goalAngle), gy = 50 - R * Math.sin(goalAngle);
  const gx2 = 50 + (R + 8) * Math.cos(goalAngle), gy2 = 50 - (R + 8) * Math.sin(goalAngle);
  const status = score == null ? 'no data' : score >= 1 ? 'on target' : higherIsBetter ? `${Math.round(score * 100)}% of goal` : 'behind goal';

  return (
    <Card className={cn('h-full', onClick && 'cursor-pointer hover:bg-muted/40 transition-colors')} onClick={onClick}>
      <CardContent className="pt-3 pb-3 px-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex justify-between">
          <span>{label}</span>
          {onClick && <span className="text-[10px] normal-case tracking-normal opacity-70">View →</span>}
        </div>
        <svg viewBox="0 0 100 58" className="w-full max-w-[180px] mx-auto block mt-1">
          <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="hsl(var(--muted))" strokeWidth="9" strokeLinecap="round" />
          <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke={`hsl(var(--${tone}))`} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${C * frac} ${C}`} style={{ transition: 'stroke-dasharray 600ms ease' }} />
          <line x1={gx} y1={gy} x2={gx2} y2={gy2} stroke="hsl(var(--foreground))" strokeWidth="1.8" transform={`translate(${(gx - gx2) * 0.45} ${(gy - gy2) * 0.45})`} />
          <text x="50" y="44" textAnchor="middle" className="fill-foreground font-bold" fontSize="15">{display}</text>
          <text x="50" y="55" textAnchor="middle" className="fill-muted-foreground" fontSize="7">{status}</text>
        </svg>
        <div className="text-[11px] text-muted-foreground text-center mt-1 leading-snug">
          <span className="text-foreground tabular-nums">Goal {goalDisplay}</span>{sub && <> · {sub}</>}
        </div>
      </CardContent>
    </Card>
  );
}
