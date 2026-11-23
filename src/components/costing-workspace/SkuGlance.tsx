// A simpler product view folded out under a SKU row: the photo and facts, the cost sum to the price,
// and the last quoted price. Read at a glance; the full costing is one click away.
import { Link } from 'react-router-dom';
import { ExternalLink, PanelRightOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, IconTooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Apply, Bundle, WorkspaceRow } from '@/lib/costing-workspace';
import { canPriceAt } from '@/lib/costing-workspace';
import { productSize } from '@/lib/product-size';
import { Thumb } from './cells';
import { FlowStrip } from './ProductPanel';
import { QuotedLine } from './Quoted';

export function SkuGlance({ row, bundle, apply, onOpen, onFold }: { row: WorkspaceRow; bundle: Bundle; apply: Apply; onOpen: () => void; onFold: () => void }) {
  const { p, r } = row;
  const type = bundle.productTypes.find((t: any) => t.id === p.product_type_id)?.name;
  const place = p.source_location_id ? bundle.locations.find((l: any) => l.id === p.source_location_id)?.name : 'In-house (Jodhpur)';
  const facts = [
    productSize(p),
    type,
    place,
    row.rawVendor ? `Raw: ${row.rawVendor}` : null,
    `${row.qty.toLocaleString()} pcs${p.moq ? ` · MOQ ${Number(p.moq).toLocaleString()}` : ''}`,
    `${r.finalUnitCbm.toFixed(4)} CBM`,
    row.shippingName || null,
  ].filter(Boolean) as string[];
  return (
    // Sticky so it stays on screen when the sheet scrolls sideways.
    <div className="sticky left-0 w-full max-w-[1120px] space-y-1 py-3 pl-11 pr-4" data-glance-for={p.id}>
      <div className="flex items-start gap-3">
        <Thumb p={p} size={56} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{p.name || 'Untitled'} <span className="font-normal text-muted-foreground">{p.sku || 'No SKU'}</span></div>
          <div className="mt-0.5 text-xs text-muted-foreground">{facts.join(' · ')}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2" onClick={onOpen}><PanelRightOpen className="h-4 w-4" /> Full costing</Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="icon" variant="ghost" className="h-7 w-7"><Link to={`/product/${p.id}?tab=costing`} aria-label="Open the product page"><ExternalLink className="h-4 w-4" /></Link></Button>
            </TooltipTrigger>
            <IconTooltipContent>Open the product page</IconTooltipContent>
          </Tooltip>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onFold} aria-label="Fold the product view"><X className="h-4 w-4" /></Button>
        </div>
      </div>
      <FlowStrip row={row} plain />
      <div className="[&>div]:border-b-0 [&>div]:px-0">
        <QuotedLine row={row} apply={apply} marginLocked={!canPriceAt(bundle, p)} />
      </div>
    </div>
  );
}
