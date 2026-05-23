import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, ArrowLeft, Copy } from 'lucide-react';
import { CopyProductsDialog } from '@/components/CopyProductsDialog';

type Customer = { id: string; name: string; company: string | null };

const ADD_NEW = '__add_new__';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (inquiryId: string) => void;
  defaultCustomerId?: string;
  defaultStatus?: 'active' | 'projected_po';
}

export function NewInquiryDialog({ open, onOpenChange, onCreated, defaultCustomerId, defaultStatus = 'active' }: Props) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('normal');
  const [requirements, setRequirements] = useState('');
  const [saving, setSaving] = useState(false);
  const [copyAfterCreate, setCopyAfterCreate] = useState(false);
  // Projected-PO quick fields (only shown when defaultStatus === 'projected_po')
  const [projFobUsd, setProjFobUsd] = useState('');
  const [projStartMonth, setProjStartMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [createdInquiryId, setCreatedInquiryId] = useState<string | null>(null);

  // Inline new-customer panel
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', company: '', email: '', phone: '' });
  const [creatingCust, setCreatingCust] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setPriority('normal');
    setRequirements('');
    setShowNewCustomer(false);
    setNewCust({ name: '', company: '', email: '', phone: '' });
    setCustomerId(defaultCustomerId ?? '');
    (async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, company')
        .order('name');
      setCustomers((data ?? []) as Customer[]);
    })();
  }, [open, defaultCustomerId]);

  const handleCustomerChange = (v: string) => {
    if (v === ADD_NEW) {
      setShowNewCustomer(true);
      return;
    }
    setCustomerId(v);
  };

  const createCustomer = async () => {
    const company = newCust.company.trim();
    if (!company) {
      toast.error('Company is required');
      return;
    }
    const contactName = newCust.name.trim();
    setCreatingCust(true);
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: contactName || company,
        company,
        email: newCust.email.trim() || null,
        phone: newCust.phone.trim() || null,
        lead_status: 'active',
      })
      .select('id, name, company')
      .single();
    setCreatingCust(false);
    if (error || !data) {
      toast.error(error?.message ?? 'Failed to create customer');
      return;
    }
    setCustomers(prev => [...prev, data as Customer].sort((a, b) => (a.company || a.name).localeCompare(b.company || b.name)));
    setCustomerId(data.id);
    setShowNewCustomer(false);
    setNewCust({ name: '', company: '', email: '', phone: '' });
  };

  const create = async () => {
    if (!customerId) { toast.error('Please select a customer'); return; }
    setSaving(true);
    const { data, error } = await supabase
      .from('customer_rfqs')
      .insert({
        customer_id: customerId,
        title: title.trim() || null,
        priority,
        requirements: requirements.trim() || null,
      })
      .select('id, rfq_number')
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Inquiry ${data.rfq_number} created`);
    if (copyAfterCreate) {
      // Keep inquiry id, open copy dialog. Navigate after copy completes.
      setCreatedInquiryId(data.id);
    } else {
      onOpenChange(false);
      onCreated?.(data.id);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
        <DialogHeader>
          <DialogTitle>{showNewCustomer ? 'Add Customer' : 'New Inquiry'}</DialogTitle>
          <DialogDescription>
            {showNewCustomer
              ? 'New customer will be saved and selected for this inquiry.'
              : 'Create a new customer inquiry. You can add products right after.'}
          </DialogDescription>
        </DialogHeader>

        {showNewCustomer ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Company *</Label>
              <Input
                value={newCust.company}
                onChange={e => setNewCust(c => ({ ...c, company: e.target.value }))}
                placeholder="Acme Inc."
                autoFocus
              />
            </div>
            <div>
              <Label className="text-xs">Contact name</Label>
              <Input
                value={newCust.name}
                onChange={e => setNewCust(c => ({ ...c, name: e.target.value }))}
                placeholder="Jane Doe"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  value={newCust.email}
                  onChange={e => setNewCust(c => ({ ...c, email: e.target.value }))}
                  placeholder="jane@acme.com"
                />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input
                  value={newCust.phone}
                  onChange={e => setNewCust(c => ({ ...c, phone: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowNewCustomer(false)} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </Button>
              <Button size="sm" onClick={createCustomer} disabled={creatingCust || !newCust.company.trim()}>
                {creatingCust ? 'Saving…' : 'Save customer'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Customer *</Label>
              <Select value={customerId} onValueChange={handleCustomerChange}>
                <SelectTrigger><SelectValue placeholder="Select a customer..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ADD_NEW} className="text-primary font-medium">
                    <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" /> Add new customer…</span>
                  </SelectItem>
                  {customers.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.company ? ` — ${c.company}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Title</Label>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Q2 dining set inquiry"
              />
            </div>
            <div>
              <Label className="text-xs">Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Requirements / Notes</Label>
              <Textarea
                value={requirements}
                onChange={e => setRequirements(e.target.value)}
                placeholder="Optional"
                rows={3}
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer rounded-md border border-dashed p-2.5 hover:bg-muted/40">
              <input
                type="checkbox"
                checked={copyAfterCreate}
                onChange={e => setCopyAfterCreate(e.target.checked)}
                className="h-4 w-4"
              />
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Copy products from an existing inquiry after creating</span>
            </label>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" onClick={create} disabled={saving || !customerId}>
                {saving ? 'Creating…' : 'Create inquiry'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>

    {createdInquiryId && (
      <CopyProductsDialog
        open={!!createdInquiryId}
        onOpenChange={(v) => {
          if (!v) {
            const id = createdInquiryId;
            setCreatedInquiryId(null);
            onOpenChange(false);
            onCreated?.(id);
          }
        }}
        targetInquiryId={createdInquiryId}
      />
    )}
    </>
  );
}
