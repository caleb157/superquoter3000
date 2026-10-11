// Extra tools for the Vendor quotes view: vendor price files and whole-column fills.
import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VendorPriceImportDialog, buildPriceTemplateXlsx, type ProductRawRows } from '@/components/VendorPriceImportDialog';
import { fillQuoteVendor, setRawWaste, type Apply, type Bundle, type WorkspaceRow } from '@/lib/costing-workspace';
import { parseNum } from './cells';

export function QuotesToolbar({ bundle, rows, slots, targetIds, apply, onImported }: {
  bundle: Bundle; rows: WorkspaceRow[]; slots: number; targetIds: string[]; apply: Apply; onImported: () => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [slot, setSlot] = useState(0);
  const [vendor, setVendor] = useState('');
  const [waste, setWaste] = useState('');
  const products = bundle.products.map(p => ({ id: p.id, name: p.name, sku: p.sku, width_inch: p.width_inch, depth_inch: p.depth_inch, height_inch: p.height_inch }));
  const scope = targetIds.length ? `${targetIds.length} selected` : `all ${rows.length}`;

  const rawRows: ProductRawRows = new Map(rows.map(r => [r.p.id, r.quotes.filter(q => q.line).map(q => ({
    id: q.line.id, vendor_name: q.line.vendor_name, include: q.line.include, sort_order: q.line.sort_order,
    components_per_product: q.line.components_per_product,
  }))]));

  const ids = targetIds.length ? targetIds : rows.map(r => r.p.id);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (vendor.trim()) { apply(b => fillQuoteVendor(b, ids, slot, vendor)); setVendor(''); } }}>
        <span className="text-xs text-muted-foreground">Fill vendor in</span>
        <select className="h-8 rounded-md border bg-background px-2" value={slot} onChange={e => setSlot(Number(e.target.value))}>
          {Array.from({ length: slots }, (_, i) => <option key={i} value={i}>Quote {i + 1}</option>)}
        </select>
        <Input className="h-8 w-40" placeholder="Vendor name" value={vendor} onChange={e => setVendor(e.target.value)} />
        <Button size="sm" variant="outline" className="h-8" type="submit" disabled={!vendor.trim()}>Fill {scope}</Button>
      </form>
      <div className="h-6 w-px bg-border" />
      <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); const n = parseNum(waste); if (n != null && n >= 0) { apply(b => setRawWaste(b, ids, n / 100)); setWaste(''); } }}>
        <span className="text-xs text-muted-foreground">Raw waste</span>
        <Input className="h-8 w-16" placeholder="%" value={waste} onChange={e => setWaste(e.target.value)} />
        <Button size="sm" variant="outline" className="h-8" type="submit" disabled={parseNum(waste) == null}>Set on {scope}</Button>
      </form>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" className="h-8 gap-1.5"
          onClick={() => buildPriceTemplateXlsx({ inquiryRfqNumber: bundle.inq.rfq_number, inquiryTitle: bundle.inq.title, products })}>
          <Download className="h-3.5 w-3.5" /> Price template
        </Button>
        <Button size="sm" variant="ghost" className="h-8 gap-1.5" onClick={() => setImportOpen(true)}>
          <Upload className="h-3.5 w-3.5" /> Import vendor prices
        </Button>
      </div>
      <VendorPriceImportDialog
        open={importOpen} onOpenChange={setImportOpen} products={products} productRawRows={rawRows}
        visibleRawSlots={slots} defaultSlot={0} defaultQtyPerSku={1} onImported={onImported}
      />
    </div>
  );
}
