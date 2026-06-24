import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { Upload, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { VendorCombobox } from '@/components/VendorCombobox';
import { supabase } from '@/integrations/supabase/client';
import { recostProduct } from '@/lib/costing-seed';

const RAW_TYPE = 'Raw Piece';

export type PricingProduct = {
  id: string;
  name: string;
  sku: string | null;
};

export type ProductRawRows = Map<string, { id: string; vendor_name: string | null; include: string | null; sort_order: number | null; components_per_product?: number | null }[]>;

type ParsedRow = {
  product_id?: string | null;
  sku?: string | null;
  unit_price_inr: number | null;
  raw_index: number;
};

type MatchedRow = {
  product: PricingProduct;
  unit_price_inr: number;
  source: 'product_id' | 'sku';
};

type UnmatchedRow = {
  reason: string;
  raw: Record<string, any>;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: PricingProduct[];
  productRawRows: ProductRawRows;
  defaultSlot?: number;
  visibleRawSlots: number;
  defaultQtyPerSku?: number;
  onImported: () => void;
};

function parseNumber(raw: any): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw).replace(/[₹,$\s,]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function findHeaderRow(aoa: any[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] || [];
    const norm = row.map(c => String(c ?? '').trim().toLowerCase());
    if (norm.includes('product_id') || norm.includes('sku')) return i;
  }
  return -1;
}

