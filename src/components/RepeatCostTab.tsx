// Product page "Past cost" tab (Repeat product): PDHQ's costing next to what the same
// product actually cost in a past Odoo manufacturing order, in the costing steps' order
// (COGS, labour, shipping, margin), with the biggest gaps first and buttons that line PDHQ
// up with the past. Edits go through the same costing bundle as the Costing tab, with undo.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Undo2, Redo2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { inr, pct } from '@/components/costing-workspace/cells';
import { useCostingBundle } from '@/hooks/use-costing-bundle';
import { ensureCostingRowsOnOpen } from '@/lib/costing-seed';
import { loadProductBundle } from '@/lib/costing-workspace';
import { cn } from '@/lib/utils';
import {
  applyAll, applyCogsPair, applyLabourPair, bucketOf, compare, comparableLines, lineLabel, loadOdooPastCost,
  loadOperationMap, newLineIds, suggestTargets,
  type CogsPair, type OdooPastCost, type OperationMap, type RepeatLink, type Target,
} from '@/lib/repeat-cost';

const fmtQty = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4)).replace(/\.?0+$/, '') || '0';

/** Variance cell: positive means the past cost more than PDHQ has now. */
function Diff({ v, className }: { v: number; className?: string }) {
  if (Math.abs(v) < 0.5) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return <span className={cn('tabular-nums', v > 0 ? 'text-destructive' : 'text-success', className)}>{v > 0 ? '+' : '−'}{inr(Math.abs(v))}</span>;
}

