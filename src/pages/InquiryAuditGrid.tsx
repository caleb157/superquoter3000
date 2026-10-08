// Inquiry Bulk Costing Editor (formerly Audit Grid).
// Tabbed "lenses" keep the grid within the viewport (no sideways scroll). Every editable
// cell writes straight to the database; all derived numbers (CBM, cost, price) are
// recomputed live through the shared costing engine. Multi-SKU selection + bulk bar
// applies one value to many SKUs at once. Audit flags (blank / odd-one-out) carry over.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, ArrowUpDown, Download, AlertTriangle, RefreshCw, ExternalLink, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PageBreadcrumbs } from '@/components/PageBreadcrumbs';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useIsMobile } from '@/hooks/use-mobile';
import { supabase } from '@/integrations/supabase/client';
import { computeProductCosting, type CostingEngineResult } from '@/lib/costing-engine';
import { cn } from '@/lib/utils';
import { customerPrimary } from '@/lib/customer-name';
import { calcICDimensions } from '@/lib/calculations';

const fmtNum = (n: number, d = 0) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const db = supabase as any;

// ---------- Audit row (used for flags + export) ----------

type AuditRow = {
  product_id: string; sku: string; name: string;
  raw_piece: number; subcontract: number;
  hw_inserts: number; hw_handles_knobs: number; hw_feet: number; hw_latches: number; hw_other: number; accessories: number;
  finishing: number; packaging: number;
  non_unit_cogs: number; direct_oh: number; indirect_oh: number; shipping: number;
  unit_cost_inr: number; unit_price_inr: number; unit_price_usd: number; npm_pct: number; cbm: number;
  packaging_type: string; shipping_method: string; source_location: string; raw_vendor: string;
  is_outsourced: boolean; outsourced: number;
};

type ColKind = 'money' | 'number' | 'category';
type AuditCol = { key: keyof AuditRow; label: string; group: string; kind: ColKind };

const AUDIT_COLUMNS: AuditCol[] = [
  { key: 'outsourced', label: 'Outsourced', group: 'Sourced', kind: 'money' },
  { key: 'raw_piece', label: 'Raw Piece', group: 'Sourced', kind: 'money' },
  { key: 'subcontract', label: 'Subcontract', group: 'Sourced', kind: 'money' },
  { key: 'hw_inserts', label: 'Inserts + Instr.', group: 'Sourced', kind: 'money' },
  { key: 'hw_handles_knobs', label: 'Handles + Knobs', group: 'Sourced', kind: 'money' },
  { key: 'hw_feet', label: 'Feet/Buffers', group: 'Sourced', kind: 'money' },
  { key: 'hw_latches', label: 'Handles/Latches', group: 'Sourced', kind: 'money' },
  { key: 'hw_other', label: 'Other Hardware', group: 'Sourced', kind: 'money' },
  { key: 'accessories', label: 'Accessories', group: 'Sourced', kind: 'money' },
  { key: 'finishing', label: 'Finishing', group: 'Finishing', kind: 'money' },
  { key: 'packaging', label: 'Packaging', group: 'Packaging', kind: 'money' },
  { key: 'non_unit_cogs', label: 'Non-unit', group: 'Overhead', kind: 'money' },
  { key: 'direct_oh', label: 'Direct OH', group: 'Overhead', kind: 'money' },
  { key: 'indirect_oh', label: 'Indirect OH', group: 'Overhead', kind: 'money' },
  { key: 'shipping', label: 'Shipping', group: 'Overhead', kind: 'money' },
  { key: 'unit_cost_inr', label: 'Unit cost ₹', group: 'Output', kind: 'money' },
  { key: 'unit_price_inr', label: 'Unit price ₹', group: 'Output', kind: 'money' },
  { key: 'unit_price_usd', label: 'Unit price $', group: 'Output', kind: 'number' },
  { key: 'npm_pct', label: 'Markup %', group: 'Output', kind: 'number' },
  { key: 'cbm', label: 'CBM', group: 'Output', kind: 'number' },
  { key: 'packaging_type', label: 'Packaging', group: 'Settings', kind: 'category' },
  { key: 'shipping_method', label: 'Shipping', group: 'Settings', kind: 'category' },
  { key: 'source_location', label: 'Source', group: 'Settings', kind: 'category' },
  { key: 'raw_vendor', label: 'Raw vendor', group: 'Settings', kind: 'category' },
];

type FlagMap = Record<string, Record<string, { kind: 'blank' | 'odd'; msg: string } | null>>;

function detectFlags(rows: AuditRow[]): FlagMap {
  const flags: FlagMap = {};
  for (const r of rows) flags[r.product_id] = {};
  for (const col of AUDIT_COLUMNS) {
    if (col.kind !== 'category') {
      if (col.key === 'outsourced') continue;
      if (!['Sourced', 'Finishing', 'Packaging', 'Overhead'].includes(col.group)) continue;
      const vals = rows.map(r => Number(r[col.key]) || 0);
      if (!(vals.filter(v => v > 0).length > vals.length / 2)) continue;
      rows.forEach((r, i) => {
        if (r.is_outsourced) return;
        if (vals[i] <= 0) flags[r.product_id][col.key] = { kind: 'blank', msg: `Most SKUs have a ${col.label} cost; this one is empty.` };
      });
    } else {
      const vals = rows.map(r => String(r[col.key] ?? ''));
      const nonEmpty = vals.filter(v => v && v !== '—');
      if (nonEmpty.length < 3) continue;
      const counts = new Map<string, number>();
      nonEmpty.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
      const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      rows.forEach((r, i) => {
        const v = vals[i];
        if (v && v !== '—' && v !== mode) flags[r.product_id][col.key] = { kind: 'odd', msg: `Most SKUs use ${mode}; this one uses ${v}.` };
      });
    }
  }
  return flags;
}

// ---------- Data bundle ----------

type Bundle = {
  inq: any; customer: any;
  products: any[]; cogs: any[]; nu: any[]; oh: any[]; shipItems: any[]; cbm: any[];
  shipTypes: any[]; employees: any[]; gs: any; productTypes: any[]; chemicalPrices: any[];
  boxData: any[]; difficulties: any[]; locations: any[]; rawMaterialCosts: any[]; shipmentPool: any;
};

