// iron-weight-core.ts
// Pure calculation logic for iron/steel section weights. No DOM, no framework.
// Units: sizes and lengths in mm, density in kg/m³, weights in kg.

export const DENSITY_WROUGHT_IRON = 7750; // kg/m³ (mild steel is 7850, grey cast iron 7200)

export const MM_PER = { mm: 1, cm: 10, in: 25.4, m: 1000, ft: 304.8 } as const;
export type Unit = keyof typeof MM_PER;
export const KG_TO_LB = 2.2046226218;

export type ShapeKey =
  | 'round_bar' | 'square_bar' | 'flat_bar' | 'hex_bar'
  | 'round_pipe' | 'square_tube' | 'rect_tube';

export interface ShapeDef {
  form: 'solid' | 'pipe';
  label: string;
  fields: [key: string, label: string][];
  /** Cross-section area in mm². Dimensions are already in mm. */
  area: (v: Record<string, number>) => number;
  /** Returns an error message, or '' when the dimensions are physically valid. */
  validate: (v: Record<string, number>) => string;
}

const PI = Math.PI;

export const SHAPES: Record<ShapeKey, ShapeDef> = {
  round_bar:   { form: 'solid', label: 'Round bar', fields: [['d', 'Diameter']],
    area: v => PI / 4 * v.d * v.d, validate: () => '' },
  square_bar:  { form: 'solid', label: 'Square bar', fields: [['a', 'Side']],
    area: v => v.a * v.a, validate: () => '' },
  flat_bar:    { form: 'solid', label: 'Flat bar / plate', fields: [['w', 'Width'], ['t', 'Thickness']],
    area: v => v.w * v.t, validate: () => '' },
  hex_bar:     { form: 'solid', label: 'Hexagonal bar', fields: [['af', 'Across flats']],
    area: v => Math.sqrt(3) / 2 * v.af * v.af, validate: () => '' },
  round_pipe:  { form: 'pipe', label: 'Round pipe', fields: [['od', 'Outer diameter'], ['t', 'Wall thickness']],
    area: v => PI * v.t * (v.od - v.t),
    validate: v => v.t >= v.od / 2 ? 'Wall thickness must be less than half the outer diameter.' : '' },
  square_tube: { form: 'pipe', label: 'Square tube', fields: [['a', 'Outer side'], ['t', 'Wall thickness']],
    area: v => v.a * v.a - (v.a - 2 * v.t) ** 2,
    validate: v => v.t >= v.a / 2 ? 'Wall thickness must be less than half the outer side.' : '' },
  rect_tube:   { form: 'pipe', label: 'Rectangular tube', fields: [['w', 'Outer width'], ['h', 'Outer height'], ['t', 'Wall thickness']],
    area: v => v.w * v.h - (v.w - 2 * v.t) * (v.h - 2 * v.t),
    validate: v => v.t >= Math.min(v.w, v.h) / 2 ? 'Wall thickness must be less than half the shorter side.' : '' },
};

export interface Part {
  name: string;
  shape: ShapeKey;
  /** Raw dimensions as entered, in `dimUnit`. Keys match SHAPES[shape].fields. */
  dims: Record<string, number>;
  dimUnit: Unit;
  length: number;
  lengthUnit: Unit;
  /** How many of this part in ONE leg. */
  count: number;
}

export interface LegType {
  name: string;
  /** How many legs of this type. */
  qty: number;
  parts: Part[];
}

// `error?: undefined` on the success branch lets `r.error` be read without strictNullChecks narrowing.
export type Result<T> = ({ ok: true; error?: undefined } & T) | { ok: false; error: string };

export interface PartWeight {
  areaMm2: number;
  kgPerMetre: number;
  kgEach: number;      // one piece
  kgPerLeg: number;    // kgEach × count
}

