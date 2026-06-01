import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DateRangePicker } from '@/components/analytics/DateRangePicker';
import { SalesDashboard } from '@/components/analytics/SalesDashboard';
import { OpsDashboard } from '@/components/analytics/OpsDashboard';
import { rangeFromPreset, type RangePreset } from '@/lib/analytics-helpers';

import { ProjectionsTable } from '@/components/analytics/ProjectionsTable';
import { CapacityChart } from '@/components/analytics/CapacityChart';

const VALID_PRESETS: RangePreset[] = ['7d', '14d', '30d', 'this_q', 'last_q', 'this_fy', 'last_fy', 'custom'];

type View = 'sales' | 'ops' | 'projections' | 'capacity';

const Analytics = () => {
  const [params, setParams] = useSearchParams();
  const viewRaw = params.get('view');
  const view: View = viewRaw === 'ops' ? 'ops' : viewRaw === 'projections' ? 'projections' : 'sales';
  const presetRaw = params.get('range') as RangePreset | null;
  const preset: RangePreset = presetRaw && VALID_PRESETS.includes(presetRaw) ? presetRaw : '30d';
  const customFrom = params.get('from') || undefined;
  const customTo = params.get('to') || undefined;

  const range = useMemo(
    () => rangeFromPreset(preset, { from: customFrom, to: customTo }),
    [preset, customFrom, customTo],
  );

  const [slowQuoteDays, setSlowQuoteDays] = useState(7);
  const [slowSampleDays, setSlowSampleDays] = useState(14);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('global_settings')
        .select('slow_quote_days, slow_sample_days')
        .limit(1)
        .maybeSingle();
      if (data) {
        if ((data as any).slow_quote_days != null) setSlowQuoteDays((data as any).slow_quote_days);
        if ((data as any).slow_sample_days != null) setSlowSampleDays((data as any).slow_sample_days);
      }
    })();
  }, []);

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };
  const setRange = (p: RangePreset, custom?: { from?: string; to?: string }) => {
    const next = new URLSearchParams(params);
    next.set('range', p);
    if (p === 'custom') {
      if (custom?.from) next.set('from', custom.from); else next.delete('from');
      if (custom?.to) next.set('to', custom.to); else next.delete('to');
    } else {
      next.delete('from');
      next.delete('to');
    }
    setParams(next, { replace: true });
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-xl font-serif font-medium tracking-tight">Analytics</h1>
          {view !== 'projections' && (
            <DateRangePicker
              preset={preset}
              customFrom={customFrom}
              customTo={customTo}
              onChange={setRange}
            />
          )}
        </div>

        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="ops">Operations</TabsTrigger>
            <TabsTrigger value="projections">Projections</TabsTrigger>
          </TabsList>
          <TabsContent value="sales" className="mt-4">
            <SalesDashboard range={range} />
          </TabsContent>
          <TabsContent value="ops" className="mt-4">
            <OpsDashboard range={range} slowQuoteDays={slowQuoteDays} slowSampleDays={slowSampleDays} />
          </TabsContent>
          <TabsContent value="projections" className="mt-4">
            <ProjectionsTable />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Analytics;