const BUCKET_TYPES: Record<string, string[]> = {
  raw_piece: ['Raw Piece', 'COGS'],
  subcontract: ['Subcontracting'],
  hw_inserts: ['Inserts + Instructions'],
  hw_handles_knobs: ['Handles + Knobs'],
  hw_feet: ['Feet/Buffers'],
  hw_latches: ['Handles/Latches'],
  hw_other: ['Other Hardware', 'Hardware'],
  accessories: ['Accessories'],
  finishing: ['Finishing Materials'],
  packaging: ['Packaging'],
};
const lineVal = (c: any) => (Number(c.components_per_product) || 0) * (Number(c.unit_cost_inr) || 0) * (1 + (Number(c.waste_factor) || 0));

type Row = {
  p: any; cbmRow: any; r: CostingEngineResult; audit: AuditRow;
  buckets: Record<string, number>; rawVendor: string;
  icAuto: { ic_width: number; ic_depth: number; ic_height: number };
};

function buildRows(b: Bundle): Row[] {
  const shipTypeById = new Map(b.shipTypes.map((s: any) => [s.id, s]));
  const locById = new Map(b.locations.map((l: any) => [l.id, l]));
  return b.products.map(p => {
    const productType = b.productTypes.find(pt => pt.id === p.product_type_id);
    const cbmRow = b.cbm.find(c => c.product_id === p.id) || null;
    const myCogs = b.cogs.filter(c => c.product_id === p.id);
    const r = computeProductCosting({
      product: p, cogsItems: myCogs,
      nonUnitCogs: b.nu.filter(n => n.product_id === p.id),
      overheadItems: b.oh.filter(o => o.product_id === p.id),
      shippingItems: b.shipItems, cbmRow, productType, boxData: b.boxData,
      chemicalPrices: b.chemicalPrices, shippingTypes: b.shipTypes, laborEmployees: b.employees,
      globalSettings: b.gs, inquiryOverrides: b.inq, locations: b.locations,
      difficulties: b.difficulties, rawMaterialCosts: b.rawMaterialCosts, shipmentPool: b.shipmentPool,
    } as any);
    const buckets: Record<string, number> = {};
    for (const k of Object.keys(BUCKET_TYPES)) buckets[k] = 0;
    for (const row of r.resolvedCogsRows as any[]) {
      if (row.include !== 'Yes') continue;
      const k = Object.keys(BUCKET_TYPES).find(key => BUCKET_TYPES[key].includes(row.cogs_type));
      if (k) buckets[k] += lineVal(row);
    }
    const rawWinner = myCogs.find(c => c.cogs_type === 'Raw Piece' && c.include === 'Yes');
    const rawVendor = (rawWinner?.vendor_name || '').trim();
    const shipItem = b.shipItems.find(s => s.product_id === p.id);
    const shipId = b.inq?.shipping_type_id_override || shipItem?.shipping_type_id || null;
    const audit: AuditRow = {
      product_id: p.id, sku: p.sku || '', name: p.name || '',
      raw_piece: buckets.raw_piece, subcontract: buckets.subcontract,
      hw_inserts: buckets.hw_inserts, hw_handles_knobs: buckets.hw_handles_knobs, hw_feet: buckets.hw_feet,
      hw_latches: buckets.hw_latches, hw_other: buckets.hw_other, accessories: buckets.accessories,
      finishing: buckets.finishing, packaging: buckets.packaging,
      non_unit_cogs: r.nonUnitCogsPerUnit, direct_oh: r.directOhPerUnit, indirect_oh: r.indirectOhPerUnit,
      shipping: r.shippingPerUnit,
      unit_cost_inr: r.summary.product_cost_per_unit_inr, unit_price_inr: r.summary.unit_price_inr,
      unit_price_usd: r.summary.unit_price_usd, npm_pct: (r.markupPercent || 0) * 100, cbm: r.finalUnitCbm,
      packaging_type: p.packaging_type || 'ic_mc',
      shipping_method: shipId ? ((shipTypeById.get(shipId) as any)?.name || '—') : '—',
      source_location: p.source_location_id ? ((locById.get(p.source_location_id) as any)?.name || '—') : 'Jodhpur',
      raw_vendor: rawVendor || '—', is_outsourced: r.isOutsourced, outsourced: r.outsourcedUnitCostInr,
    };
    const icAuto = calcICDimensions(Number(p.width_inch) || 0, Number(p.depth_inch) || 0, Number(p.height_inch) || 0, productType?.pkg_ic_add_per_side_in ?? 0.5);
    return { p, cbmRow, r, audit, buckets, rawVendor, icAuto };
  });
}

// ---------- Lens columns ----------

type EditKind = 'money' | 'num' | 'pct' | 'text' | 'select' | 'bool' | 'dims';
type LensCol = {
  id: string;
  label: string;
  width: string; // tailwind width class
  edit?: EditKind;
  options?: (b: Bundle) => { value: string; label: string }[];
  get: (row: Row) => any;
  display?: (row: Row) => string;
  flagKey?: keyof AuditRow;
  disabled?: (row: Row, b: Bundle) => string | null;
  /** Writes value for the given product ids. */
  target?: { kind: 'product'; field: string } | { kind: 'product_dims'; fields: [string, string, string] }
    | { kind: 'cbm'; field: string } | { kind: 'cbm_dims'; fields: [string, string, string] }
    | { kind: 'bucket'; bucket: string } | { kind: 'vendor' };
};

const PACKAGING_OPTS = [
  { value: 'ic_mc', label: 'IC + MC' },
  { value: 'ic_only', label: 'IC only' },
  { value: 'bulk_pack', label: 'Bulk pack' },
  { value: 'corrugate_bubble', label: 'Corrugate/Bubble' },
  { value: 'no_packaging', label: 'None' },
];
const boxOpts = (b: Bundle) => {
  const set = Array.from(new Set(b.boxData.map((x: any) => x.box_type).filter(Boolean)));
  return set.map(v => ({ value: v, label: v }));
};
const money = (n: number) => (n ? `₹${fmtNum(n, 0)}` : '—');
const dimsStr = (a: any, b: any, c: any) => (a || b || c) ? `${+(+a || 0).toFixed(2)}×${+(+b || 0).toFixed(2)}×${+(+c || 0).toFixed(2)}` : '';
const bucketCol = (id: string, label: string): LensCol => ({
  id, label, width: 'w-[92px]', edit: 'money', flagKey: id as keyof AuditRow,
  get: r => Math.round(r.buckets[id] * 100) / 100, target: { kind: 'bucket', bucket: id },
});
const ro = (id: string, label: string, get: (r: Row) => any, display: (r: Row) => string, width = 'w-[88px]', flagKey?: keyof AuditRow): LensCol =>
  ({ id, label, width, get, display, flagKey });

