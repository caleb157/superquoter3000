// Settings → General → Odoo labour mapping: which PDHQ labour type each Odoo BOM operation's
// hours count as when a product's costing is checked against a past production run
// (product page → Repeat product). Saved on global_settings.odoo_operation_labor_map.
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DEFAULT_OPERATION_MAP, LABOR_TYPES, SKIP_OPERATION, loadOdooOperations, loadOperationMap, saveOperationMap,
  type OperationMap,
} from '@/lib/repeat-cost';

const UNSET = '__unset';

export default function OdooLabourMapSettings() {
  const [ops, setOps] = useState<string[]>([]);
  const [map, setMap] = useState<OperationMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [o, m] = await Promise.allSettled([loadOdooOperations(), loadOperationMap()]);
      if (m.status === 'fulfilled') setMap(m.value);
      else setError('The mapping can’t be saved until the Odoo labour mapping SQL has been run.');
      // Operations already mapped stay listed even when Odoo can't be reached.
      const known = Object.keys({ ...DEFAULT_OPERATION_MAP, ...(m.status === 'fulfilled' ? m.value : {}) });
      if (o.status === 'fulfilled') setOps([...new Set([...o.value, ...known])].sort());
      else { setOps(known.sort()); setError(e => e ?? (o.reason instanceof Error ? o.reason.message : String(o.reason))); }
      setLoading(false);
    })();
  }, []);

  const set = async (op: string, v: string) => {
    const prev = map;
    const next = { ...map };
    if (v === UNSET) delete next[op]; else next[op] = v;
    setMap(next);
    try { await saveOperationMap(next); }
    catch (e) { setMap(prev); toast.error(`Couldn’t save: ${e instanceof Error ? e.message : e}`); }
  };

  if (loading) return <div className="py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        When a product is checked against a past Odoo production run (product page → Repeat product), each operation’s hours count as this labour type.
      </p>
      {error && <p className="text-xs text-warning">{error}</p>}
      <div className="rounded-md border max-w-xl">
        <Table>
          <TableHeader><TableRow><TableHead>Odoo operation</TableHead><TableHead>PDHQ labour type</TableHead></TableRow></TableHeader>
          <TableBody>
            {ops.map(op => {
              const def = DEFAULT_OPERATION_MAP[op] ?? (LABOR_TYPES.includes(op) ? op : null);
              return (
                <TableRow key={op}>
                  <TableCell>{op}</TableCell>
                  <TableCell>
                    <Select value={map[op] ?? UNSET} onValueChange={v => void set(op, v)}>
                      <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>{def ? `Default (${def})` : 'Not counted (pick one)'}</SelectItem>
                        {LABOR_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        <SelectItem value={SKIP_OPERATION}>Don’t count these hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
