// PD Dashboard — global product-development checklist across all open inquiries.
// Read + write: checkboxes write straight to pd_checklist_items, same rules as PD View.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { supabase } from '@/integrations/supabase/client';
import { customerPrimary } from '@/lib/customer-name';
import {
  PD_ITEMS, PD_LEGACY_CATEGORY_ALIAS, pdDisabledReason, pdIsDisabled,
  type PdItemDef, type PdItemKey,
} from '@/lib/pd-items';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

import { STATUS_OPTIONS, statusLabel } from '@/lib/inquiry-status';

const CLOSED_STATUSES = ['complete', 'cancelled'];
const PAGE_SIZE = 100;

type Row = {
  id: string;
  sku: string | null;
  name: string;
  photo_url: string | null;
  packaging_type: string | null;
  percent_wood: number | null;
  inquiry_id: string;
  inquiry_label: string;
  inquiry_status: string;
  customer_id: string | null;
  customer_label: string;
};

type SortKey = 'inquiry' | 'product' | 'incomplete';

export default function PdDashboard() {
  useDocumentTitle('PD Dashboard');

  const [rows, setRows] = useState<Row[]>([]);
  const [cogsCats, setCogsCats] = useState<Record<string, Set<string>>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  // filters
  const [includeClosed, setIncludeClosed] = useState(false);
  const [search, setSearch] = useState('');
  const [inquiryFilter, setInquiryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('open');
  const statusFilterRef = useRef(statusFilter);
  statusFilterRef.current = statusFilter;
  const [customerFilter, setCustomerFilter] = useState('all');
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [missingItem, setMissingItem] = useState<'all' | PdItemKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('inquiry');
  const [page, setPage] = useState(0);

  useEffect(() => { setPage(0); }, [search, statusFilter, inquiryFilter, customerFilter, incompleteOnly, missingItem, sortKey, includeClosed]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, photo_url, packaging_type, percent_wood, customer_rfq_id, sort_order, customer_rfqs!inner(id, rfq_number, title, status, customers(id, name, company))')
        .is('archived_at', null)
        .not('customer_rfq_id', 'is', null)
        .order('name', { ascending: true });

      if (error) {
        toast.error('Could not load products: ' + error.message);
        setLoading(false);
        return;
      }

      const list: Row[] = ((data || []) as any[])
        .filter(p => includeClosed || CLOSED_STATUSES.includes(statusFilterRef.current) || !CLOSED_STATUSES.includes(p.customer_rfqs?.status))
        .map(p => {
          const inq = p.customer_rfqs;
          const cust = inq?.customers;
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            photo_url: p.photo_url,
            packaging_type: p.packaging_type,
            percent_wood: p.percent_wood,
            inquiry_id: inq?.id,
            inquiry_label: inq?.title || inq?.rfq_number || 'Untitled inquiry',
            inquiry_status: inq?.status || '',
            customer_id: cust?.id ?? null,
            customer_label: cust ? customerPrimary(cust) : '—',
          } as Row;
        });
      setRows(list);

      const ids = list.map(p => p.id);
      if (ids.length) {
        const chunk = <T,>(arr: T[], n: number) => arr.reduce<T[][]>((a, v, i) => (i % n ? a[a.length - 1].push(v) : a.push([v]), a), []);
        const cogsRes: any[] = [];
        const pdRes: any[] = [];
        for (const part of chunk(ids, 300)) {
          const [{ data: c }, { data: pd }] = await Promise.all([
            supabase.from('cogs_items').select('product_id, cogs_type, include').in('product_id', part),
            supabase.from('pd_checklist_items').select('product_id, item_key, is_checked').in('product_id', part),
          ]);
          cogsRes.push(...((c || []) as any[]));
          pdRes.push(...((pd || []) as any[]));
        }
        const map: Record<string, Set<string>> = {};
        for (const r of cogsRes) {
          if (r.include === 'No') continue;
          const cat = PD_LEGACY_CATEGORY_ALIAS[r.cogs_type] || r.cogs_type;
          if (!cat) continue;
          (map[r.product_id] ||= new Set()).add(cat);
        }
        setCogsCats(map);
        const state: Record<string, boolean> = {};
        for (const r of pdRes) state[`${r.product_id}:${r.item_key}`] = !!r.is_checked;
        setChecked(state);
      } else {
        setCogsCats({});
        setChecked({});
      }
      setLoading(false);
    })();
  }, [includeClosed, statusFilter]);

  const isDisabled = (p: Row, item: PdItemDef) => pdIsDisabled(p, item, cogsCats);

  const rowProgress = (p: Row) => {
    const applicable = PD_ITEMS.filter(it => !isDisabled(p, it));
    const done = applicable.filter(it => checked[`${p.id}:${it.key}`]).length;
    return { done, total: applicable.length };
  };

  const inquiryOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach(r => m.set(r.inquiry_id, r.inquiry_label));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const customerOptions = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach(r => { if (r.customer_id) m.set(r.customer_id, r.customer_label); });
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter(r => {
      if (statusFilter === 'open') { if (!['active', 'po'].includes(r.inquiry_status)) return false; }
      else if (statusFilter !== 'all' && r.inquiry_status !== statusFilter) return false;
      if (inquiryFilter !== 'all' && r.inquiry_id !== inquiryFilter) return false;
      if (customerFilter !== 'all' && r.customer_id !== customerFilter) return false;
      if (q && !(`${r.sku || ''} ${r.name} ${r.inquiry_label} ${r.customer_label}`.toLowerCase().includes(q))) return false;
      if (missingItem !== 'all') {
        const it = PD_ITEMS.find(i => i.key === missingItem)!;
        if (isDisabled(r, it) || checked[`${r.id}:${it.key}`]) return false;
      }
      if (incompleteOnly) {
        const prog = rowProgress(r);
        if (prog.done >= prog.total) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortKey === 'product') return (a.sku || a.name).localeCompare(b.sku || b.name);
      if (sortKey === 'incomplete') {
        const pa = rowProgress(a), pb = rowProgress(b);
        return (pa.total - pa.done === pb.total - pb.done)
          ? a.inquiry_label.localeCompare(b.inquiry_label)
          : (pb.total - pb.done) - (pa.total - pa.done);
      }
      return a.inquiry_label.localeCompare(b.inquiry_label) || (a.sku || a.name).localeCompare(b.sku || b.name);
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, statusFilter, inquiryFilter, customerFilter, incompleteOnly, missingItem, sortKey, checked, cogsCats]);

  const pageRows = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  /** Summary of open (applicable + unchecked) items by type, across the filtered set. */
  const summary = useMemo(() => {
    return PD_ITEMS.map(it => {
      const inquiries = new Set<string>();
      let pending = 0;
      for (const r of filtered) {
        if (isDisabled(r, it)) continue;
        if (checked[`${r.id}:${it.key}`]) continue;
        pending++;
        inquiries.add(r.inquiry_id);
      }
      return { item: it, pending, inquiries: inquiries.size };
    }).sort((a, b) => b.pending - a.pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, checked, cogsCats]);

  const totalOpen = summary.reduce((s, r) => s + r.pending, 0);
  const maxPending = Math.max(1, ...summary.map(s => s.pending));

  const toggle = async (p: Row, item: PdItemDef, next: boolean) => {
    const cellKey = `${p.id}:${item.key}`;
    const prev = !!checked[cellKey];
    setChecked(s => ({ ...s, [cellKey]: next }));
    setSaving(s => ({ ...s, [cellKey]: true }));
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('pd_checklist_items').upsert(
      {
        product_id: p.id,
        item_key: item.key,
        is_checked: next,
        checked_at: next ? new Date().toISOString() : null,
        checked_by: next ? auth.user?.id ?? null : null,
      },
      { onConflict: 'product_id,item_key' },
    );
    setSaving(s => ({ ...s, [cellKey]: false }));
    if (error) {
      setChecked(s => ({ ...s, [cellKey]: prev }));
      toast.error('Could not save: ' + error.message);
    }
  };

  const groups: { name: string; items: PdItemDef[] }[] = [];
  for (const it of PD_ITEMS) {
    const g = groups[groups.length - 1];
    if (!g || g.name !== it.group) groups.push({ name: it.group, items: [it] });
    else g.items.push(it);
  }

  return (
    <AppLayout>
      <TooltipProvider delayDuration={150}>
        <div className="px-3 sm:px-4 py-3 space-y-3 max-w-none">
          <PageBreadcrumbs canonical={[{ label: 'Inquiries', to: '/inquiries' }]} current="PD Dashboard" />

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">PD Dashboard</h1>
              <p className="text-xs text-muted-foreground">
                Product development checklist across every open inquiry. Greyed cells don't apply to that product.
              </p>
            </div>
            <div className="rounded-md border px-3 py-1.5 text-sm bg-muted/40">
              <span className="font-semibold tabular-nums">{totalOpen}</span>
              <span className="text-muted-foreground text-xs ml-1.5">open PD items</span>
            </div>
          </div>

          {/* Summary by item type */}
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">PD item</th>
                  <th className="text-right px-2 py-1.5 font-medium w-[90px]">Pending</th>
                  <th className="text-right px-2 py-1.5 font-medium w-[110px]">Inquiries</th>
                  <th className="px-2 py-1.5 font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {summary.filter(s => s.pending > 0).map(s => (
                  <tr key={s.item.key} className="border-t hover:bg-accent/40">
                    <td className="px-2 py-1">
                      <button className="hover:underline text-left" onClick={() => setMissingItem(s.item.key)}>
                        {s.item.label}
                      </button>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">{s.pending}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{s.inquiries}</td>
                    <td className="px-2 py-1">
                      <div className="h-1.5 rounded bg-primary/70" style={{ width: `${(s.pending / maxPending) * 100}%` }} />
                    </td>
                  </tr>
                ))}
                {summary.every(s => s.pending === 0) && (
                  <tr><td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">Nothing pending — all applicable items are checked.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search SKU, product, inquiry, customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 w-[260px]"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open (Active + PO)</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUS_OPTIONS.map(s2 => <SelectItem key={s2} value={s2}>{statusLabel(s2)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={inquiryFilter} onValueChange={setInquiryFilter}>
              <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Inquiry" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All inquiries</SelectItem>
                {inquiryOptions.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={customerFilter} onValueChange={setCustomerFilter}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue placeholder="Customer" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All customers</SelectItem>
                {customerOptions.map(([id, label]) => <SelectItem key={id} value={id}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={missingItem} onValueChange={v => setMissingItem(v as any)}>
              <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Missing item" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any PD item</SelectItem>
                {PD_ITEMS.map(it => <SelectItem key={it.key} value={it.key}>Missing: {it.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortKey} onValueChange={v => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inquiry">Sort: by inquiry</SelectItem>
                <SelectItem value="product">Sort: by product</SelectItem>
                <SelectItem value="incomplete">Sort: most incomplete</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Switch id="incomplete-only" checked={incompleteOnly} onCheckedChange={setIncompleteOnly} />
              <Label htmlFor="incomplete-only" className="text-xs">Incomplete only</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch id="include-closed" checked={includeClosed} onCheckedChange={setIncludeClosed} />
              <Label htmlFor="include-closed" className="text-xs">Include closed inquiries</Label>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No products match these filters.</div>
          ) : (
            <>
              <div className="border rounded-md overflow-auto max-h-[calc(100vh-260px)]">
                <table className="text-xs border-collapse w-full">
                  <thead className="sticky top-0 z-20 bg-muted">
                    <tr>
                      <th rowSpan={2} className="sticky left-0 z-30 bg-muted text-left px-2 py-1.5 border-r border-b font-medium w-[220px] min-w-[220px]">SKU / Product</th>
                      <th rowSpan={2} className="text-left px-2 py-1.5 border-r border-b font-medium w-[180px] min-w-[180px]">Inquiry</th>
                      <th rowSpan={2} className="text-left px-2 py-1.5 border-r border-b font-medium w-[140px] min-w-[140px]">Customer</th>
                      {groups.map(g => (
                        <th key={g.name} colSpan={g.items.length} className="text-center px-1 py-1 border-b border-l font-medium text-[11px] uppercase tracking-wide text-muted-foreground">
                          {g.name}
                        </th>
                      ))}
                      <th rowSpan={2} className="text-center px-2 py-1.5 border-b border-l font-medium whitespace-nowrap">Done</th>
                    </tr>
                    <tr>
                      {PD_ITEMS.map((it, i) => (
                        <th
                          key={it.key}
                          title={it.label}
                          className={cn(
                            'align-bottom px-1 py-1.5 border-b font-medium text-center w-[64px] min-w-[64px]',
                            i === 0 || PD_ITEMS[i - 1]?.group !== it.group ? 'border-l' : '',
                          )}
                        >
                          <span className="block text-[10px] leading-tight break-words">{it.label}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(p => {
                      const prog = rowProgress(p);
                      return (
                        <tr key={p.id} className="hover:bg-accent/40">
                          <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-r border-b w-[220px] min-w-[220px]">
                            <div className="flex items-center gap-2">
                              {p.photo_url && <img src={p.photo_url} alt={p.name} loading="lazy" className="h-8 w-8 rounded object-cover border shrink-0" />}
                              <div className="min-w-0">
                                <Link to={`/inquiry/${p.inquiry_id}/pd`} className="font-medium truncate max-w-[180px] block hover:underline">
                                  {p.sku || '—'}
                                </Link>
                                <div className="text-muted-foreground text-[11px] truncate max-w-[180px]">{p.name}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 border-r border-b">
                            <Link to={`/inquiry/${p.inquiry_id}`} className="hover:underline block truncate max-w-[170px]">{p.inquiry_label}</Link>
                          </td>
                          <td className="px-2 py-1.5 border-r border-b text-muted-foreground truncate max-w-[130px]">{p.customer_label}</td>
                          {PD_ITEMS.map((it, i) => {
                            const cellKey = `${p.id}:${it.key}`;
                            const disabled = isDisabled(p, it);
                            const box = (
                              <div className="flex items-center justify-center">
                                <Checkbox
                                  checked={!!checked[cellKey]}
                                  disabled={disabled || !!saving[cellKey]}
                                  onCheckedChange={v => toggle(p, it, v === true)}
                                  aria-label={`${it.label} — ${p.sku || p.name}`}
                                  className={cn(
                                    'border-2',
                                    disabled
                                      ? 'opacity-100 border-muted-foreground/70 bg-muted-foreground/25 cursor-not-allowed'
                                      : 'border-border bg-background data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground',
                                  )}
                                />
                              </div>
                            );
                            return (
                              <td
                                key={it.key}
                                className={cn(
                                  'px-1 py-1.5 border-b text-center w-[64px] min-w-[64px]',
                                  i === 0 || PD_ITEMS[i - 1]?.group !== it.group ? 'border-l' : '',
                                  disabled && 'bg-muted',
                                )}
                              >
                                {disabled ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild><span className="inline-block cursor-not-allowed">{box}</span></TooltipTrigger>
                                    <TooltipContent>{pdDisabledReason(p, it)}</TooltipContent>
                                  </Tooltip>
                                ) : box}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 border-b border-l text-center whitespace-nowrap tabular-nums font-medium">
                            {prog.done}/{prog.total}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Showing {page * PAGE_SIZE + 1}–{Math.min(filtered.length, (page + 1) * PAGE_SIZE)} of {filtered.length} products
                </span>
                {pageCount > 1 && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="h-7" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                    <span>Page {page + 1} / {pageCount}</span>
                    <Button variant="outline" size="sm" className="h-7" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </TooltipProvider>
    </AppLayout>
  );
}
