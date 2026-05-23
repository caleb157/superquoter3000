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
    if (defaultStatus === 'projected_po') {
      if (!projFobUsd || Number(projFobUsd) <= 0) { toast.error('Projected FOB revenue is required'); return; }
      if (!projStartMonth) { toast.error('Start month is required'); return; }
    }
    setSaving(true);
    const { data, error } = await supabase
      .from('customer_rfqs')
      .insert({
        customer_id: customerId,
        title: title.trim() || null,
        priority,
        status: defaultStatus,
        requirements: requirements.trim() || null,
      })
      .select('id, rfq_number')
      .single();
    if (error || !data) { setSaving(false); toast.error(error?.message ?? 'Failed'); return; }
    if (defaultStatus === 'projected_po') {
      const { suggestDefaultMonths } = await import('@/lib/projections');
      const months = suggestDefaultMonths('sea');
      const startDate = `${projStartMonth}-01`;
      await (supabase as any).from('inquiry_projections').insert({
        inquiry_id: data.id,
        projected_fob_revenue_usd: Number(projFobUsd),
        start_month: startDate,
        shipping_month: months.shipping_month,
        delivery_month: months.delivery_month,
      });
    }
    setSaving(false);
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
          <DialogTitle>{showNewCustomer ? 'Add Customer' : defaultStatus === 'projected_po' ? 'New Projected PO' : 'New Inquiry'}</DialogTitle>
          <DialogDescription>
            {showNewCustomer
              ? 'New customer will be saved and selected for this inquiry.'
              : defaultStatus === 'projected_po'
                ? 'Forecast a repeat order before the PO is signed. You can flesh out details on the Projection tab.'
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
            {defaultStatus === 'projected_po' && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-teal-300 dark:border-teal-700/50 bg-teal-50 dark:bg-teal-500/10 p-3">
                <div className="col-span-2 text-xs font-medium text-teal-800 dark:text-teal-300">Projection (minimum)</div>
                <div>
                  <Label className="text-xs">Projected FOB (USD) *</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={projFobUsd}
                    onChange={e => setProjFobUsd(e.target.value)}
                    placeholder="50000"
                  />
                </div>
                <div>
                  <Label className="text-xs">Start month *</Label>
                  <Input
                    type="month"
                    value={projStartMonth}
                    onChange={e => setProjStartMonth(e.target.value)}
                  />
                </div>
              </div>
            )}
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
                {saving ? 'Creating…' : defaultStatus === 'projected_po' ? 'Create projected PO' : 'Create inquiry'}
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
