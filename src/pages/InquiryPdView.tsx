// Inquiry PD View — per-product product-development checklist matrix.
// Rows = non-archived products in the inquiry, columns = fixed PD items.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Maximize2 } from 'lucide-react';


import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ---------- PD items ----------

type ItemKey =
  | 'finishing_panel_wood'
  | 'finishing_panel_metal'
  | 'ic_size'
  | 'mc_size'
  | 'packaging'
  | 'inserts_instructions'
  | 'handles_knobs'
  | 'feet_buffers'
  | 'handles_latches'
  | 'other_hardware'
  | 'accessories'
  | 'qc_sheet'
  | 'final_product_photo';

type ItemDef = {
  key: ItemKey;
  label: string;
  group: string;
  /** COGS category name this item depends on; item is greyed out when the product has no such rows. */
  cogsCategory?: string;
  /** Greyed out unless the product's packaging_type is 'ic_mc'. */
  requiresIcMc?: boolean;
  /** Greyed out when the product is 0% wood. */
  requiresWood?: boolean;
  /** Greyed out when the product is 100% wood (no metal). */
  requiresMetal?: boolean;
};

const ITEMS: ItemDef[] = [
  { key: 'finishing_panel_wood',  label: 'Finishing Panel — Wood',   group: 'Finishing', requiresWood: true },
  { key: 'finishing_panel_metal', label: 'Finishing Panel — Metal',  group: 'Finishing', requiresMetal: true },
  { key: 'ic_size',               label: 'IC SIZE',                  group: 'Packaging' },
  { key: 'mc_size',               label: 'MC SIZE',                  group: 'Packaging', requiresIcMc: true },
  { key: 'packaging',             label: 'Packaging',                group: 'Packaging' },
  { key: 'inserts_instructions',  label: 'Inserts/Instructions',     group: 'Packaging', cogsCategory: 'Inserts + Instructions' },
  { key: 'handles_knobs',         label: 'Handles/Knobs',            group: 'Hardware',  cogsCategory: 'Handles + Knobs' },
  { key: 'feet_buffers',          label: 'Feet/Buffers',             group: 'Hardware',  cogsCategory: 'Feet/Buffers' },
  { key: 'handles_latches',       label: 'Hinges/Latches',           group: 'Hardware',  cogsCategory: 'Handles/Latches' },
  { key: 'other_hardware',        label: 'Other Hardware',           group: 'Hardware',  cogsCategory: 'Other Hardware' },
  { key: 'accessories',           label: 'Accessories',              group: 'Accessories', cogsCategory: 'Accessories' },
  { key: 'qc_sheet',              label: 'QC Sheet',                 group: 'QC' },
  { key: 'final_product_photo',   label: 'Final Product Photo',      group: 'QC' },
];


// Legacy COGS rows still typed 'Hardware' count towards "Other Hardware".
const LEGACY_CATEGORY_ALIAS: Record<string, string> = { Hardware: 'Other Hardware' };

type Inquiry = { id: string; rfq_number: string; title: string | null };
type Product = {
  id: string;
  sku: string | null;
  name: string;
  photo_url: string | null;
  packaging_type: string | null;
  percent_wood: number | null;
};


