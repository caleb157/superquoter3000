import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { seedProductDefaultsForMany } from '@/lib/product-defaults';

type Row = {
  name: string;
  width_inch: string;
  depth_inch: string;
  height_inch: string;
  quantity: string;
  moq: string;
  target_price_usd: string;
  notes: string;
};

const blankRow = (): Row => ({
  name: '', width_inch: '', depth_inch: '', height_inch: '',
  quantity: '', moq: '', target_price_usd: '', notes: '',
});

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inquiryId: string;
  onCreated: () => void;
};

export function QuickAddProductsDialog({ open, onOpenChange, inquiryId, onCreated }: Props) {
  const [rows, setRows] = useState<Row[]>([blankRow(), blankRow(), blankRow()]);
  const [saving, setSaving] = useState(false);

  const update = (i: number, patch: Partial<Row>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const addRow = () => setRows(prev => [...prev, blankRow()]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    const valid = rows.filter(r => r.name.trim().length > 0);
    if (valid.length === 0) {
      toast.error('Add at least one product name');
      return;
    }
    setSaving(true);
    const num = (s: string) => s.trim() === '' ? null : Number(s);
    const int = (s: string) => s.trim() === '' ? null : Math.round(Number(s));
    const payload = valid.map(r => ({
      customer_rfq_id: inquiryId,
      name: r.name.trim(),
      width_inch: num(r.width_inch),
      depth_inch: num(r.depth_inch),
      height_inch: num(r.height_inch),
      quantity: int(r.quantity) ?? 100,
      moq: int(r.moq) ?? 50,
      target_price_usd: num(r.target_price_usd),
      notes: r.notes.trim() || null,
    }));
    const { data: inserted, error } = await supabase.from('products').insert(payload).select('id');
    if (error) { setSaving(false); toast.error(error.message); return; }
    try {
      await seedProductDefaultsForMany((inserted || []).map(p => p.id));
    } catch (e: any) {
      console.error('Failed to seed defaults', e);
    }
    setSaving(false);
    toast.success(`Added ${payload.length} product${payload.length === 1 ? '' : 's'}`);
    setRows([blankRow(), blankRow(), blankRow()]);
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add products</DialogTitle>
          <DialogDescription>
            Quickly add multiple products by name. Dimensions, quantity, MOQ, and target price are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs min-w-[180px]">Name *</TableHead>
                <TableHead className="text-xs w-16">W (in)</TableHead>
                <TableHead className="text-xs w-16">D (in)</TableHead>
                <TableHead className="text-xs w-16">H (in)</TableHead>
                <TableHead className="text-xs w-20">Qty</TableHead>
                <TableHead className="text-xs w-20">MOQ</TableHead>
                <TableHead className="text-xs w-24">Target $</TableHead>
                <TableHead className="text-xs min-w-[140px]">Notes</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="p-1">
                    <Input value={r.name} onChange={e => update(i, { name: e.target.value })} className="h-8 text-sm" placeholder="Product name" />
                  </TableCell>
                  <TableCell className="p-1"><Input type="number" step="0.1" value={r.width_inch} onChange={e => update(i, { width_inch: e.target.value })} className="h-8 text-sm" /></TableCell>
                  <TableCell className="p-1"><Input type="number" step="0.1" value={r.depth_inch} onChange={e => update(i, { depth_inch: e.target.value })} className="h-8 text-sm" /></TableCell>
                  <TableCell className="p-1"><Input type="number" step="0.1" value={r.height_inch} onChange={e => update(i, { height_inch: e.target.value })} className="h-8 text-sm" /></TableCell>
                  <TableCell className="p-1"><Input type="number" value={r.quantity} onChange={e => update(i, { quantity: e.target.value })} className="h-8 text-sm" placeholder="100" /></TableCell>
                  <TableCell className="p-1"><Input type="number" value={r.moq} onChange={e => update(i, { moq: e.target.value })} className="h-8 text-sm" placeholder="50" /></TableCell>
                  <TableCell className="p-1"><Input type="number" step="0.01" value={r.target_price_usd} onChange={e => update(i, { target_price_usd: e.target.value })} className="h-8 text-sm" /></TableCell>
                  <TableCell className="p-1"><Input value={r.notes} onChange={e => update(i, { notes: e.target.value })} className="h-8 text-sm" /></TableCell>
                  <TableCell className="p-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(i)} disabled={rows.length === 1}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={addRow}>
            <Plus className="h-3.5 w-3.5" /> Add row
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Add products'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
