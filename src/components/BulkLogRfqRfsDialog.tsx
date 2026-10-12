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
  inquiryId: string;
  selectedProductIds: string[];
  onDone: () => void;
};

/** Logs a customer's request for samples (RFS) as a sample request with a line per selected product. */
export function BulkLogRfqRfsDialog({ open, onOpenChange, inquiryId, selectedProductIds, onDone }: Props) {
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(new Date().toISOString().slice(0, 10));
      setNotes('');
    }
  }, [open]);

  const title = 'Log received RFS';
  const subtitle = `Create a sample request for ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}, dated when the customer asked.`;

  const save = async () => {
    if (!date) { toast.error('Date required'); return; }
    if (selectedProductIds.length === 0) { toast.error('No products selected'); return; }
    setSaving(true);

    // The customer's sample request becomes a sample request with a line per product;
    // product sample stages follow the lines automatically.
    const { data: req, error: rErr } = await (supabase as any).from('sample_requests')
      .insert({ customer_rfq_id: inquiryId, customer_requested_date: date, requested_date: date, notes: notes.trim() || null })
      .select('id').single();
    if (rErr) { setSaving(false); toast.error(rErr.message); return; }

    const sampleRows = selectedProductIds.map(pid => ({
      request_id: req.id,
      product_id: pid,
      customer_rfq_id: inquiryId,
      status: 'pending',
      requested_date: date,
    }));
    const { error: sErr } = await (supabase as any).from('samples').insert(sampleRows);
    if (sErr) { setSaving(false); toast.error(sErr.message); return; }

    toast.success(`Logged RFS · sample request with ${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}`);

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