export default function InquiryPdView() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  /** productId -> set of COGS category names present on that product */
  const [cogsCats, setCogsCats] = useState<Record<string, Set<string>>>({});
  /** `${productId}:${itemKey}` -> checked */
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  // ---------- resizable / responsive columns ----------
  const scrollRef = useRef<HTMLDivElement>(null);
  const STORAGE_KEY = 'pd-view-col-widths';
  const MIN_W = 34;
  const MAX_W = 160;
  const [widths, setWidths] = useState<Record<ItemKey, number>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Record<string, number>;
        return Object.fromEntries(ITEMS.map(i => [i.key, saved[i.key] ?? 64])) as Record<ItemKey, number>;
      }
    } catch { /* ignore */ }
    return Object.fromEntries(ITEMS.map(i => [i.key, 64])) as Record<ItemKey, number>;
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)); } catch { /* ignore */ }
  }, [widths]);

  /** Distribute available horizontal space evenly across checklist columns. */
  const fitColumns = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const available = el.clientWidth - 200 /* SKU col */ - 64 /* Done col */ - 2;
    const w = Math.max(MIN_W, Math.min(MAX_W, Math.floor(available / ITEMS.length)));
    setWidths(Object.fromEntries(ITEMS.map(i => [i.key, w])) as Record<ItemKey, number>);
  }, []);

  const didAutoFit = useRef(false);
  useEffect(() => {
    if (loading || didAutoFit.current || !scrollRef.current) return;
    didAutoFit.current = true;
    if (!localStorage.getItem(STORAGE_KEY)) fitColumns();
  }, [loading, fitColumns]);

  const startResize = (e: React.MouseEvent, key: ItemKey) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key];
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(MIN_W, Math.min(MAX_W, startW + (ev.clientX - startX)));
      setWidths(w => ({ ...w, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };



  useDocumentTitle(inquiry ? `PD View — ${inquiry.title || inquiry.rfq_number}` : 'PD View');

  useEffect(() => {
    if (!inquiryId) return;
    (async () => {
      setLoading(true);
      const [{ data: inq }, { data: prods }] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title').eq('id', inquiryId).maybeSingle(),
        supabase
          .from('products')
          .select('id, sku, name, photo_url, packaging_type, percent_wood')
          .eq('customer_rfq_id', inquiryId)
          .is('archived_at', null)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
      ]);
      setInquiry((inq as Inquiry) || null);
      const list = (prods || []) as Product[];
      setProducts(list);

      const ids = list.map(p => p.id);
      if (ids.length > 0) {
        const [{ data: cogs }, { data: pd }] = await Promise.all([
          supabase.from('cogs_items').select('product_id, cogs_type, include').in('product_id', ids),
          supabase.from('pd_checklist_items').select('product_id, item_key, is_checked').in('product_id', ids),
        ]);
        const map: Record<string, Set<string>> = {};
        for (const row of (cogs || []) as any[]) {
          if (row.include === 'No') continue;
          const cat = LEGACY_CATEGORY_ALIAS[row.cogs_type] || row.cogs_type;
          if (!cat) continue;
          (map[row.product_id] ||= new Set()).add(cat);
        }
        setCogsCats(map);
        const state: Record<string, boolean> = {};
        for (const row of (pd || []) as any[]) state[`${row.product_id}:${row.item_key}`] = !!row.is_checked;
        setChecked(state);
      } else {
        setCogsCats({});
        setChecked({});
      }
      setLoading(false);
    })();
  }, [inquiryId]);

  const isDisabled = (p: Product, item: ItemDef) => {
    if (item.requiresWood) return p.percent_wood === 0;
    if (item.requiresMetal) return p.percent_wood === 1;
    if (item.requiresIcMc) return (p.packaging_type || 'ic_mc') !== 'ic_mc';
    if (item.cogsCategory) return !cogsCats[p.id]?.has(item.cogsCategory);
    return false;
  };

  const disabledReason = (p: Product, item: ItemDef) => {
    if (item.requiresWood) return 'No wood on this product (0% wood).';
    if (item.requiresMetal) return 'No metal on this product (100% wood).';
    if (item.requiresIcMc) return `No master carton — packaging is "${p.packaging_type || 'ic_mc'}".`;
    if (item.cogsCategory) return `No "${item.cogsCategory}" COGS rows on this product.`;
    return '';
  };

  const applicableItems = (p: Product) => ITEMS.filter(it => !isDisabled(p, it));

  const rowProgress = (p: Product) => {
    const applicable = applicableItems(p);
    const done = applicable.filter(it => checked[`${p.id}:${it.key}`]).length;
    return { done, total: applicable.length };
  };

  const overall = useMemo(() => {
    let done = 0, total = 0;
    for (const p of products) {
      const r = rowProgress(p);
      done += r.done; total += r.total;
    }
    return { done, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, checked, cogsCats]);

  const toggle = async (p: Product, item: ItemDef, next: boolean) => {
    const cellKey = `${p.id}:${item.key}`;
    const prev = !!checked[cellKey];
    setChecked(s => ({ ...s, [cellKey]: next }));
    setSaving(s => ({ ...s, [cellKey]: true }));
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('pd_checklist_items')
      .upsert(
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

  if (loading || !inquiry) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading…</div></AppLayout>;
  }

  const title = inquiry.title || inquiry.rfq_number;

  const groups: { name: string; items: ItemDef[] }[] = [];
  for (const it of ITEMS) {
    const g = groups[groups.length - 1];
    if (!g || g.name !== it.group) groups.push({ name: it.group, items: [it] });
    else g.items.push(it);
  }

  return (
    <AppLayout>
      <TooltipProvider delayDuration={150}>
        <div className="px-3 sm:px-4 py-3 space-y-3 max-w-none">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <PageBreadcrumbs
              canonical={[
                { label: 'Inquiries', to: '/inquiries' },
                { label: title, to: `/inquiry/${inquiryId}` },
              ]}
              current="PD View"
            />
          </div>

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">PD View</h1>
              <p className="text-xs text-muted-foreground">
                Product development checklist for every active SKU. Greyed-out cells don't apply to that product.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={fitColumns}>
                <Maximize2 className="h-3.5 w-3.5" /> Fit to screen
              </Button>
              <div className="rounded-md border px-3 py-1.5 text-sm bg-muted/40">
                <span className="font-semibold tabular-nums">{overall.done}/{overall.total}</span>
                <span className="text-muted-foreground text-xs ml-1.5">items done</span>
              </div>
            </div>

          </div>

          {products.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No active products in this inquiry.</div>
          ) : (
            <div
              ref={scrollRef}
              className="border rounded-md overflow-auto max-h-[calc(100vh-200px)] scroll-smooth snap-x snap-proximity"
            >
              <table className="text-xs border-collapse">
                <thead className="sticky top-0 z-20 bg-muted">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-30 bg-muted text-left px-2 py-1.5 border-r border-b font-medium w-[200px] min-w-[200px]">SKU / Name</th>
                    {groups.map(g => (
                      <th key={g.name} colSpan={g.items.length} className="text-center px-1 py-1 border-b border-l font-medium text-[11px] uppercase tracking-wide text-muted-foreground">
                        {g.name}
                      </th>
                    ))}
                    <th rowSpan={2} className="text-center px-2 py-1.5 border-b border-l font-medium whitespace-nowrap">Done</th>
                  </tr>
                  <tr>
                    {ITEMS.map((it, i) => (
                      <th
                        key={it.key}
                        title={it.label}
                        style={{ width: widths[it.key], minWidth: widths[it.key], maxWidth: widths[it.key] }}
                        className={cn(
                          'group relative align-bottom px-1 py-1.5 border-b font-medium text-center snap-start',
                          i === 0 || ITEMS[i - 1]?.group !== it.group ? 'border-l' : '',
                        )}
                      >
                        <span className="block text-[10px] leading-tight break-words hyphens-none">
                          {it.label}
                        </span>
                        <span
                          role="separator"
                          aria-label={`Resize ${it.label} column`}
                          onMouseDown={e => startResize(e, it.key)}
                          onDoubleClick={() => fitColumns()}
                          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-primary/40 group-hover:bg-border"
                        />
                      </th>
                    ))}
                  </tr>

                </thead>
                <tbody>
                  {products.map(p => {
                    const prog = rowProgress(p);
                    return (
                      <tr key={p.id} className="hover:bg-accent/40">
                        <td className="sticky left-0 z-10 bg-background px-2 py-1.5 border-r border-b w-[200px] min-w-[200px]">
                          <div className="flex items-center gap-2">
                            {p.photo_url && (
                              <img src={p.photo_url} alt={p.name} loading="lazy" className="h-8 w-8 rounded object-cover border shrink-0" />
                            )}
                            <button
                              className="text-left min-w-0"
                              onClick={() => navigate(`/product/${p.id}`)}
                            >
                              <div className="font-medium truncate max-w-[180px]">{p.sku || '—'}</div>
                              <div className="text-muted-foreground text-[11px] truncate max-w-[180px]">{p.name}</div>
                            </button>
                          </div>
                        </td>
                        {ITEMS.map((it, i) => {
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
                              style={{ width: widths[it.key], minWidth: widths[it.key], maxWidth: widths[it.key] }}
                              className={cn(
                                'px-1 py-1.5 border-b text-center snap-start',
                                i === 0 || ITEMS[i - 1]?.group !== it.group ? 'border-l' : '',
                                disabled && 'bg-muted',
                              )}
                            >
                              {disabled ? (
                                <Tooltip>
                                  <TooltipTrigger asChild><span className="inline-block cursor-not-allowed">{box}</span></TooltipTrigger>
                                  <TooltipContent>{disabledReason(p, it)}</TooltipContent>
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
          )}

        </div>
      </TooltipProvider>
    </AppLayout>
  );
}
