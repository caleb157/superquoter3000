// Inquiry Audit Grid — read-only bird's-eye matrix of all SKUs × cost buckets + key settings.
// Flags BLANK cells (majority of column has a value, this one doesn't) and CATEGORICAL
// odd-ones-out (cell differs from column mode). Numeric magnitude is NOT flagged.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, AlertTriangle } from 'lucide-react';
import * as XLSX from 'xlsx';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { computeProductCosting, type CostingEngineResult } from '@/lib/costing-engine';
import { cn } from '@/lib/utils';
const fmtNum = (n: number, d = 0) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Types ----------

type Inquiry = {
  id: string;
  rfq_number: string;
  title: string | null;
  customer_id: string | null;
  shipping_type_id_override: string | null;
};
type Customer = { id: string; name: string };
type ShippingType = { id: string; name: string };
type Location = { id: string; name: string };

type AuditRow = {
  product_id: string;
  sku: string;
  name: string;
  // Numeric buckets (INR per unit)
  raw_piece: number;
  subcontract: number;
  hardware: number;
  finishing: number;
  packaging: number;
  non_unit_cogs: number;
  direct_oh: number;
  indirect_oh: number;
  shipping: number;
  // Outputs
  unit_cost_inr: number;
  unit_price_inr: number;
  unit_price_usd: number;
  npm_pct: number; // markup as %
  cbm: number;
  // Categorical settings
  packaging_type: string;
  shipping_method: string;
  source_location: string;
  raw_vendor: string;
};

// ---------- Column definition ----------

type ColKind = 'money' | 'number' | 'category';
type ColDef = {
  key: keyof AuditRow;
  label: string;
  group: string;
  kind: ColKind;
};

const COLUMNS: ColDef[] = [
  // Sourced
  { key: 'raw_piece',     label: 'Raw Piece',    group: 'Sourced',   kind: 'money' },
  { key: 'subcontract',   label: 'Subcontract',  group: 'Sourced',   kind: 'money' },
  { key: 'hardware',      label: 'Hardware',     group: 'Sourced',   kind: 'money' },
  // Finishing
  { key: 'finishing',     label: 'Finishing',    group: 'Finishing', kind: 'money' },
  // Packaging
  { key: 'packaging',     label: 'Packaging',    group: 'Packaging', kind: 'money' },
  // Overhead
  { key: 'non_unit_cogs', label: 'Non-unit',     group: 'Overhead',  kind: 'money' },
  { key: 'direct_oh',     label: 'Direct OH',    group: 'Overhead',  kind: 'money' },
  { key: 'indirect_oh',   label: 'Indirect OH',  group: 'Overhead',  kind: 'money' },
  { key: 'shipping',      label: 'Shipping',     group: 'Overhead',  kind: 'money' },
  // Output
  { key: 'unit_cost_inr', label: 'Unit cost ₹',  group: 'Output',    kind: 'money' },
  { key: 'unit_price_inr',label: 'Unit price ₹', group: 'Output',    kind: 'money' },
  { key: 'unit_price_usd',label: 'Unit price $', group: 'Output',    kind: 'number' },
  { key: 'npm_pct',       label: 'Markup %',     group: 'Output',    kind: 'number' },
  { key: 'cbm',           label: 'CBM',          group: 'Output',    kind: 'number' },
  // Settings
  { key: 'packaging_type',  label: 'Packaging',  group: 'Settings',  kind: 'category' },
  { key: 'shipping_method', label: 'Shipping',   group: 'Settings',  kind: 'category' },
  { key: 'source_location', label: 'Source',     group: 'Settings',  kind: 'category' },
  { key: 'raw_vendor',      label: 'Raw vendor', group: 'Settings',  kind: 'category' },
];

// ---------- Anomaly detection ----------

type FlagKind = 'blank' | 'odd';
type FlagMap = Record<string, Record<string, { kind: FlagKind; msg: string } | null>>;

function mostFrequent(values: string[]): { mode: string | null; count: number } {
  if (values.length === 0) return { mode: null, count: 0 };
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let mode: string | null = null;
  let best = 0;
  for (const [k, c] of counts) if (c > best) { best = c; mode = k; }
  return { mode, count: best };
}

