import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { odooSkuPrefixes, type SkuPrefix } from '@/lib/odoo-products';
import type { Prefixes } from '@/lib/odoo-bom';

type Props = { value: Prefixes; onChange: (next: Prefixes) => void };

/**
 * The two SKU prefixes for Send to Odoo: one for the finished products, one for raw pieces.
 * Suggestions are the prefixes already used in Odoo (read live); any new prefix can be typed.
 */
export function SkuPrefixBar({ value, onChange }: Props) {
  const [known, setKnown] = useState<SkuPrefix[]>([]);
  useEffect(() => { odooSkuPrefixes().then(setKnown).catch(() => { /* typing still works */ }); }, []);
  const saleable = known.filter(p => p.saleable > 0);
  const other = known.filter(p => p.other > 0);
  const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border px-3 py-2">
      <datalist id="odoo-prefix-saleable">{saleable.map(p => <option key={p.prefix} value={p.prefix}>{`${p.saleable} products · e.g. ${p.sample}`}</option>)}</datalist>
      <datalist id="odoo-prefix-other">{other.map(p => <option key={p.prefix} value={p.prefix}>{`${p.other} items · e.g. ${p.sample}`}</option>)}</datalist>
      <label className="space-y-1">
        <span className="block text-xs text-muted-foreground">Product SKU prefix</span>
        <Input className="h-8 w-32 text-xs font-mono" list="odoo-prefix-saleable" placeholder="e.g. RWH"
          value={value.product} onChange={e => onChange({ ...value, product: clean(e.target.value) })} />
      </label>
      <p className="text-xs text-muted-foreground flex-1 min-w-[220px]">
        Fills each product's SKU prefix (PREFIX-BASE-SUFFIX); add the suffix per product. SKUs you've typed yourself are kept.
      </p>
    </div>
  );
}
