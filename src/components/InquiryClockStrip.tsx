import { useEffect, useState } from 'react';
import { Clock, Pencil, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { clockStart, computeInquiryClock, quoteStop, type ClockTone } from '@/lib/inquiry-clock';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/** Fired when an inquiry's repeat-order flag changes, so the strip and the Projection tab stay in step. */
export const REPEAT_ORDER_EVENT = 'inquiry-repeat-order-changed';

export const CLOCK_TONE_CLASSES: Record<ClockTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  amber: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
  red: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30',
  done: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
};

/** Strip at the top of an inquiry: time waiting for the first quote, frozen once one is saved
 *  (or at the quoted date entered here). Repeat orders show no clock. */
export function InquiryClockStrip({ inquiryId, receivedDate, createdAt, quotedDate, status, refreshKey, onQuotedDateChange }: {
  inquiryId: string;
  receivedDate: string | null;
  createdAt: string | null;
  quotedDate: string | null;
  status: string | null;
  refreshKey?: number;
  onQuotedDateChange: (date: string | null) => Promise<void> | void;
}) {
  const [firstQuoteAt, setFirstQuoteAt] = useState<string | null | undefined>(undefined);
  const [repeatOrder, setRepeatOrder] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [editOpen, setEditOpen] = useState(false);
  const [draftDate, setDraftDate] = useState('');

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from('inquiry_projections').select('repeat_order').eq('inquiry_id', inquiryId).maybeSingle();
      setRepeatOrder(!!data?.repeat_order);
    })();
    const onChange = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.inquiryId === inquiryId) setRepeatOrder(!!d.repeatOrder);
    };
    window.addEventListener(REPEAT_ORDER_EVENT, onChange);
    return () => window.removeEventListener(REPEAT_ORDER_EVENT, onChange);
  }, [inquiryId, refreshKey]);

  const toggleRepeat = async (next: boolean) => {
    setRepeatOrder(next);
    const { error } = await (supabase as any)
      .from('inquiry_projections').upsert({ inquiry_id: inquiryId, repeat_order: next }, { onConflict: 'inquiry_id' });
    if (error) { setRepeatOrder(!next); toast.error(error.message); return; }
    window.dispatchEvent(new CustomEvent(REPEAT_ORDER_EVENT, { detail: { inquiryId, repeatOrder: next } }));
  };

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
    if (firstQuoteAt || quotedDate || repeatOrder) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [firstQuoteAt, quotedDate, repeatOrder]);

  if (firstQuoteAt === undefined) return null;

  const repeatToggle = (
    <label className="ml-auto flex items-center gap-1.5 text-xs cursor-pointer select-none">
      <Checkbox checked={repeatOrder} onCheckedChange={c => toggleRepeat(!!c)} />
      Repeat order
    </label>
  );

  if (repeatOrder) {
    return (
      <div className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm', CLOCK_TONE_CLASSES.neutral)}>
        <Repeat className="h-4 w-4 shrink-0" />
        <span>Repeat order, quote time not tracked</span>
        {repeatToggle}
      </div>
    );
  }

  const clock = computeInquiryClock({ receivedDate, createdAt, firstQuoteAt, quotedDate, status, now });
  if (!clock) return null;
  const start = clockStart(receivedDate, createdAt);
  const stop = quoteStop(quotedDate, firstQuoteAt);
  const stopText = quotedDate
    ? ` to the quoted date ${stop?.toLocaleDateString()} (entered by hand)`
    : firstQuoteAt ? ` to the first quote on ${new Date(firstQuoteAt).toLocaleString()}` : '';

  const save = async (value: string | null) => {
    await onQuotedDateChange(value);
    setEditOpen(false);
  };

  return (
    <div
      className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm', CLOCK_TONE_CLASSES[clock.tone])}
      title={start ? `Counted from ${start.toLocaleString()}${stopText}` : undefined}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span className="font-medium">{clock.label}</span>
      <Popover open={editOpen} onOpenChange={o => { setEditOpen(o); if (o) setDraftDate(quotedDate ?? (firstQuoteAt ? toDateInput(new Date(firstQuoteAt)) : '')); }}>
        <PopoverTrigger asChild>
          <button type="button" className="opacity-60 hover:opacity-100" aria-label="Edit quoted date">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 space-y-2">
          <div className="text-sm font-medium">Quoted date</div>
          <Input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)} className="h-9" />
          <p className="text-[11px] text-muted-foreground">
            {firstQuoteAt
              ? `First quote saved in the app: ${new Date(firstQuoteAt).toLocaleDateString()}.`
              : 'No quote saved in the app yet.'}
          </p>
          <div className="flex justify-between gap-2">
            {quotedDate
              ? <Button variant="ghost" size="sm" onClick={() => save(null)}>Use saved quote</Button>
              : <span />}
            <Button size="sm" disabled={!draftDate} onClick={() => save(draftDate)}>Save</Button>
          </div>
        </PopoverContent>
      </Popover>
      {repeatToggle}
    </div>
  );
}

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
