// The piece's own size (W × D × H, inches) as one short label, for places that
// name a product: the product page header, the costing sheet name column and
// the product panel. Same numbers the Shipping step's Piece block edits.
type Sized = { width_inch?: number | null; depth_inch?: number | null; height_inch?: number | null };

const axis = (v: number | null | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '?';
  return String(Math.round(n * 100) / 100);
};

/** `12 × 8 × 4.5"`, or null when no size has been entered yet. */
export function productSize(p: Sized | null | undefined): string | null {
  if (!p) return null;
  const vals = [p.width_inch, p.depth_inch, p.height_inch];
  if (!vals.some(v => Number(v) > 0)) return null;
  return `${vals.map(axis).join(' × ')}"`;
}
