import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { Plus, ArrowLeft, ChevronDown } from 'lucide-react';
import { defaultDurationMonths, deriveScheduleMonths } from '@/lib/projections';

type Customer = { id: string; name: string; company: string | null };
type Entity = { id: string; name: string };
type Mode = 'active' | 'projected_po';
type ShipMethod = 'sea' | 'air' | 'ground';

const ADD_NEW = '__add_new__';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (inquiryId: string) => void;
  defaultCustomerId?: string;
  defaultMode?: Mode;
  /** @deprecated use defaultMode */
  defaultStatus?: Mode;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function CreateInquiryDialog({
  open, onOpenChange, onCreated, defaultCustomerId,
  defaultMode, defaultStatus,
}: Props) {
  const initialMode: Mode = defaultMode ?? defaultStatus ?? 'active';
  const [mode, setMode] = useState<Mode>(initialMode);

  // Shared fields
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [sellingEntityId, setSellingEntityId] = useState<string>('');
  const [producingEntityId, setProducingEntityId] = useState<string>('');
  const [producingTouched, setProducingTouched] = useState(false);
  const [certainty, setCertainty] = useState<string>('');
  const [startMonth, setStartMonth] = useState<string>(currentMonth());
  const [shipMethod, setShipMethod] = useState<ShipMethod>('sea');
  const [duration, setDuration] = useState<string>(String(defaultDurationMonths('sea')));
  const [durationTouched, setDurationTouched] = useState(false);
  const [payingShipping, setPayingShipping] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Projected-PO fields
  const [projFobUsd, setProjFobUsd] = useState('');
  const [projGpmPct, setProjGpmPct] = useState('');

  // Inline new-customer panel
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCust, setNewCust] = useState({ name: '', company: '', email: '', phone: '' });
  const [creatingCust, setCreatingCust] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(defaultMode ?? defaultStatus ?? 'active');
    setTitle('');
    setCustomerId(defaultCustomerId ?? '');
    setShowNewCustomer(false);
    setNewCust({ name: '', company: '', email: '', phone: '' });
    setStartMonth(currentMonth());
    setShipMethod('sea');
    setDuration(String(defaultDurationMonths('sea')));
    setDurationTouched(false);
    setPayingShipping(false);
    setProducingTouched(false);
    setAdvancedOpen(false);
    setProjFobUsd('');
    setProjGpmPct('');
    (async () => {
      const [{ data: cust }, { data: ent }] = await Promise.all([
        supabase.from('customers').select('id, name, company').order('name'),
        supabase.from('company_entities').select('id, name').order('name'),
      ]);
      setCustomers((cust ?? []) as Customer[]);
      setEntities((ent ?? []) as Entity[]);
      const firstEntity = ent?.[0]?.id ?? '';
      setSellingEntityId(firstEntity);
      setProducingEntityId(firstEntity);
    })();
  }, [open, defaultCustomerId, defaultMode, defaultStatus]);

  // Default certainty per mode (only when not touched)
  useEffect(() => {
    setCertainty(mode === 'projected_po' ? '75' : '');
  }, [mode]);

  // Mirror producing entity to selling unless user expanded & changed it
  useEffect(() => {
    if (!producingTouched) setProducingEntityId(sellingEntityId);
  }, [sellingEntityId, producingTouched]);

  // Auto-adjust duration when ship method changes, unless user typed
  useEffect(() => {
    if (!durationTouched) setDuration(String(defaultDurationMonths(shipMethod)));
  }, [shipMethod, durationTouched]);

  const handleCustomerChange = (v: string) => {
    if (v === ADD_NEW) { setShowNewCustomer(true); return; }
    setCustomerId(v);
  };

  const createCustomer = async () => {
    const company = newCust.company.trim();
    if (!company) { toast.error('Company is required'); return; }
    setCreatingCust(true);
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: newCust.name.trim() || company,
        company,
        email: newCust.email.trim() || null,
        phone: newCust.phone.trim() || null,
        lead_status: 'active',
      })
      .select('id, name, company')
      .single();
    setCreatingCust(false);
    if (error || !data) { toast.error(error?.message ?? 'Failed to create customer'); return; }
    setCustomers(prev => [...prev, data as Customer].sort(
      (a, b) => (a.company || a.name).localeCompare(b.company || b.name),
    ));
    setCustomerId(data.id);
    setShowNewCustomer(false);
    setNewCust({ name: '', company: '', email: '', phone: '' });
  };

  const canSubmit = useMemo(() => {
    if (!customerId) return false;
    if (!startMonth) return false;
    if (mode === 'projected_po') {
      if (!projFobUsd || Number(projFobUsd) <= 0) return false;
    }
    return true;
  }, [customerId, startMonth, mode, projFobUsd]);

  const create = async () => {
    if (!canSubmit) {
      if (!customerId) toast.error('Please select a customer');
      else if (mode === 'projected_po' && (!projFobUsd || Number(projFobUsd) <= 0))
        toast.error('Estimated FOB revenue is required');
      else toast.error('Start month is required');
      return;
    }
    setSaving(true);

    // 1. Inquiry
    const { data: inq, error: inqErr } = await supabase
      .from('customer_rfqs')
      .insert({
        customer_id: customerId,
        title: title.trim() || null,
        priority: 'normal',
        status: mode,
      })
      .select('id, rfq_number, title')
      .single();
    if (inqErr || !inq) { setSaving(false); toast.error(inqErr?.message ?? 'Failed to create inquiry'); return; }

    // 2. Projection
    const startDate = `${startMonth}-01`;
    const durNum = Math.max(0, Number(duration || 0));
    const schedule = deriveScheduleMonths(startDate, durNum) ?? {};
    const certNum = certainty.trim() === '' ? null : Math.max(0, Math.min(100, Number(certainty))) / 100;
    const fobNum = projFobUsd.trim() === '' ? null : Number(projFobUsd);
    const gpmNum = projGpmPct.trim() === '' ? null : Math.max(0, Math.min(100, Number(projGpmPct))) / 100;

    const { error: projErr } = await (supabase as any)
      .from('inquiry_projections')
      .insert({
        inquiry_id: inq.id,
        selling_entity_id: sellingEntityId || null,
        producing_entity_id: producingEntityId || sellingEntityId || null,
        certainty_override: certNum,
        start_month: startDate,
        duration_months: durNum || null,
        shipping_method: shipMethod,
        paying_shipping: payingShipping,
        projected_fob_revenue_usd: mode === 'projected_po' ? fobNum : null,
        project_gpm: mode === 'projected_po' ? gpmNum : null,
        ...schedule,
      });

    setSaving(false);

    const label = inq.title || inq.rfq_number;
    if (projErr) {
      toast.warning(`Inquiry ${label} created, but projection failed: ${projErr.message}. Fill it in on the Projection tab.`);
    } else {
      toast.success(`Created ${label}`);
    }
    onOpenChange(false);
    onCreated?.(inq.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto mx-2 sm:mx-auto">
        <DialogHeader>
          <DialogTitle>
            {showNewCustomer ? 'Add Customer' : 'Create Inquiry'}
          </DialogTitle>
          <DialogDescription>
            {showNewCustomer
              ? 'New customer will be saved and selected for this inquiry.'
              : 'Spin up an inquiry with a scaffolded projection. Add products and refine on the detail page.'}
          </DialogDescription>
        </DialogHeader>

        {showNewCustomer ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Company *</Label>
              <Input value={newCust.company} onChange={e => setNewCust(c => ({ ...c, company: e.target.value }))} placeholder="Acme Inc." autoFocus />
            </div>
            <div>
              <Label className="text-xs">Contact name</Label>
              <Input value={newCust.name} onChange={e => setNewCust(c => ({ ...c, name: e.target.value }))} placeholder="Jane Doe" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Email</Label>
                <Input value={newCust.email} onChange={e => setNewCust(c => ({ ...c, email: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={newCust.phone} onChange={e => setNewCust(c => ({ ...c, phone: e.target.value }))} />
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
            {/* Mode toggle */}
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as Mode)}
              className="grid grid-cols-2 gap-2"
            >
              <label className={`flex items-center gap-2 rounded-md border p-2.5 text-sm cursor-pointer ${mode === 'active' ? 'border-primary bg-primary/5' : 'border-input'}`}>
                <RadioGroupItem value="active" />
                <span>New inquiry</span>
              </label>
              <label className={`flex items-center gap-2 rounded-md border p-2.5 text-sm cursor-pointer ${mode === 'projected_po' ? 'border-primary bg-primary/5' : 'border-input'}`}>
                <RadioGroupItem value="projected_po" />
                <span>Projected PO</span>
              </label>
            </RadioGroup>

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
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Q2 dining set" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Selling entity</Label>
                <Select value={sellingEntityId} onValueChange={setSellingEntityId}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    {entities.map(e => (
                      <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Certainty %</Label>
                <Input
                  type="number" inputMode="decimal" min={0} max={100}
                  value={certainty} onChange={e => setCertainty(e.target.value)}
                  placeholder={mode === 'projected_po' ? '75' : 'auto'}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Start month *</Label>
                <Input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Duration (months)</Label>
                <Input
                  type="number" inputMode="numeric" min={0}
                  value={duration}
                  onChange={e => { setDurationTouched(true); setDuration(e.target.value); }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 items-end">
              <div>
                <Label className="text-xs">Ship method</Label>
                <Select value={shipMethod} onValueChange={(v) => setShipMethod(v as ShipMethod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sea">Sea</SelectItem>
                    <SelectItem value="air">Air</SelectItem>
                    <SelectItem value="ground">Ground</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 rounded-md border border-input p-2.5 text-sm cursor-pointer h-10">
                <Switch checked={payingShipping} onCheckedChange={setPayingShipping} />
                <span>We pay shipping</span>
              </label>
            </div>

            {mode === 'projected_po' && (
              <div className="grid grid-cols-2 gap-2 rounded-md border border-teal-300 dark:border-teal-700/50 bg-teal-50 dark:bg-teal-500/10 p-3">
                <div className="col-span-2 text-xs font-medium text-teal-800 dark:text-teal-300">
                  Estimate (no products needed)
                </div>
                <div>
                  <Label className="text-xs">Estimated FOB (USD) *</Label>
                  <Input
                    type="number" inputMode="decimal"
                    value={projFobUsd} onChange={e => setProjFobUsd(e.target.value)}
                    placeholder="50000"
                  />
                </div>
                <div>
                  <Label className="text-xs">GPM %</Label>
                  <Input
                    type="number" inputMode="decimal" min={0} max={100}
                    value={projGpmPct} onChange={e => setProjGpmPct(e.target.value)}
                    placeholder="optional"
                  />
                </div>
              </div>
            )}

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
                Advanced
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div>
                  <Label className="text-xs">Producing entity</Label>
                  <Select
                    value={producingEntityId}
                    onValueChange={(v) => { setProducingTouched(true); setProducingEntityId(v); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {entities.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">Defaults to selling entity.</p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" onClick={create} disabled={saving || !canSubmit}>
                {saving ? 'Creating…' : mode === 'projected_po' ? 'Create projected PO' : 'Create inquiry'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
