import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  generateBoxRfq,
  generateChemicalRfq,
  generateHardwareRfq,
  generateRawPieceRfq,
  createRfq,
} from '@/lib/rfq-generation';
import { useAuth } from '@/contexts/AuthContext';

type RfqType = 'raw_pieces' | 'boxes' | 'hardware' | 'chemicals';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inquiryId: string;
  productIds: string[];
  onCreated?: (rfqId: string) => void;
};

const TYPE_LABEL: Record<RfqType, string> = {
  raw_pieces: 'Raw Pieces',
  boxes: 'Boxes',
  hardware: 'Hardware',
  chemicals: 'Chemicals',
};

async function runGenerator(type: RfqType, inquiryId: string, productIds: string[]) {
  const ids = productIds.length > 0 ? productIds : undefined;
  switch (type) {
    case 'raw_pieces': return generateRawPieceRfq(inquiryId, ids);
    case 'boxes': return generateBoxRfq(inquiryId, ids);
    case 'hardware': return generateHardwareRfq(inquiryId, ids);
    case 'chemicals': return generateChemicalRfq(inquiryId, ids);
  }
}

export function GenerateRfqDialog({ open, onOpenChange, inquiryId, productIds, onCreated }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rfqType, setRfqType] = useState<RfqType>('raw_pieces');
  const [discountPct, setDiscountPct] = useState<number>(10);
  const [preview, setPreview] = useState<{ title: string; count: number; totalEst: number } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingPreview(true);
    setPreview(null);
    (async () => {
      try {
        const res = await runGenerator(rfqType, inquiryId, productIds);
        if (cancelled) return;
        const totalEst = res.items.reduce((s, it) => s + (it.estimated_cost || 0) * (it.quantity || 0), 0);
        setPreview({ title: res.title, count: res.items.length, totalEst });
      } catch (e: any) {
        if (!cancelled) toast.error('Preview failed: ' + (e?.message || 'unknown'));
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, rfqType, inquiryId, productIds.join(',')]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const gen = await runGenerator(rfqType, inquiryId, productIds);
      if (gen.items.length === 0) {
        toast.error('No line items to generate for this selection.');
        setCreating(false);
        return;
      }
      const discount = Math.max(0, Math.min(100, discountPct)) / 100;
      const { rfqId, error } = await createRfq(inquiryId, rfqType, gen.title, gen.items, discount, user?.id);
      if (error || !rfqId) {
        toast.error(error || 'Failed to create RFQ');
        setCreating(false);
        return;
      }
      toast.success(`RFQ created (${gen.items.length} line item${gen.items.length === 1 ? '' : 's'})`);
      onOpenChange(false);
      if (onCreated) onCreated(rfqId);
      navigate(`/vendor-rfq/${rfqId}`);
    } catch (e: any) {
      toast.error('Create failed: ' + (e?.message || 'unknown'));
    } finally {
      setCreating(false);
    }
  };

  const scopeLabel = productIds.length > 0
    ? `${productIds.length} selected product${productIds.length === 1 ? '' : 's'}`
    : 'All products in inquiry';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate Vendor RFQ</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Scope: <span className="font-medium text-foreground">{scopeLabel}</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">RFQ type</Label>
            <Select value={rfqType} onValueChange={(v) => setRfqType(v as RfqType)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABEL) as RfqType[]).map(t => (
                  <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Discount %</Label>
            <Input
              type="number"
              step="1"
              min={0}
              max={100}
              value={discountPct}
              onChange={(e) => setDiscountPct(Number(e.target.value))}
              className="h-9"
            />
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
            <div className="font-medium text-sm">Preview</div>
            {loadingPreview ? (
              <div className="text-muted-foreground">Computing…</div>
            ) : preview ? (
              <>
                <div className="text-muted-foreground truncate">{preview.title}</div>
                <div>Line items: <span className="font-medium text-foreground">{preview.count}</span></div>
                <div>
                  Estimated total: <span className="font-medium text-foreground">
                    ₹{preview.totalEst.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-muted-foreground">No data</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || loadingPreview || (preview?.count ?? 0) === 0}>
            {creating ? 'Creating…' : 'Create RFQ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