function detectFlags(rows: AuditRow[]): { flags: FlagMap; colCounts: Record<string, number> } {
  const flags: FlagMap = {};
  const colCounts: Record<string, number> = {};
  for (const r of rows) flags[r.product_id] = {};

  for (const col of COLUMNS) {
    colCounts[col.key] = 0;
    if (col.kind === 'money' || col.kind === 'number') {
      // Only flag money buckets for blank — skip outputs (cost/price/cbm/npm), they aren't "missing"
      if (col.group !== 'Sourced' && col.group !== 'Finishing' && col.group !== 'Packaging' && col.group !== 'Overhead') continue;
      const vals = rows.map(r => Number(r[col.key]) || 0);
      const filled = vals.filter(v => v > 0).length;
      const majorityFilled = filled > vals.length / 2;
      if (!majorityFilled) continue;
      for (let i = 0; i < rows.length; i++) {
        if (vals[i] <= 0) {
          flags[rows[i].product_id][col.key] = {
            kind: 'blank',
            msg: `Most SKUs have a ${col.label} cost; this one is empty.`,
          };
          colCounts[col.key]++;
        }
      }
    } else {
      const vals = rows.map(r => String(r[col.key] ?? ''));
      const nonEmpty = vals.filter(v => v !== '' && v !== '—');
      if (nonEmpty.length < 3) continue;
      const { mode } = mostFrequent(nonEmpty);
      if (!mode) continue;
      for (let i = 0; i < rows.length; i++) {
        const v = vals[i];
        if (v === '' || v === '—') continue;
        if (v !== mode) {
          flags[rows[i].product_id][col.key] = {
            kind: 'odd',
            msg: `Most SKUs use ${mode}; this one uses ${v}.`,
          };
          colCounts[col.key]++;
        }
      }
    }
  }
  return { flags, colCounts };
}

// ---------- Page ----------

