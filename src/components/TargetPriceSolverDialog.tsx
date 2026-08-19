import { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmt } from '@/lib/formatters';
import { markupToNpm } from '@/lib/calculations';
import { solveForMarkup, solveForMaxCost, type CostBucket } from '@/lib/target-price-solver';
import { cn } from '@/lib/utils';
import { Target, Check } from 'lucide-react';

export type TargetPriceSolverInputs = {
  /** Total unit cost in INR (COGS + non-unit COGS + direct OH + indirect OH + shipping/packaging). */
  currentCostInr: number;
  /** Cost buckets for the proportional cut breakdown. */
  buckets: CostBucket[];
  markupPercent: number;
  exchangeRate: number;
  currentUnitPriceUsd: number;
};

type Mode = 'markup' | 'cost';

export function TargetPriceSolverPanel({
  inputs,
  defaultTargetUsd,
  onApplyMarkup,
}: {
  inputs: TargetPriceSolverInputs;
  defaultTargetUsd?: number | null;
  onApplyMarkup?: (markup: number) => Promise<void> | void;
}) {
  const { currentCostInr, buckets, markupPercent, exchangeRate, currentUnitPriceUsd } = inputs;
  const [mode, setMode] = useState<Mode>('markup');
  const [targetStr, setTargetStr] = useState<string>(defaultTargetUsd ? String(defaultTargetUsd) : '');
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => { setConfirming(false); }, [targetStr, mode]);

  const targetUsd = Number(targetStr) || 0;
  const currentCostUsd = exchangeRate > 0 ? currentCostInr / exchangeRate : 0;

  const markupSolve = useMemo(() => solveForMarkup({
    targetPriceUsd: targetUsd, currentCostInr, exchangeRate, currentMarkup: markupPercent,
  }), [targetUsd, currentCostInr, exchangeRate, markupPercent]);

  const costSolve = useMemo(() => solveForMaxCost({
    targetPriceUsd: targetUsd, currentCostInr, exchangeRate, markupPercent, buckets,
  }), [targetUsd, currentCostInr, exchangeRate, markupPercent, buckets]);

  const hasTarget = targetUsd > 0;

  return (
    <div className="space-y-4">
      {/* Inputs */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-muted-foreground">Target unit price (USD)</label>
          <Input
            className="h-8 text-sm"
            type="number"
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 45.00"
            value={targetStr}
            onChange={e => setTargetStr(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Solve for</label>
          <div className="flex rounded-md border p-0.5">
            {([['markup', 'Markup %'], ['cost', 'Max cost']] as [Mode, string][]).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'flex-1 rounded-sm px-2 py-1 text-xs transition-colors',
                  mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Current state */}
      <div className="grid grid-cols-3 gap-2 rounded-md border p-3">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Current price</div>
          <div className="font-mono text-sm font-semibold">{fmt.usd(currentUnitPriceUsd)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Current cost</div>
          <div className="font-mono text-sm font-semibold">{fmt.usd(currentCostUsd)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Current markup</div>
          <div className="font-mono text-sm font-semibold">
            {fmt.pct(markupPercent)}
            <span className="ml-1 text-[10px] font-normal text-muted-foreground">
              ({fmt.pct(markupToNpm(markupPercent))} NPM)
            </span>
          </div>
        </div>
      </div>

      {!hasTarget && (
        <p className="text-xs text-muted-foreground">Enter a target unit price to solve.</p>
      )}

      {/* Markup mode */}
      {hasTarget && mode === 'markup' && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Required markup</span>
            <Badge variant={markupSolve.requiredMarkup >= markupPercent ? 'secondary' : 'outline'} className="font-mono">
              {fmt.pct(markupSolve.requiredMarkup)}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              = {fmt.pct(markupSolve.requiredNpm)} net profit margin
            </span>
          </div>
          <p className="text-xs">
            {markupSolve.requiredMarkup < 0 ? (
              <>Your current unit cost of <strong>{fmt.usd(currentCostUsd)}</strong> is already above{' '}
              <strong>{fmt.usd(targetUsd)}</strong>. This target is not reachable with any positive markup.</>
            ) : (
              <>Your current markup is <strong>{fmt.pct(markupPercent)}</strong>. To hit{' '}
              <strong>{fmt.usd(targetUsd)}</strong> at the current cost, you'd need a markup of{' '}
              <strong>{fmt.pct(markupSolve.requiredMarkup)}</strong> ({markupSolve.markupDelta >= 0 ? '+' : ''}
              {(markupSolve.markupDelta * 100).toFixed(1)} pts).</>
            )}
          </p>
          {onApplyMarkup && markupSolve.requiredMarkup > 0 && (
            <div className="flex items-center gap-2">
              {!confirming ? (
                <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
                  Apply this markup
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={applying}
                    onClick={async () => {
                      setApplying(true);
                      try { await onApplyMarkup(markupSolve.requiredMarkup); }
                      finally { setApplying(false); setConfirming(false); }
                    }}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Confirm {fmt.pct(markupSolve.requiredMarkup)}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                  <span className="text-[11px] text-muted-foreground">This updates the product's markup.</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cost mode */}
      {hasTarget && mode === 'cost' && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Max allowable unit cost</span>
            <Badge variant="secondary" className="font-mono">{fmt.usd(costSolve.maxCostUsd)}</Badge>
            <span className="text-[11px] text-muted-foreground font-mono">{fmt.inr(costSolve.maxCostInr)}</span>
          </div>
          <p className="text-xs">
            {costSolve.cutRequiredUsd > 0 ? (
              <>At your current <strong>{fmt.pct(markupPercent)}</strong> markup, hitting{' '}
              <strong>{fmt.usd(targetUsd)}</strong> requires cutting unit cost from{' '}
              <strong>{fmt.usd(costSolve.currentCostUsd)}</strong> to{' '}
              <strong>{fmt.usd(costSolve.maxCostUsd)}</strong> (−{fmt.usd(costSolve.cutRequiredUsd)}).</>
            ) : (
              <>At your current <strong>{fmt.pct(markupPercent)}</strong> markup you already clear{' '}
              <strong>{fmt.usd(targetUsd)}</strong> — you have{' '}
              <strong>{fmt.usd(Math.abs(costSolve.cutRequiredUsd))}</strong> of cost headroom per unit.</>
            )}
          </p>

          {costSolve.allocation.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                Proportional estimate only — spread across current cost buckets by share. Not a prescriptive
                plan; decide where to actually cut.
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7 text-[11px]">Bucket</TableHead>
                    <TableHead className="h-7 text-right text-[11px]">Current ($)</TableHead>
                    <TableHead className="h-7 text-right text-[11px]">Share</TableHead>
                    <TableHead className="h-7 text-right text-[11px]">
                      {costSolve.cutRequiredUsd > 0 ? 'Cut ($)' : 'Headroom ($)'}
                    </TableHead>
                    <TableHead className="h-7 text-right text-[11px]">Target ($)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costSolve.allocation.map(a => (
                    <TableRow key={a.label}>
                      <TableCell className="py-1 text-xs">{a.label}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs">
                        {fmt.usd(exchangeRate > 0 ? a.currentInr / exchangeRate : 0)}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs">{fmt.pct(a.share)}</TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs">
                        {fmt.usd(Math.abs(exchangeRate > 0 ? a.cutInr / exchangeRate : 0))}
                      </TableCell>
                      <TableCell className="py-1 text-right font-mono text-xs">
                        {fmt.usd(exchangeRate > 0 ? a.targetInr / exchangeRate : 0)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TargetPriceSolverDialog({
  open,
  onOpenChange,
  inputs,
  defaultTargetUsd,
  onApplyMarkup,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inputs: TargetPriceSolverInputs;
  defaultTargetUsd?: number | null;
  onApplyMarkup?: (markup: number) => Promise<void> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4" /> Target Price Solver
          </DialogTitle>
          <DialogDescription className="text-xs">
            Back-solve the markup or the maximum unit cost needed to hit a target sell price. Uses the same
            price = cost × (1 + markup) formula as the costing sheet.
          </DialogDescription>
        </DialogHeader>
        <TargetPriceSolverPanel inputs={inputs} defaultTargetUsd={defaultTargetUsd} onApplyMarkup={onApplyMarkup} />
      </DialogContent>
    </Dialog>
  );
}