export function RepeatCostTab({ productId, link, onLinkChange }: {
  productId: string;
  link: RepeatLink;
  /** Saves a different manufacturing order choice on the link. */
  onLinkChange: (link: RepeatLink) => void;
}) {
  const loader = useCallback(async () => {
    try { await ensureCostingRowsOnOpen(productId); } catch (e) { console.error('ensureCostingRowsOnOpen', e); }
    return loadProductBundle(productId);
  }, [productId]);
  const { bundle, loading, apply, rows, undo, redo, canUndo, canRedo, saving } = useCostingBundle(loader);
  const row = rows.find(r => r.p.id === productId);

  const [past, setPast] = useState<OdooPastCost | null>(null);
  const [pastError, setPastError] = useState<string | null>(null);
  const [pastLoading, setPastLoading] = useState(true);
  const [opMap, setOpMap] = useState<OperationMap>({});
  const [targets, setTargets] = useState<Record<number, Target>>({});

  const loadPast = useCallback(async () => {
    setPastLoading(true);
    try {
      const [p, m] = await Promise.all([
        loadOdooPastCost(link),
        loadOperationMap().catch(e => { console.warn('operation map', e); return {}; }),
      ]);
      setPast(p); setOpMap(m); setPastError(null);
    } catch (e) {
      setPastError(e instanceof Error ? e.message : String(e));
    } finally {
      setPastLoading(false);
    }
  }, [link]);
  useEffect(() => { void loadPast(); }, [loadPast]);

  // Suggest where each Odoo component goes once both sides are loaded (and again for a different MO).
  const bundleReady = !!bundle;
  useEffect(() => {
    if (!bundle || !past) return;
    setTargets(suggestTargets(bundle, productId, past.components));
  }, [past, bundleReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const cmp = useMemo(() => (bundle && row && past?.mo ? compare(bundle, row, past, targets, opMap) : null), [bundle, row, past, targets, opMap]);
  const lines = useMemo(() => (bundle ? comparableLines(bundle, productId) : []), [bundle, productId]);

  const applyPair = (pair: CogsPair) => {
    const comp = pair.comps[0];
    const newId = !pair.line && comp ? crypto.randomUUID() : undefined;
    apply(b => applyCogsPair(b, productId, pair, cmp!.produced, newId));
    if (newId && comp) setTargets(t => ({ ...t, [comp.odoo_product_id]: newId }));
  };
  const applyEverything = () => {
    if (!cmp) return;
    const ids = newLineIds(cmp);
    apply(b => applyAll(b, productId, cmp, ids));
    setTargets(t => ({ ...t, ...ids }));
    toast.success('PDHQ costing now follows the past production run', { action: { label: 'Undo', onClick: () => undo() } });
  };

  if (loading || pastLoading) return <div className="py-16 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (pastError) return (
    <div className="py-12 text-center text-sm text-muted-foreground space-y-3">
      <p>Couldn’t read the past cost from Odoo: {pastError}</p>
      <Button variant="outline" size="sm" onClick={() => void loadPast()}>Retry</Button>
    </div>
  );
  if (!past || !bundle || !row) return null;

  const sale = past.sale;
  const fx = row.r.exchangeRate || 0;
  const header = (
    <div className="rounded-md border p-3 space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium">{past.product.sku ? `[${past.product.sku}] ` : ''}{past.product.name}</span>
        {sale && <span className="text-muted-foreground">{sale.order} · {sale.customer} · {sale.quantity} pcs @ {sale.price_unit.toFixed(2)} {sale.currency}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Production run</span>
        {past.mos.length > 0 ? (
          <Select value={String(past.mo?.id ?? '')} onValueChange={v => onLinkChange({ ...link, mo_id: Number(v) })}>
            <SelectTrigger className="h-8 w-auto min-w-[240px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {past.mos.map(m => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name} · {m.produced} made · {m.date ?? '—'}{m.linked ? ' · this order' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : <span className="text-xs">none finished in Odoo yet</span>}
        <span className="text-xs text-muted-foreground tabular-nums">Odoo’s booked cost {inr(past.mo && past.mo.produced ? past.mo.finished_value / past.mo.produced : past.product.standard_price, 2)}/unit (no overhead or shipping)</span>
        <div className="ml-auto flex items-center gap-1">
          {saving > 0 && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => undo()} disabled={!canUndo} title="Undo"><Undo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => redo()} disabled={!canRedo} title="Redo"><Redo2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void loadPast()} title="Reload from Odoo"><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={applyEverything} disabled={!cmp}><Wand2 className="h-3.5 w-3.5 mr-1.5" />Use all Odoo values</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Past = quantities and prices actually used in Odoo, with Odoo’s hours costed at today’s PDHQ labour rates and indirect overhead.
        Shipping isn’t part of Odoo’s production cost, so PDHQ’s shipping is used on both sides.
      </p>
    </div>
  );

  if (!past.mo || !cmp) return <div className="space-y-3">{header}<p className="text-sm text-muted-foreground py-6 text-center">There’s no finished manufacturing order for this product in Odoo, so there’s no past cost to compare yet.</p></div>;

  const s = cmp.steps;
  const soInr = cmp.price.soInr;
  const marginOf = (price: number | null, cost: number) => (price && price > 0 ? (price - cost) / price : null);
  const stepRows = [s.cogs, s.labour, s.indirect, s.shipping, s.capital].filter(x => x.pdhq || x.odoo);

  return (
    <div className="space-y-4">
      {header}

      {/* Summary by step */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Per unit</TableHead><TableHead className="text-right">PDHQ now</TableHead><TableHead className="text-right">Past (Odoo)</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {stepRows.map(x => (
                <TableRow key={x.label}>
                  <TableCell>{x.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(x.pdhq)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(x.odoo)}</TableCell>
                  <TableCell className="text-right"><Diff v={x.odoo - x.pdhq} /></TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>{s.total.label}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(s.total.pdhq)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(s.total.odoo)}</TableCell>
                <TableCell className="text-right"><Diff v={s.total.odoo - s.total.pdhq} /></TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Unit price</TableCell>
                <TableCell className="text-right tabular-nums">{inr(cmp.price.pdhqInr)}</TableCell>
                <TableCell className="text-right tabular-nums">{soInr != null ? inr(soInr) : '—'}{sale && <span className="block text-xs text-muted-foreground">{sale.order} price</span>}</TableCell>
                <TableCell />
              </TableRow>
              <TableRow>
                <TableCell>Margin</TableCell>
                <TableCell className="text-right tabular-nums">{pct(marginOf(cmp.price.pdhqInr, s.total.pdhq))}</TableCell>
                <TableCell className="text-right tabular-nums">{soInr != null ? pct(marginOf(soInr, s.total.odoo)) : '—'}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">{fx > 0 && sale?.currency === 'USD' ? `at ₹${fx.toFixed(2)}/USD` : ''}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {/* Major variance points */}
        <div className="rounded-md border p-3">
          <div className="text-sm font-medium mb-2">Biggest differences</div>
          {cmp.variances.length === 0 ? <p className="text-sm text-muted-foreground">PDHQ already matches the past run.</p> : (
            <ul className="space-y-1.5">
              {cmp.variances.slice(0, 8).map((v, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <Diff v={v.diff} className="w-20 shrink-0 text-right" />
                  <span className="min-w-0 truncate">{v.label}</span>
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">{[v.step, v.note].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}
          {cmp.unmappedOps.length > 0 && (
            <p className="mt-3 text-xs text-warning flex gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Odoo hours not counted yet: {cmp.unmappedOps.map(o => `${o.operation} (${o.hours.toFixed(1)} h)`).join(', ')}.{' '}
                <Link to="/settings#odoo-labour" className="underline">Map these operations to a labour type</Link>.
              </span>
            </p>
          )}
        </div>
      </div>

      {/* COGS */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">1 · COGS</h3>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PDHQ line</TableHead>
                <TableHead>Odoo used (per unit)</TableHead>
                <TableHead className="text-right">PDHQ</TableHead>
                <TableHead className="text-right">Past</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cmp.cogs.map(g => [
                <TableRow key={`h:${g.bucket}`} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={6} className="py-1.5 text-xs font-medium text-muted-foreground">{g.label}</TableCell>
                </TableRow>,
                ...g.pairs.map(pair => (
                  <TableRow key={pair.key} className={cn(pair.skipped && 'opacity-50')}>
                    <TableCell className="align-top max-w-[220px]">
                      {pair.line ? <span className="block truncate" title={pair.label}>{pair.label}</span>
                        : <Badge variant="outline" className="font-normal">{pair.skipped ? 'Skipped' : 'New line'}</Badge>}
                    </TableCell>
                    <TableCell className="align-top">
                      {pair.comps.length === 0 ? <span className="text-xs text-muted-foreground">Not used in this run</span> : (
                        <div className="space-y-1.5">
                          {pair.comps.map(c => (
                            <div key={c.odoo_product_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-xs min-w-0">
                                <span className="font-medium">{c.sku}</span> {c.name}
                                <span className="block text-muted-foreground tabular-nums">
                                  {fmtQty(cmp.produced ? c.used / cmp.produced : 0)} {c.uom} @ {inr(c.used ? c.value / c.used : 0, 2)}
                                  {c.planned > 0 && Math.abs(c.used - c.planned) / c.planned > 0.05 && <> · planned {fmtQty(c.planned / cmp.produced)}</>}
                                  {c.planned === 0 && <> · not on BOM</>}
                                </span>
                              </span>
                              <Select value={String(targets[c.odoo_product_id] ?? 'new')} onValueChange={v => setTargets(t => ({ ...t, [c.odoo_product_id]: v }))}>
                                <SelectTrigger className="h-7 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="new">Add as a new line</SelectItem>
                                  <SelectItem value="skip">Leave out</SelectItem>
                                  {lines.filter(l => bucketOf(l.cogs_type).key === g.bucket || l.id === targets[c.odoo_product_id]).map(l => (
                                    <SelectItem key={l.id} value={l.id}>{lineLabel(bundle, l) || l.cogs_type}{l.include === 'No' ? ' (off)' : ''}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums align-top">{inr(pair.pdhq, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums align-top">{inr(pair.odoo, 2)}</TableCell>
                    <TableCell className="text-right align-top"><Diff v={pair.odoo - pair.pdhq} /></TableCell>
                    <TableCell className="text-right align-top">
                      {!pair.skipped && Math.abs(pair.odoo - pair.pdhq) >= 0.01 && (
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => applyPair(pair)}>
                          {pair.comps.length ? 'Use Odoo' : 'Turn off'}<ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">“Use Odoo” sets the line to the quantity actually used per unit at the price paid, with waste at 0 because Odoo’s quantity already includes it. Several Odoo items on one line become one set.</p>
      </section>

      {/* Labour */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">2 · Labour</h3>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Labour type</TableHead>
                <TableHead>Odoo operations</TableHead>
                <TableHead className="text-right">PDHQ h/unit</TableHead>
                <TableHead className="text-right">Past h/unit</TableHead>
                <TableHead className="text-right">₹/h</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cmp.labour.map(l => (
                <TableRow key={l.laborType}>
                  <TableCell>{l.laborType}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.operations.join(', ') || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.pdhqHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.odooHours.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(l.rate)}</TableCell>
                  <TableCell className="text-right"><Diff v={(l.odooHours - l.pdhqHours) * l.rate} /></TableCell>
                  <TableCell className="text-right">
                    {Math.abs(l.odooHours - l.pdhqHours) >= 0.005 && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => apply(b => applyLabourPair(b, productId, l))}>
                        Use Odoo<ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Indirect overhead is {inr(cmp.indirectPerHour, 2)} per man-hour on every hour, so each extra hour costs its labour rate plus that.
          Odoo operations count towards labour types as set in <Link to="/settings#odoo-labour" className="underline">Settings → Odoo labour mapping</Link>.
        </p>
      </section>

      {/* Shipping + margin */}
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">3 · Shipping</h3>
        <p className="text-sm text-muted-foreground">PDHQ {inr(s.shipping.pdhq, 2)}/unit. Odoo’s production cost has no shipping, so this isn’t compared.</p>
      </section>
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">4 · Margin</h3>
        <p className="text-sm text-muted-foreground">
          {soInr != null && sale
            ? <>At {sale.order}’s price of {inr(soInr)} the past cost leaves {pct(marginOf(soInr, s.total.odoo))}; PDHQ’s current price of {inr(cmp.price.pdhqInr)} on PDHQ’s cost leaves {pct(marginOf(cmp.price.pdhqInr, s.total.pdhq))}.</>
            : <>PDHQ’s current price of {inr(cmp.price.pdhqInr)} leaves {pct(marginOf(cmp.price.pdhqInr, s.total.pdhq))}.</>}
          {' '}Change the markup on the Costing tab.
        </p>
      </section>
    </div>
  );
}
