import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiryId: string;
  selectedProducts: { id: string; name: string; sample_stage?: string | null }[];
  onCreated: () => void;
};

export function NewSampleBatchDialog({ open, onOpenChange, inquiryId, selectedProducts, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [notes, setNotes] = useState('');
  const [finishes, setFinishes] = useState('');
  const [vendors, setVendors] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(''); setRequiredBy(''); setNotes(''); setFinishes(''); setVendors('');
    }
  }, [open]);

  const submit = async () => {
    if (selectedProducts.length === 0) { toast.error('No products selected'); return; }
    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const { data: rfs, error: rfsErr } = await (supabase as any).from('rfs').insert({
      customer_rfq_id: inquiryId,
      title: title.trim() || null,
      required_by_date: requiredBy || null,
      notes: notes.trim() || null,
      finishes_used: finishes.trim() || null,
      vendors_used: vendors.trim() || null,
      status: 'pending',
      requested_date: today,
    }).select().single();

    if (rfsErr || !rfs) { setSaving(false); toast.error(rfsErr?.message ?? 'Failed to create batch'); return; }

    const sampleRows = selectedProducts.map(p => ({
      rfs_id: rfs.id, product_id: p.id, status: 'requested', requested_date: today,
    }));
    const { error: sErr } = await (supabase as any).from('samples').insert(sampleRows);
    if (sErr) { setSaving(false); toast.error(sErr.message); return; }

    const flipIds = selectedProducts.filter(p => p.sample_stage !== 'sample_sent').map(p => p.id);
    if (flipIds.length) {
      await supabase.from('products').update({ sample_stage: 'sampling' }).in('id', flipIds);
    }

    setSaving(false);
    toast.success(`Sample batch created with ${selectedProducts.length} products`);
    onCreated();
    onOpenChange(false);
  };

  const preview = selectedProducts.slice(0, 3).map(p => p.name).join(', ');
  const more = selectedProducts.length > 3 ? ` and ${selectedProducts.length - 3} more` : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New sample batch</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/40 p-3 text-xs">
            <div className="font-medium">{selectedProducts.length} products in this batch</div>
            <div className="text-muted-foreground mt-0.5 truncate">{preview}{more}</div>
          </div>
          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Required by</Label>
            <Input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="text-sm mt-1" rows={2} />
          </div>
          <div>
            <Label className="text-xs">Finishes used</Label>
            <Textarea value={finishes} onChange={e => setFinishes(e.target.value)} className="text-sm mt-1" rows={2} />
          </div>
          <div>
            <Label className="text-xs">Vendors used</Label>
            <Textarea value={vendors} onChange={e => setVendors(e.target.value)} className="text-sm mt-1" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Batch'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
