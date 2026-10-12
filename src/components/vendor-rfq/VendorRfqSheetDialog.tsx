import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { createRfqSheets, defaultReplyBy, type SheetVendor } from '@/lib/vendor-rfq-sheet';
import type { RawTargetMode } from '@/lib/rfq-generation';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiryId: string;
  productIds: string[];
  onCreated?: () => void;
};

type VendorRow = SheetVendor & { category: string | null };

const MODE_LABEL: Record<RawTargetMode, string> = {
  raw_piece: 'Raw piece',
  outsourced: 'Finished and packed (outsourced)',
  finishing_packing: 'Finished product, ex-shipping',
};

export function VendorRfqSheetDialog({ open, onOpenChange, inquiryId, productIds, onCreated }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<RawTargetMode>('raw_piece');
  const [discountPct, setDiscountPct] = useState(10);
  const [replyBy, setReplyBy] = useState(defaultReplyBy());
  const [notes, setNotes] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPicked(new Set()); setSearch(''); setReplyBy(defaultReplyBy()); setNotes('');
    (async () => {
      const { data } = await (supabase as any).from('vendors').select('id, name, email, phone, address, category').order('name');
      setVendors(data || []);
    })();
  }, [open]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? vendors.filter(v => v.name.toLowerCase().includes(q) || (v.category || '').toLowerCase().includes(q)) : vendors;
    // Raw piece vendors first, the way the RFQ editor sorts them.
    return [...list].sort((a, b) => (a.category === 'raw_pieces' ? 0 : 1) - (b.category === 'raw_pieces' ? 0 : 1) || a.name.localeCompare(b.name));
  }, [vendors, search]);

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const create = async () => {
    setCreating(true);
    try {
      const chosen = vendors.filter(v => picked.has(v.id));
      const { batchId, count } = await createRfqSheets({
        inquiryId, productIds, vendors: chosen, mode,
        discount: Math.max(0, Math.min(100, discountPct)) / 100,
        replyBy: replyBy || null, notes: notes.trim() || null, userId: user?.id,
      });
      toast.success(count ? `RFQ sheet made for ${count} vendor${count === 1 ? '' : 's'}` : 'RFQ sheet made');
      onOpenChange(false);
      onCreated?.();
      navigate(`/vendor-rfq-sheet/${batchId}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not make the RFQ sheet');
    } finally {
      setCreating(false);
    }
  };

  const scope = productIds.length > 0 ? `${productIds.length} selected product${productIds.length === 1 ? '' : 's'}` : 'All products in the inquiry';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Vendor RFQ sheet</DialogTitle>
          <DialogDescription>{scope}. Pick vendors to give each its own PDF, or none for one printable sheet you can send to anyone. Replies go into one grid.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Vendors (optional)</Label>
              <span className="text-xs text-muted-foreground">{picked.size} picked</span>
            </div>
            <Input className="h-8 text-sm" placeholder="Search vendors…" value={search} onChange={e => setSearch(e.target.value)} />
            <ScrollArea className="h-48 rounded-md border">
              <div className="p-1">
                {shown.map(v => (
                  <label key={v.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted cursor-pointer">
                    <Checkbox checked={picked.has(v.id)} onCheckedChange={() => toggle(v.id)} />
                    <span className="flex-1 truncate">{v.name}</span>
                    {v.category && v.category !== 'general' && <Badge variant="secondary" className="text-[10px] h-4">{v.category}</Badge>}
                  </label>
                ))}
                {shown.length === 0 && <div className="p-3 text-xs text-muted-foreground">No vendors found. Add them on the Vendors page.</div>}
              </div>
            </ScrollArea>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Quoting for</Label>
              <Select value={mode} onValueChange={v => setMode(v as RawTargetMode)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABEL) as RawTargetMode[]).map(m => <SelectItem key={m} value={m}>{MODE_LABEL[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reply by</Label>
              <Input type="date" className="h-9" value={replyBy} onChange={e => setReplyBy(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target price, % below our budget</Label>
            <Input type="number" min={0} max={100} step={1} className="h-9 w-24" value={discountPct} onChange={e => setDiscountPct(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes for vendors (optional)</Label>
            <Textarea rows={2} className="text-sm" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Wood, finish or delivery details…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Cancel</Button>
          <Button onClick={create} disabled={creating}>
            {creating ? 'Making…' : picked.size === 0 ? 'Make sheet without a vendor' : `Make sheet${picked.size > 1 ? `s for ${picked.size} vendors` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
