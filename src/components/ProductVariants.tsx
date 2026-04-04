import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ChevronDown, Plus, Trash2, Pencil, Camera, X } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';

interface Variant {
  id: string;
  product_id: string;
  variant_name: string;
  wood_price_factor: number;
  photo_url: string | null;
  notes: string | null;
}

interface ProductVariantsProps {
  productId: string;
  masterRawPieceCost: number;
  otherCostsPerUnit: number;
  markupPercent: number;
  exchangeRate: number;
}

const emptyForm = { variant_name: '', wood_price_factor: 1, photo_url: null as string | null, notes: '' };

export function ProductVariants({ productId, masterRawPieceCost, otherCostsPerUnit, markupPercent, exchangeRate }: ProductVariantsProps) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchVariants();
  }, [productId]);

  const fetchVariants = async () => {
    const { data } = await supabase.from('product_variants').select('*').eq('product_id', productId).order('created_at');
    if (data) setVariants(data as Variant[]);
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (v: Variant) => {
    setEditingId(v.id);
    setForm({ variant_name: v.variant_name, wood_price_factor: v.wood_price_factor ?? 1, photo_url: v.photo_url, notes: v.notes || '' });
    setDialogOpen(true);
  };

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `variants/${productId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('product-photos').upload(path, file);
    if (error) { toast.error('Upload failed'); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
    setForm(f => ({ ...f, photo_url: urlData.publicUrl }));
    setUploading(false);
  };

  const handleSave = async () => {
    if (!form.variant_name.trim()) { toast.error('Name is required'); return; }
    const payload = {
      variant_name: form.variant_name.trim(),
      wood_price_factor: form.wood_price_factor,
      photo_url: form.photo_url,
      notes: form.notes || null,
      product_id: productId,
    };

    if (editingId) {
      const { error } = await supabase.from('product_variants').update(payload).eq('id', editingId);
      if (error) { toast.error('Update failed'); return; }
      toast.success('Variant updated');
    } else {
      const { error } = await supabase.from('product_variants').insert(payload);
      if (error) { toast.error('Create failed'); return; }
      toast.success('Variant added');
    }
    setDialogOpen(false);
    fetchVariants();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this variant?')) return;
    await supabase.from('product_variants').delete().eq('id', id);
    toast.success('Variant deleted');
    fetchVariants();
  };

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-2 py-2 px-3 bg-muted/50 rounded-md hover:bg-muted transition-colors text-left">
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
            <span className="text-sm font-semibold flex-1">H. Variants (Wood Types)</span>
            <span className="text-xs calc-field px-2 py-0.5 rounded">{variants.length} variant{variants.length !== 1 ? 's' : ''}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="py-2 px-1 space-y-2">
            {variants.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-right">Factor</TableHead>
                    <TableHead className="text-right">Raw Piece (₹)</TableHead>
                    <TableHead className="text-right">Product Cost (₹)</TableHead>
                    <TableHead className="text-right">Price ($)</TableHead>
                    <TableHead className="w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {variants.map(v => {
                    const vc = calc.calcVariantCost(masterRawPieceCost, v.wood_price_factor ?? 1, otherCostsPerUnit, markupPercent, exchangeRate);
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="p-1">
                          {v.photo_url ? (
                            <img src={v.photo_url} alt={v.variant_name} className="h-8 w-8 rounded object-cover" />
                          ) : (
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">—</div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-medium">
                          {v.variant_name}
                          {v.notes && <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{v.notes}</p>}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">{(v.wood_price_factor ?? 1).toFixed(2)}×</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmt.inr(vc.variant_raw_piece_cost)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmt.inr(vc.variant_product_cost)}</TableCell>
                        <TableCell className="text-right text-xs font-mono font-semibold">{fmt.usd(vc.variant_unit_price_usd)}</TableCell>
                        <TableCell className="text-right p-1">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEdit(v)}><Pencil className="h-3 w-3" /></Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(v.id)}><Trash2 className="h-3 w-3" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="text-xs text-muted-foreground py-2 text-center">No variants yet. Add wood type variants to see alternate pricing.</p>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openAdd}>
              <Plus className="h-3 w-3 mr-1" /> Add Variant
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editingId ? 'Edit Variant' : 'Add Variant'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Variant Name *</label>
              <Input className="h-8 text-xs" placeholder="e.g. Sheesham, Mango Wood" value={form.variant_name} onChange={e => setForm(f => ({ ...f, variant_name: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Wood Price Factor (multiplier on raw piece cost)</label>
              <Input className="h-8 text-xs" type="number" step="0.01" value={form.wood_price_factor} onChange={e => setForm(f => ({ ...f, wood_price_factor: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Photo</label>
              <div className="flex items-center gap-2">
                {form.photo_url ? (
                  <div className="relative group">
                    <img src={form.photo_url} className="h-16 w-16 rounded object-cover border" />
                    <button onClick={() => setForm(f => ({ ...f, photo_url: null }))} className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ) : (
                  <label className="h-16 w-16 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50">
                    <Camera className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[8px] text-muted-foreground">{uploading ? 'Uploading...' : 'Upload'}</span>
                    <input type="file" className="hidden" accept="image/*" disabled={uploading} onChange={e => { if (e.target.files?.[0]) handlePhotoUpload(e.target.files[0]); }} />
                  </label>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea className="text-xs min-h-[60px]" placeholder="Optional notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Price preview */}
            {form.wood_price_factor > 0 && (
              <div className="bg-muted/50 rounded p-2 text-xs space-y-1">
                <p className="font-semibold text-muted-foreground">Price Preview</p>
                {(() => {
                  const vc = calc.calcVariantCost(masterRawPieceCost, form.wood_price_factor, otherCostsPerUnit, markupPercent, exchangeRate);
                  return (
                    <>
                      <p>Raw Piece: {fmt.inr(vc.variant_raw_piece_cost)}</p>
                      <p>Product Cost: {fmt.inr(vc.variant_product_cost)}</p>
                      <p className="font-semibold">Unit Price: {fmt.usd(vc.variant_unit_price_usd)}</p>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSave}>{editingId ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
