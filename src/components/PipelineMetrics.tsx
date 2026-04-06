import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { daysBetween, type PipelineItem } from '@/lib/pipeline-helpers';

interface Props {
  items: PipelineItem[];
  customers: Record<string, string>;
}

function getQuarter(dateStr: string): string {
  const d = new Date(dateStr);
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()} Q${q}`;
}

export function PipelineMetrics({ items, customers }: Props) {
  const years = useMemo(() => {
    const s = new Set<string>();
    items.forEach(i => { if (i.rfq_date) s.add(i.rfq_date.slice(0, 4)); });
    return Array.from(s).sort();
  }, [items]);

  const [filterYear, setFilterYear] = useState<string>('all');
  const [filterCustomer, setFilterCustomer] = useState<string>('all');

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (i.is_foak) return false;
      if (filterYear !== 'all' && (!i.rfq_date || !i.rfq_date.startsWith(filterYear))) return false;
      if (filterCustomer !== 'all' && i.customer_id !== filterCustomer) return false;
      return true;
    });
  }, [items, filterYear, filterCustomer]);

  const quarterData = useMemo(() => {
    const qMap: Record<string, { quote: number[]; initialSample: number[]; finalSample: number[] }> = {};
    filtered.forEach(i => {
      if (!i.rfq_date) return;
      const q = getQuarter(i.rfq_date);
      if (!qMap[q]) qMap[q] = { quote: [], initialSample: [], finalSample: [] };
      const dtq = daysBetween(i.rfq_date, i.initial_quote_date);
      if (dtq !== null) qMap[q].quote.push(dtq);
      const dis = daysBetween(i.rfq_date, i.initial_sample_date);
      if (dis !== null) qMap[q].initialSample.push(dis);
      const dfs = daysBetween(i.rfq_date, i.final_sample_date);
      if (dfs !== null) qMap[q].finalSample.push(dfs);
    });
    return Object.entries(qMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([q, v]) => ({
        quarter: q,
        'Avg Days to Quote': v.quote.length ? Math.round(v.quote.reduce((a, b) => a + b, 0) / v.quote.length) : 0,
        'Avg Days to Initial Sample': v.initialSample.length ? Math.round(v.initialSample.reduce((a, b) => a + b, 0) / v.initialSample.length) : 0,
        'Avg Days to Final Sample': v.finalSample.length ? Math.round(v.finalSample.reduce((a, b) => a + b, 0) / v.finalSample.length) : 0,
      }));
  }, [filtered]);

  const whoData = useMemo(() => {
    const wMap: Record<string, number[]> = {};
    filtered.forEach(i => {
      const who = i.who || 'Unknown';
      if (!wMap[who]) wMap[who] = [];
      const dtq = daysBetween(i.rfq_date, i.initial_quote_date);
      if (dtq !== null) wMap[who].push(dtq);
    });
    return Object.entries(wMap).map(([who, vals]) => ({
      who,
      'Avg Days to Quote': vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
      count: vals.length,
    }));
  }, [filtered]);

  const uniqueCustomers = useMemo(() => {
    const ids = new Set(items.map(i => i.customer_id).filter(Boolean) as string[]);
    return Array.from(ids).map(id => ({ id, name: customers[id] || id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [items, customers]);

  return (
    <div className="space-y-6">
      <div className="flex gap-3">
        <Select value={filterYear} onValueChange={setFilterYear}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Year" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCustomer} onValueChange={setFilterCustomer}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Customer" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Customers</SelectItem>
            {uniqueCustomers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Response Time by Quarter</CardTitle></CardHeader>
        <CardContent>
          {quarterData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={quarterData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="quarter" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: 'Days', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Avg Days to Quote" fill="hsl(var(--primary))" />
                <Bar dataKey="Avg Days to Initial Sample" fill="hsl(var(--secondary))" />
                <Bar dataKey="Avg Days to Final Sample" fill="hsl(var(--accent))" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No data for selected filters</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Performance by Person</CardTitle></CardHeader>
        <CardContent>
          {whoData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={whoData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="who" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="Avg Days to Quote" fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No data</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