export default function InquiryAuditGrid() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [inquiry, setInquiry] = useState<Inquiry | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useDocumentTitle(inquiry ? `Audit Grid · ${inquiry.title || inquiry.rfq_number}` : 'Audit Grid');

  // Load + run engine for every product in the inquiry.
  const load = useCallback(async () => {
    if (!inquiryId) return;
    setLoading(true);

    const { data: inq } = await supabase
      .from('customer_rfqs')
      .select('id, rfq_number, title, customer_id, shipping_type_id_override, exchange_rate_override, markup_percent_override, indirect_overhead_per_mh_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override')
      .eq('id', inquiryId)
      .maybeSingle();
    if (!inq) { setLoading(false); return; }
    setInquiry(inq as any);

    if ((inq as any).customer_id) {
      const { data: c } = await supabase.from('customers').select('id, name').eq('id', (inq as any).customer_id).maybeSingle();
      setCustomer((c as Customer) || null);
    }

    const { data: prods } = await supabase
      .from('products')
      .select('*')
      .eq('customer_rfq_id', inquiryId)
      .order('created_at', { ascending: true });
    const productList = (prods as any[]) || [];
    if (productList.length === 0) { setRows([]); setLoading(false); return; }
    const ids = productList.map(p => p.id);

    const [
      cogsRes, nuRes, ohRes, shipItemsRes, shipTypesRes, empRes, gsRes,
      cbmRes, ptRes, chemRes, boxRes, diffRes, locRes, rawRes,
    ] = await Promise.all([
      supabase.from('cogs_items').select('*').in('product_id', ids).limit(100000),
      supabase.from('non_unit_cogs').select('*').in('product_id', ids).limit(100000),
      supabase.from('overhead_items').select('*').in('product_id', ids).limit(100000),
      supabase.from('shipping_items').select('*').in('product_id', ids).limit(100000),
      supabase.from('shipping_types').select('*'),
      supabase.from('labor_employees').select('*'),
      supabase.from('global_settings').select('*').limit(1).single(),
      supabase.from('cbm_estimates').select('*').in('product_id', ids).limit(100000),
      supabase.from('product_types').select('*'),
      supabase.from('chemical_prices').select('*'),
      supabase.from('box_data').select('*'),
      (supabase as any).from('finishing_difficulty').select('name, adjustment_factor'),
      (supabase as any).from('local_transport_locations').select('id, name, cost_per_cbm_inr'),
      (supabase as any).from('raw_material_costs').select('*'),
    ]);

    const cogs = (cogsRes.data || []) as any[];
    const nu = (nuRes.data || []) as any[];
    const oh = (ohRes.data || []) as any[];
    const shipItems = (shipItemsRes.data || []) as any[];
    const shipTypes = (shipTypesRes.data || []) as ShippingType[];
    const employees = (empRes.data || []) as any[];
    const gs = (gsRes.data || {}) as any;
    const cbm = (cbmRes.data || []) as any[];
    const productTypes = (ptRes.data || []) as any[];
    const chemicalPrices = (chemRes.data || []) as any[];
    const boxData = (boxRes.data || []) as any[];
    const difficulties = ((diffRes as any).data || []) as any[];
    const locations = ((locRes as any).data || []) as Location[];
    const rawMaterialCosts = ((rawRes as any).data || []) as any[];

    const shipTypeById = new Map(shipTypes.map(s => [s.id, s]));
    const locById = new Map(locations.map(l => [l.id, l]));

    const out: AuditRow[] = productList.map((p: any) => {
      const productType = productTypes.find(pt => pt.id === p.product_type_id);
      const cbmRow = cbm.find(c => c.product_id === p.id) || null;
      const r: CostingEngineResult = computeProductCosting({
        product: p,
        cogsItems: cogs.filter(c => c.product_id === p.id),
        nonUnitCogs: nu.filter(n => n.product_id === p.id),
        overheadItems: oh.filter(o => o.product_id === p.id),
        shippingItems: shipItems,
        cbmRow,
        productType,
        boxData,
        chemicalPrices,
        shippingTypes: shipTypes as any[],
        laborEmployees: employees,
        globalSettings: gs,
        inquiryOverrides: inq,
        locations,
        difficulties,
        rawMaterialCosts,
      });

      // Sum buckets from resolvedCogsRows (only include='Yes' rows)
      const buckets = { raw: 0, subc: 0, hw: 0, finishing: 0, packaging: 0 };
      for (const row of r.resolvedCogsRows as any[]) {
        if (row.include !== 'Yes') continue;
        const qty = Number(row.components_per_product) || 0;
        const cost = Number(row.unit_cost_inr) || 0;
        const waste = Number(row.waste_factor) || 0;
        const v = qty * cost * (1 + waste);
        switch (row.cogs_type) {
          case 'Raw Piece':            buckets.raw += v; break;
          case 'COGS':                 buckets.raw += v; break;
          case 'Subcontracting':       buckets.subc += v; break;
          case 'Hardware':             buckets.hw += v; break;
          case 'Finishing Materials':  buckets.finishing += v; break;
          case 'Packaging':            buckets.packaging += v; break;
        }
      }

      // Settings: raw vendor (winning include=Yes raw row), packaging, shipping, source.
      const rawWinner = (cogs.filter(c => c.product_id === p.id && c.cogs_type === 'Raw Piece' && c.include === 'Yes')[0]) as any;
      const rawVendor = (rawWinner?.vendor_name || '').trim() || '—';
      const packagingType = p.packaging_type || 'ic_mc';
      const shipItem = shipItems.find(s => s.product_id === p.id);
      const shipId = (inq as any)?.shipping_type_id_override || shipItem?.shipping_type_id || null;
      const shipName = shipId ? (shipTypeById.get(shipId)?.name || '—') : '—';
      const sourceName = p.source_location_id
        ? (locById.get(p.source_location_id)?.name || '—')
        : 'Jodhpur';

      return {
        product_id: p.id,
        sku: p.sku || '',
        name: p.name || '',
        raw_piece: buckets.raw,
        subcontract: buckets.subc,
        hardware: buckets.hw,
        finishing: buckets.finishing,
        packaging: buckets.packaging,
        non_unit_cogs: r.nonUnitCogsPerUnit,
        direct_oh: r.directOhPerUnit,
        indirect_oh: r.indirectOhPerUnit,
        shipping: r.shippingPerUnit,
        unit_cost_inr: r.summary.product_cost_per_unit_inr,
        unit_price_inr: r.summary.unit_price_inr,
        unit_price_usd: r.summary.unit_price_usd,
        npm_pct: (r.markupPercent || 0) * 100,
        cbm: r.finalUnitCbm,
        packaging_type: packagingType,
        shipping_method: shipName,
        source_location: sourceName,
        raw_vendor: rawVendor,
      };
    });

    setRows(out);
    setLoading(false);
  }, [inquiryId]);

  useEffect(() => { void load(); }, [load]);

  const { flags, colCounts } = useMemo(() => detectFlags(rows), [rows]);
  const totalFlags = useMemo(() => Object.values(colCounts).reduce((a, b) => a + b, 0), [colCounts]);
  const flaggedColCount = useMemo(() => Object.values(colCounts).filter(c => c > 0).length, [colCounts]);

  const visibleRows = useMemo(() => {
    if (!onlyFlagged) return rows;
    return rows.filter(r => Object.values(flags[r.product_id] || {}).some(Boolean));
  }, [rows, flags, onlyFlagged]);

  const handleDownload = () => {
    if (!inquiry) return;
    const headers = ['SKU', 'Name', ...COLUMNS.map(c => `${c.group}: ${c.label}`), 'Flags'];
    const dataRows = rows.map(r => {
      const cells: any[] = [r.sku, r.name];
      const flagDescriptions: string[] = [];
      for (const col of COLUMNS) {
        const v = r[col.key];
        cells.push(col.kind === 'category' ? String(v ?? '') : (Number(v) || 0));
        const f = flags[r.product_id]?.[col.key];
        if (f) flagDescriptions.push(`${col.label} (${f.kind === 'blank' ? 'blank' : 'odd'})`);
      }
      cells.push(flagDescriptions.join('; '));
      return cells;
    });
    const meta = [
      ['Inquiry', inquiry.rfq_number],
      ['Title', inquiry.title || ''],
      ['Customer', customer?.name || ''],
      ['Generated', new Date().toISOString()],
      [],
    ];
    const aoa = [...meta, headers, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit');
    XLSX.writeFile(wb, `${inquiry.rfq_number}_cost_audit.xlsx`);
  };

  if (loading || !inquiry) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading…</div></AppLayout>;
  }

  const title = inquiry.title || inquiry.rfq_number;

  // Mobile: summary + flagged SKU list only
  if (isMobile) {
    const flaggedRows = rows.filter(r => Object.values(flags[r.product_id] || {}).some(Boolean));
    return (
      <AppLayout>
        <div className="px-3 py-3 space-y-3">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <div>
            <h1 className="text-lg font-semibold">Audit Grid</h1>
            <p className="text-xs text-muted-foreground">{title}</p>
          </div>
          <div className="rounded-md border p-3 bg-card text-sm">
            {totalFlags === 0
              ? 'No potential issues detected.'
              : `${totalFlags} potential issue${totalFlags === 1 ? '' : 's'} across ${flaggedColCount} column${flaggedColCount === 1 ? '' : 's'}.`}
          </div>
          {flaggedRows.length > 0 && (
            <div className="space-y-2">
              {flaggedRows.map(r => {
                const reasons = Object.entries(flags[r.product_id] || {})
                  .filter(([, f]) => f)
                  .map(([k, f]) => `${COLUMNS.find(c => c.key === k)?.label}: ${f!.msg}`);
                return (
                  <button
                    key={r.product_id}
                    className="w-full text-left rounded-md border p-3 bg-card hover:bg-accent"
                    onClick={() => navigate(`/product/${r.product_id}?tab=costing`)}
                  >
                    <div className="text-sm font-medium">{r.sku || r.name}</div>
                    {r.sku && <div className="text-xs text-muted-foreground">{r.name}</div>}
                    <ul className="mt-1.5 text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                      {reasons.map((rsn, i) => <li key={i}>⚠ {rsn}</li>)}
                    </ul>
                  </button>
                );
              })}
            </div>
          )}
          <Button variant="outline" size="sm" className="w-full" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> Download audit XLSX
          </Button>
        </div>
      </AppLayout>
    );
  }

  // Desktop matrix
  const groups: { name: string; cols: ColDef[] }[] = [];
  for (const c of COLUMNS) {
    const g = groups[groups.length - 1];
    if (!g || g.name !== c.group) groups.push({ name: c.group, cols: [c] });
    else g.cols.push(c);
  }

  return (
    <AppLayout>
      <TooltipProvider delayDuration={150}>
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
              current="Audit Grid"
            />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">Audit Grid</h1>
              <p className="text-xs text-muted-foreground">
                Compare every SKU's cost breakdown side by side. Amber cells flag a SKU missing a cost most others have, or a setting that differs from the majority.
                Click a row to open its costing sheet. Numeric magnitude differences are not flagged.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Switch id="only-flagged" checked={onlyFlagged} onCheckedChange={setOnlyFlagged} />
                <Label htmlFor="only-flagged" className="text-xs">Show only flagged rows</Label>
              </div>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={rows.length === 0}>
                <Download className="h-3.5 w-3.5 mr-1" /> Download audit grid
              </Button>
            </div>
          </div>

          <div className={cn(
            'rounded-md border px-3 py-2 text-sm flex items-center gap-2',
            totalFlags > 0 ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900' : 'bg-muted/40 text-muted-foreground',
          )}>
            {totalFlags > 0 && <AlertTriangle className="h-4 w-4" />}
            {totalFlags === 0
              ? 'No potential issues detected.'
              : `${totalFlags} potential issue${totalFlags === 1 ? '' : 's'} across ${flaggedColCount} column${flaggedColCount === 1 ? '' : 's'}.`}
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No products in this inquiry yet.</div>
          ) : (
            <div className="border rounded-md overflow-auto max-h-[calc(100vh-220px)]">
              <table className="text-xs border-collapse">
                <thead className="sticky top-0 z-20 bg-muted">
                  <tr>
                    <th rowSpan={2} className="sticky left-0 z-30 bg-muted text-left px-2 py-1.5 border-r border-b font-medium min-w-[220px]">SKU / Name</th>
                    {groups.map(g => (
                      <th key={g.name} colSpan={g.cols.length} className="text-center px-2 py-1 border-b border-l font-medium text-[11px] uppercase tracking-wide text-muted-foreground">
                        {g.name}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {COLUMNS.map((c, i) => (
                      <th
                        key={c.key as string}
                        className={cn(
                          'text-left px-2 py-1.5 border-b font-medium whitespace-nowrap',
                          i === 0 || COLUMNS[i - 1]?.group !== c.group ? 'border-l' : '',
                          c.kind !== 'category' && 'text-right',
                        )}
                      >
                        {c.label}
                        {colCounts[c.key] > 0 && (
                          <span className="ml-1 text-amber-600 dark:text-amber-400">⚠{colCounts[c.key]}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map(r => (
                    <tr key={r.product_id} className="hover:bg-accent/40 cursor-pointer" onClick={() => navigate(`/product/${r.product_id}?tab=costing`)}>
                      <td className="sticky left-0 z-10 bg-background hover:bg-accent/40 px-2 py-1.5 border-r border-b min-w-[220px]">
                        <div className="font-medium truncate max-w-[260px]">{r.sku || '—'}</div>
                        <div className="text-muted-foreground text-[11px] truncate max-w-[260px]">{r.name}</div>
                      </td>
                      {COLUMNS.map((c, i) => {
                        const flag = flags[r.product_id]?.[c.key as string];
                        const v = r[c.key];
                        const isMoney = c.kind === 'money';
                        const isNum = c.kind === 'number';
                        const num = Number(v) || 0;
                        const display = c.kind === 'category'
                          ? (String(v ?? '') || '—')
                          : (num === 0 ? '—' : isMoney ? `₹${fmtNum(num, 0)}` : (c.key === 'cbm' ? num.toFixed(4) : fmtNum(num, c.key === 'npm_pct' ? 1 : 2)));
                        const cell = (
                          <td
                            key={c.key as string}
                            className={cn(
                              'px-2 py-1.5 border-b whitespace-nowrap tabular-nums',
                              (isMoney || isNum) && 'text-right',
                              i === 0 || COLUMNS[i - 1]?.group !== c.group ? 'border-l' : '',
                              flag && 'bg-amber-100/70 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200',
                            )}
                          >
                            {flag && <span className="mr-1">⚠</span>}{display}
                          </td>
                        );
                        if (!flag) return cell;
                        return (
                          <Tooltip key={c.key as string}>
                            <TooltipTrigger asChild>{cell}</TooltipTrigger>
                            <TooltipContent>{flag.msg}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </TooltipProvider>
    </AppLayout>
  );
}
