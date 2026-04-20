import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inquiryId?: string | null;          // optional pre-link
  inquiries?: { id: string; rfq_number: string; title: string | null }[]; // shown if no inquiryId
  onCreated: () => void;
}

export function NewRfsDialog({ open, onOpenChange, inquiryId, inquiries = [], onCreated }: Props) {
  const [form, setForm] = useState({
    customer_rfq_id: inquiryId || '',
    title: '',
    required_by_date: '',
    requirements: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const reset = () => setForm({ customer_rfq_id: inquiryId || '', title: '', required_by_date: '', requirements: '', notes: '' });

  const close = (v: boolean) => { if (!v) reset(); onOpenChange(v); };

  const create = async () => {
    setSaving(true);
    const { data, error } = await (supabase as any).from('rfs').insert({
      customer_rfq_id: form.customer_rfq_id || null,
      title: form.title.trim() || null,
      required_by_date: form.required_by_date || null,
      requirements: form.requirements.trim() || null,
      notes: form.notes.trim() || null,
    }).select().single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Created ${data.rfs_number}`);
    onCreated();
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Request for Sample (RFS)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {!inquiryId && (
            <div>
              <Label className="text-xs">Link to Inquiry (optional)</Label>
              <Select value={form.customer_rfq_id} onValueChange={v => setForm(f => ({ ...f, customer_rfq_id: v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {inquiries.map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.rfq_number} — {i.title || 'Untitled'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Input placeholder="Title (e.g. Walnut sideboard sample)" value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div>
            <Label className="text-xs">Required by</Label>
            <Input type="date" value={form.required_by_date}
              onChange={e => setForm(f => ({ ...f, required_by_date: e.target.value }))} />
          </div>
          <Textarea placeholder="Requirements" rows={3} value={form.requirements}
            onChange={e => setForm(f => ({ ...f, requirements: e.target.value }))} />
          <Textarea placeholder="Notes" rows={2} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <Button onClick={create} disabled={saving} className="w-full">
            {saving ? 'Creating...' : 'Create RFS'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
