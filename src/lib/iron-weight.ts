// App-side helpers for the Iron Weight Calculator (/tools/iron-weight): editable state, the
// example build, size presets, formatting, the copy-summary text, the local draft and the
// clean-up of photo estimates. All weights come from iron-weight-core.ts — nothing here
// computes a weight itself.
import {
  DENSITY_WROUGHT_IRON, KG_TO_LB, MM_PER, SHAPES, grandTotal, partWeight,
  type LegType, type Part, type ShapeKey, type Unit,
} from '@/lib/iron-weight-core';

export const DEFAULT_PRICE_PER_KG = 135;
export const DIM_UNITS: Unit[] = ['mm', 'cm', 'in'];
export const LENGTH_UNITS: Unit[] = ['mm', 'cm', 'm', 'ft', 'in'];
export const unitLabel = (u: Unit) => (u === 'in' ? 'inch' : u);

/** A part as edited on screen: the core Part plus an id and where it came from. */
export type EditPart = Part & {
  id: string;
  /** Set by a photo estimate; cleared as soon as the part is edited by hand. */
  estimate?: { confidence: 'low' | 'medium' | 'high'; note?: string };
};
export type EditLeg = Omit<LegType, 'parts'> & { id: string; parts: EditPart[] };
export type Build = { pricePerKg: number | null; legs: EditLeg[] };

export const newId = () => Math.random().toString(36).slice(2, 10);

export const SHAPE_ORDER: ShapeKey[] = ['rect_tube', 'square_tube', 'round_pipe', 'round_bar', 'square_bar', 'flat_bar', 'hex_bar'];

/** Common Indian-market sections, in mm. Picking one fills the size fields. */
export const PRESETS: Record<ShapeKey, Record<string, number>[]> = {
  rect_tube: [{ w: 40, h: 20, t: 1.5 }, { w: 40, h: 20, t: 2 }, { w: 50, h: 25, t: 2 }, { w: 60, h: 40, t: 2 }, { w: 60, h: 40, t: 3 }, { w: 80, h: 40, t: 3 }, { w: 100, h: 50, t: 3 }],
  square_tube: [{ a: 20, t: 1.5 }, { a: 25, t: 1.5 }, { a: 25, t: 2 }, { a: 32, t: 2 }, { a: 40, t: 2 }, { a: 40, t: 3 }, { a: 50, t: 3 }, { a: 60, t: 3 }],
  round_pipe: [{ od: 19, t: 1.5 }, { od: 25.4, t: 1.6 }, { od: 32, t: 2 }, { od: 38, t: 2 }, { od: 48.3, t: 3.2 }, { od: 60, t: 3 }],
  round_bar: [{ d: 6 }, { d: 8 }, { d: 10 }, { d: 12 }, { d: 16 }, { d: 20 }, { d: 25 }],
  square_bar: [{ a: 10 }, { a: 12 }, { a: 16 }, { a: 20 }, { a: 25 }, { a: 40 }],
  flat_bar: [{ w: 20, t: 3 }, { w: 25, t: 5 }, { w: 32, t: 6 }, { w: 40, t: 5 }, { w: 50, t: 6 }, { w: 50, t: 10 }],
  hex_bar: [{ af: 10 }, { af: 17 }, { af: 22 }],
};
export const presetLabel = (shape: ShapeKey, v: Record<string, number>) =>
  SHAPES[shape].fields.map(([k]) => v[k]).join(' × ') + ' mm';

export function part(name: string, shape: ShapeKey, dims: Record<string, number>, length: number, count: number, extra: Partial<EditPart> = {}): EditPart {
  return { id: newId(), name, shape, dims, dimUnit: 'mm', length, lengthUnit: 'mm', count, ...extra };
}

/** Example data: a U-frame leg in rectangular tube and a plain solid-bar leg. */
export function exampleBuild(): Build {
  const tube = { w: 60, h: 40, t: 3 };
  return {
    pricePerKg: DEFAULT_PRICE_PER_KG,
    legs: [
      { id: newId(), name: 'U-frame leg', qty: 2, parts: [part('Uprights', 'rect_tube', tube, 700, 2), part('Foot', 'rect_tube', tube, 680, 1), part('Top rail', 'rect_tube', tube, 720, 1)] },
      { id: newId(), name: 'Solid bar leg', qty: 4, parts: [part('Bar', 'square_bar', { a: 40 }, 710, 1)] },
    ],
  };
}

/** Sizes for a new shape: keep matching fields, fill the rest from the shape's first preset. */
export function dimsForShape(shape: ShapeKey, prev: Record<string, number>, prevUnit: Unit): { dims: Record<string, number>; dimUnit: Unit } {
  const base = PRESETS[shape][Math.min(3, PRESETS[shape].length - 1)];
  const dims: Record<string, number> = {};
  let kept = 0;
  for (const [k] of SHAPES[shape].fields) {
    if (prev[k] > 0) { dims[k] = prev[k]; kept++; } else dims[k] = base[k] / MM_PER[prevUnit];
  }
  return kept ? { dims, dimUnit: prevUnit } : { dims: { ...base }, dimUnit: 'mm' };
}

// ---------- formatting ----------

const fmt = (n: number, d: number) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
/** Kilograms with sensible precision: 3 decimals under 10 kg, 2 under 1000, else 1. */
export const kg = (n: number) => fmt(n, n < 10 ? 3 : n < 1000 ? 2 : 1);
export const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const trimNum = (n: number) => (Number.isFinite(n) ? String(+n.toFixed(3)) : '');
export const lbOf = (kgs: number) => kgs * KG_TO_LB;

