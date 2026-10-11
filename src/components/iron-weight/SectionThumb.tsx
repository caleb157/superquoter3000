// Cross-section of a part, drawn to scale within its own box: hollow for pipe/tube, solid for bars.
import { MM_PER, SHAPES, type Part } from '@/lib/iron-weight-core';
import { cn } from '@/lib/utils';

export function SectionThumb({ p, className }: { p: Part; className?: string }) {
  const s = SHAPES[p.shape];
  const v: Record<string, number> = {};
  for (const [k] of s.fields) v[k] = (p.dims[k] || 0) * MM_PER[p.dimUnit];
  const valid = s.fields.every(([k]) => v[k] > 0) && !s.validate(v);
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={cn('h-10 w-10 shrink-0 rounded-md bg-muted/60', className)}>
      {valid && <Shape shape={p.shape} v={v} />}
    </svg>
  );
}

function Shape({ shape, v }: { shape: Part['shape']; v: Record<string, number> }) {
  const cx = 100, cy = 100, max = 150;
  const fill = { className: 'fill-muted-foreground/60 stroke-foreground/70', strokeWidth: 4 } as const;
  let ew = 0, eh = 0;
  if (shape === 'round_bar') ew = eh = v.d;
  else if (shape === 'round_pipe') ew = eh = v.od;
  else if (shape === 'square_bar' || shape === 'square_tube') ew = eh = v.a;
  else if (shape === 'hex_bar') { ew = (2 * v.af) / Math.sqrt(3); eh = v.af; }
  else { ew = v.w; eh = shape === 'flat_bar' ? v.t : v.h; }
  const k = max / Math.max(ew, eh);
  const W = Math.max(ew * k, 6), H = Math.max(eh * k, 6);
  const ring = (r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const rect = (w: number, h: number) => `M${cx - w / 2} ${cy - h / 2}h${w}v${h}h${-w}Z`;

  if (shape === 'round_bar') return <circle cx={cx} cy={cy} r={W / 2} {...fill} />;
  if (shape === 'square_bar' || shape === 'flat_bar') return <rect x={cx - W / 2} y={cy - H / 2} width={W} height={H} {...fill} />;
  if (shape === 'hex_bar') {
    const R = W / 2;
    const pts = Array.from({ length: 6 }, (_, i) => `${(cx + R * Math.cos((i * Math.PI) / 3)).toFixed(2)},${(cy + R * Math.sin((i * Math.PI) / 3)).toFixed(2)}`);
    return <polygon points={pts.join(' ')} {...fill} />;
  }
  if (shape === 'round_pipe') return <path fillRule="evenodd" d={ring(W / 2) + ring(Math.max(((v.od - 2 * v.t) * k) / 2, 0))} {...fill} />;
  const iw = Math.max((ew - 2 * v.t) * k, 0), ih = Math.max((eh - 2 * v.t) * k, 0);
  return <path fillRule="evenodd" d={rect(W, H) + rect(iw, ih)} {...fill} />;
}