const LENSES: { id: string; label: string; hint: string; cols: LensCol[] }[] = [
  {
    id: 'sourcing', label: 'Sourcing', hint: 'Raw piece, vendor, subcontract and outsourced cost',
    cols: [
      { id: 'qty', label: 'Qty', width: 'w-[70px]', edit: 'num', get: r => r.p.quantity ?? 0, target: { kind: 'product', field: 'quantity' } },
      { id: 'is_outsourced', label: 'Outsourced', width: 'w-[80px]', edit: 'bool', get: r => !!r.p.is_outsourced, target: { kind: 'product', field: 'is_outsourced' } },
      { id: 'outsourced_cost', label: 'Outsourced ₹', width: 'w-[100px]', edit: 'money', get: r => r.p.outsourced_unit_cost_inr ?? 0, target: { kind: 'product', field: 'outsourced_unit_cost_inr' } },
      { id: 'vendor', label: 'Raw vendor', width: 'w-[150px]', edit: 'text', flagKey: 'raw_vendor', get: r => r.rawVendor, target: { kind: 'vendor' } },
      bucketCol('raw_piece', 'Raw Piece ₹'),
      bucketCol('subcontract', 'Subcontract ₹'),
      { id: 'wood', label: 'Wood %', width: 'w-[72px]', edit: 'num', get: r => r.p.percent_wood ?? 0, target: { kind: 'product', field: 'percent_wood' } },
      { id: 'source', label: 'Source', width: 'w-[130px]', edit: 'select', flagKey: 'source_location',
        options: b => [{ value: '', label: 'Jodhpur' }, ...b.locations.map((l: any) => ({ value: l.id, label: l.name }))],
        get: r => r.p.source_location_id || '', target: { kind: 'product', field: 'source_location_id' } },
    ],
  },
  {
    id: 'packaging', label: 'Packaging & CBM', hint: 'Piece size, box types and master carton limits → packed CBM',
    cols: [
      { id: 'pkg_type', label: 'Packaging', width: 'w-[110px]', edit: 'select', flagKey: 'packaging_type', options: () => PACKAGING_OPTS,
        get: r => r.p.packaging_type || 'ic_mc', target: { kind: 'product', field: 'packaging_type' } },
      { id: 'piece_w', label: 'Piece W"', width: 'w-[62px]', edit: 'num', get: r => r.p.width_inch ?? 0, target: { kind: 'product', field: 'width_inch' } },
      { id: 'piece_d', label: 'Piece D"', width: 'w-[62px]', edit: 'num', get: r => r.p.depth_inch ?? 0, target: { kind: 'product', field: 'depth_inch' } },
      { id: 'piece_h', label: 'Piece H"', width: 'w-[62px]', edit: 'num', get: r => r.p.height_inch ?? 0, target: { kind: 'product', field: 'height_inch' } },
      { id: 'pkg_w', label: 'Pkg W"', width: 'w-[62px]', edit: 'num', get: r => +(r.cbmRow?.ic_width ?? r.icAuto.ic_width).toFixed(2), target: { kind: 'cbm', field: 'ic_width' } },
      { id: 'pkg_d', label: 'Pkg D"', width: 'w-[62px]', edit: 'num', get: r => +(r.cbmRow?.ic_depth ?? r.icAuto.ic_depth).toFixed(2), target: { kind: 'cbm', field: 'ic_depth' } },
      { id: 'pkg_h', label: 'Pkg H"', width: 'w-[62px]', edit: 'num', get: r => +(r.cbmRow?.ic_height ?? r.icAuto.ic_height).toFixed(2), target: { kind: 'cbm', field: 'ic_height' } },
      { id: 'weight', label: 'Wt kg', width: 'w-[68px]', edit: 'num', get: r => r.p.weight_kg ?? 0, target: { kind: 'product', field: 'weight_kg' } },
      { id: 'ic_type', label: 'IC ply', width: 'w-[76px]', edit: 'select', options: boxOpts, get: r => r.cbmRow?.ic_type || '7 ply', target: { kind: 'cbm', field: 'ic_type' } },
      { id: 'per_ic', label: 'Pcs/IC', width: 'w-[64px]', edit: 'num', get: r => r.cbmRow?.products_per_ic || 1, target: { kind: 'cbm', field: 'products_per_ic' } },
      { id: 'mc_type', label: 'MC ply', width: 'w-[76px]', edit: 'select', options: boxOpts, get: r => r.cbmRow?.mc_type || '7 ply', target: { kind: 'cbm', field: 'mc_type' } },
      { id: 'mc_max', label: 'MC max W×D×H"', width: 'w-[110px]', edit: 'dims',
        get: r => dimsStr(r.cbmRow?.mc_max_width || 25, r.cbmRow?.mc_max_depth || 25, r.cbmRow?.mc_max_height || 25),
        target: { kind: 'cbm_dims', fields: ['mc_max_width', 'mc_max_depth', 'mc_max_height'] } },
      { id: 'bulk_pcs', label: 'Bulk pcs', width: 'w-[62px]', edit: 'num', get: r => r.p.bulk_pieces_per_box ?? 1, target: { kind: 'product', field: 'bulk_pieces_per_box' },
        disabled: r => (r.p.packaging_type === 'bulk_pack' ? null : 'Only used for bulk pack') },
      ro('mc_dims', 'MC size', r => r.r.mcDims.mc_width, r => r.r.mcDims.mc_width ? dimsStr(r.r.mcDims.mc_width, r.r.mcDims.mc_depth, r.r.mcDims.mc_height) : '—', 'w-[100px]'),
      ro('per_mc', 'Pcs/MC', r => r.r.productsPerMc, r => r.r.productsPerMc ? String(r.r.productsPerMc) : '—', 'w-[60px]'),
      ro('cbm', 'Unit CBM', r => r.r.finalUnitCbm, r => r.r.finalUnitCbm ? r.r.finalUnitCbm.toFixed(4) : '—', 'w-[76px]', 'cbm'),
    ],
  },
  {
    id: 'hardware', label: 'Hardware', hint: 'Per-unit hardware and accessory costs',
    cols: [
      bucketCol('hw_inserts', 'Inserts + Instr.'),
      bucketCol('hw_handles_knobs', 'Handles + Knobs'),
      bucketCol('hw_feet', 'Feet / Buffers'),
      bucketCol('hw_latches', 'Latches'),
      bucketCol('hw_other', 'Other HW'),
      bucketCol('accessories', 'Accessories'),
      ro('hw_total', 'HW total', r => 0, r => money(['hw_inserts', 'hw_handles_knobs', 'hw_feet', 'hw_latches', 'hw_other', 'accessories'].reduce((a, k) => a + r.buckets[k], 0)), 'w-[96px]'),
    ],
  },
  {
    id: 'finishing', label: 'Finishing & Labor', hint: 'Product type, finish difficulty, labor and overhead',
    cols: [
      { id: 'ptype', label: 'Product type', width: 'w-[150px]', edit: 'select',
        options: b => b.productTypes.map((t: any) => ({ value: t.id, label: t.name })), get: r => r.p.product_type_id || '', target: { kind: 'product', field: 'product_type_id' } },
      { id: 'difficulty', label: 'Finish difficulty', width: 'w-[120px]', edit: 'select',
        options: b => b.difficulties.map((d: any) => ({ value: d.name, label: d.name })), get: r => r.p.finishing_difficulty || 'Medium', target: { kind: 'product', field: 'finishing_difficulty' } },
      bucketCol('finishing', 'Finishing ₹'),
      bucketCol('packaging', 'Packaging ₹'),
      ro('mh', 'Man-hrs', r => r.r.manHoursPerUnit, r => r.r.manHoursPerUnit ? r.r.manHoursPerUnit.toFixed(2) : '—', 'w-[70px]'),
      ro('nu', 'Non-unit ₹', r => r.r.nonUnitCogsPerUnit, r => money(r.r.nonUnitCogsPerUnit), 'w-[88px]', 'non_unit_cogs'),
      ro('doh', 'Direct OH ₹', r => r.r.directOhPerUnit, r => money(r.r.directOhPerUnit), 'w-[90px]', 'direct_oh'),
      ro('ioh', 'Indirect OH ₹', r => r.r.indirectOhPerUnit, r => money(r.r.indirectOhPerUnit), 'w-[96px]', 'indirect_oh'),
      ro('ship', 'Shipping ₹', r => r.r.shippingPerUnit, r => money(r.r.shippingPerUnit), 'w-[88px]', 'shipping'),
    ],
  },
  {
    id: 'pricing', label: 'Pricing & Audit', hint: 'Markup, target price and outliers',
    cols: [
      { id: 'markup', label: 'Markup %', width: 'w-[80px]', edit: 'pct', get: r => Math.round((r.p.markup_percent ?? 0.2) * 10000) / 100,
        target: { kind: 'product', field: 'markup_percent' },
        disabled: (_r, b) => (b.inq?.markup_percent_override != null ? 'Inquiry-level markup override is set' : null) },
      { id: 'target', label: 'Target $', width: 'w-[80px]', edit: 'num', get: r => r.p.target_price_usd ?? 0, target: { kind: 'product', field: 'target_price_usd' } },
      ro('cost', 'Unit cost ₹', r => r.audit.unit_cost_inr, r => money(r.audit.unit_cost_inr), 'w-[96px]'),
      ro('price_inr', 'Price ₹', r => r.audit.unit_price_inr, r => money(r.audit.unit_price_inr), 'w-[96px]'),
      ro('gap', 'vs Target', r => 0, r => {
        const t = Number(r.p.target_price_usd) || 0; if (!t) return '—';
        const d = r.audit.unit_price_usd - t; return `${d >= 0 ? '+' : ''}${d.toFixed(2)}`;
      }, 'w-[80px]'),
      ro('ship_m', 'Shipping', r => r.audit.shipping_method, r => r.audit.shipping_method, 'w-[120px]', 'shipping_method'),
      ro('flags', 'Issues', r => 0, () => '', 'w-[220px]'),
    ],
  },
];

