import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { CLOCK_TONE_CLASSES } from '@/components/InquiryClockStrip';
import { computeSampleClock, type SampleClock } from '@/lib/sample-requests';

/** Sample clock under the inquiry clock: the oldest open request, else the latest one received. */
export function InquirySampleClockStrip({ inquiryId, refreshKey }: { inquiryId: string; refreshKey?: number }) {
  const navigate = useNavigate();
  const [shown, setShown] = useState<{ id: string; number: string; clock: SampleClock; moreOpen: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from('sample_requests')
        .select('id, request_number, requested_date, required_by_date, samples(status, completed_at)')
        .eq('customer_rfq_id', inquiryId)
        .order('requested_date', { ascending: true });
      const all = ((data ?? []) as any[]).map(r => ({ id: r.id, number: r.request_number, clock: computeSampleClock(r, r.samples ?? []) }))
        .filter(r => r.clock.state !== 'empty');
      const open = all.filter(r => r.clock.state === 'open');
      if (open.length) setShown({ ...open[0], moreOpen: open.length - 1 });
      else if (all.length) setShown({ ...all[all.length - 1], moreOpen: 0 });
      else setShown(null);
    })();
  }, [inquiryId, refreshKey]);

  if (!shown) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(`/samples/${shown.id}`)}
      className={cn('flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm hover:opacity-90', CLOCK_TONE_CLASSES[shown.clock.tone])}
      title={`Sample request ${shown.number}; stops when every sample is received at our factory`}
    >
      <FlaskConical className="h-4 w-4 shrink-0" />
      <span className="font-medium">{shown.clock.label}</span>
      <span className="ml-auto font-mono text-xs opacity-80">{shown.number}{shown.moreOpen > 0 ? ` +${shown.moreOpen} more open` : ''}</span>
    </button>
  );
}
