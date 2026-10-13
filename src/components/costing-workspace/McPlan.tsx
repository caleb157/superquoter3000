// Plain-words explanation of how inner cartons pack into the master carton (Pcs/MC).
import type { MasterCartonPlan } from '@/lib/calculations';
import { cn } from '@/lib/utils';
import { num } from './cells';

const n = (v: number) => num(v, 2);
const dims = (a: number, b: number, c: number) => `${n(a)} × ${n(b)} × ${n(c)}"`;

/** Short layout label for the grid, e.g. "1×6×2 on side". */
export function mcPlanShort(plan: MasterCartonPlan): string {
  const layout = `${plan.along.w}×${plan.along.d}×${plan.along.h}`;
  if (plan.manualLayout) return `${layout} by hand`;
  return plan.orientation === 'on its side' ? `${layout} on side` : plan.orientation === 'upright, turned' ? `${layout} turned` : layout;
}

export function mcPlanLines(plan: MasterCartonPlan): { text: string; tone?: 'warn' | 'strong' }[] {
  const { usable, placed, along, maxFit, buffers, max } = plan;
  const lines: { text: string; tone?: 'warn' | 'strong' }[] = [];
  lines.push({ text: `Room inside: ${dims(usable.w, usable.d, usable.h)} (${dims(max.w, max.d, max.h)} max, less ${n(buffers.wd)}" side and ${n(buffers.h)}" top buffer)` });
  if (plan.manualLayout) {
    lines.push({ text: `Inner carton ${dims(plan.icOd.w, plan.icOd.d, plan.icOd.h)} outside, laid out by hand: ${along.w} across W × ${along.d} along D × ${along.h} high` });
  } else {
    const how = plan.orientation === 'upright' ? 'upright'
      : plan.orientation === 'upright, turned' ? `upright, turned (${dims(placed.w, placed.d, placed.h)})`
      : `on its side (${dims(placed.w, placed.d, placed.h)})`;
    lines.push({ text: `Inner carton ${dims(plan.icOd.w, plan.icOd.d, plan.icOd.h)} outside, packed ${how}` });
    lines.push({ text: `Fits ${maxFit.w} across W (${n(usable.w)} ÷ ${n(placed.w)}) × ${maxFit.d} along D (${n(usable.d)} ÷ ${n(placed.d)}) × ${maxFit.h} high (${n(usable.h)} ÷ ${n(placed.h)}) = ${maxFit.w * maxFit.d * maxFit.h} inner cartons` });
    if (!plan.icFits) lines.push({ text: 'One inner carton is bigger than the master carton max, so it ships one per carton.', tone: 'warn' });
  }
  if (plan.limit === 'weight') lines.push({ text: `Held to ${plan.packedIcs} inner cartons by the ${n(plan.weightLimitKg)} kg weight limit`, tone: 'warn' });
  if (plan.limit === 'quantity') lines.push({ text: `Held to ${plan.packedIcs} inner cartons by the order quantity`, tone: 'warn' });
  if (plan.limit === 'manual' && plan.packedIcs < along.w * along.d * along.h) lines.push({ text: `Held to ${plan.packedIcs} inner cartons by the ${n(plan.weightLimitKg)} kg weight limit`, tone: 'warn' });
  lines.push({ text: `${plan.packedIcs} inner cartons × ${plan.productsPerIc} pc = ${plan.autoPieces} pcs per master carton`, tone: plan.override == null ? 'strong' : undefined });
  if (plan.override != null) lines.push({ text: `Set by hand to ${plan.override} pcs (calculated ${plan.autoPieces})`, tone: 'strong' });
  lines.push({ text: `Master carton inside: ${dims(plan.mc.width, plan.mc.depth, plan.mc.height)}` });
  return lines;
}

export function McPlanBreakdown({ plan, className }: { plan: MasterCartonPlan; className?: string }) {
  return (
    <div className={cn('space-y-0.5 text-xs', className)}>
      {mcPlanLines(plan).map((l, i) => (
        <div key={i} className={cn(l.tone === 'warn' && 'text-warning', l.tone === 'strong' && 'font-medium text-foreground')}>{l.text}</div>
      ))}
    </div>
  );
}
