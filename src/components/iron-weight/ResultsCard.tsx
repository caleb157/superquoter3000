// Grand total (kg, lb, tonnes, cost) with a per-assembly breakdown and "Copy summary".
import { useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import type { GrandTotal, Result } from '@/lib/iron-weight-core';
import { kg, lbOf, rupees, trimNum, unitLabel, type Build } from '@/lib/iron-weight';

export function ResultsCard({ build, total, summary }: { build: Build; total: Result<GrandTotal>; summary: string | null }) {
  const [copied, setCopied] = useState(false);
  const price = build.pricePerKg && build.pricePerKg > 0 ? build.pricePerKg : null;

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Copy was blocked by the browser — select the text below instead');
      setFallback(true);
    }
  };
  const [fallback, setFallback] = useState(false);

  return (
    <Card className="p-4 space-y-4" aria-live="polite">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Total weight{total.ok ? `, ${total.totalLegs} ${total.totalLegs === 1 ? 'piece' : 'pieces'}` : ''}
        </div>
        {total.ok ? (
          <>
            <div className="text-4xl font-semibold tabular-nums leading-tight">{kg(total.totalKg)}<span className="ml-1.5 text-lg text-muted-foreground font-medium">kg</span></div>
            <div className="text-sm text-muted-foreground tabular-nums">{kg(lbOf(total.totalKg))} lb · {(total.totalKg / 1000).toFixed(4)} tonnes</div>
            {price && total.totalCost != null && (
              <div className="mt-2 text-2xl font-semibold text-primary tabular-nums">{rupees(total.totalCost)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">at ₹{trimNum(price)}/kg</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="text-4xl font-semibold text-muted-foreground">—</div>
            <p className="mt-1 text-sm font-medium text-destructive">{build.legs.length ? 'Fix the highlighted fields to see the total.' : 'Add an assembly to start.'}</p>
          </>
        )}
      </div>

      {total.ok && (
        <div className="space-y-4 border-t pt-4">
          {total.legs.map((o, i) => {
            const leg = build.legs[i];
            const share = total.totalKg > 0 ? (o.kgSubtotal / total.totalKg) * 100 : 0;
            return (
              <div key={leg.id} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium break-words">{o.name || 'Assembly'}</span>
                  <span className="text-sm tabular-nums">{o.qty} × {kg(o.kgEachLeg)} = <b>{kg(o.kgSubtotal)} kg</b>{o.costSubtotal != null ? ` · ${rupees(o.costSubtotal)}` : ''}</span>
                </div>
                <div className="h-1.5 rounded-full bg-primary/15 overflow-hidden" role="presentation">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${share.toFixed(1)}%` }} />
                </div>
                {o.parts.map((pt, j) => {
                  const p = leg.parts[j];
                  return (
                    <div key={p.id} className="flex justify-between gap-3 pl-2.5 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">{pt.name || 'Part'} ({p.count} × {trimNum(p.length)} {unitLabel(p.lengthUnit)})</span>
                      <span className="shrink-0 tabular-nums">{kg(pt.kgPerLeg)} kg{pt.cost != null ? ` · ${rupees(pt.cost)}` : ''}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <Button onClick={copy} disabled={!summary} className="gap-1.5 w-full sm:w-auto">
          {copied ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy summary'}
        </Button>
        {fallback && summary && (
          <textarea readOnly rows={6} value={summary} onFocus={e => e.target.select()} aria-label="Summary text"
            className="mt-2 w-full rounded-md border bg-muted/40 p-2 font-mono text-xs" />
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Wrought iron, 7750 kg/m³. Tube weights assume sharp corners, so rolled corner radii change the result slightly.
        Weld metal, end caps and plates are not included.
      </p>
    </Card>
  );
}
