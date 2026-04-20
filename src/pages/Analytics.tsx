import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { STAGE_LABEL } from '@/components/ProductStagePills';

type StageEvent = {
  id: string;
  product_id: string;
  track: string;
  from_stage: string | null;
  to_stage: string | null;
  occurred_at: string;
};

const TRACKS = ['design', 'quote', 'sample'] as const;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function fmtDays(d: number | null | undefined): string {
  if (d == null || isNaN(d)) return '—';
  return `${d.toFixed(1)} days`;
}

const Analytics = () => {
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [ev, inq] = await Promise.all([
        supabase
          .from('product_stage_events')
          .select('*')
          .order('occurred_at', { ascending: true }),
        supabase.from('customer_rfqs').select('id, status, created_at, updated_at'),
      ]);
      setEvents((ev.data || []) as StageEvent[]);
      setInquiries(inq.data || []);
      setLoading(false);
    })();
  }, []);

  // Pair entries -> exits per (product, track)
  const { stageDurations, currentCounts } = useMemo(() => {
    const durations: Record<string, Record<string, { durations: number[]; count: number }>> = {};
    const current: Record<string, Record<string, number>> = {};
    TRACKS.forEach(t => {
      durations[t] = {};
      current[t] = {};
    });

    // group events by product+track
    const grouped: Record<string, StageEvent[]> = {};
    events.forEach(e => {
      const key = `${e.product_id}|${e.track}`;
      (grouped[key] ||= []).push(e);
    });

    Object.entries(grouped).forEach(([key, evs]) => {
      const [, track] = key.split('|');
      if (!TRACKS.includes(track as any)) return;
      // each event represents a transition at occurred_at.
      // duration in to_stage = next event's occurred_at - this.occurred_at.
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (!e.to_stage) continue;
        const next = evs[i + 1];
        if (next) {
          const d = (new Date(next.occurred_at).getTime() - new Date(e.occurred_at).getTime()) / MS_PER_DAY;
          const slot = (durations[track][e.to_stage] ||= { durations: [], count: 0 });
          slot.durations.push(d);
          slot.count++;
        } else {
          // currently in this stage
          current[track][e.to_stage] = (current[track][e.to_stage] || 0) + 1;
          const slot = (durations[track][e.to_stage] ||= { durations: [], count: 0 });
          slot.count++;
        }
      }
    });

    return { stageDurations: durations, currentCounts: current };
  }, [events]);

  // Inquiry timing
  const { avgInquiryAge, avgTimeToPo } = useMemo(() => {
    const now = Date.now();
    const active = inquiries.filter(i => i.status !== 'cancelled' && i.status !== 'po');
    const ages = active.map(i => (now - new Date(i.created_at).getTime()) / MS_PER_DAY);
    const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

    const pos = inquiries.filter(i => i.status === 'po');
    const times = pos.map(
      i => (new Date(i.updated_at).getTime() - new Date(i.created_at).getTime()) / MS_PER_DAY,
    );
    const avgPo = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
    return { avgInquiryAge: avgAge, avgTimeToPo: avgPo };
  }, [inquiries]);

  const noEvents = !loading && events.length === 0;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold">Analytics</h1>

        {noEvents ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No stage events yet. As products move through stages, analytics will populate here.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Stage Durations</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8">Track</TableHead>
                      <TableHead className="h-8">Stage</TableHead>
                      <TableHead className="h-8 text-right">Avg</TableHead>
                      <TableHead className="h-8 text-right">P50</TableHead>
                      <TableHead className="h-8 text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TRACKS.flatMap(track => {
                      const stages = Object.entries(stageDurations[track] || {});
                      if (!stages.length) return [];
                      return stages.map(([stage, info]) => {
                        const avg = info.durations.length
                          ? info.durations.reduce((a, b) => a + b, 0) / info.durations.length
                          : null;
                        const p50 = info.durations.length ? median(info.durations) : null;
                        return (
                          <TableRow key={`${track}-${stage}`}>
                            <TableCell className="py-2 capitalize">{track}</TableCell>
                            <TableCell className="py-2">{STAGE_LABEL[stage] ?? stage}</TableCell>
                            <TableCell className="py-2 text-right tabular-nums">
                              {fmtDays(avg)}
                            </TableCell>
                            <TableCell className="py-2 text-right tabular-nums">
                              {fmtDays(p50)}
                            </TableCell>
                            <TableCell className="py-2 text-right tabular-nums">
                              {info.count}
                            </TableCell>
                          </TableRow>
                        );
                      });
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Current Stage Counts</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8">Track</TableHead>
                      <TableHead className="h-8">Stage</TableHead>
                      <TableHead className="h-8 text-right">Products</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {TRACKS.flatMap(track => {
                      const stages = Object.entries(currentCounts[track] || {});
                      return stages.map(([stage, count]) => (
                        <TableRow key={`${track}-${stage}`}>
                          <TableCell className="py-2 capitalize">{track}</TableCell>
                          <TableCell className="py-2">{STAGE_LABEL[stage] ?? stage}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{count}</TableCell>
                        </TableRow>
                      ));
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Inquiry Timing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-2">
                <div>
                  <div className="text-2xl font-bold tabular-nums">
                    {avgInquiryAge != null ? `${avgInquiryAge.toFixed(1)}` : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Avg active inquiry age (days)
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold tabular-nums">
                    {avgTimeToPo != null ? `${avgTimeToPo.toFixed(1)}` : '—'}
                  </div>
                  <div className="text-xs text-muted-foreground">Avg time to PO (days)</div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Analytics;
