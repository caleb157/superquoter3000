import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, MessageCircle, Trophy, Zap } from 'lucide-react';

type Customer = { id: string; sales_stage: string | null; not_now_until?: string | null };

interface Props {
  customers: Customer[];
}

/** Stages from a first reply on: the base for conversion. Queued / In outreach have not answered yet. */
const REPLIED = new Set(['responded', 'in_conversation', 'inquiry', 'customer', 'not_now']);

/** Headline counts for the Customers page, all read from the one sales stage. */
export function CustomerMetricsCard({ customers }: Props) {
  const stats = useMemo(() => {
    const by = (s: string) => customers.filter(c => c.sales_stage === s).length;
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const replied = customers.filter(c => REPLIED.has(c.sales_stage ?? '')).length;
    const won = by('customer');
    return {
      won,
      inquiries: by('inquiry'),
      leads: by('responded') + by('in_conversation'),
      inConversation: by('in_conversation'),
      conversion: replied > 0 ? Math.round((won / replied) * 100) : 0,
      replied,
      notNow: by('not_now'),
      backSoon: customers.filter(c => c.sales_stage === 'not_now' && c.not_now_until && c.not_now_until <= soon).length,
    };
  }, [customers]);

  const tile = (icon: React.ReactNode, label: string, value: string, sub?: string) => (
    <div className="flex items-start gap-2.5">
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-base font-semibold leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {tile(<Trophy className="h-4 w-4 text-success" />, 'Customers', String(stats.won), `${stats.inquiries} live inquir${stats.inquiries === 1 ? 'y' : 'ies'}`)}
          {tile(<MessageCircle className="h-4 w-4 text-warning" />, 'Leads', String(stats.leads), `${stats.inConversation} in conversation`)}
          {tile(<Zap className="h-4 w-4 text-info" />, 'Conversion', `${stats.conversion}%`, `customers of ${stats.replied} who replied`)}
          {tile(<CalendarClock className="h-4 w-4" />, 'Not now', String(stats.notNow), `${stats.backSoon} due back in 30 days`)}
        </div>
      </CardContent>
    </Card>
  );
}
