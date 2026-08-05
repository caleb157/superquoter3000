import { useState } from 'react';
import { Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fmt } from '@/lib/formatters';
import { calcTargetLineUnitPrice } from '@/lib/calculations';

export type TargetLineButtonProps = {
  /** Product-level target price in USD (null/0 → disabled). */
  productTargetPriceUsd: number | null | undefined;
  /** Live engine total cost per unit (INR). */
  totalCostPerUnitInr: number;
  markupPercent: number;
  exchangeRate: number;
  /** This row's current per-unit contribution to product cost (INR). */
  rowContributionInr: number;
  /** This row's current manually-set unit price (INR). */
  currentUnitPriceInr: number;
  /** Quantity of this component per finished product (waste applied separately). */
  componentsPerProduct: number;
  wasteFactor?: number;
  /** Label for the unit-price field being solved for. */
  priceLabel?: string;
  className?: string;
  size?: 'sm' | 'md';
  onFill: (newUnitPriceInr: number) => void;
};

export function TargetLineButton({
  productTargetPriceUsd,
  totalCostPerUnitInr,
  markupPercent,
  exchangeRate,
  rowContributionInr,
  currentUnitPriceInr,
  componentsPerProduct,
  wasteFactor = 0,
  priceLabel = '/unit',
  className,
  size = 'sm',
  onFill,
}: TargetLineButtonProps) {
  const [open, setOpen] = useState(false);
  const btnSize = size === 'md' ? 'h-9 w-9' : 'h-6 w-6';
  const iconSize = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';

  if (!productTargetPriceUsd) {
    return (
      <Button
        size="icon"
        variant="ghost"
        disabled
        title="Set a target price on this product first"
        className={`${btnSize} ${className || ''}`}
      >
        <Target className={`${iconSize} text-muted-foreground/40`} />
      </Button>
    );
  }

  const result = calcTargetLineUnitPrice({
    targetPriceUsd: productTargetPriceUsd,
    markupPercent,
    exchangeRate,
    totalCostPerUnitInr,
    thisRowCurrentContributionInr: rowContributionInr,
    componentsPerProduct,
    wasteFactor,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className={`${btnSize} text-muted-foreground hover:text-primary ${className || ''}`}
          title="Target this line to hit the product's target price"
        >
          <Target className={iconSize} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" align="end">
        {!result.feasible ? (
          <div className="text-amber-700 dark:text-amber-400">
            No room — cost already exceeds target even at ₹0 for this line.
            <div className="text-xs text-muted-foreground mt-1">
              Over by {fmt.inr(Math.abs(result.targetRowContributionInr))}.
            </div>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              To hit {fmt.usd(productTargetPriceUsd)}, this line needs to price at:
            </div>
            <div className="text-lg font-semibold mt-1 font-mono">
              {fmt.inr(result.targetUnitCostInr!)}
              <span className="text-xs text-muted-foreground font-normal font-sans"> {priceLabel}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              (currently {fmt.inr(currentUnitPriceInr)}, contributing {fmt.inr(rowContributionInr)} to product cost)
            </div>
            <Button
              size="sm"
              className="w-full mt-3"
              onClick={() => { onFill(result.targetUnitCostInr!); setOpen(false); }}
            >
              Fill this price
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
