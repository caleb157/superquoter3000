import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: 'rfq' | 'rfs';
  inquiryId: string;
  selectedProductIds: string[];
  onDone: () => void;
};

export function BulkLogRfqRfsDialog({ open, onOpenChange, kind, inquiryId, selectedProductIds, onDone }: Props) {
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setNotes('');
    }
  }, [open]);

  const isRfq = kind === 'rfq';
  const title = isRfq ? 'Log received RFQ' : 'Log received RFS';
  const subtitle = isRfq
    ? `Mark ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} as "costing".`
    : `Auto-create samples for ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} and mark as "sampling".`;

  const save = async () => {
    if (!date) { toast.error('Date required'); return; }
    if (selectedProductIds.length === 0) { toast.error('No products selected'); return; }
    setSaving(true);

    if (isRfq) {
      const { error: logErr } = await (supabase as any)
        .from('inquiry_received_rfqs')
        .insert({ inquiry_id: inquiryId, received_date: date, notes: notes.trim() || null });
      if (logErr) { setSaving(false); toast.error(logErr.message); return; }

      const { error: pErr } = await (supabase as any)
        .from('products')
        .update({ quote_stage: 'quoting' })
        .in('id', selectedProductIds);
      if (pErr) { setSaving(false); toast.error(pErr.message); return; }

      toast.success(`Logged RFQ · ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} → costing`);
    } else {
      const { error: logErr } = await (supabase as any)
        .from('inquiry_received_rfs')
        .insert({ inquiry_id: inquiryId, received_date: date, notes: notes.trim() || null });
      if (logErr) { setSaving(false); toast.error(logErr.message); return; }

      const sampleRows = selectedProductIds.map(pid => ({
        product_id: pid,
        customer_rfq_id: inquiryId,
        status: 'pending',
        requested_date: date,
        notes: notes.trim() || null,
      }));
      const { error: sErr } = await (supabase as any).from('samples').insert(sampleRows);
      if (sErr) { setSaving(false); toast.error(sErr.message); return; }

      const { error: pErr } = await (supabase as any)
        .from('products')
        .update({ sample_stage: 'sampling' })
        .in('id', selectedProductIds);
      if (pErr) { setSaving(false); toast.error(pErr.message); return; }

      toast.success(`Logged RFS · created ${selectedProductIds.length} sample${selectedProductIds.length === 1 ? '' : 's'}`);
    }

    setSaving(false);
    onOpenChange(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Date received</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="text-sm mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
