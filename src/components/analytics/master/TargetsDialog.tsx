import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export type KpiTargets = {
  confirmed_sos_monthly: number; revenue_usd_monthly: number; rfq_days: number;
  sample_days: number; otd_pct: number; complaints_monthly: number;
};
export const DEFAULT_TARGETS: KpiTargets = { confirmed_sos_monthly: 15, revenue_usd_monthly: 250000, rfq_days: 3, sample_days: 14, otd_pct: 95, complaints_monthly: 2 };

export function useKpiTargets() {
  const [id, setId] = useState<string | null>(null);
  const [targets, setTargets] = useState<KpiTargets>(DEFAULT_TARGETS);
  useEffect(() => {
    (supabase as any).from('global_settings').select('id, analytics_targets').limit(1).maybeSingle().then(({ data }: any) => {
      if (!data) return;
      setId(data.id); setTargets({ ...DEFAULT_TARGETS, ...(data.analytics_targets || {}) });
    });
  }, []);
  const save = async (t: KpiTargets) => {
    setTargets(t);
    if (!id) return;
    const { error } = await (supabase as any).from('global_settings').update({ analytics_targets: t }).eq('id', id);
    if (error) toast.error(error.message); else toast.success('Targets saved');
  };
  return { targets, save };
}

const FIELDS: { k: keyof KpiTargets; label: string; hint: string }[] = [
  { k: 'confirmed_sos_monthly', label: 'Confirmed SOs per month', hint: 'scaled to the date range' },
  { k: 'revenue_usd_monthly', label: 'Booked revenue per month (USD)', hint: 'scaled; shown in ₹ when INR is selected' },
  { k: 'rfq_days', label: 'RFQ → quote, max days', hint: 'average' },
  { k: 'sample_days', label: 'Sample cycle, max days', hint: 'median' },
  { k: 'otd_pct', label: 'On-time delivery, min %', hint: '' },
  { k: 'complaints_monthly', label: 'Complaints per month, max', hint: 'scaled to the date range' },
];

export function TargetsDialog({ open, onOpenChange, targets, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; targets: KpiTargets; onSave: (t: KpiTargets) => void }) {
  const [draft, setDraft] = useState(targets);
  useEffect(() => { if (open) setDraft(targets); }, [open, targets]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>KPI targets</DialogTitle>
          <DialogDescription>Monthly goals scale automatically to the selected date range.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {FIELDS.map(f => (
            <div key={f.k} className="grid grid-cols-[1fr_120px] items-center gap-3">
              <Label className="text-sm">{f.label}{f.hint && <span className="block text-[11px] text-muted-foreground font-normal">{f.hint}</span>}</Label>
              <Input type="number" value={draft[f.k]} onChange={e => setDraft({ ...draft, [f.k]: Number(e.target.value) || 0 })} className="h-8 text-right" />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onSave(draft); onOpenChange(false); }}>Save targets</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
