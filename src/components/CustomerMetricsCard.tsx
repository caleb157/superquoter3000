import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, Trophy, TrendingDown, Users } from 'lucide-react';

type Customer = { id: string; lead_status: string; created_at: string | null };

interface Props {
  customers: Customer[];
}

/**
 * Cycle time = days from customer created_at → today,
 * for customers that reached a terminal state (won / churned / inactive).
 * It's an approximation since we don't track per-status timestamps yet.
 */
export function CustomerMetricsCard({ customers }: Props) {
  const stats = useMemo(() => {
    const terminal = customers.filter(c =>
      ['won', 'churned', 'inactive'].includes(c.lead_status) && c.created_at
    );
    const wonCustomers = customers.filter(c => c.lead_status === 'won' && c.created_at);
    const lostCustomers = customers.filter(c => ['churned', 'inactive'].includes(c.lead_status) && c.created_at);

    const daysFor = (list: Customer[]) => {
      if (list.length === 0) return null;
      const totalMs = list.reduce((acc, c) => {
        const created = new Date(c.created_at!).getTime();
        return acc + (Date.now() - created);
      }, 0);
      return Math.round(totalMs / list.length / (1000 * 60 * 60 * 24));
    };

    const totalLeads = customers.length;
    const wonCount = wonCustomers.length;
    const conversionRate = totalLeads > 0 ? Math.round((wonCount / totalLeads) * 100) : 0;

    return {
      avgCycle: daysFor(terminal),
      avgWonCycle: daysFor(wonCustomers),
      avgLostCycle: daysFor(lostCustomers),
      totalLeads,
      wonCount,
      conversionRate,
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
          {tile(
            <Users className="h-4 w-4" />,
            'Total Customers',
            String(stats.totalLeads),
            `${stats.wonCount} won`
          )}
          {tile(
            <Trophy className="h-4 w-4 text-emerald-600" />,
            'Conversion',
            `${stats.conversionRate}%`,
            'leads → won'
          )}
          {tile(
            <Clock className="h-4 w-4 text-blue-600" />,
            'Avg cycle (won)',
            stats.avgWonCycle != null ? `${stats.avgWonCycle}d` : '—',
            'lead → won'
          )}
          {tile(
            <TrendingDown className="h-4 w-4 text-amber-600" />,
            'Avg cycle (lost)',
            stats.avgLostCycle != null ? `${stats.avgLostCycle}d` : '—',
            'lead → churned/inactive'
          )}
        </div>
      </CardContent>
    </Card>
  );
}
