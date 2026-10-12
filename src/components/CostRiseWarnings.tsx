import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { fmt } from '@/lib/formatters';
import { loadCostRiseWarnings, type CostRiseWarning } from '@/lib/cost-history';

/** Lines of a quote whose cost rose since they were last quoted to this customer. */
export function useCostRiseWarnings(snapshot: any, enabled = true): CostRiseWarning[] {
  const [warnings, setWarnings] = useState<CostRiseWarning[]>([]);
  const id = snapshot?.id;
  const linesKey = JSON.stringify(((snapshot?.products ?? []) as any[]).map(l => l.product_id ?? null));
  useEffect(() => {
    if (!enabled || !snapshot) { setWarnings([]); return; }
    let cancelled = false;
    loadCostRiseWarnings(snapshot).then(w => { if (!cancelled) setWarnings(w); }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, linesKey, enabled]);
  return warnings;
}

/** One-line text for a warning, e.g. "cost up 12% since you quoted $41.20 on 3 Sep". */
export function costRiseText(w: CostRiseWarning): string {
  return `cost up ${Math.round(w.pct * 100)}% since you quoted ${fmt.money(w.quotedPrice, w.currency)} on ${format(new Date(w.sentAt), 'd MMM')}`;
}

/** Banner on an unsent quote listing lines whose cost went up since the customer's last quote. */
export function CostRiseBanner({ snapshot }: { snapshot: any }) {
  const warnings = useCostRiseWarnings(snapshot, !snapshot?.sent_at);
  if (snapshot?.sent_at || warnings.length === 0) return null;
  return (
    <div className="no-print max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Cost has gone up on {warnings.length} line{warnings.length === 1 ? '' : 's'} since this customer was last quoted
        </div>
        <ul className="mt-1.5 space-y-1 pl-6 list-disc">
          {warnings.map(w => (
            <li key={w.index}>
              <span className="font-medium">{w.name}</span>: {costRiseText(w)}
              {w.reasons.length > 0 && <span className="text-amber-800/80"> ({w.reasons.slice(-3).join('; ')})</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
