import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Upload, X } from 'lucide-react';
import { fmt } from '@/lib/formatters';
import { UploadParseDialog } from '@/components/UploadParseDialog';
import { SortableHeader } from '@/components/SortableHeader';
import { getStatusLevel } from '@/components/ProductStatusIndicator';
import { Badge } from '@/components/ui/badge';

function costingBadge(p: { cbm_done?: boolean; cogs_done?: boolean; overhead_done?: boolean; shipping_done?: boolean; revenue_done?: boolean }, hasReview: boolean): { label: string; cls: string } {
  const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
  const done = flags.filter(Boolean).length;
  if (hasReview) return { label: 'Needs Review', cls: 'bg-red-100 text-red-700' };
  if (done === 5) return { label: 'Priced', cls: 'bg-emerald-100 text-emerald-700' };
  if (done > 0) return { label: `In Progress (${done}/5)`, cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Empty', cls: 'bg-muted text-muted-foreground' };
}
import { useTableSort } from '@/hooks/use-table-sort';
import { furthestStageBucket, productStageBuckets, STAGE_BUCKET_LABELS, type StageBucket } from '@/lib/pipeline-weights';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { rowNavHandlers } from '@/lib/row-nav';
import { RowContextMenu } from '@/components/RowContextMenu';
import { usePersistentState, useScrollRestoration } from '@/hooks/use-persistent-state';


const Products = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [cbmMap, setCbmMap] = useState<Record<string, any>>({});
  const [cogsMap, setCogsMap] = useState<Record<string, any[]>>({});
  const [ohMap, setOhMap] = useState<Record<string, any[]>>({});
  const [costDataMap, setCostDataMap] = useState<Record<string, { cost_usd: number; price_usd: number }>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePersistentState<string>('products.search', '');
  const [filterInquiry, setFilterInquiry] = usePersistentState<string>('products.filterInquiry', 'all');
  const [filterCustomer, setFilterCustomer] = usePersistentState<string>('products.filterCustomer', 'all');
  const [filterType, setFilterType] = usePersistentState<string>('products.filterType', 'all');
  const [filterStatus, setFilterStatus] = usePersistentState<string>('products.filterStatus', 'all');
  useScrollRestoration('products.scroll', !loading);
  const [showUploadParse, setShowUploadParse] = useState(false);
  const [uploadInquiryId, setUploadInquiryId] = useState('');
  const [showInquiryPicker, setShowInquiryPicker] = useState(false);

  const stageParam = searchParams.get('stage') as StageBucket | null;
  const inquiryStatusMap = useMemo(
    () => Object.fromEntries(inquiries.map(i => [i.id, i.status])),
    [inquiries],
  );

  const clearStageFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('stage');
    setSearchParams(next, { replace: true });
  };

  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<any>({
    storageKey: 'products-sort',
  });

  useEffect(() => {
    const fetchAll = async () => {
      const [prodRes, inqRes, custRes, typesRes, cbmRes, cogsRes, ohRes] = await Promise.all([
        supabase.from('products').select('*').order('created_at', { ascending: false }),
        (supabase as any).from('customer_rfqs').select('*'),
        supabase.from('customers').select('*'),
        supabase.from('product_types').select('*'),
        supabase.from('cbm_estimates').select('*'),
        supabase.from('cogs_items').select('*'),
        supabase.from('overhead_items').select('*'),
      ]);
      const prods = prodRes.data || [];
      const allCogs = cogsRes.data || [];
      const allOh = ohRes.data || [];
      const allCbm = cbmRes.data || [];

      setProducts(prods);
      if (inqRes.data) setInquiries(inqRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (typesRes.data) setProductTypes(typesRes.data);

      const cbm: Record<string, any> = {};
      allCbm.forEach((c: any) => { if (c.product_id) cbm[c.product_id] = c; });
      setCbmMap(cbm);

      const cogsM: Record<string, any[]> = {};
      allCogs.forEach((c: any) => { if (c.product_id) { if (!cogsM[c.product_id]) cogsM[c.product_id] = []; cogsM[c.product_id].push(c); } });
      setCogsMap(cogsM);

      const ohM: Record<string, any[]> = {};
      allOh.forEach((o: any) => { if (o.product_id) { if (!ohM[o.product_id]) ohM[o.product_id] = []; ohM[o.product_id].push(o); } });
      setOhMap(ohM);

      // Use shared helper so prices match the costing sheet (includes auto-calc rows for
      // packaging boxes, finishing materials, finishing/packaging labor, etc.)
      const priceMap = await computeProductPriceAndCost(prods.map((p: any) => p.id));
      const cMap: Record<string, { cost_usd: number; price_usd: number }> = {};
      Object.entries(priceMap).forEach(([id, v]) => {
        cMap[id] = { cost_usd: v.unit_cost_usd, price_usd: v.unit_price_usd };
      });
      setCostDataMap(cMap);

      setLoading(false);
    };
    fetchAll();
  }, []);

  const inquiryMap = Object.fromEntries(inquiries.map(p => [p.id, p]));
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]));

  const hasReview = (productId: string) => {
    const cogs = cogsMap[productId] || [];
    const oh = ohMap[productId] || [];
    return cogs.some((c: any) => c.include === 'Review') || oh.some((o: any) => o.include === 'Review');
  };

  const filtered = useMemo(() => {
    let result = products.filter(p => {
      if (search) {
        const s = search.toLowerCase();
        if (!(p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s))) return false;
      }
      if (filterInquiry !== 'all' && p.customer_rfq_id !== filterInquiry) return false;
      if (filterType !== 'all' && p.product_type_id !== filterType) return false;
      if (filterCustomer !== 'all') {
        const inq = inquiryMap[p.customer_rfq_id];
        if (!inq || inq.customer_id !== filterCustomer) return false;
      }
      if (filterStatus !== 'all') {
        const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
        const done = flags.filter(Boolean).length;
        switch (filterStatus) {
          case 'complete': if (done !== 5) return false; break;
          case 'in_progress': if (done === 0 || done === 5) return false; break;
          case 'not_started': if (done !== 0) return false; break;
          case 'needs_review': if (!hasReview(p.id)) return false; break;
        }
      }
      if (stageParam) {
        const inqStatus = p.customer_rfq_id ? inquiryStatusMap[p.customer_rfq_id] : null;
        if (inqStatus === 'cancelled' || inqStatus === 'complete') return false;
        if (!productStageBuckets(p, inqStatus).includes(stageParam)) return false;
      }
      return true;
    });

    const getters: Record<string, (p: any) => string | number> = {
      product: (p) => (p.name || '').toLowerCase(),
      sku: (p) => (p.sku || '').toLowerCase(),
      inquiry: (p) => {
        const i = inquiryMap[p.customer_rfq_id];
        return ((i?.rfq_number || '') + ' ' + (i?.title || '')).toLowerCase();
      },
      customer: (p) => {
        const inq = inquiryMap[p.customer_rfq_id];
        const cust = inq?.customer_id ? customerMap[inq.customer_id] : null;
        return (cust?.name || '').toLowerCase();
      },
      qty: (p) => p.quantity || 0,
      unit_cbm: (p) => cbmMap[p.id]?.final_unit_cbm || 0,
      cost: (p) => costDataMap[p.id]?.cost_usd || 0,
      price: (p) => costDataMap[p.id]?.price_usd || 0,
      status: (p) => getStatusLevel(p),
    };

    result = sortItems(result, getters);
    return result;
  }, [products, search, filterInquiry, filterType, filterCustomer, filterStatus, stageParam, inquiryStatusMap, sortColumn, sortDirection, inquiryMap, customerMap, cbmMap, costDataMap]);

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-serif font-medium tracking-tight">All Products</h1>
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => setShowInquiryPicker(true)}>
            <Upload className="h-3 w-3" /> Upload & Parse
          </Button>
        </div>

        <Dialog open={showInquiryPicker} onOpenChange={setShowInquiryPicker}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Select Inquiry</DialogTitle></DialogHeader>
            <p className="text-xs text-muted-foreground">Choose which inquiry to add parsed products to:</p>
            <Select value={uploadInquiryId} onValueChange={setUploadInquiryId}>
              <SelectTrigger><SelectValue placeholder="Select an inquiry..." /></SelectTrigger>
              <SelectContent>
                {inquiries.map(p => <SelectItem key={p.id} value={p.id}>{p.rfq_number} — {p.title || 'Untitled'}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button disabled={!uploadInquiryId} onClick={() => { setShowInquiryPicker(false); setShowUploadParse(true); }}>
              Continue
            </Button>
          </DialogContent>
        </Dialog>

        {uploadInquiryId && (
          <UploadParseDialog
            open={showUploadParse}
            onOpenChange={setShowUploadParse}
            inquiryId={uploadInquiryId}
            productTypes={productTypes}
            onProductsCreated={() => {
              setUploadInquiryId('');
              supabase.from('products').select('*').order('created_at', { ascending: false }).then(({ data }) => { if (data) setProducts(data); });
            }}
          />
        )}

        {stageParam && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filtered by stage:</span>
            <button
              onClick={clearStageFilter}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20"
            >
              {STAGE_BUCKET_LABELS[stageParam] ?? stageParam}
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <div className="grid grid-cols-2 lg:flex lg:flex-wrap gap-2">
            <Select value={filterInquiry} onValueChange={setFilterInquiry}>
              <SelectTrigger className="lg:w-48 h-9 text-xs"><SelectValue placeholder="All Inquiries" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Inquiries</SelectItem>
                {inquiries.map(p => <SelectItem key={p.id} value={p.id}>{p.rfq_number} — {p.title || 'Untitled'}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterCustomer} onValueChange={setFilterCustomer}>
              <SelectTrigger className="lg:w-40 h-9 text-xs"><SelectValue placeholder="All Customers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="lg:w-40 h-9 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {productTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="lg:w-40 h-9 text-xs"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="not_started">Not Started</SelectItem>
                <SelectItem value="needs_review">Needs Review</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : (
          <>
            <div className="hidden md:block border rounded-md overflow-auto">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead noResize className="w-10"></TableHead>
                    <SortableHeader column="product" label="Product" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="w-[220px]" />
                    <SortableHeader column="sku" label="SKU" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="w-[140px]" />
                    <SortableHeader column="inquiry" label="Inquiry" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="w-[240px]" />
                    <SortableHeader column="customer" label="Customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="w-[160px]" />
                    <SortableHeader column="qty" label="Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right w-[80px]" />
                    <SortableHeader column="unit_cbm" label="Unit CBM" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right w-[110px]" />
                    <SortableHeader column="cost" label="Cost ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right w-[100px]" />
                    <SortableHeader column="price" label="Price ($)" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right w-[100px]" />
                    <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-center w-[110px]" />
                    <TableHead noResize className="text-xs w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(p => {
                    const inq = inquiryMap[p.customer_rfq_id];
                    const cust = inq?.customer_id ? customerMap[inq.customer_id] : null;
                    const cbm = cbmMap[p.id];
                    const review = hasReview(p.id);
                    return (
                      <RowContextMenu key={p.id} path={`/product/${p.id}`}>
                      <TableRow className="cursor-pointer hover:bg-accent/50" {...rowNavHandlers(navigate, `/product/${p.id}`, { from: { label: 'Products', path: '/products' } })}>
                        <TableCell>
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={p.photo_url || ''} />
                            <AvatarFallback className="text-[10px]">{p.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell className="font-medium text-sm break-words">{p.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground break-all">{p.sku || '—'}</TableCell>
                        <TableCell className="break-words">
                          <span className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); if (inq) navigate(`/inquiry/${inq.id}`); }}>
                            {inq ? `${inq.rfq_number} — ${inq.title || 'Untitled'}` : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs break-words">{cust?.name || '—'}</TableCell>
                        <TableCell className="text-right text-xs">{fmt.qty(p.quantity)}</TableCell>
                        <TableCell className="text-right text-xs">{cbm?.final_unit_cbm ? fmt.cbm(cbm.final_unit_cbm) : '—'}</TableCell>
                        <TableCell className="text-right text-xs">{costDataMap[p.id]?.cost_usd ? fmt.usd(costDataMap[p.id].cost_usd) : '—'}</TableCell>
                        <TableCell className="text-right text-xs">{costDataMap[p.id]?.price_usd ? fmt.usd(costDataMap[p.id].price_usd) : '—'}</TableCell>
                        <TableCell className="text-center">
                          {(() => {
                            const cb = costingBadge(p, review);
                            return <Badge className={cb.cls} variant="secondary">{cb.label}</Badge>;
                          })()}
                        </TableCell>
                        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                          <ConfirmDeleteButton
                            itemLabel={`product "${p.name}"`}
                            iconOnly
                            onConfirm={async () => {
                              const { error } = await supabase.from('products').delete().eq('id', p.id);
                              if (error) throw error;
                              setProducts(prev => prev.filter(x => x.id !== p.id));
                            }}
                          />
                        </TableCell>
                      </TableRow>
                      </RowContextMenu>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No products found.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {filtered.length === 0 && (
                <Card><div className="py-8 text-center text-sm text-muted-foreground">No products found.</div></Card>
              )}
              {filtered.map(p => {
                const inq = inquiryMap[p.customer_rfq_id];
                const cust = inq?.customer_id ? customerMap[inq.customer_id] : null;
                const cbm = cbmMap[p.id];
                const review = hasReview(p.id);
                const cb = costingBadge(p, review);
                return (
                  <RowContextMenu key={p.id} path={`/product/${p.id}`}>
                  <Card className="cursor-pointer active:bg-accent/50" {...rowNavHandlers(navigate, `/product/${p.id}`, { from: { label: 'Products', path: '/products' } })}>
                    <div className="p-3 flex gap-3">
                      <Avatar className="h-12 w-12 shrink-0">
                        <AvatarImage src={p.photo_url || ''} />
                        <AvatarFallback className="text-[11px]">{p.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="font-medium text-sm truncate">{p.name}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {p.sku ? `${p.sku} · ` : ''}{inq ? inq.rfq_number : '—'}{cust ? ` · ${cust.name}` : ''}
                            </div>
                          </div>
                          <Badge className={cb.cls + ' shrink-0 text-[10px]'} variant="secondary">{cb.label}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                          <span>Qty {fmt.qty(p.quantity)}</span>
                          <span>{cbm?.final_unit_cbm ? fmt.cbm(cbm.final_unit_cbm) + ' CBM' : '—'}</span>
                          <span className="font-medium text-foreground">
                            {costDataMap[p.id]?.price_usd ? fmt.usd(costDataMap[p.id].price_usd) : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Card>
                  </RowContextMenu>
                );
              })}
            </div>
          </>
        )}
      </div>
      
    </AppLayout>
  );
};

export default Products;
