import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string | number;
  sublabel?: string;
  subValue?: string;
  className?: string;
  onClick?: () => void;
};

export function MetricCard({ label, value, sublabel, subValue, className, onClick }: Props) {
  return (
    <Card
      className={cn('h-full', onClick && 'cursor-pointer hover:bg-muted/40 transition-colors', className)}
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-3">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center justify-between">
          <span>{label}</span>
          {onClick && <span className="text-[10px] text-muted-foreground/70 normal-case tracking-normal">View →</span>}
        </div>
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