export function describeSection(p: Part) {
  const v = p.dims;
  const u = unitLabel(p.dimUnit);
  switch (p.shape) {
    case 'round_bar': return `round bar Ø${trimNum(v.d)} ${u}`;
    case 'square_bar': return `square bar ${trimNum(v.a)} ${u}`;
    case 'flat_bar': return `flat bar ${trimNum(v.w)} × ${trimNum(v.t)} ${u}`;
    case 'hex_bar': return `hex bar ${trimNum(v.af)} ${u} A/F`;
    case 'round_pipe': return `round pipe OD ${trimNum(v.od)} × ${trimNum(v.t)} ${u} wall`;
    case 'square_tube': return `square tube ${trimNum(v.a)} × ${trimNum(v.t)} ${u} wall`;
    case 'rect_tube': return `rect tube ${trimNum(v.w)} × ${trimNum(v.h)} × ${trimNum(v.t)} ${u} wall`;
  }
}

/** Plain-text summary for "Copy summary". Null while anything is invalid. */
export function summaryText(b: Build, heading?: string): string | null {
  const price = b.pricePerKg && b.pricePerKg > 0 ? b.pricePerKg : undefined;
  const r = grandTotal(b.legs, { pricePerKg: price });
  if (!r.ok) return null;
  const cost = (w: number) => (price ? ` · ${rupees(w * price)}` : '');
  const lines: string[] = [];
  if (heading) lines.push(heading, '');
  b.legs.forEach((leg, i) => {
    const o = r.legs[i];
    lines.push(`${leg.name || 'Assembly'}: ${leg.qty} × ${kg(o.kgEachLeg)} kg = ${kg(o.kgSubtotal)} kg${cost(o.kgSubtotal)}`);
    leg.parts.forEach((p, j) => {
      lines.push(`   ${p.name || 'Part'} (${p.count} × ${trimNum(p.length)} ${unitLabel(p.lengthUnit)}), ${describeSection(p)}: ${kg(o.parts[j].kgPerLeg)} kg${cost(o.parts[j].kgPerLeg)} per ${leg.name || 'assembly'}`);
    });
  });
  lines.push('', `Total: ${kg(r.totalKg)} kg (${kg(r.totalKg * KG_TO_LB)} lb) for ${r.totalLegs} ${r.totalLegs === 1 ? 'piece' : 'pieces'}` +
    (price ? `, ${rupees(r.totalCost!)} at ₹${trimNum(price)}/kg` : '') + `, wrought iron ${DENSITY_WROUGHT_IRON} kg/m³.`);
  lines.push('Sharp-corner tube geometry; weld metal, end caps and plates not included.');
  return lines.join('\n');
}

// ---------- validation shown beside fields ----------

export type PartIssue = { field: 'dims' | 'length' | 'count'; message: string } | null;
export function partIssue(p: Part): PartIssue {
  const r = partWeight(p);
  if (r.ok) return null;
  const field = /length/i.test(r.error) ? 'length' : /count/i.test(r.error) ? 'count' : 'dims';
  return { field, message: r.error };
}
export const qtyIssue = (n: number) => (n >= 1 && Number.isInteger(n) ? null : 'Must be a whole number, 1 or more.');

// ---------- local draft (the working copy; named builds live in the database) ----------

const DRAFT_KEY = 'pdhq-iron-weight-draft-v1';
export type Draft = Build & { loaded?: { id: string; sku: string; label: string } | null };

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return isBuild(d) ? d : null;
  } catch { return null; }
}
export function saveDraft(d: Draft) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* storage blocked: keep working in memory */ }
}

export function isBuild(d: any): d is Build {
  return !!d && Array.isArray(d.legs) && d.legs.every((l: any) =>
    l && typeof l.id === 'string' && Array.isArray(l.parts) &&
    l.parts.every((p: any) => p && SHAPES[p.shape as ShapeKey] && p.dims && MM_PER[p.dimUnit as Unit] && MM_PER[p.lengthUnit as Unit]));
}

// ---------- photo estimate → editable parts ----------

/** Shape of the estimate-iron-parts function's answer (all sizes and lengths in mm). */
export type IronEstimate = {
  summary: string;
  assumptions: string[];
  assemblies: {
    name: string; qty: number;
    parts: { name: string; shape: ShapeKey; dims: Record<string, number>; length_mm: number; count: number; confidence: 'low' | 'medium' | 'high'; note: string }[];
  }[];
};

/** Turn an estimate into editable assemblies, dropping anything the calculator can't use. */
export function legsFromEstimate(e: IronEstimate): EditLeg[] {
  const legs: EditLeg[] = [];
  for (const a of e.assemblies ?? []) {
    const parts: EditPart[] = [];
    for (const p of a.parts ?? []) {
      if (!SHAPES[p.shape]) continue;
      const dims: Record<string, number> = {};
      for (const [k] of SHAPES[p.shape].fields) dims[k] = Math.round((Number(p.dims?.[k]) || 0) * 10) / 10;
      parts.push(part(p.name || 'Part', p.shape, dims, Math.round(Number(p.length_mm) || 0), Math.max(1, Math.round(Number(p.count) || 1)), {
        estimate: { confidence: p.confidence ?? 'low', note: p.note || undefined },
      }));
    }
    if (parts.length) legs.push({ id: newId(), name: a.name || 'Assembly', qty: Math.max(1, Math.round(Number(a.qty) || 1)), parts });
  }
  return legs;
}
