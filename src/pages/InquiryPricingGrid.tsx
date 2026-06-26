import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Plus, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { VendorCombobox } from '@/components/VendorCombobox';
import {
  VendorPriceImportDialog,
  buildPriceTemplateXlsx,
  type ProductRawRows,
} from '@/components/VendorPriceImportDialog';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { recostProduct } from '@/lib/costing-seed';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/formatters';

// ---------- Types ----------

type Inquiry = { id: string; rfq_number: string; title: string | null };
type Product = {
  id: string;
  name: string;
  sku: string | null;
  width_inch: number | null;
  depth_inch: number | null;
  height_inch: number | null;
};
type CogsRow = {
  id: string;
  product_id: string;
  cogs_type: string;
  component_name: string | null;
  vendor_name: string | null;
  unit_cost_inr: number | null;
  components_per_product: number | null;
  waste_factor: number | null;
  include: string | null;
  sort_order: number | null;
  created_at: string | null;
};

const COGS_SELECT = 'id, product_id, cogs_type, component_name, vendor_name, unit_cost_inr, components_per_product, waste_factor, include, sort_order, created_at';

const RAW_TYPE = 'Raw Piece';
const SUBC_TYPE = 'Subcontracting';
const HW_TYPE = 'Hardware';
const PRICED_QTY_DEFAULT_TYPES = new Set([RAW_TYPE, SUBC_TYPE, HW_TYPE]);

// ---------- Helpers ----------