export function VendorPriceImportDialog({
  open, onOpenChange, products, productRawRows, defaultSlot = 0, visibleRawSlots, defaultQtyPerSku = 1, onImported,
}: Props) {
  const [vendor, setVendor] = useState('');
  const [slot, setSlot] = useState<number>(defaultSlot);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setVendor(''); setSlot(defaultSlot); setFile(null); setParsed(null);
    }
  }, [open, defaultSlot]);

  // Auto-update default slot when vendor changes: if vendor already has a slot in
  // any product, default to that slot (update mode).
  useEffect(() => {
    if (!vendor) return;
    const v = vendor.trim().toLowerCase();
    for (const raws of productRawRows.values()) {
      for (let i = 0; i < raws.length; i++) {
        if ((raws[i].vendor_name || '').trim().toLowerCase() === v) {
          setSlot(i);
          return;
        }
      }
    }
  }, [vendor, productRawRows]);

  const slotOptions = useMemo(() => {
    const n = Math.max(visibleRawSlots, 4);
    return Array.from({ length: n }, (_, i) => i);
  }, [visibleRawSlots]);

  const handleFile = async (f: File) => {
    setFile(f);
    setParsing(true);
    setParsed(null);
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName =
        wb.SheetNames.find(n => n.toLowerCase() !== '_info' && n.toLowerCase() !== '_meta') ||
        wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
      const headerIdx = findHeaderRow(aoa);
      if (headerIdx < 0) {
        toast.error('Could not find header row. Expected "product_id" or "SKU".');
        setParsing(false);
        return;
      }
      const headers = (aoa[headerIdx] || []).map((c: any) => String(c ?? '').trim().toLowerCase());
      const colIdx = (name: string) => headers.findIndex(h => h === name.toLowerCase());
      const pidCol = colIdx('product_id');
      const skuCol = colIdx('sku');
      const priceCol = headers.findIndex(h => h.includes('unit price') || h === 'price' || h.includes('price'));

      if (priceCol < 0) {
        toast.error('Could not find a "Unit Price" column.');
        setParsing(false);
        return;
      }

      const rows: ParsedRow[] = [];
      for (let i = headerIdx + 1; i < aoa.length; i++) {
        const r = aoa[i] || [];
        // Skip fully empty rows
        if (r.every((c: any) => c == null || String(c).trim() === '')) continue;
        const price = parseNumber(r[priceCol]);
        rows.push({
          product_id: pidCol >= 0 ? String(r[pidCol] ?? '').trim() || null : null,
          sku: skuCol >= 0 ? String(r[skuCol] ?? '').trim() || null : null,
          unit_price_inr: price,
          raw_index: i,
        });
      }
      setParsed(rows);
    } catch (e: any) {
      toast.error(`Parse failed: ${e?.message || 'unknown'}`);
    } finally {
      setParsing(false);
    }
  };

  const { matched, unmatched, withoutPrice } = useMemo(() => {
    const matched: MatchedRow[] = [];
    const unmatched: UnmatchedRow[] = [];
    const withoutPrice: ParsedRow[] = [];
    if (!parsed) return { matched, unmatched, withoutPrice };

    const byId = new Map(products.map(p => [p.id, p]));
    const bySku = new Map<string, PricingProduct>();
    for (const p of products) {
      if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p);
    }

    for (const r of parsed) {
      if (r.unit_price_inr == null) { withoutPrice.push(r); continue; }
      let prod: PricingProduct | undefined;
      let source: 'product_id' | 'sku' = 'product_id';
      if (r.product_id) prod = byId.get(r.product_id);
      if (!prod && r.sku) {
        prod = bySku.get(r.sku.trim().toLowerCase());
        source = 'sku';
      }
      if (prod) {
        matched.push({ product: prod, unit_price_inr: r.unit_price_inr, source });
      } else {
        unmatched.push({
          reason: r.product_id || r.sku ? 'No product matches this id/SKU in this inquiry.' : 'Row has no product_id or SKU.',
          raw: { product_id: r.product_id, sku: r.sku, unit_price_inr: r.unit_price_inr },
        });
      }
    }
    return { matched, unmatched, withoutPrice };
  }, [parsed, products]);

  const handleCommit = async () => {
    if (!vendor.trim()) { toast.error('Pick a vendor first.'); return; }
    if (matched.length === 0) { toast.error('No matched rows to import.'); return; }

    setCommitting(true);
    try {
      const affectedProductIds: string[] = [];
      for (const m of matched) {
        const raws = productRawRows.get(m.product.id) || [];
        const existing = raws[slot];
        const hasWinner = raws.some(r => r.include === 'Yes');
        const include = existing
          ? (existing.include || 'No')
          : (hasWinner ? 'No' : 'Yes');

        if (existing) {
          const currentQty = Number(existing.components_per_product || 0);
          const patch: { vendor_name: string; unit_cost_inr: number; components_per_product?: number } =
            { vendor_name: vendor.trim(), unit_cost_inr: m.unit_price_inr };
          if (currentQty <= 0) patch.components_per_product = defaultQtyPerSku;
          const { error } = await supabase
            .from('cogs_items')
            .update(patch)
            .eq('id', existing.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('cogs_items')
            .insert({
              product_id: m.product.id,
              cogs_type: RAW_TYPE,
              component_name: `Raw Piece ${slot + 1}`,
              vendor_name: vendor.trim(),
              unit_cost_inr: m.unit_price_inr,
              include,
              sort_order: slot,
              waste_factor: 0,
              components_per_product: defaultQtyPerSku,
            });
          if (error) throw error;
        }
        affectedProductIds.push(m.product.id);
      }

      toast.success(`Imported ${matched.length} price${matched.length === 1 ? '' : 's'} for ${vendor.trim()}.`);
      onOpenChange(false);
      onImported();

      // Light recost in background (don't block UI)
      void (async () => {
        for (const pid of affectedProductIds) {
          try { await recostProduct(pid); } catch (e) { console.error('recost failed', e); }
        }
      })();
    } catch (e: any) {
      toast.error(`Import failed: ${e?.message || 'unknown'}`);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import vendor prices</DialogTitle>
          <DialogDescription>
            Upload a filled price template. Prices land in the chosen vendor's column
            in the Pricing grid for all matched products at once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Vendor</Label>
              <VendorCombobox
                value={vendor}
                onChange={setVendor}
                placeholder="Pick or add vendor…"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target column</Label>
              <Select value={String(slot)} onValueChange={(v) => setSlot(Number(v))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {slotOptions.map(i => (
                    <SelectItem key={i} value={String(i)}>Vendor {i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Filled template (.xlsx / .csv)</Label>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={parsing}
              >
                {parsing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                {file ? 'Replace file' : 'Choose file'}
              </Button>
              {file && <span className="text-xs text-muted-foreground truncate">{file.name}</span>}
            </div>
          </div>

          {parsed && (
            <div className="border rounded-md">
              <div className="flex items-center gap-3 px-3 py-2 border-b text-xs">
                <Badge variant="secondary" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {matched.length} matched
                </Badge>
                {unmatched.length > 0 && (
                  <Badge variant="destructive" className="gap-1">
                    <AlertTriangle className="h-3 w-3" /> {unmatched.length} unmatched
                  </Badge>
                )}
                {withoutPrice.length > 0 && (
                  <span className="text-muted-foreground">{withoutPrice.length} row(s) without a price (skipped)</span>
                )}
              </div>
              <ScrollArea className="max-h-[280px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-1.5 font-medium">Status</th>
                      <th className="text-left px-3 py-1.5 font-medium">Product / Identifier</th>
                      <th className="text-right px-3 py-1.5 font-medium">Price ₹</th>
                      <th className="text-left px-3 py-1.5 font-medium">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matched.map((m, i) => (
                      <tr key={`m-${i}`} className="border-t">
                        <td className="px-3 py-1"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /></td>
                        <td className="px-3 py-1 truncate max-w-[280px]">{m.product.name} <span className="text-muted-foreground">· {m.product.sku || '—'}</span></td>
                        <td className="px-3 py-1 text-right tabular-nums">{m.unit_price_inr.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-1 text-muted-foreground">by {m.source === 'product_id' ? 'product_id' : 'SKU'}</td>
                      </tr>
                    ))}
                    {unmatched.map((u, i) => (
                      <tr key={`u-${i}`} className="border-t bg-red-50/40 dark:bg-red-950/20">
                        <td className="px-3 py-1"><AlertTriangle className="h-3.5 w-3.5 text-red-600" /></td>
                        <td className="px-3 py-1 truncate max-w-[280px] text-muted-foreground">
                          {u.raw.sku || u.raw.product_id || '(no identifier)'}
                        </td>
                        <td className="px-3 py-1 text-right tabular-nums text-muted-foreground">
                          {u.raw.unit_price_inr != null ? Number(u.raw.unit_price_inr).toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="px-3 py-1 text-red-700 dark:text-red-400">{u.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={committing}>Cancel</Button>
          <Button
            onClick={handleCommit}
            disabled={committing || !vendor.trim() || matched.length === 0}
          >
            {committing && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            Import {matched.length || ''} price{matched.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Template generator (exported for the page's "Download template" button) ----------

export function buildPriceTemplateXlsx(args: {
  inquiryRfqNumber: string;
  inquiryTitle?: string | null;
  products: Array<{
    id: string;
    name: string;
    sku: string | null;
    width_inch: number | null;
    depth_inch: number | null;
    height_inch: number | null;
  }>;
}) {
  const { inquiryRfqNumber, inquiryTitle, products } = args;
  const wb = XLSX.utils.book_new();

  const today = new Date().toISOString().slice(0, 10);
  const meta = [
    [`Inquiry ${inquiryRfqNumber}${inquiryTitle ? ` · ${inquiryTitle}` : ''}`],
    [`Generated ${today}. Fill the "Unit Price (₹)" column for each row and send the file back.`],
    [`Do not edit the "product_id" column or change column order.`],
    [],
  ];

  const header = ['product_id', 'SKU', 'Product Name', 'Width', 'Depth', 'Height', 'Unit Price (₹)', 'Notes'];
  const rows = products.map(p => [
    p.id,
    p.sku || '',
    p.name,
    p.width_inch ?? '',
    p.depth_inch ?? '',
    p.height_inch ?? '',
    '', // Unit Price - blank
    '', // Notes - blank
  ]);

  const aoa = [...meta, header, ...rows];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths
  sheet['!cols'] = [
    { wch: 38 }, // product_id
    { wch: 14 }, // SKU
    { wch: 36 }, // Name
    { wch: 8 },  // W
    { wch: 8 },  // D
    { wch: 8 },  // H
    { wch: 14 }, // Price
    { wch: 28 }, // Notes
  ];

  XLSX.utils.book_append_sheet(wb, sheet, 'Prices');
  XLSX.writeFile(wb, `${inquiryRfqNumber}_price_template.xlsx`);
}