function parseDims(s: string): [number, number, number] | null {
  const parts = s.split(/[x×*,\s]+/i).map(v => v.trim()).filter(Boolean).map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
  return parts as [number, number, number];
}

// ---------- Page ----------

export default function InquiryAuditGrid() {
  const { id: inquiryId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [lensId, setLensId] = useState('sourcing');
  const [nameSort, setNameSort] = useState<'asc' | 'desc' | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const [saving, setSaving] = useState(0);

  useDocumentTitle(bundle ? `Bulk Editor · ${bundle.inq.title || bundle.inq.rfq_number}` : 'Bulk Editor');

  const load = useCallback(async () => {
    if (!inquiryId) return;
    const { data: inq } = await db.from('customer_rfqs')
      .select('id, rfq_number, title, customer_id, shipping_type_id_override, exchange_rate_override, markup_percent_override, indirect_overhead_per_mh_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override')
      .eq('id', inquiryId).maybeSingle();
    if (!inq) { setLoading(false); return; }
    let customer = null;
    if (inq.customer_id) customer = (await db.from('customers').select('id, name').eq('id', inq.customer_id).maybeSingle()).data;
    const { data: prods } = await db.from('products').select('*').eq('customer_rfq_id', inquiryId).is('archived_at', null)
      .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true });
    const products = (prods as any[]) || [];
    const ids = products.length ? products.map(p => p.id) : ['00000000-0000-0000-0000-000000000000'];
    const res = await Promise.all([
      db.from('cogs_items').select('*').in('product_id', ids).limit(100000),
      db.from('non_unit_cogs').select('*').in('product_id', ids).limit(100000),
      db.from('overhead_items').select('*').in('product_id', ids).limit(100000),
      db.from('shipping_items').select('*').in('product_id', ids).limit(100000),
      db.from('shipping_types').select('*'),
      db.from('labor_employees').select('*'),
      db.from('global_settings').select('*').limit(1).single(),
      db.from('cbm_estimates').select('*').in('product_id', ids).limit(100000),
      db.from('product_types').select('*'),
      db.from('chemical_prices').select('*'),
      db.from('box_data').select('*'),
      db.from('finishing_difficulty').select('name, adjustment_factor'),
      db.from('local_transport_locations').select('id, name, cost_per_cbm_inr'),
      db.from('raw_material_costs').select('*'),
    ]);
    const d = res.map((x: any) => x.data || []);
    const { buildShipmentPools } = await import('@/lib/shipment-pool');
    const shipmentPool = (await buildShipmentPools([inquiryId]))[inquiryId] ?? null;
    setBundle({
      inq, customer, products, cogs: d[0], nu: d[1], oh: d[2], shipItems: d[3], shipTypes: d[4], employees: d[5],
      gs: res[6].data || {}, cbm: d[7], productTypes: d[8], chemicalPrices: d[9], boxData: d[10],
      difficulties: d[11], locations: d[12], rawMaterialCosts: d[13], shipmentPool,
    });
    setLoading(false);
  }, [inquiryId]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (bundle ? buildRows(bundle) : []), [bundle]);
  const flags = useMemo(() => detectFlags(rows.map(r => r.audit)), [rows]);
  const flagCount = (pid: string) => Object.values(flags[pid] || {}).filter(Boolean).length;
  const totalFlags = useMemo(() => rows.reduce((a, r) => a + flagCount(r.p.id), 0), [rows, flags]); // eslint-disable-line
  const sortedRows = useMemo(() => {
    if (!nameSort) return rows;
    const dir = nameSort === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const ka = `${a.audit.name} ${a.audit.sku}`.toLowerCase();
      const kb = `${b.audit.name} ${b.audit.sku}`.toLowerCase();
      return dir * ka.localeCompare(kb, undefined, { sensitivity: 'base' });
    });
  }, [rows, nameSort]);
  const visibleRows = useMemo(() => (onlyFlagged ? sortedRows.filter(r => flagCount(r.p.id) > 0) : sortedRows), [sortedRows, flags, onlyFlagged]); // eslint-disable-line

  const lens = LENSES.find(l => l.id === lensId)!;

  // ---------- Persistence ----------

  const track = async (fn: () => Promise<void>) => {
    setSaving(s => s + 1);
    try { await fn(); } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
      await load();
    } finally { setSaving(s => s - 1); }
  };
  const check = (r: any) => { if (r?.error) throw r.error; return r; };

  const applyValue = useCallback((col: LensCol, ids: string[], raw: any) => {
    if (!bundle || !col.target || ids.length === 0) return;
    const t = col.target;
    let value: any = raw;
    if (col.edit === 'money' || col.edit === 'num' || col.edit === 'pct') {
      const n = Number(String(raw).replace(/[₹$,%\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) { toast.error('Enter a valid number'); return; }
      value = col.edit === 'pct' ? n / 100 : n;
    }
    if (col.edit === 'select' && value === '') value = null;

    if (t.kind === 'product' || t.kind === 'product_dims') {
      let patch: Record<string, any>;
      if (t.kind === 'product_dims') {
        const dims = parseDims(String(raw)); if (!dims) { toast.error('Use W×D×H, e.g. 18x12x24'); return; }
        patch = { [t.fields[0]]: dims[0], [t.fields[1]]: dims[1], [t.fields[2]]: dims[2] };
      } else patch = { [t.field]: value };
      setBundle(b => b && ({ ...b, products: b.products.map(p => (ids.includes(p.id) ? { ...p, ...patch } : p)) }));
      void track(async () => { check(await db.from('products').update(patch).in('id', ids)); });
      return;
    }

    if (t.kind === 'cbm' || t.kind === 'cbm_dims') {
      let patch: Record<string, any>;
      if (t.kind === 'cbm_dims') {
        const dims = parseDims(String(raw)); if (!dims) { toast.error('Use W×D×H, e.g. 25x25x25'); return; }
        patch = { [t.fields[0]]: dims[0], [t.fields[1]]: dims[1], [t.fields[2]]: dims[2] };
      } else patch = { [t.field]: value };
      const existing = new Set(bundle.cbm.filter(c => ids.includes(c.product_id)).map(c => c.product_id));
      const missing = ids.filter(id => !existing.has(id));
      setBundle(b => b && ({
        ...b,
        cbm: [...b.cbm.map(c => (ids.includes(c.product_id) ? { ...c, ...patch } : c)),
          ...missing.map(pid => ({ id: `tmp-${pid}`, product_id: pid, ...patch }))],
      }));
      void track(async () => {
        if (existing.size) check(await db.from('cbm_estimates').update(patch).in('product_id', [...existing]));
        if (missing.length) {
          const ins = check(await db.from('cbm_estimates').insert(missing.map(pid => ({ product_id: pid, ...patch }))).select('*'));
          setBundle(b => b && ({ ...b, cbm: [...b.cbm.filter(c => !missing.includes(c.product_id)), ...(ins.data || [])] }));
        }
      });
      return;
    }

    if (t.kind === 'bucket' || t.kind === 'vendor') {
      const types = t.kind === 'vendor' ? BUCKET_TYPES.raw_piece : BUCKET_TYPES[t.bucket];
      const primaryType = types[0];
      const updates: { id: string; patch: any }[] = [];
      const inserts: any[] = [];
      for (const pid of ids) {
        const lines = bundle.cogs.filter(c => c.product_id === pid && types.includes(c.cogs_type) && c.include === 'Yes')
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const primary = lines[0];
        if (t.kind === 'vendor') {
          const v = String(value || '').trim() || null;
          if (primary) updates.push({ id: primary.id, patch: { vendor_name: v } });
          else if (v) inserts.push({ product_id: pid, cogs_type: primaryType, component_name: primaryType, vendor_name: v, unit_cost_inr: 0, components_per_product: 1, waste_factor: 0, include: 'Yes' });
          continue;
        }
        if (primary) {
          const others = lines.slice(1).reduce((a, c) => a + lineVal(c), 0);
          const qty = Number(primary.components_per_product) > 0 ? Number(primary.components_per_product) : 1;
          const waste = Number(primary.waste_factor) || 0;
          const unit = Math.max(0, (value - others) / (qty * (1 + waste)));
          updates.push({ id: primary.id, patch: { unit_cost_inr: Math.round(unit * 100) / 100, components_per_product: qty } });
        } else if (value > 0) {
          inserts.push({ product_id: pid, cogs_type: primaryType, component_name: primaryType, unit_cost_inr: value, components_per_product: 1, waste_factor: 0, include: 'Yes' });
        }
      }
      setBundle(b => b && ({
        ...b,
        cogs: [...b.cogs.map(c => { const u = updates.find(x => x.id === c.id); return u ? { ...c, ...u.patch } : c; }),
          ...inserts.map((x, i) => ({ ...x, id: `tmp-${i}-${x.product_id}` }))],
      }));
      void track(async () => {
        // Group identical patches into single updates.
        const groups = new Map<string, string[]>();
        updates.forEach(u => { const k = JSON.stringify(u.patch); groups.set(k, [...(groups.get(k) || []), u.id]); });
        await Promise.all([...groups.entries()].map(async ([k, idsG]) => check(await db.from('cogs_items').update(JSON.parse(k)).in('id', idsG))));
        if (inserts.length) {
          const ins = check(await db.from('cogs_items').insert(inserts).select('*'));
          setBundle(b => b && ({ ...b, cogs: [...b.cogs.filter(c => !String(c.id).startsWith('tmp-')), ...(ins.data || [])] }));
        }
      });
    }
  }, [bundle, load]); // eslint-disable-line

  // ---------- Selection ----------

  const toggleRow = (idx: number, shift: boolean) => {
    const pid = visibleRows[idx].p.id;
    setSelected(prev => {
      const next = new Set(prev);
      const on = !prev.has(pid);
      if (shift && lastClicked.current != null) {
        const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)];
        for (let i = a; i <= b; i++) on ? next.add(visibleRows[i].p.id) : next.delete(visibleRows[i].p.id);
      } else on ? next.add(pid) : next.delete(pid);
      return next;
    });
    lastClicked.current = idx;
  };
  const allSelected = visibleRows.length > 0 && visibleRows.every(r => selected.has(r.p.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleRows.map(r => r.p.id)));

  // ---------- Keyboard nav ----------

  const focusCell = (ri: number, ci: number) => {
    const el = document.querySelector<HTMLElement>(`[data-cell="${ri}-${ci}"]`);
    if (el) { el.focus(); if (el instanceof HTMLInputElement) el.select(); }
  };

  // ---------- Summary ----------

  const summary = useMemo(() => {
    let cbm = 0, fob = 0, cost = 0, units = 0;
    rows.forEach(r => {
      const q = Number(r.p.quantity) || 0;
      units += q; cbm += r.r.finalUnitCbm * q; fob += r.audit.unit_price_usd * q; cost += r.audit.unit_cost_inr * q;
    });
    const priceInr = rows.reduce((a, r) => a + r.audit.unit_price_inr * (Number(r.p.quantity) || 0), 0);
    return { cbm, fob, units, margin: priceInr > 0 ? (1 - cost / priceInr) * 100 : 0 };
  }, [rows]);

  const handleDownload = () => {
    if (!bundle) return;
    const headers = ['SKU', 'Name', ...AUDIT_COLUMNS.map(c => `${c.group}: ${c.label}`), 'Flags'];
    const data = rows.map(({ audit: r }) => [
      r.sku, r.name,
      ...AUDIT_COLUMNS.map(c => (c.kind === 'category' ? String(r[c.key] ?? '') : Number(r[c.key]) || 0)),
      Object.entries(flags[r.product_id] || {}).filter(([, f]) => f).map(([k, f]) => `${k} (${f!.kind})`).join('; '),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([
      ['Inquiry', bundle.inq.rfq_number], ['Title', bundle.inq.title || ''], ['Customer', customerPrimary(bundle.customer)],
      ['Generated', new Date().toISOString()], [], headers, ...data,
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit');
    XLSX.writeFile(wb, `${bundle.inq.rfq_number}_cost_audit.xlsx`);
  };

  if (loading || !bundle) return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading…</div></AppLayout>;
  const title = bundle.inq.title || bundle.inq.rfq_number;

  if (isMobile) {
    return (
      <AppLayout>
        <div className="px-3 py-3 space-y-3">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <h1 className="text-lg font-semibold">Bulk Costing Editor</h1>
          <p className="text-xs text-muted-foreground">Editing works on a laptop or desktop. Flagged SKUs:</p>
          {rows.filter(r => flagCount(r.p.id) > 0).map(r => (
            <button key={r.p.id} className="w-full text-left rounded-md border p-3 bg-card" onClick={() => navigate(`/product/${r.p.id}?tab=costing`)}>
              <div className="text-sm font-medium">{r.audit.sku || r.audit.name}</div>
              <ul className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                {Object.values(flags[r.p.id] || {}).filter(Boolean).map((f, i) => <li key={i}>⚠ {f!.msg}</li>)}
              </ul>
            </button>
          ))}
        </div>
      </AppLayout>
    );
  }

  const editableCols = lens.cols.filter(c => c.edit && c.target);

  return (
    <AppLayout>
      <TooltipProvider delayDuration={150}>
        <div className="px-4 py-3 space-y-3 max-w-none pb-24">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7 px-2" onClick={() => navigate(`/inquiry/${inquiryId}`)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <PageBreadcrumbs canonical={[{ label: 'Inquiries', to: '/inquiries' }, { label: title, to: `/inquiry/${inquiryId}` }]} current="Bulk Editor" />
          </div>

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold">Bulk Costing Editor</h1>
              <p className="text-xs text-muted-foreground">
                Click any cell to edit. Enter / ↓ moves down, Tab moves right. Tick SKUs (Shift-click for a range) to change many at once.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground min-w-[60px]">{saving > 0 ? 'Saving…' : 'All saved'}</span>
              <div className="flex items-center gap-2">
                <Switch id="only-flagged" checked={onlyFlagged} onCheckedChange={setOnlyFlagged} />
                <Label htmlFor="only-flagged" className="text-xs">Only flagged</Label>
              </div>
              <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={!rows.length}><Download className="h-3.5 w-3.5 mr-1" /> XLSX</Button>
            </div>
          </div>

          {/* Live summary */}
          <div className="grid grid-cols-5 gap-2">
            {[
              ['SKUs', String(rows.length)],
              ['Units', fmtNum(summary.units)],
              ['Total packed CBM', summary.cbm.toFixed(2)],
              ['Total FOB', `$${fmtNum(summary.fob, 0)}`],
              ['Blended margin', `${summary.margin.toFixed(1)}%`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border bg-card px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
                <div className="text-base font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          {/* Lens tabs */}
          <div className="flex items-center gap-1 border-b">
            {LENSES.map((l, i) => (
              <button
                key={l.id}
                onClick={() => setLensId(l.id)}
                className={cn('px-3 py-2 text-sm -mb-px border-b-2 transition-colors',
                  l.id === lensId ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
              >
                <span className="text-[10px] text-muted-foreground mr-1">{i + 1}</span>{l.label}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground pr-1">{lens.hint}</span>
            {totalFlags > 0 && (
              <span className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1 pl-3">
                <AlertTriangle className="h-3.5 w-3.5" /> {totalFlags} issue{totalFlags === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">No products in this inquiry yet.</div>
          ) : (
            <div className="border rounded-md overflow-auto max-h-[calc(100vh-330px)]">
              <table className="w-full text-xs border-collapse table-fixed">
                <thead className="sticky top-0 z-20 bg-muted">
                  <tr>
                    <th className="w-[34px] px-2 py-2 border-b"><Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" /></th>
                    <th className="w-[170px] text-left px-2 py-2 border-b border-r font-medium">
                      <button
                        className="inline-flex items-center gap-1 cursor-pointer select-none hover:text-foreground"
                        onClick={() => setNameSort(s => (s === 'asc' ? 'desc' : s === 'desc' ? null : 'asc'))}
                        title="Sort by name"
                      >
                        SKU / Name
                        {nameSort === 'asc' && <ArrowUp className="h-3 w-3" />}
                        {nameSort === 'desc' && <ArrowDown className="h-3 w-3" />}
                        {!nameSort && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                      </button>
                    </th>
                    {lens.cols.map(c => (
                      <th key={c.id} className={cn(c.width, 'text-left px-2 py-2 border-b font-medium whitespace-nowrap overflow-hidden text-ellipsis')}>
                        {c.label}{!c.edit && <span className="ml-1 text-muted-foreground font-normal">·</span>}
                      </th>
                    ))}
                    <th className="w-[76px] text-right px-2 py-2 border-b border-l font-medium">FOB $</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, ri) => {
                    const pid = row.p.id;
                    const isSel = selected.has(pid);
                    return (
                      <tr key={pid} className={cn('group', isSel ? 'bg-primary/10' : 'hover:bg-accent/30')}>
                        <td className="px-2 py-1 border-b text-center" onClick={e => { e.preventDefault(); toggleRow(ri, e.shiftKey); }}>
                          <Checkbox checked={isSel} aria-label={`Select ${row.audit.sku}`} className="pointer-events-none" />
                        </td>
                        <td className="px-2 py-1 border-b border-r">
                          <div className="flex items-center gap-1">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{row.audit.sku || '—'}</div>
                              <div className="text-muted-foreground text-[11px] truncate">{row.audit.name}</div>
                            </div>
                            <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground" title="Open costing sheet"
                              onClick={() => navigate(`/product/${pid}?tab=costing`)}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                        {lens.cols.map((c, ci) => {
                          const flag = c.flagKey ? flags[pid]?.[c.flagKey] : null;
                          const cell = (
                            <td key={c.id} className={cn('px-1 py-0.5 border-b', flag && 'bg-amber-100/70 dark:bg-amber-900/30')}>
                              {c.id === 'flags' ? (
                                <div className="text-[11px] text-amber-700 dark:text-amber-400 truncate px-1">
                                  {Object.values(flags[pid] || {}).filter(Boolean).map(f => f!.msg.replace(/^Most SKUs (have a|use) /, '')).join(' · ') || <span className="text-muted-foreground">—</span>}
                                </div>
                              ) : (
                                <EditCell col={c} row={row} bundle={bundle} cellId={`${ri}-${ci}`}
                                  onCommit={v => applyValue(c, [pid], v)}
                                  onNav={dir => focusCell(ri + dir, ci)} />
                              )}
                            </td>
                          );
                          return flag ? (
                            <Tooltip key={c.id}><TooltipTrigger asChild>{cell}</TooltipTrigger><TooltipContent>{flag.msg}</TooltipContent></Tooltip>
                          ) : cell;
                        })}
                        <td className="px-2 py-1 border-b border-l text-right tabular-nums font-medium">
                          {row.audit.unit_price_usd ? `$${row.audit.unit_price_usd.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selected.size > 0 && (
          <BulkBar
            count={selected.size}
            cols={editableCols}
            bundle={bundle}
            lensLabel={lens.label}
            onApply={(col, v) => applyValue(col, rows.filter(r => selected.has(r.p.id)).map(r => r.p.id), v)}
            onApplyDims={(colId, dims) => {
              const ids = rows.filter(r => selected.has(r.p.id)).map(r => r.p.id);
              const target = colId === 'piece_dims'
                ? { kind: 'product_dims' as const, fields: ['width_inch', 'depth_inch', 'height_inch'] as [string, string, string] }
                : { kind: 'cbm_dims' as const, fields: ['ic_width', 'ic_depth', 'ic_height'] as [string, string, string] };
              applyValue({ id: colId, label: colId, width: '', edit: 'dims', get: () => '', target }, ids, dims.join('x'));
            }}
            onClear={() => setSelected(new Set())}
          />
        )}
      </TooltipProvider>
    </AppLayout>
  );
}

// ---------- Cell ----------

function EditCell({ col, row, bundle, cellId, onCommit, onNav }: {
  col: LensCol; row: Row; bundle: Bundle; cellId: string;
  onCommit: (v: any) => void; onNav: (dir: 1 | -1) => void;
}) {
  const value = col.get(row);
  const disabledMsg = col.disabled?.(row, bundle) ?? null;

  if (!col.edit || !col.target) {
    return <div className="px-1 py-1 tabular-nums truncate text-muted-foreground">{col.display ? col.display(row) : String(value ?? '—')}</div>;
  }
  if (col.edit === 'bool') {
    return (
      <div className="flex justify-center py-1">
        <Checkbox data-cell={cellId} checked={!!value} disabled={!!disabledMsg} onCheckedChange={v => onCommit(!!v)} />
      </div>
    );
  }
  if (col.edit === 'select') {
    const opts = col.options?.(bundle) ?? [];
    const has = opts.some(o => o.value === value);
    return (
      <select
        data-cell={cellId}
        value={value ?? ''}
        disabled={!!disabledMsg}
        title={disabledMsg || undefined}
        onChange={e => onCommit(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onNav(1); } }}
        className="w-full h-7 rounded-sm bg-transparent px-1 text-xs border border-transparent hover:border-input focus:border-ring focus:outline-none disabled:opacity-50"
      >
        {!has && <option value={value ?? ''}>{value || '—'}</option>}
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  const numeric = col.edit === 'money' || col.edit === 'num' || col.edit === 'pct';
  const shown = numeric ? (Number(value) ? String(value) : '') : String(value ?? '');
  return (
    <input
      key={shown}
      data-cell={cellId}
      defaultValue={shown}
      disabled={!!disabledMsg}
      title={disabledMsg || undefined}
      placeholder={numeric ? '—' : ''}
      inputMode={numeric ? 'decimal' : undefined}
      onBlur={e => {
        const v = e.currentTarget.value.trim();
        if (v === shown) return;
        onCommit(numeric && v === '' ? 0 : v);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); onNav(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); onNav(-1); }
        else if (e.key === 'Escape') { e.currentTarget.value = shown; e.currentTarget.blur(); }
      }}
      className={cn(
        'w-full h-7 rounded-sm bg-transparent px-1 text-xs border border-transparent hover:border-input focus:border-ring focus:bg-background focus:outline-none disabled:opacity-40',
        numeric && 'text-right tabular-nums',
      )}
    />
  );
}

// ---------- Bulk bar ----------

function BulkBar({ count, cols, bundle, lensLabel, onApply, onApplyDims, onClear }: {
  count: number; cols: LensCol[]; bundle: Bundle; lensLabel: string;
  onApply: (col: LensCol, v: any) => void; onApplyDims: (colId: string, dims: [number, number, number]) => void; onClear: () => void;
}) {
  const [colId, setColId] = useState(cols[0]?.id ?? '');
  const [val, setVal] = useState<any>('');
  const [dims, setDims] = useState({ w: '', d: '', h: '' });
  const isDimCol = ['piece_w', 'piece_d', 'piece_h', 'pkg_w', 'pkg_d', 'pkg_h'].includes(colId);
  useEffect(() => {
    if (!cols.some(c => c.id === colId)) { setColId(cols[0]?.id ?? ''); setVal(''); }
    setDims({ w: '', d: '', h: '' });
  }, [cols, colId]); // eslint-disable-line react-hooks/exhaustive-deps
  const col = cols.find(c => c.id === colId);

  const apply = () => {
    if (!col) return;
    if (isDimCol) {
      const w = Number(dims.w), d = Number(dims.d), h = Number(dims.h);
      if ([w, d, h].some(n => !Number.isFinite(n) || n < 0)) { toast.error('Enter valid numbers for W, D and H'); return; }
      if (w === 0 && d === 0 && h === 0) { toast.error('Enter at least one dimension'); return; }
      onApplyDims(colId, [w, d, h]);
      toast.success(`Dimensions updated on ${count} SKU${count === 1 ? '' : 's'}`);
      return;
    }
    if (col.edit !== 'bool' && col.edit !== 'select' && col.edit !== 'text' && String(val).trim() === '') { toast.error('Enter a value'); return; }
    onApply(col, col.edit === 'bool' ? !!val : val);
    toast.success(`${col.label} updated on ${count} SKU${count === 1 ? '' : 's'}`);
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-lg border bg-popover text-popover-foreground shadow-lg px-3 py-2 flex items-center gap-2">
      <span className="text-sm font-medium whitespace-nowrap">{count} selected</span>
      <span className="text-xs text-muted-foreground whitespace-nowrap">· {lensLabel}: set</span>
      {cols.length === 0 ? (
        <span className="text-xs text-muted-foreground">Nothing editable in this tab</span>
      ) : (
        <>
          <select value={colId} onChange={e => { setColId(e.target.value); setVal(''); }}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm">
            {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">to</span>
          {isDimCol ? (
            <div className="flex items-center gap-1">
              {(['w', 'd', 'h'] as const).map(k => (
                <Input key={k} value={dims[k]} inputMode="decimal"
                  onChange={e => setDims(s => ({ ...s, [k]: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && apply()}
                  placeholder={k.toUpperCase()} className="h-8 w-[52px]" />
              ))}
            </div>
          ) : col?.edit === 'bool' ? (
            <select value={val ? '1' : ''} onChange={e => setVal(e.target.value === '1')} className="h-8 rounded-md border border-input bg-background px-2 text-sm">
              <option value="1">Yes</option><option value="">No</option>
            </select>
          ) : col?.edit === 'select' ? (
            <select value={val} onChange={e => setVal(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-sm max-w-[180px]">
              <option value="" disabled>Choose…</option>
              {(col.options?.(bundle) ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <Input value={val} onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === 'Enter' && apply()}
              placeholder={col?.edit === 'dims' ? 'W×D×H' : col?.edit === 'pct' ? '%' : col?.edit === 'money' ? '₹' : ''}
              className="h-8 w-[140px]" />
          )}
          <Button size="sm" onClick={apply}>Apply</Button>
        </>
      )}
      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClear} aria-label="Clear selection"><X className="h-4 w-4" /></Button>
    </div>
  );
}
