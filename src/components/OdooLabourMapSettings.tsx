// Settings → General → Odoo labour mapping: which PDHQ labour type each Odoo BOM operation's
// hours count as when a product's costing is checked against a past production run
// (product page → Repeat product). Saved on global_settings.odoo_operation_labor_map.
import { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  LABOR_TYPES, SKIP_OPERATION, autoLaborType, laborTypeFor, loadOdooOperations, loadOperationMap, saveOperationMap,
  type OperationMap,
} from '@/lib/repeat-cost';

const UNSET = '__unset';

export default function OdooLabourMapSettings() {
  const [ops, setOps] = useState<string[]>([]);
  const [map, setMap] = useState<OperationMap>({});
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loads only when opened: Odoo has a few hundred operation names.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    setLoading(true);
    (async () => {
      const [o, m] = await Promise.allSettled([loadOdooOperations(), loadOperationMap()]);
      if (m.status === 'fulfilled') setMap(m.value);
      else setError('The mapping can’t be saved until the Odoo labour mapping SQL has been run.');
      // Operations already mapped stay listed even when Odoo can't be reached.
      const known = Object.keys(m.status === 'fulfilled' ? m.value : {});
      if (o.status === 'fulfilled') setOps([...new Set([...o.value, ...known])].sort());
      else { setOps(known.sort()); setError(e => e ?? (o.reason instanceof Error ? o.reason.message : String(o.reason))); }
      setLoading(false);
    })();
  }, [open, loaded]);

  const set = async (op: string, v: string) => {
    const prev = map;
    const next = { ...map };
    if (v === UNSET) delete next[op]; else next[op] = v;
    setMap(next);
    try { await saveOperationMap(next); }
    catch (e) { setMap(prev); toast.error(`Couldn’t save: ${e instanceof Error ? e.message : e}`); }
  };

  const summary = Object.entries(
    ops.reduce<Record<string, number>>((a, op) => { const t = laborTypeFor(op, map) ?? 'Not counted'; a[t] = (a[t] ?? 0) + 1; return a; }, {}),
  ).map(([t, n]) => `${t} ${n}`).join(' · ');

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1">
          When a product is checked against a past Odoo production run (product page → Repeat product), each operation’s hours count as a labour type.
          Operations are matched by their wording (Finish…, Sand…, Package…); set one here only to change it.
        </p>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 shrink-0">
            {open ? 'Hide' : 'Show'} operations
            <ChevronDown className={cn('h-4 w-4 ml-1 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-2">
        {loading ? <div className="py-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div> : <>
          {error && <p className="text-xs text-warning">{error}</p>}
          {ops.length > 0 && <p className="text-xs text-muted-foreground tabular-nums">{ops.length} operations: {summary}</p>}
          <div className="rounded-md border max-w-xl max-h-[480px] overflow-y-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Odoo operation</TableHead><TableHead>PDHQ labour type</TableHead></TableRow></TableHeader>
              <TableBody>
                {ops.map(op => {
                  const auto = autoLaborType(op);
                  const autoLabel = auto == null ? 'Not counted (no match)' : auto === SKIP_OPERATION ? 'Auto (not counted)' : `Auto (${auto})`;
                  return (
                    <TableRow key={op}>
                      <TableCell>{op}</TableCell>
                      <TableCell>
                        <Select value={map[op] ?? UNSET} onValueChange={v => void set(op, v)}>
                          <SelectTrigger className="h-8 w-[220px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNSET}>{autoLabel}</SelectItem>
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
        </>}
      </CollapsibleContent>
    </Collapsible>
  );
}
