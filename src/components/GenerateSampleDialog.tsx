import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Product = {
  id: string;
  name: string;
  quantity: number | null;
  sample_stage: string | null;
};

type InquiryOption = { id: string; rfq_number: string; title: string | null };
type Vendor = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiryId?: string;
  inquiryNumber?: string;
  preSelectedProductIds?: string[];
  inquiryOptions?: InquiryOption[];
  onCreated: () => void;
};

type Step = 'pick_inquiry' | 'select' | 'details';

export function GenerateSampleDialog({
  open, onOpenChange, inquiryId: propInquiryId, inquiryNumber, preSelectedProductIds, inquiryOptions, onCreated,
}: Props) {
  const initialStep: Step = (() => {
    if (propInquiryId && preSelectedProductIds && preSelectedProductIds.length > 0) return 'details';
    if (propInquiryId) return 'select';
    if (inquiryOptions && inquiryOptions.length > 0) return 'pick_inquiry';
    return 'select';
  })();

  const [step, setStep] = useState<Step>(initialStep);
  const [activeInquiryId, setActiveInquiryId] = useState<string>(propInquiryId ?? '');
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [vendorName, setVendorName] = useState<string>('');
  const [dimensions, setDimensions] = useState('');
  const [finish, setFinish] = useState('');
  const [notes, setNotes] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(initialStep);
    setActiveInquiryId(propInquiryId ?? '');
    setVendorId(''); setVendorName('');
    setDimensions(''); setFinish(''); setNotes(''); setRequiredBy('');
    setSelected(new Set(preSelectedProductIds ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: v } = await supabase.from('vendors').select('id, name').order('name');
      setVendors((v as Vendor[]) ?? []);
      if (!activeInquiryId) { setProducts([]); return; }
      const { data } = await supabase
        .from('products')
        .select('id, name, quantity, sample_stage')
        .eq('customer_rfq_id', activeInquiryId)
        .order('name');
      setProducts((data ?? []) as Product[]);
    })();
  }, [open, activeInquiryId]);

  const allSelected = products.length > 0 && products.every(p => selected.has(p.id));
  const toggleAll = (v: boolean) => setSelected(v ? new Set(products.map(p => p.id)) : new Set());
  const toggleOne = (id: string, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const chosen: { id: string; name: string; sample_stage: string | null }[] = (() => {
    if (preSelectedProductIds && preSelectedProductIds.length > 0 && products.length === 0) {
      return preSelectedProductIds.map(id => ({ id, name: id, sample_stage: null }));
    }
    return products.filter(p => selected.has(p.id));
  })();

  const submit = async () => {
    if (!activeInquiryId) { toast.error('Select an inquiry first'); return; }
    if (chosen.length === 0) { toast.error('No products selected'); return; }
    setSaving(true);

    let finalVendorId = vendorId || null;
    const overrideName = vendorName.trim();
    if (!finalVendorId && overrideName) {
      const existing = vendors.find(v => v.name.toLowerCase() === overrideName.toLowerCase());
      if (existing) {
        finalVendorId = existing.id;
      } else {
        const { data: nv, error: vErr } = await supabase
          .from('vendors').insert({ name: overrideName, category: 'sampling' }).select('id, name').single();
        if (vErr) { setSaving(false); toast.error('Could not create vendor: ' + vErr.message); return; }
        finalVendorId = nv!.id;
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const sampleRows = chosen.map(p => ({
      product_id: p.id,
      customer_rfq_id: activeInquiryId,
      vendor_id: finalVendorId,
      status: 'pending',
      requested_date: today,
      dimensions_inch: dimensions.trim() || null,
      finish: finish.trim() || null,
      notes: notes.trim() || null,
      required_by_date: requiredBy || null,
    }));

    const { error: sErr } = await (supabase as any).from('samples').insert(sampleRows);
    if (sErr) { setSaving(false); toast.error(sErr.message); return; }

    const flipIds = chosen.filter(p => p.sample_stage !== 'sampling').map(p => p.id);
    if (flipIds.length) {
      await supabase.from('products').update({ sample_stage: 'sampling' }).in('id', flipIds);
    }

    setSaving(false);
    toast.success(`Created ${chosen.length} sample${chosen.length === 1 ? '' : 's'}`);
    onCreated();
    onOpenChange(false);
  };

  const preview = chosen.slice(0, 3).map(p => p.name).join(', ');
  const more = chosen.length > 3 ? ` and ${chosen.length - 3} more` : '';
  const titleNoun = chosen.length === 1 ? 'Sample' : 'Samples';

  const stepLabel = (() => {
    if (step === 'pick_inquiry') return 'Step 1 of 3 · Select inquiry';
    if (step === 'select') return inquiryOptions ? 'Step 2 of 3 · Select products' : 'Step 1 of 2 · Select products';
    return inquiryOptions ? 'Step 3 of 3 · Sample details' : 'Step 2 of 2 · Sample details';
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Generate {titleNoun}{inquiryNumber ? ` — ${inquiryNumber}` : ''}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{stepLabel}</p>
        </DialogHeader>

        {step === 'pick_inquiry' && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Inquiry</Label>
              <Select value={activeInquiryId} onValueChange={setActiveInquiryId}>
                <SelectTrigger><SelectValue placeholder="Pick an inquiry…" /></SelectTrigger>
                <SelectContent>
                  {(inquiryOptions ?? []).map(i => (
                    <SelectItem key={i.id} value={i.id}>{i.rfq_number} — {i.title || 'Untitled'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={() => setStep('select')} disabled={!activeInquiryId}>Next →</Button>
            </DialogFooter>
          </>
        )}

        {step === 'select' && (
          <>
            <div className="space-y-1 max-h-[50vh] overflow-y-auto">
              {products.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">No products in this inquiry.</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground border-b">
                    <Checkbox checked={allSelected} onCheckedChange={(v) => toggleAll(!!v)} />
                    <span className="flex-1">Select all / none</span>
                  </div>
                  {products.map(p => {
                    const isSampling = p.sample_stage === 'sampling';
                    return (
                      <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 rounded cursor-pointer">
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggleOne(p.id, !!v)} />
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{p.quantity ?? 0}</span>
                        {isSampling && <Badge variant="secondary" className="text-[10px] bg-amber-100 text-amber-700">sampling</Badge>}
                      </label>
                    );
                  })}
                </>
              )}
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <div className="flex gap-2">
                {inquiryOptions && (
                  <Button variant="ghost" onClick={() => setStep('pick_inquiry')}>← Back</Button>
                )}
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={() => setStep('details')} disabled={selected.size === 0}>Next →</Button>
              </div>
            </DialogFooter>
          </>
        )}

        {step === 'details' && (
          <>
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">{chosen.length} product{chosen.length === 1 ? '' : 's'} · same details applied to each</div>
                <div className="text-muted-foreground mt-0.5 truncate">{preview}{more}</div>
              </div>

              <div>
                <Label className="text-xs">Vendor (applied to all)</Label>
                <VendorCombobox
                  vendors={vendors}
                  vendorId={vendorId}
                  vendorName={vendorName}
                  onChange={(id, name) => { setVendorId(id); setVendorName(name); }}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Optional. Pick or type a new name to create a vendor on save.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Dimensions</Label>
                  <Input value={dimensions} onChange={e => setDimensions(e.target.value)} className="h-9 mt-1" placeholder='e.g. 12 x 8 x 4"' />
                </div>
                <div>
                  <Label className="text-xs">Finish</Label>
                  <Input value={finish} onChange={e => setFinish(e.target.value)} className="h-9 mt-1" />
                </div>
              </div>

              <div>
                <Label className="text-xs">Required by</Label>
                <Input type="date" value={requiredBy} onChange={e => setRequiredBy(e.target.value)} className="h-9 mt-1" />
              </div>

              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="text-sm mt-1" rows={2} />
              </div>
            </div>
            <DialogFooter>
              {!(preSelectedProductIds && preSelectedProductIds.length > 0) && (
                <Button variant="ghost" onClick={() => setStep('select')}>← Back</Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>
                {saving ? 'Creating…' : `Create ${chosen.length} ${titleNoun}`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VendorCombobox({
  vendors, vendorId, vendorName, onChange,
}: {
  vendors: Vendor[];
  vendorId: string;
  vendorName: string;
  onChange: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = vendors.find(v => v.id === vendorId);
  const display = selected?.name || vendorName || '';
  const trimmed = query.trim();
  const exactMatch = trimmed
    ? vendors.find(v => v.name.toLowerCase() === trimmed.toLowerCase())
    : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full h-9 mt-1 justify-between text-sm font-normal"
        >
          <span className={cn('truncate', !display && 'text-muted-foreground')}>
            {display || 'Select or type a vendor…'}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search or type a new vendor…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {trimmed ? (
                <button
                  type="button"
                  className="w-full text-left text-sm px-2 py-1.5 hover:bg-accent rounded"
                  onClick={() => { onChange('', trimmed); setOpen(false); setQuery(''); }}
                >
                  + Create "{trimmed}"
                </button>
              ) : (
                <span className="text-sm text-muted-foreground">No vendors yet.</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {(vendorId || vendorName) && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange('', ''); setOpen(false); setQuery(''); }}
                >
                  <X className="mr-2 h-3.5 w-3.5" /> Clear vendor
                </CommandItem>
              )}
              {vendors.map(v => (
                <CommandItem
                  key={v.id}
                  value={v.name}
                  onSelect={() => { onChange(v.id, v.name); setOpen(false); setQuery(''); }}
                >
                  <Check className={cn('mr-2 h-3.5 w-3.5', vendorId === v.id ? 'opacity-100' : 'opacity-0')} />
                  {v.name}
                </CommandItem>
              ))}
              {trimmed && !exactMatch && (
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={() => { onChange('', trimmed); setOpen(false); setQuery(''); }}
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Create "{trimmed}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
