import { cn } from '@/lib/utils';
import { fmt } from '@/lib/formatters';
import type { FobEstimate } from '@/lib/fob';

const rupees = (v: number) => fmt.inr(Math.round(v || 0));
const perUnit = (v: number) => `₹${(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FobEstimatePanel({ estimate, shippingPerUnit, compact, showSelected = true }: { estimate: FobEstimate; shippingPerUnit?: number; compact?: boolean; showSelected?: boolean }) {
  const pooled = estimate.basis === 'inquiry';
  const cbm = estimate.pool_cbm ?? estimate.cbm;
  const cartons = estimate.pool_cartons ?? estimate.cartons;
  return (
    <div className="mt-2 space-y-2 rounded-md border bg-muted/30 p-2 text-xs">
      <div className="text-muted-foreground">
        {pooled
          ? <>Priced as part of inquiry shipment: <b className="text-foreground">{fmt.num(cbm, 2)} CBM</b> · {cartons} cartons · {estimate.pool_product_count} products · this product = {((estimate.share || 0) * 100).toFixed(1)}% of volume</>
          : <>FOB estimate: <b className="text-foreground">{fmt.num(cbm, 2)} CBM</b> · {cartons} cartons</>}
        <span className="block text-[10px]">Origin charges only (excl. ocean freight, destination, GST)</span>
      </div>
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-3')}>
        {estimate.options.map(o => {
          const sel = showSelected && o.mode === estimate.selected.mode;
          return (
            <div key={o.mode} className={cn('rounded border p-2', sel ? 'border-primary bg-primary/10' : 'bg-background')}>
              <div className="flex justify-between font-medium">
                <span>{o.label}</span>
                {sel && <span className="text-[10px] text-primary">Selected</span>}
              </div>
              {o.mix && <div className="text-[10px] text-muted-foreground">{o.mix}</div>}
              <div className="font-mono">{rupees(o.total_inr)}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{rupees(o.per_cbm_inr)}/CBM</div>
            </div>
          );
        })}
      </div>
      <table className="w-full">
        <tbody>
          {estimate.selected.lines.filter(l => l.amount_inr !== 0).map(l => (
            <tr key={l.label}><td className="text-muted-foreground">{l.label}</td><td className="text-right font-mono">{rupees(l.amount_inr)}</td></tr>
          ))}
          <tr className="border-t font-semibold"><td>Total ({estimate.selected.label}{estimate.selected.mix ? ` · ${estimate.selected.mix}` : ''})</td><td className="text-right font-mono">{rupees(estimate.selected.total_inr)}</td></tr>
          {shippingPerUnit != null && <tr><td>This product</td><td className="text-right font-mono">{perUnit(shippingPerUnit)}/unit</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
