import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string | number;
  sublabel?: string;
  subValue?: string;
  className?: string;
};

export function MetricCard({ label, value, sublabel, subValue, className }: Props) {
  return (
    <Card className={cn('h-full', className)}>
      <CardContent className="pt-4 pb-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {(sublabel || subValue) && (
          <div className="text-[11px] text-muted-foreground mt-1.5 leading-snug">
            {subValue && <span className="tabular-nums text-foreground">{subValue}</span>}
            {subValue && sublabel && ' · '}
            {sublabel}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
