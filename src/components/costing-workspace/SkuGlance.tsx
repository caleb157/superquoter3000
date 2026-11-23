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
  const perMc = r.productsPerMc && r.productsPerMc > 1 ? `${r.productsPerMc} / MC` : null;
  const facts: [string, string | null | undefined][] = [
    ['Qty', row.qty.toLocaleString()],
    ['MOQ', p.moq != null ? Number(p.moq).toLocaleString() : null],
    ['Hard MOQ', p.hard_moq != null ? Number(p.hard_moq).toLocaleString() : null],
    ['Size', productSize(p)],
    ['Type', type],
    ['Source', place],
    ['Raw vendor', row.rawVendor || null],
    ['CBM / unit', r.finalUnitCbm.toFixed(4)],
    ['Packed', perMc],
    ['Shipping', row.shippingName || null],
  ];
  return (
    // Sticky so it stays on screen when the sheet scrolls sideways.
    <div className="sticky left-0 w-full max-w-[1120px] py-4 pl-11 pr-4" data-glance-for={p.id}>
      <div className="flex items-start gap-5">
        <Thumb p={p} size={132} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold leading-tight">{p.name || 'Untitled'}</div>
              <div className="text-xs text-muted-foreground">{p.sku || 'No SKU'}</div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2" onClick={onOpen}><PanelRightOpen className="h-4 w-4" /> Full costing</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild size="icon" variant="ghost" className="h-7 w-7"><Link to={`/product/${p.id}?tab=costing`} aria-label="Open the product page"><ExternalLink className="h-4 w-4" /></Link></Button>
              </TooltipTrigger>
              <IconTooltipContent>Open the product page</IconTooltipContent>
            </Tooltip>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onFold} aria-label="Fold the product view"><X className="h-4 w-4" /></Button>
          </div>
          <dl className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-5 gap-y-2.5">
            {facts.filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="truncate text-sm font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3"><FlowStrip row={row} plain /></div>
          <div className="[&>div]:border-b-0 [&>div]:px-0">
            <QuotedLine row={row} apply={apply} marginLocked={!canPriceAt(bundle, p)} />
          </div>
        </div>
      </div>
    </div>
  );
}