/** Weight of one part. Returns an error string for bad input instead of throwing. */
export function partWeight(p: Part, density = DENSITY_WROUGHT_IRON): Result<PartWeight> {
  const s = SHAPES[p.shape];
  const dimsMm: Record<string, number> = {};
  for (const [k] of s.fields) {
    const x = p.dims[k];
    if (!(x > 0)) return { ok: false, error: 'Enter a size greater than zero for every field.' };
    dimsMm[k] = x * MM_PER[p.dimUnit];
  }
  const lengthMm = p.length * MM_PER[p.lengthUnit];
  if (!(lengthMm > 0)) return { ok: false, error: 'Enter a length greater than zero.' };
  if (!(density > 0)) return { ok: false, error: 'Density must be greater than zero.' };
  if (!(p.count >= 1) || !Number.isInteger(p.count)) return { ok: false, error: 'Count must be a whole number, 1 or more.' };
  const bad = s.validate(dimsMm);
  if (bad) return { ok: false, error: bad };

  const areaMm2 = s.area(dimsMm);
  const kgPerMetre = areaMm2 * 1e-6 * density;
  const kgEach = areaMm2 * lengthMm * 1e-9 * density;
  return { ok: true, areaMm2, kgPerMetre, kgEach, kgPerLeg: kgEach * p.count };
}

export interface LegBreakdown {
  name: string;
  qty: number;
  kgEachLeg: number;
  kgSubtotal: number;
  costSubtotal?: number;
  parts: { name: string; kgPerLeg: number; cost?: number }[];
}

export interface GrandTotal {
  legs: LegBreakdown[];
  totalLegs: number;
  totalKg: number;
  totalLb: number;
  totalCost?: number; // only when pricePerKg > 0
}

/** Sums every leg type into one total. Fails with the first validation error found. */
export function grandTotal(
  legTypes: LegType[],
  opts: { density?: number; pricePerKg?: number } = {},
): Result<GrandTotal> {
  const density = opts.density ?? DENSITY_WROUGHT_IRON;
  const price = opts.pricePerKg && opts.pricePerKg > 0 ? opts.pricePerKg : undefined;
  if (!legTypes.length) return { ok: false, error: 'Add a leg type to start.' };

  const legs: LegBreakdown[] = [];
  let totalKg = 0, totalLegs = 0;

  for (const leg of legTypes) {
    if (!(leg.qty >= 1) || !Number.isInteger(leg.qty))
      return { ok: false, error: `${leg.name}: number of legs must be a whole number, 1 or more.` };
    if (!leg.parts.length) return { ok: false, error: `${leg.name}: add at least one part.` };

    let kgEachLeg = 0;
    const parts: LegBreakdown['parts'] = [];
    for (const p of leg.parts) {
      const r = partWeight(p, density);
      if (!r.ok) return { ok: false, error: `${leg.name} / ${p.name}: ${r.error}` };
      kgEachLeg += r.kgPerLeg;
      parts.push({ name: p.name, kgPerLeg: r.kgPerLeg, cost: price && r.kgPerLeg * price });
    }
    const kgSubtotal = kgEachLeg * leg.qty;
    legs.push({ name: leg.name, qty: leg.qty, kgEachLeg, kgSubtotal, costSubtotal: price && kgSubtotal * price, parts });
    totalKg += kgSubtotal;
    totalLegs += leg.qty;
  }
  return { ok: true, legs, totalLegs, totalKg, totalLb: totalKg * KG_TO_LB, totalCost: price && totalKg * price };
}

// ---- self-test: `node --experimental-strip-types iron-weight-core.ts` ----
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('iron-weight-core.ts')) {
  const tube = (len: number, count: number, name: string): Part =>
    ({ name, shape: 'rect_tube', dims: { w: 60, h: 40, t: 3 }, dimUnit: 'mm', length: len, lengthUnit: 'mm', count });
  const r = grandTotal([
    { name: 'U-frame leg', qty: 2, parts: [tube(700, 2, 'Uprights'), tube(680, 1, 'Foot'), tube(720, 1, 'Top rail')] },
    { name: 'Solid bar leg', qty: 4, parts: [{ name: 'Bar', shape: 'square_bar', dims: { a: 40 }, dimUnit: 'mm', length: 710, lengthUnit: 'mm', count: 1 }] },
  ], { density: 7850, pricePerKg: 135 });
  console.log(r.ok ? { totalKg: +r.totalKg.toFixed(2), totalCost: Math.round(r.totalCost!) } : r);
  // expected at density 7850: totalKg 60.46, totalCost 8163
}
