import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { clockStart, computeInquiryClock, type ClockTone } from '@/lib/inquiry-clock';

const TONE: Record<ClockTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  amber: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
};

/** Strip at the top of an inquiry: time waiting for the first quote, frozen once one is saved. */
export function InquiryClockStrip({ inquiryId, receivedDate, createdAt, status, refreshKey }: {
  inquiryId: string;
  receivedDate: string | null;
  createdAt: string | null;
  status: string | null;
  refreshKey?: number;
}) {
  const [firstQuoteAt, setFirstQuoteAt] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('quote_snapshots')
        .select('created_at')
        .eq('customer_rfq_id', inquiryId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      setFirstQuoteAt(data?.created_at ?? null);
    })();
  }, [inquiryId, refreshKey]);

  // Keep the open time current while the page stays open.
  useEffect(() => {
    if (firstQuoteAt) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [firstQuoteAt]);

  if (firstQuoteAt === undefined) return null;
  const clock = computeInquiryClock({ receivedDate, createdAt, firstQuoteAt, status, now });
  if (!clock) return null;
  const start = clockStart(receivedDate, createdAt);

  return (
    <div
      className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm', TONE[clock.tone])}
      title={start ? `Counted from ${start.toLocaleString()}${firstQuoteAt ? ` to the first quote on ${new Date(firstQuoteAt).toLocaleString()}` : ''}` : undefined}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span className="font-medium">{clock.label}</span>
    </div>
  );
}
