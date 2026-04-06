import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { Tables } from '@/integrations/supabase/types';
import { STATUS_OPTIONS } from '@/lib/pipeline-helpers';

type PipelineItem = Tables<'pipeline_items'>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: PipelineItem | null;
  onSaved: () => void;
  defaultCustomerId?: string;
  defaultProjectId?: string;
}

export function PipelineItemDialog({ open, onOpenChange, item, onSaved, defaultCustomerId, defaultProjectId }: Props) {
  const [customers, setCustomers] = useState<{ id: string; name: string; company: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: '',
    description: '',
    who: '',
    customer_id: '',
    project_id: '',
    design_done: false,
    photo_done: false,
    rfq_date: '',
    initial_quote_date: '',
    sample_request_date: '',
    initial_sample_date: '',
    final_sample_date: '',
    finish: '',
    dimensions_inch: '',
    weight_kg: '',
    status: 'active',
    is_foak: false,
    notes: '',
  });

  useEffect(() => {
    if (!open) return;
    supabase.from('customers').select('id, name, company').order('name').then(({ data }) => data && setCustomers(data));
    supabase.from('projects').select('id, name').order('name').then(({ data }) => data && setProjects(data));
  }, [open]);

  useEffect(() => {
    if (item) {
      setForm({
        name: item.name,
        description: item.description ?? '',
        who: item.who ?? '',
        customer_id: item.customer_id ?? '',
        project_id: item.project_id ?? '',
        design_done: item.design_done,
        photo_done: item.photo_done,
        rfq_date: item.rfq_date ?? '',
        initial_quote_date: item.initial_quote_date ?? '',
        sample_request_date: item.sample_request_date ?? '',
        initial_sample_date: item.initial_sample_date ?? '',
        final_sample_date: item.final_sample_date ?? '',
        finish: item.finish ?? '',
        dimensions_inch: item.dimensions_inch ?? '',
        weight_kg: item.weight_kg?.toString() ?? '',
        status: item.status,
        is_foak: item.is_foak,
        notes: item.notes ?? '',
      });
    } else {
      setForm({
        name: '', description: '', who: '',
        customer_id: defaultCustomerId ?? '', project_id: defaultProjectId ?? '',
        design_done: false, photo_done: false,
        rfq_date: '', initial_quote_date: '',
        sample_request_date: '', initial_sample_date: '', final_sample_date: '',
        finish: '', dimensions_inch: '', weight_kg: '',
        status: 'active', is_foak: false, notes: '',
      });
    }
  }, [item, open, defaultCustomerId, defaultProjectId]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      who: form.who || null,
      customer_id: form.customer_id || null,
      project_id: form.project_id || null,
      design_done: form.design_done,
      photo_done: form.photo_done,
      rfq_date: form.rfq_date || null,
      initial_quote_date: form.initial_quote_date || null,
      sample_request_date: form.sample_request_date || null,
      initial_sample_date: form.initial_sample_date || null,
      final_sample_date: form.final_sample_date || null,
      finish: form.finish || null,
      dimensions_inch: form.dimensions_inch || null,
      weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
      status: form.status,
      is_foak: form.is_foak,
      notes: form.notes || null,
    };

    let error;
    if (item) {
      ({ error } = await supabase.from('pipeline_items').update(payload).eq('id', item.id));
    } else {
      ({ error } = await supabase.from('pipeline_items').insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(item ? 'Item updated' : 'Item created');
    onSaved();
    onOpenChange(false);
  };

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Pipeline Item' : 'New Pipeline Item'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} />
          </div>

          <div>
            <Label>Customer</Label>
            <Select value={form.customer_id} onValueChange={v => set('customer_id', v)}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Link to Project</Label>
            <Select value={form.project_id} onValueChange={v => set('project_id', v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Who</Label>
            <Input value={form.who} onChange={e => set('who', e.target.value)} placeholder="CQ, PH, etc." />
          </div>

          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => set('status', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={form.design_done} onCheckedChange={v => set('design_done', v)} />
            <Label>Design Done</Label>
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={form.photo_done} onCheckedChange={v => set('photo_done', v)} />
            <Label>Photo Done</Label>
          </div>

          <div>
            <Label>RFQ Date</Label>
            <Input type="date" value={form.rfq_date} onChange={e => set('rfq_date', e.target.value)} />
          </div>

          <div>
            <Label>Initial Quote Date</Label>
            <Input type="date" value={form.initial_quote_date} onChange={e => set('initial_quote_date', e.target.value)} />
          </div>

          <div>
            <Label>Sample Request Date</Label>
            <Input type="date" value={form.sample_request_date} onChange={e => set('sample_request_date', e.target.value)} />
          </div>

          <div>
            <Label>Initial Sample Date</Label>
            <Input type="date" value={form.initial_sample_date} onChange={e => set('initial_sample_date', e.target.value)} />
          </div>

          <div>
            <Label>Final Sample Date</Label>
            <Input type="date" value={form.final_sample_date} onChange={e => set('final_sample_date', e.target.value)} />
          </div>

          <div>
            <Label>Finish</Label>
            <Input value={form.finish} onChange={e => set('finish', e.target.value)} />
          </div>

          <div>
            <Label>Dimensions (inch)</Label>
            <Input value={form.dimensions_inch} onChange={e => set('dimensions_inch', e.target.value)} />
          </div>

          <div>
            <Label>Weight (kg)</Label>
            <Input type="number" value={form.weight_kg} onChange={e => set('weight_kg', e.target.value)} />
          </div>

          <div className="flex items-center gap-3">
            <Switch checked={form.is_foak} onCheckedChange={v => set('is_foak', v)} />
            <Label>First of a Kind (exclude from metrics)</Label>
          </div>

          <div className="col-span-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} />
          </div>

          <div className="col-span-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
