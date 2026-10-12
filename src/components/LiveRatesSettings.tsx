// Settings → Live rates: the Odoo exchange rate and LaborTrax labor cost per man-hour
// that costing always uses (src/lib/live-rates.ts).
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { avgRateByDesignation } from '@/lib/calculations';
import { LABOR_COLS } from '@/lib/costing-intake';
import { isLiveStale, LIVE_STALE_HOURS, type LiveLaborDetail } from '@/lib/live-rates';
import { syncLiveRates } from '@/lib/live-rates-sync';
import { cn } from '@/lib/utils';

const LABOR_TYPES = LABOR_COLS.map(c => c.laborType);
const inr = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const ago = (at: string | null | undefined) => (at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : 'never');

export default function LiveRatesSettings() {
  const [gs, setGs] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const [g, e] = await Promise.all([
      (supabase as any).from('global_settings').select('*').limit(1).single(),
      supabase.from('labor_employees').select('hourly_rate_inr, designations'),
    ]);
    if (g.data) setGs(g.data);
    if (e.data) setEmployees(e.data as any[]);
  };
  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setSyncing(true);
    const res = await syncLiveRates();
    setSyncing(false);
    if (res.error) return toast.error('Refresh failed', { description: res.error });
    if (res.warnings?.length) toast.warning('Refreshed with warnings', { description: res.warnings.join(' · ') });
    else toast.success('Live rates refreshed');
    await load();
  };

  if (!gs) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const detail = (gs.live_labor_detail || null) as LiveLaborDetail | null;
  const directLive = (gs.live_direct_rates || {}) as Record<string, number>;
  const warnings: string[] = gs.live_rates_warnings || [];
  const stale = isLiveStale(gs.live_exchange_rate_at) || isLiveStale(gs.live_labor_at);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Live rates</CardTitle>
            <CardDescription>
              Exchange rate from Odoo; indirect overhead (fully burdened ₹/man-hour) and direct wages by labor type from LaborTrax.
              Every costing screen and new quote uses them, and they refresh automatically every {LIVE_STALE_HOURS} hours. A per-inquiry override still wins, and if a source is down the last good value stays in use.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={syncing}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', syncing && 'animate-spin')} /> Refresh now
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {(warnings.length > 0 || stale) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              {stale && <div>Live values are more than {LIVE_STALE_HOURS} hours old; the last good values are in use.</div>}
              {warnings.map(w => <div key={w}>{w}</div>)}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow><TableHead>Rate</TableHead><TableHead className="text-right">In use</TableHead><TableHead>Source</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Exchange rate (INR per USD)</TableCell>
                <TableCell className="text-right tabular-nums">{Number(gs.live_exchange_rate || gs.exchange_rate).toFixed(4)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">Odoo, updated {ago(gs.live_exchange_rate_at)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Indirect overhead / man-hour (fully burdened)</TableCell>
                <TableCell className="text-right tabular-nums">{inr(Number(gs.live_burdened_per_mh || gs.indirect_overhead_per_mh))}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {detail?.burdened_source === 'labortrax' ? `LaborTrax fully burdened figure${detail.window ? `, ${detail.window.from} to ${detail.window.to}` : ''}` : `LaborTrax labor entries${detail ? `, ${detail.window.from} to ${detail.window.to}, ${detail.hours.toLocaleString()} man-hours` : ''}`}, updated {ago(gs.live_labor_at)}
                </TableCell>
              </TableRow>
              {LABOR_TYPES.map(t => (
                <TableRow key={t}>
                  <TableCell className="pl-6">Direct wages / man-hour: {t}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(directLive[t] || avgRateByDesignation(employees, t))}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{!directLive[t] ? 'No LaborTrax hours: Labor Directory employee average'
                    : detail?.direct_source?.[t] === '6m' ? 'LaborTrax, 6-month rate (no hours in the last 3 weeks)'
                    : `LaborTrax${detail?.direct_window ? `, ${detail.direct_window.from} to ${detail.direct_window.to}` : ''}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {detail?.categories?.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">LaborTrax work-order categories, {detail.direct_window ? `${detail.direct_window.from} to ${detail.direct_window.to}` : ''} ({detail.categories.length})</summary>
              <Table>
                <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Counts as</TableHead><TableHead className="text-right">Man-hours</TableHead><TableHead className="text-right">Direct ₹/MH</TableHead></TableRow></TableHeader>
                <TableBody>
                  {detail.categories.map(c => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell className={cn(!c.laborType && 'text-muted-foreground')}>{c.laborType ?? 'Not matched (only in the burdened average)'}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.hours.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(c.directPerMh)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}