function parseClipboardMatrix(text: string): string[][] {
  // Strip trailing newline only (a single trailing \n is normal from copy)
  const t = text.replace(/\r/g, '').replace(/\n$/, '');
  if (!t) return [];
  return t.split('\n').map(row => row.split('\t'));
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[₹,$\s,]/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeDefaultQty(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function shouldBackfillPricedQty(row: Pick<CogsRow, 'cogs_type' | 'unit_cost_inr' | 'components_per_product'>): boolean {
  return (
    PRICED_QTY_DEFAULT_TYPES.has(row.cogs_type) &&
    (Number(row.unit_cost_inr) || 0) > 0 &&
    (Number(row.components_per_product) || 0) <= 0
  );
}

// ---------- Column model ----------

type CellKind = 'vendor' | 'price';
type ColumnSpec =
  | { key: string; kind: CellKind; group: 'raw'; slot: number }
  | { key: string; kind: CellKind; group: 'subc' }
  | { key: string; kind: CellKind; group: 'hw' };

function buildColumns(rawSlots: number): ColumnSpec[] {
  const cols: ColumnSpec[] = [];
  for (let s = 0; s < rawSlots; s++) {
    cols.push({ key: `raw_v_${s}`, kind: 'vendor', group: 'raw', slot: s });
    cols.push({ key: `raw_p_${s}`, kind: 'price', group: 'raw', slot: s });
  }
  cols.push({ key: 'subc_v', kind: 'vendor', group: 'subc' });
  cols.push({ key: 'subc_p', kind: 'price', group: 'subc' });
  cols.push({ key: 'hw_v', kind: 'vendor', group: 'hw' });
  cols.push({ key: 'hw_p', kind: 'price', group: 'hw' });
  return cols;
}

// ---------- Page ----------

export default function InquiryPricingGrid() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<CogsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [extraSlots, setExtraSlots] = useState(0); // beyond the default 3
  const [recostingIds, setRecostingIds] = useState<Set<string>>(new Set());
  const [importOpen, setImportOpen] = useState(false);
  const [defaultQtyPerSku, setDefaultQtyPerSku] = useState<number>(1);
  const qtyRef = useRef(defaultQtyPerSku);
  useEffect(() => { qtyRef.current = normalizeDefaultQty(defaultQtyPerSku); }, [defaultQtyPerSku]);
  const [defaultWastePct, setDefaultWastePct] = useState<number>(0);
  const wasteRef = useRef(defaultWastePct);
  useEffect(() => { wasteRef.current = defaultWastePct; }, [defaultWastePct]);
  const wasteSeededRef = useRef(false);

  useDocumentTitle(inquiry ? `Pricing Grid · ${inquiry.title || inquiry.rfq_number}` : 'Pricing Grid');

  const refetch = useCallback(async () => {
    if (!inquiryId) return;
    setLoading(true);
    const { data: inq } = await supabase
      .from('customer_rfqs')
      .select('id, rfq_number, title')
      .eq('id', inquiryId)
      .maybeSingle();
    setInquiry((inq as Inquiry) || null);

    const { data: prods } = await supabase
      .from('products')
      .select('id, name, sku, width_inch, depth_inch, height_inch')
      .eq('customer_rfq_id', inquiryId)
      .order('created_at', { ascending: true });
    const productList = (prods || []) as Product[];
    setProducts(productList);

    if (productList.length > 0) {
      const ids = productList.map(p => p.id);
      const { data: cogs } = await supabase
        .from('cogs_items')
        .select(COGS_SELECT)
        .in('product_id', ids)
        .in('cogs_type', [RAW_TYPE, SUBC_TYPE, HW_TYPE]);
      setRows((cogs || []) as CogsRow[]);
    } else {
      setRows([]);
    }
    setLoading(false);
  }, [inquiryId]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Seed the toolbar's default waste % from the most common existing raw-piece value
  useEffect(() => {
    if (loading || wasteSeededRef.current) return;
    const rawWastes = rows.filter(r => r.cogs_type === RAW_TYPE).map(r => Number(r.waste_factor) || 0);
    if (rawWastes.length === 0) { wasteSeededRef.current = true; return; }
    const counts = new Map<number, number>();
    for (const w of rawWastes) counts.set(w, (counts.get(w) || 0) + 1);
    let best = 0; let bestCount = -1;
    for (const [w, c] of counts) if (c > bestCount) { best = w; bestCount = c; }
    setDefaultWastePct(Math.round(best * 10000) / 100);
    wasteSeededRef.current = true;
  }, [loading, rows]);

  // Build per-product indexed maps
  const productRows = useMemo(() => {
    const map = new Map<string, { raw: CogsRow[]; subc: CogsRow | null; hw: CogsRow | null }>();
    for (const p of products) map.set(p.id, { raw: [], subc: null, hw: null });
    for (const r of rows) {
      const bucket = map.get(r.product_id);
      if (!bucket) continue;
      if (r.cogs_type === RAW_TYPE) bucket.raw.push(r);
      else if (r.cogs_type === SUBC_TYPE && !bucket.subc) bucket.subc = r;
      else if (r.cogs_type === HW_TYPE && !bucket.hw) bucket.hw = r;
    }
    for (const v of map.values()) {
      v.raw.sort((a, b) => {
        const sa = a.sort_order ?? 0;
        const sb = b.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
    }
    return map;
  }, [products, rows]);

  const maxRawSlots = useMemo(() => {
    let m = 0;
    for (const v of productRows.values()) m = Math.max(m, v.raw.length);
    return m;
  }, [productRows]);

  const visibleRawSlots = Math.max(3, maxRawSlots, 3 + extraSlots);
  const columns = useMemo(() => buildColumns(visibleRawSlots), [visibleRawSlots]);

  // ---------- Persistence ----------

  // Returns row id (existing or newly created). For raw pieces, slot is mandatory.
  const ensureRow = useCallback(
    async (
      productId: string,
      group: 'raw' | 'subc' | 'hw',
      slot?: number,
    ): Promise<string | null> => {
      const bucket = productRows.get(productId);
      if (!bucket) return null;

      if (group === 'raw') {
        const existing = bucket.raw[slot!];
        if (existing) return existing.id;
        // Decide include: if there is no winner yet, this becomes the winner.
        const hasWinner = bucket.raw.some(r => r.include === 'Yes');
        const include = hasWinner ? 'No' : 'Yes';
        const sort_order = slot!; // 0,1,2,3 — matches default convention
        const component_name = `Raw Piece ${slot! + 1}`;
        const { data, error } = await supabase
          .from('cogs_items')
          .insert({
            product_id: productId,
            cogs_type: RAW_TYPE,
            component_name,
            include,
            sort_order,
            waste_factor: 0,
            components_per_product: normalizeDefaultQty(qtyRef.current),
          })
          .select(COGS_SELECT)
          .single();
        if (error || !data) {
          toast.error(`Failed to add row: ${error?.message || 'unknown'}`);
          return null;
        }
        setRows(prev => [...prev, data as CogsRow]);
        return (data as CogsRow).id;
      }

      if (group === 'subc') {
        if (bucket.subc) return bucket.subc.id;
        const { data, error } = await supabase
          .from('cogs_items')
          .insert({
            product_id: productId,
            cogs_type: SUBC_TYPE,
            component_name: 'Subcontracting 1',
            include: 'Yes',
            sort_order: 2,
            waste_factor: 0,
            components_per_product: normalizeDefaultQty(qtyRef.current),
          })
          .select(COGS_SELECT)
          .single();
        if (error || !data) { toast.error(`Failed to add subcontract row: ${error?.message}`); return null; }
        setRows(prev => [...prev, data as CogsRow]);
        return (data as CogsRow).id;
      }

      // hw
      if (bucket.hw) return bucket.hw.id;
      const { data, error } = await supabase
        .from('cogs_items')
        .insert({
          product_id: productId,
          cogs_type: HW_TYPE,
          component_name: 'Hardware 1',
          include: 'Yes',
          sort_order: 10,
          waste_factor: 0.05,
          components_per_product: normalizeDefaultQty(qtyRef.current),
        })
        .select(COGS_SELECT)
        .single();
      if (error || !data) { toast.error(`Failed to add hardware row: ${error?.message}`); return null; }
      setRows(prev => [...prev, data as CogsRow]);
      return (data as CogsRow).id;
    },
    [productRows],
  );

  const updateRow = useCallback(async (rowId: string, patch: Partial<CogsRow>) => {
    // Optimistic
    setRows(prev => prev.map(r => (r.id === rowId ? { ...r, ...patch } : r)));
    const { error } = await supabase.from('cogs_items').update(patch as any).eq('id', rowId);
    if (error) { toast.error(`Save failed: ${error.message}`); void refetch(); }
  }, [refetch]);

  // Keep a ref to rows so writeCell can read current qty without re-creating callback
  const rowsRef = useRef<CogsRow[]>(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  const writeCell = useCallback(
    async (
      productId: string,
      col: ColumnSpec,
      raw: string,
    ): Promise<boolean> => {
      const trimmed = raw.trim();
      if (trimmed === '') return false; // skip empties (paste semantics)
      const slot = col.group === 'raw' ? col.slot : undefined;
      const rowId = await ensureRow(productId, col.group, slot);
      if (!rowId) return false;
      if (col.kind === 'vendor') {
        await updateRow(rowId, { vendor_name: trimmed });
      } else {
        const n = parseNumber(trimmed);
        if (n == null) return false;
        // If the row currently has qty 0/null, backfill it to the default so the
        // price actually flows into the costing sheet. Never overwrite a real qty.
        const existing = rowsRef.current.find(r => r.id === rowId);
        const currentQty = Number(existing?.components_per_product || 0);
        const patch: Partial<CogsRow> =
          currentQty > 0
            ? { unit_cost_inr: n }
            : { unit_cost_inr: n, components_per_product: normalizeDefaultQty(qtyRef.current) };
        await updateRow(rowId, patch);
        // Recost so the costing sheet picks up the new qty/price
        void recostInBackground(productId);
      }
      return true;
    },
    [ensureRow, updateRow],
  );

  const setWinner = useCallback(
    async (productId: string, slot: number) => {
      const bucket = productRows.get(productId);
      if (!bucket) return;
      // Make sure the row exists
      const winnerId = await ensureRow(productId, 'raw', slot);
      if (!winnerId) return;
      // Flip flags for all this product's raw rows
      const allRaw = [...bucket.raw];
      const updates = allRaw.map(r => ({ id: r.id, include: r.id === winnerId ? 'Yes' : 'No' }));
      // Optimistic
      setRows(prev => prev.map(r => {
        const u = updates.find(x => x.id === r.id);
        return u ? { ...r, include: u.include } : r;
      }));
      // Persist (parallel)
      const errors: string[] = [];
      await Promise.all(updates.map(async u => {
        const { error } = await supabase.from('cogs_items').update({ include: u.include }).eq('id', u.id);
        if (error) errors.push(error.message);
      }));
      // If the row was just created in ensureRow, it wasn't in allRaw — handle separately.
      if (!allRaw.find(r => r.id === winnerId)) {
        await supabase.from('cogs_items').update({ include: 'Yes' }).eq('id', winnerId);
        setRows(prev => prev.map(r => (r.id === winnerId ? { ...r, include: 'Yes' } : r)));
      }
      if (errors.length) toast.error(`Some updates failed: ${errors[0]}`);
      // Recost in the background
      void recostInBackground(productId);
    },
    [ensureRow, productRows],
  );

  const recostInBackground = useCallback(async (productId: string) => {
    setRecostingIds(prev => new Set(prev).add(productId));
    try { await recostProduct(productId); } catch (e: any) {
      console.error('recost failed', e);
    } finally {
      setRecostingIds(prev => {
        const n = new Set(prev); n.delete(productId); return n;
      });
    }
  }, []);

  useEffect(() => {
    if (loading || rows.length === 0) return;
    const qty = normalizeDefaultQty(qtyRef.current);
    const toBackfill = rows.filter(shouldBackfillPricedQty);
    if (toBackfill.length === 0) return;

    const ids = toBackfill.map(r => r.id);
    const productIds = [...new Set(toBackfill.map(r => r.product_id))];
    setRows(prev => prev.map(r => (ids.includes(r.id) ? { ...r, components_per_product: qty } : r)));
    void (async () => {
      const { error } = await supabase
        .from('cogs_items')
        .update({ components_per_product: qty })
        .in('id', ids);
      if (error) {
        toast.error(`Qty backfill failed: ${error.message}`);
        void refetch();
        return;
      }
      await Promise.all(productIds.map(pid => recostInBackground(pid)));
    })();
  }, [loading, rows, refetch, recostInBackground]);

  // ---------- Paste handling ----------

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLInputElement>, productIdx: number, colIdx: number) => {
      const text = e.clipboardData.getData('text/plain');
      if (!text) return;
      const matrix = parseClipboardMatrix(text);
      if (matrix.length === 0) return;
      // Single cell → let default behavior handle it
      if (matrix.length === 1 && matrix[0].length === 1) return;
      e.preventDefault();

      let writes = 0;
      for (let r = 0; r < matrix.length; r++) {
        const pIdx = productIdx + r;
        if (pIdx >= products.length) break;
        const productId = products[pIdx].id;
        const cells = matrix[r];
        for (let c = 0; c < cells.length; c++) {
          const cIdx = colIdx + c;
          if (cIdx >= columns.length) break;
          const col = columns[cIdx];
          const ok = await writeCell(productId, col, cells[c]);
          if (ok) writes++;
        }
      }
      if (writes > 0) toast.success(`Pasted ${writes} value${writes === 1 ? '' : 's'}`);
    },
    [products, columns, writeCell],
  );

  // ---------- Render ----------

  if (isMobile) {
    return (
      <AppLayout>
        <div className="max-w-md mx-auto py-12 text-center space-y-4">
          <h1 className="text-lg font-semibold">Pricing Grid</h1>
          <p className="text-sm text-muted-foreground">
            The pricing grid is desktop-only. Open this inquiry on a wider screen
            to edit vendor prices in bulk.
          </p>
          <Button variant="outline" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to inquiry
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (loading || !inquiry) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading…</div></AppLayout>;
  }

  const title = inquiry.title || inquiry.rfq_number;

  return (
    <AppLayout>
      <div className="px-4 py-3 space-y-3 max-w-none">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <PageBreadcrumbs
            canonical={[
              { label: 'Inquiries', to: '/inquiries' },
              { label: title, to: `/inquiry/${inquiryId}` },
            ]}
            current="Pricing Grid"
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold">Pricing Grid</h1>
            <p className="text-xs text-muted-foreground">
              Enter raw-piece quotes from every vendor in one place. Pick a winner per product — losing quotes stay on file as the comparison record.
              Paste a column of values from Excel into any cell to fill down.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground border rounded-md px-2 h-8"
              title="New raw-piece / subcontract / hardware rows created by typing or pasting into this grid use this quantity. Rows that already have a quantity are never overwritten; rows with qty 0 are backfilled to this when you enter a price."
            >
              Default qty/SKU:
              <Input
                type="number"
                min={1}
                step={1}
                value={defaultQtyPerSku}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setDefaultQtyPerSku(normalizeDefaultQty(n));
                }}
                className="h-6 w-14 text-xs px-1.5 tabular-nums"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => buildPriceTemplateXlsx({
                inquiryRfqNumber: inquiry.rfq_number,
                inquiryTitle: inquiry.title,
                products,
              })}
              disabled={products.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Download price template
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setImportOpen(true)}
              disabled={products.length === 0}
            >
              <Upload className="h-3.5 w-3.5 mr-1" /> Import vendor prices
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExtraSlots(n => n + 1)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add vendor column
            </Button>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">No products in this inquiry yet.</div>
        ) : (
          <PricingGridTable
            products={products}
            columns={columns}
            visibleRawSlots={visibleRawSlots}
            productRows={productRows}
            recostingIds={recostingIds}
            onWriteCell={writeCell}
            onSetWinner={setWinner}
            onPaste={handlePaste}
          />
        )}
      </div>

      <VendorPriceImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        products={products}
        productRawRows={(() => {
          const m: ProductRawRows = new Map();
          for (const p of products) {
            const bucket = productRows.get(p.id);
            m.set(p.id, (bucket?.raw || []).map(r => ({
              id: r.id,
              vendor_name: r.vendor_name,
              include: r.include,
              sort_order: r.sort_order,
              components_per_product: r.components_per_product,
            })));
          }
          return m;
        })()}
        visibleRawSlots={visibleRawSlots}
        defaultSlot={0}
        defaultQtyPerSku={defaultQtyPerSku}
        onImported={() => void refetch()}
      />
    </AppLayout>
  );
}

