import type { AllegroLaunch, LaunchPaidBy } from '@/lib/dkt-cashflow';
import { monthLabel } from '@/lib/dkt-cashflow';
import type { AmazonSku } from '@/lib/dkt-amazon';
import { MonthField, NumField, SelectField, usd } from './fields';

const PAID_BY: { value: LaunchPaidBy; label: string }[] = [
  { value: 'auto', label: 'Allegro if it has it, else DKT' },
  { value: 'allegro', label: 'Allegro (what it has), DKT the rest' },
  { value: 'dkt', label: 'DKT cash' },
];

/** Who pays an Allegro launch, as one short line. */
function launchFundingText(l: AllegroLaunch): string {
  if (!l.month) return '';
  if (l.past) return 'Already paid (before this month)';
  const parts = [];
  if (l.fromAllegro > 0.005) parts.push(`Allegro pays ${usd(l.fromAllegro)}`);
  if (l.fromDkt > 0.005) parts.push(`DKT pays ${usd(l.fromDkt)}`);
  // Allegro moves the whole launch amount into DKT; what this launch doesn't spend stays in DKT's cash.
  if (l.leftover > 0.5) parts.push(`${usd(l.leftover)} of that isn't needed for this launch and stays in DKT's cash`);
  return parts.join(', ') || 'Nothing to pay';
}

/**
 * Override an Allegro launch: pin its PO month (blank = Allegro sets it), who pays a pinned launch,
 * and the first order (blank = what the budget buys).
 */
export function LaunchOverride({ launch: l, updateSku }: { launch: AllegroLaunch; updateSku: (id: string, p: Partial<AmazonSku>) => void }) {
  const x = l.sku;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label className="flex items-center gap-1" title="Pin the launch (first PO) to a month. Blank: it goes out when Allegro has the launch amount.">
        PO month
        <MonthField className="w-[8.5rem]" allowEmpty label="Launch PO month" value={x.launch_month ?? null}
          onSave={v => updateSku(x.id, v ? { launch_month: v } : { launch_month: null, launch_paid_by: null })} />
        {!l.pinned && <span>{l.month ? `auto: ${monthLabel(l.month)}` : 'auto: not yet'}</span>}
      </label>
      {l.pinned && !l.past && (
        <label className="flex items-center gap-1">Paid by
          <SelectField className="w-64" label="Launch paid by" value={l.paidBy}
            options={PAID_BY} onSave={v => updateSku(x.id, { launch_paid_by: v === 'auto' ? null : v })} />
        </label>
      )}
      <label className="flex items-center gap-1" title="Blank: what the budget after launch costs buys at landed cost">
        First order
        <NumField className="w-16" integer allowEmpty label="First order quantity" placeholder={String(l.sizedUnits)} value={x.first_order_qty ?? null}
          onSave={v => updateSku(x.id, { first_order_qty: v })} />
        units{x.first_order_qty == null ? ` (${usd(l.inventoryBudget)} ÷ ${usd(l.landed)})` : ` (${usd(l.units * l.landed)} at ${usd(l.landed)} landed; the budget buys ${l.sizedUnits})`}, launch costs {usd(l.launchCost)}
      </label>
      {l.month && <span className="font-medium text-foreground">{launchFundingText(l)}</span>}
    </span>
  );
}
