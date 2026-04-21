import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

type Customer = { id: string; name: string; company: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCustomerId?: string | null;
  onCreated?: (inquiry: { id: string; rfq_number: string }) => void;
};

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export function NewInquiryDialog({ open, onOpenChange, defaultCustomerId, onCreated }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>(defaultCustomerId || '');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('normal');
  const [requirements, setRequirements] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(defaultCustomerId || '');
    setTitle('');
    setPriority('normal');
    setRequirements('');
    (async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, company')
        .order('name');
      setCustomers((data ?? []) as Customer[]);
    })();
  }, [open, defaultCustomerId]);

  const handleCreate = async () => {
    if (!customerId) { toast.error('Pick a customer'); return; }
    setBusy(true);
    try {
      const { data, error } = await (supabase as any)
        .from('customer_rfqs')
        .insert({
          customer_id: customerId,
          title: title.trim() || null,
          priority,
          requirements: requirements.trim() || null,
          status: 'active',
        })
        .select('id, rfq_number')
        .single();
      if (error) throw error;
      toast.success(`Created ${data.rfq_number}`);
      onCreated?.(data);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to create inquiry');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Inquiry</DialogTitle>
          <DialogDescription>Create a new customer inquiry. You can add products right after.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Customer *</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select a customer..." /></SelectTrigger>
              <SelectContent>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}{c.company ? ` · ${c.company}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              className="h-9"
              placeholder="e.g. Q2 dining set inquiry"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as any)}>
              <SelectTrigger className="h-9 capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Requirements / notes</Label>
            <Textarea
              rows={3}
              placeholder="Optional — paste customer requirements, target dates, etc."
              value={requirements}
              onChange={e => setRequirements(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleCreate} disabled={busy || !customerId}>
            {busy ? 'Creating…' : 'Create inquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
