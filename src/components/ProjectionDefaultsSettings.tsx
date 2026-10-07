import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { loadProjectionDefaults } from '@/lib/projection-defaults';

const FIELDS = [
  { col: 'default_certainty_pct', label: 'Default certainty %', help: 'Applied to every open inquiry unless it has its own certainty. Scales projected revenue, cash flow and capacity.' },
  { col: 'default_cust_deposit_pct', label: 'Default customer deposit %', help: 'Customer advance when Parable Ventures sells directly. The rest is paid in the shipping month.' },
  { col: 'default_ie_deposit_pct', label: 'Default inter-entity deposit %', help: 'Advance DKT pays Parable Ventures when DKT is the selling entity. The rest is paid in the shipping month.' },
] as const;

export default function ProjectionDefaultsSettings() {
  const [row, setRow] = useState<any>(null);
  useEffect(() => {
    (supabase as any).from('global_settings').select('id, default_certainty_pct, default_cust_deposit_pct, default_ie_deposit_pct').limit(1).maybeSingle()
      .then(({ data }: any) => setRow(data));
  }, []);

  const save = async (col: string, raw: string) => {
    const v = Math.max(0, Math.min(100, Number(raw) || 0)) / 100;
    if (!row?.id || Number(row[col]) === v) return;
    const { error } = await (supabase as any).from('global_settings').update({ [col]: v }).eq('id', row.id);
    if (error) return toast.error(error.message);
    setRow({ ...row, [col]: v });
    await loadProjectionDefaults(true);
    toast.success('Saved');
  };

  if (!row) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Projections defaults</CardTitle>
        <CardDescription>Used by the analytics projections and as starting values in each inquiry's Projections tab. Any inquiry can override them.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-3">
        {FIELDS.map(f => (
          <div key={f.col} className="space-y-1.5">
            <Label className="text-xs">{f.label}</Label>
            <Input type="number" min={0} max={100} step={1} defaultValue={Math.round(Number(row[f.col]) * 100)} onBlur={e => save(f.col, e.target.value)} className="h-9" />
            <p className="text-[11px] text-muted-foreground">{f.help}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