// ---------- Grid table ----------

type TableProps = {
  products: Product[];
  columns: ColumnSpec[];
  visibleRawSlots: number;
  productRows: Map<string, { raw: CogsRow[]; subc: CogsRow | null; hw: CogsRow | null }>;
  recostingIds: Set<string>;
  onWriteCell: (productId: string, col: ColumnSpec, raw: string) => Promise<boolean>;
  onSetWinner: (productId: string, slot: number) => Promise<void>;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>, productIdx: number, colIdx: number) => void;
};

function PricingGridTable({
  products, columns, visibleRawSlots, productRows, recostingIds, onWriteCell, onSetWinner, onPaste,
}: TableProps) {
  return (
    <div className="border rounded-md overflow-auto max-h-[calc(100vh-180px)] bg-background">
      <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
        <thead className="sticky top-0 z-20 bg-muted/95 backdrop-blur">
          <tr>
            <th
              className="sticky left-0 z-30 bg-muted/95 backdrop-blur px-3 py-2 text-left font-medium border-b border-r min-w-[240px]"
              rowSpan={2}
            >
              Product
            </th>
            {Array.from({ length: visibleRawSlots }).map((_, slot) => (
              <th key={`raw-h-${slot}`} colSpan={3} className="px-2 py-1 text-center font-medium border-b border-r">
                Vendor {slot + 1}
              </th>
            ))}
            <th colSpan={2} className="px-2 py-1 text-center font-medium border-b border-r">Subcontract</th>
            <th colSpan={2} className="px-2 py-1 text-center font-medium border-b">Hardware</th>
          </tr>
          <tr>
            {Array.from({ length: visibleRawSlots }).flatMap((_, slot) => [
              <th key={`v-${slot}`} className="px-2 py-1 text-left font-normal text-muted-foreground border-b min-w-[140px]">Vendor</th>,
              <th key={`p-${slot}`} className="px-2 py-1 text-right font-normal text-muted-foreground border-b min-w-[100px]">Price ₹</th>,
              <th key={`w-${slot}`} className="px-1 py-1 text-center font-normal text-muted-foreground border-b border-r w-[36px]">Win</th>,
            ])}
            <th className="px-2 py-1 text-left font-normal text-muted-foreground border-b min-w-[140px]">Vendor</th>
            <th className="px-2 py-1 text-right font-normal text-muted-foreground border-b border-r min-w-[100px]">Price ₹</th>
            <th className="px-2 py-1 text-left font-normal text-muted-foreground border-b min-w-[140px]">Vendor</th>
            <th className="px-2 py-1 text-right font-normal text-muted-foreground border-b min-w-[100px]">Price ₹</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p, pIdx) => {
            const bucket = productRows.get(p.id) || { raw: [], subc: null, hw: null };
            const winnerSlot = bucket.raw.findIndex(r => r.include === 'Yes');
            return (
              <tr key={p.id} className="border-b hover:bg-muted/30">
                <td className="sticky left-0 z-10 bg-background hover:bg-muted/30 px-3 py-1.5 border-r align-top">
                  <Link
                    to={`/product/${p.id}`}
                    className="block font-medium hover:underline truncate max-w-[220px]"
                    title={p.name}
                  >
                    {p.name}
                  </Link>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="font-mono">{p.sku || '—'}</span>
                    {recostingIds.has(p.id) && (
                      <span className="inline-flex items-center gap-1">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" /> recosting
                      </span>
                    )}
                  </div>
                </td>

                {columns.map((col, cIdx) => {
                  const cellKey = `${p.id}-${col.key}`;
                  const row =
                    col.group === 'raw'
                      ? bucket.raw[col.slot]
                      : col.group === 'subc'
                        ? bucket.subc
                        : bucket.hw;
                  const isWinner = col.group === 'raw' && winnerSlot === col.slot;
                  const isLastInGroup = col.kind === 'price' && (col.group !== 'raw'); // subc/hw price ends with border
                  const isWinnerCol = col.group === 'raw';

                  if (col.kind === 'vendor') {
                    return (
                      <td
                        key={cellKey}
                        className={cn('px-1 py-0.5 align-middle', isWinner && 'bg-emerald-50 dark:bg-emerald-950/30')}
                      >
                        <VendorPasteCell
                          value={row?.vendor_name || ''}
                          onChange={(v) => void onWriteCell(p.id, col, v)}
                          onPaste={(e) => onPaste(e, pIdx, cIdx)}
                        />
                      </td>
                    );
                  }

                  // price cell
                  const isWinnerPrice = col.group === 'raw' && winnerSlot === col.slot;
                  return (
                    <td
                      key={cellKey}
                      className={cn(
                        'px-1 py-0.5 align-middle',
                        isWinnerPrice && 'bg-emerald-50 dark:bg-emerald-950/30',
                        !isWinnerCol && 'border-l',
                      )}
                    >
                      <PriceCell
                        value={row?.unit_cost_inr ?? null}
                        winner={isWinnerPrice}
                        onCommit={(raw) => void onWriteCell(p.id, col, raw)}
                        onPaste={(e) => onPaste(e, pIdx, cIdx)}
                      />
                    </td>
                  );
                }).reduce<React.ReactNode[]>((acc, node, i) => {
                  acc.push(node);
                  // After every "Win" radio column for raw, insert the radio
                  const col = columns[i];
                  if (col.group === 'raw' && col.kind === 'price') {
                    const slot = col.slot;
                    const isWinner = winnerSlot === slot;
                    acc.push(
                      <td key={`${p.id}-win-${slot}`} className="px-1 py-0.5 text-center border-r">
                        <input
                          type="radio"
                          name={`winner-${p.id}`}
                          checked={isWinner}
                          onChange={() => void onSetWinner(p.id, slot)}
                          className="h-3.5 w-3.5 accent-emerald-600 cursor-pointer"
                          aria-label={`Set vendor ${slot + 1} as winner`}
                        />
                      </td>
                    );
                  }
                  return acc;
                }, [])}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Cell components ----------

function VendorPasteCell({
  value, onChange, onPaste,
}: {
  value: string;
  onChange: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  // We use the combobox for the typical flow, plus a hidden input overlay to capture multi-cell pastes.
  // Strategy: render combobox; for paste, listen on a wrapping div.
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={wrapRef}
      onPasteCapture={(e) => {
        const text = e.clipboardData.getData('text/plain') || '';
        // Multi-cell paste? Intercept and bubble up to the grid handler.
        if (/[\n\t]/.test(text.replace(/\n$/, ''))) {
          onPaste(e as unknown as React.ClipboardEvent<HTMLInputElement>);
        }
      }}
    >
      <VendorCombobox value={value} onChange={onChange} placeholder="Vendor…" className="h-7" />
    </div>
  );
}

function PriceCell({
  value, winner, onCommit, onPaste,
}: {
  value: number | null;
  winner: boolean;
  onCommit: (raw: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setDraft(value == null ? '' : String(value));
  }, [value]);

  return (
    <Input
      value={draft}
      onChange={(e) => { dirtyRef.current = true; setDraft(e.target.value); }}
      onPaste={onPaste}
      onBlur={() => {
        if (!dirtyRef.current) return;
        dirtyRef.current = false;
        const original = value == null ? '' : String(value);
        if (draft.trim() === original.trim()) return;
        const n = parseNumber(draft);
        if (draft.trim() !== '' && n == null) {
          toast.error('Invalid number');
          setDraft(original);
          return;
        }
        onCommit(draft);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={cn(
        'h-7 text-right text-xs px-1.5 tabular-nums',
        winner && 'font-semibold',
      )}
      placeholder="—"
      inputMode="decimal"
    />
  );
}
