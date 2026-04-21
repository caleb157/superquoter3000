import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

type Product = {
  id: string;
  name: string;
  quantity: number | null;
  sample_stage: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiryId: string;
  inquiryNumber?: string;
  onCreated: () => void;
  /** Optional: pre-selected products from a parent screen. If provided, skips the selection step. */
  preselectedProducts?: { id: string; name: string; sample_stage?: string | null }[];
};

const SAMPLE_STAGE_LABEL: Record<string, { label: string; cls: string }> = {
  sampling: { label: 'sampling', cls: 'bg-amber-100 text-amber-700' },
  sample_sent: { label: 'sent', cls: 'bg-emerald-100 text-emerald-700' },
};

export function GenerateSampleBatchDialog({
  open, onOpenChange, inquiryId, inquiryNumber, onCreated, preselectedProducts,
}: Props) {
  const skipSelect = !!preselectedProducts && preselectedProducts.length > 0;
  const [step, setStep] = useState<'select' | 'details'>(skipSelect ? 'details' : 'select');
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [title, setTitle] = useState('');
  const [requiredBy, setRequiredBy] = useState('');
  const [notes, setNotes] = useState('');
  const [finishes, setFinishes] = useState('');
  const [vendors, setVendors] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(skipSelect ? 'details' : 'select');
    setTitle(''); setRequiredBy(''); setNotes(''); setFinishes(''); setVendors('');
    if (skipSelect) {
      setProducts(preselectedProducts!.map(p => ({ id: p.id, name: p.name, quantity: null, sample_stage: p.sample_stage ?? null })));
      setSelected(new Set(preselectedProducts!.map(p => p.id)));
      return;
    }
    setSelected(new Set());
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('id, name, quantity, sample_stage')
        .eq('customer_rfq_id', inquiryId)
        .order('name');
      setProducts((data ?? []) as Product[]);
    })();
  }, [open, inquiryId, skipSelect, preselectedProducts]);

  const allSelected = products.length > 0 && products.every(p => selected.has(p.id));
  const toggleAll = (v: boolean) => setSelected(v ? new Set(products.map(p => p.id)) : new Set());
  const toggleOne = (id: string, v: boolean) => {
    const next = new Set(selected);
    if (v) next.add(id); else next.delete(id);
    setSelected(next);
  };

  const chosen = products.filter(p => selected.has(p.id));

  const submit = async () => {
    if (chosen.length === 0) { toast.error('No products selected'); return; }
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

    const sampleRows = chosen.map(p => ({
      rfs_id: rfs.id, product_id: p.id, status: 'requested', requested_date: today,
    }));
    const { error: sErr } = await (supabase as any).from('samples').insert(sampleRows);
    if (sErr) { setSaving(false); toast.error(sErr.message); return; }

    const flipIds = chosen.filter(p => p.sample_stage !== 'sample_sent').map(p => p.id);
    if (flipIds.length) {
      await supabase.from('products').update({ sample_stage: 'sampling' }).in('id', flipIds);
    }

    setSaving(false);
    toast.success(`Sample batch created with ${chosen.length} products`);
    onCreated();
    onOpenChange(false);
  };

  const preview = chosen.slice(0, 3).map(p => p.name).join(', ');
  const more = chosen.length > 3 ? ` and ${chosen.length - 3} more` : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Generate Sample Batch{inquiryNumber ? ` — ${inquiryNumber}` : ''}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {step === 'select' ? 'Step 1 of 2 · Select products' : 'Step 2 of 2 · Batch details'}
          </p>
        </DialogHeader>

        {step === 'select' ? (
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
                    const stage = p.sample_stage ? SAMPLE_STAGE_LABEL[p.sample_stage] : null;
                    return (
                      <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/50 rounded cursor-pointer">
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggleOne(p.id, !!v)} />
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{p.quantity ?? 0}</span>
                        {stage && <Badge variant="secondary" className={`text-[10px] ${stage.cls}`}>{stage.label}</Badge>}
                      </label>
                    );
                  })}
                </>
              )}
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={() => setStep('details')} disabled={selected.size === 0}>Next →</Button>
              </div>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <div className="font-medium">{chosen.length} products in this batch</div>
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
              {!skipSelect && (
                <Button variant="ghost" onClick={() => setStep('select')}>← Back</Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create Batch'}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
