import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DateRangePicker } from '@/components/analytics/DateRangePicker';
import { KpiZone } from '@/components/analytics/master/KpiZone';
import { ProjectionsZone } from '@/components/analytics/master/ProjectionsZone';
import { rangeFromPreset, type RangePreset } from '@/lib/analytics-helpers';
import type { Ccy } from '@/lib/master-analytics';
import { useAnalyticsSnapshot } from '@/hooks/use-analytics-snapshot';
import { useDocumentTitle } from '@/hooks/use-document-title';

const VALID_PRESETS: RangePreset[] = ['7d', '14d', '30d', 'this_q', 'last_q', 'this_fy', 'last_fy', 'this_cy', 'last_cy', 'custom'];

const Analytics = () => {
  useDocumentTitle('Kickass Analytics Dashboard');
  const [params, setParams] = useSearchParams();
  const presetRaw = params.get('range') as RangePreset | null;
  const preset: RangePreset = presetRaw && VALID_PRESETS.includes(presetRaw) ? presetRaw : '30d';
  const customFrom = params.get('from') || undefined;
  const customTo = params.get('to') || undefined;
  const range = useMemo(() => rangeFromPreset(preset, { from: customFrom, to: customTo }), [preset, customFrom, customTo]);
  const ccy: Ccy = params.get('ccy') === 'INR' ? 'INR' : 'USD';
  const includePipeline = params.get('pipeline') !== '0';

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v == null) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };
  const setRange = (p: RangePreset, custom?: { from?: string; to?: string }) => {
    const next = new URLSearchParams(params);
    next.set('range', p);
    if (p === 'custom') {
      if (custom?.from) next.set('from', custom.from); else next.delete('from');
      if (custom?.to) next.set('to', custom.to); else next.delete('to');
    } else { next.delete('from'); next.delete('to'); }
    setParams(next, { replace: true });
  };

  const { snapshot, syncedAt, syncing, refresh } = useAnalyticsSnapshot();
  const [settings, setSettings] = useState({ id: '', hqRate: 0, overheadMonths: 3, openingCash: 0, slowQuote: 7, slowSample: 14 });
  useEffect(() => {
    supabase.from('global_settings').select('*').limit(1).maybeSingle().then(({ data }) => {
      const d: any = data; if (!d) return;
      setSettings({ id: d.id, hqRate: Number(d.exchange_rate) || 0, overheadMonths: d.overhead_avg_months ?? 3, openingCash: Number(d.opening_cash_inr) || 0, slowQuote: d.slow_quote_days ?? 7, slowSample: d.slow_sample_days ?? 14 });
    });
  }, []);
  const saveSetting = async (col: string, val: number, key: 'overheadMonths' | 'openingCash') => {
    setSettings(s => ({ ...s, [key]: val }));
    if (settings.id) await (supabase as any).from('global_settings').update({ [col]: val }).eq('id', settings.id);
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Global bar: only controls that apply to both zones */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <h1 className="text-xl font-serif font-medium tracking-tight">Kickass Analytics Dashboard</h1>
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup type="single" size="sm" variant="outline" value={ccy} onValueChange={v => v && setParam('ccy', v === 'INR' ? 'INR' : null)}>
              <ToggleGroupItem value="USD" className="px-3">USD</ToggleGroupItem>
              <ToggleGroupItem value="INR" className="px-3">INR</ToggleGroupItem>
            </ToggleGroup>
            <span className="text-xs text-muted-foreground tabular-nums">
              Odoo ₹{snapshot?.inr_per_usd ? snapshot.inr_per_usd.toFixed(2) : '—'} · HQ ₹{settings.hqRate || '—'}
            </span>
            <Button size="sm" variant="outline" className="h-8" disabled={syncing} onClick={() => refresh(settings.overheadMonths)}>
              <RefreshCw className={syncing ? 'h-3.5 w-3.5 mr-1.5 animate-spin' : 'h-3.5 w-3.5 mr-1.5'} />
              {syncing ? 'Syncing…' : 'Refresh Odoo & LaborTrax'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {syncedAt ? `Synced ${formatDistanceToNow(new Date(syncedAt), { addSuffix: true })}` : 'Never synced'}
            </span>
          </div>
        </div>
        {snapshot?.warnings?.length ? (
          <div className="text-xs rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-muted-foreground">
            Last sync had issues: {snapshot.warnings.join(' · ')}
          </div>
        ) : null}

        {/* Zone 1 */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Performance KPIs</h2>
            <DateRangePicker preset={preset} customFrom={customFrom} customTo={customTo} onChange={setRange} />
          </div>
          <KpiZone snapshot={snapshot} ccy={ccy} range={range} />
        </section>

        {/* Zone 2 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Projections <span className="font-normal normal-case text-muted-foreground">· as of now</span></h2>
          </div>
          <ProjectionsZone
            snapshot={snapshot} ccy={ccy} hqRate={settings.hqRate || 84}
            includePipeline={includePipeline} setIncludePipeline={v => setParam('pipeline', v ? null : '0')}
            overheadMonths={settings.overheadMonths} setOverheadMonths={n => saveSetting('overhead_avg_months', n, 'overheadMonths')}
          />
        </section>

      </div>
    </AppLayout>
  );
};

export default Analytics;
