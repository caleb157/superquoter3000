import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

type AttrPair = { key: string; value: string };

interface Variant {
  id: string;
  product_id: string;
  variant_name: string;
  wood_price_factor: number | null;
  photo_url: string | null;
  notes: string | null;
  attributes: Record<string, string> | null;
}

const SUGGESTED_KEYS = ['Finish', 'Color', 'Wood', 'Material', 'Stain', 'Hardware'];

const emptyForm = {
  variant_name: '',
  wood_price_factor: 1,
  photo_url: null as string | null,
  notes: '',
  attrs: [] as AttrPair[],
};

type WoodPrice = { id: string; wood_type: string; price_per_cft_inr: number };

export function ProductVariantsTab({ productId }: { productId: string }) {
  const [variants, setVariants] = useState<Variant[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [woods, setWoods] = useState<WoodPrice[]>([]);
  const [selectedWoodId, setSelectedWoodId] = useState<string>('');

  // Cheapest wood = baseline (factor 1.0)
  const baseWoodPrice = woods.length ? Math.min(...woods.map(w => Number(w.price_per_cft_inr) || 0).filter(p => p > 0)) : 0;

  const fetchVariants = async () => {
    const { data } = await supabase
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .order('created_at');
    if (data) setVariants(data as any);
  };

  useEffect(() => { fetchVariants(); }, [productId]);

  useEffect(() => {
    supabase.from('wood_prices').select('id, wood_type, price_per_cft_inr').order('price_per_cft_inr').then(({ data }) => {
      if (data) setWoods(data as any);
    });
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (v: Variant) => {
    setEditingId(v.id);
    setForm({
      variant_name: v.variant_name,
      wood_price_factor: v.wood_price_factor ?? 1,
      photo_url: v.photo_url,
      notes: v.notes || '',
      attrs: Object.entries(v.attributes || {}).map(([key, value]) => ({ key, value: String(value) })),
    });
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
    const attributes: Record<string, string> = {};
    for (const a of form.attrs) {
      const k = a.key.trim();
      if (k) attributes[k] = a.value.trim();
    }
    const payload = {
      variant_name: form.variant_name.trim(),
      wood_price_factor: form.wood_price_factor || 1,
      photo_url: form.photo_url,
      notes: form.notes || null,
      attributes,
      product_id: productId,
    };

    if (editingId) {
      const { error } = await (supabase as any).from('product_variants').update(payload).eq('id', editingId);
      if (error) { toast.error(error.message); return; }
      toast.success('Variant updated');
    } else {
      const { error } = await (supabase as any).from('product_variants').insert(payload);
      if (error) { toast.error(error.message); return; }
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

  const addAttr = (key = '') => setForm(f => ({ ...f, attrs: [...f.attrs, { key, value: '' }] }));
  const updateAttr = (idx: number, patch: Partial<AttrPair>) =>
    setForm(f => ({ ...f, attrs: f.attrs.map((a, i) => i === idx ? { ...a, ...patch } : a) }));
  const removeAttr = (idx: number) =>
    setForm(f => ({ ...f, attrs: f.attrs.filter((_, i) => i !== idx) }));

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define alternate versions of this product — wood, finish, color, etc. Pricing impact (when wood factor differs) shows in costing.
        </p>
        <Button size="sm" onClick={openAdd} className="gap-1.5"><Plus className="h-4 w-4" /> Add Variant</Button>
      </div>

      {variants.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No variants yet. Add one to capture different finishes, colors, or wood types.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {variants.map(v => (
            <Card key={v.id} className="overflow-hidden">
              <div className="aspect-video bg-muted flex items-center justify-center">
                {v.photo_url ? (
                  <img src={v.photo_url} alt={v.variant_name} className="h-full w-full object-cover" />
                ) : (
                  <Camera className="h-8 w-8 text-muted-foreground/50" />
                )}
              </div>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm">{v.variant_name}</div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(v)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => handleDelete(v.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {v.attributes && Object.keys(v.attributes).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(v.attributes).map(([k, val]) => (
                      <Badge key={k} variant="secondary" className="text-[10px] font-normal">
                        <span className="text-muted-foreground mr-1">{k}:</span>{String(val)}
                      </Badge>
                    ))}
                  </div>
                )}
                {(v.wood_price_factor ?? 1) !== 1 && (
                  <div className="text-[10px] text-muted-foreground">
                    Wood price factor: <span className="font-mono">{(v.wood_price_factor ?? 1).toFixed(2)}×</span>
                  </div>
                )}
                {v.notes && <p className="text-xs text-muted-foreground line-clamp-2">{v.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Variant' : 'Add Variant'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Variant Name *</label>
              <Input
                className="h-9"
                placeholder="e.g. Walnut Stain, Mango Wood, Matte Black"
                value={form.variant_name}
                onChange={e => setForm(f => ({ ...f, variant_name: e.target.value }))}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-muted-foreground">Attributes</label>
                <div className="flex gap-1 flex-wrap">
                  {SUGGESTED_KEYS.filter(k => !form.attrs.some(a => a.key.toLowerCase() === k.toLowerCase())).map(k => (
                    <Button key={k} type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => addAttr(k)}>+ {k}</Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                {form.attrs.map((a, i) => (
                  <div key={i} className="flex gap-1.5">
                    <Input className="h-8 text-xs flex-1" placeholder="key" value={a.key}
                      onChange={e => updateAttr(i, { key: e.target.value })} />
                    <Input className="h-8 text-xs flex-[2]" placeholder="value" value={a.value}
                      onChange={e => updateAttr(i, { value: e.target.value })} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0"
                      onClick={() => removeAttr(i)}><X className="h-3.5 w-3.5" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => addAttr('')}>
                  <Plus className="h-3 w-3" /> Add custom attribute
                </Button>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Wood price factor (multiplier on raw piece cost)</label>
              <Input
                className="h-9" type="number" step="0.01"
                value={form.wood_price_factor}
                onChange={e => setForm(f => ({ ...f, wood_price_factor: Number(e.target.value) }))}
              />
              <p className="text-[10px] text-muted-foreground mt-0.5">Use 1 if pricing is the same as the master product.</p>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Photo</label>
              <div className="flex items-center gap-2">
                {form.photo_url ? (
                  <div className="relative group">
                    <img src={form.photo_url} className="h-20 w-20 rounded object-cover border" />
                    <button onClick={() => setForm(f => ({ ...f, photo_url: null }))}
                      className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <label className="h-20 w-20 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50">
                    <Camera className="h-4 w-4 text-muted-foreground" />
                    <span className="text-[9px] text-muted-foreground mt-0.5">{uploading ? 'Uploading…' : 'Upload'}</span>
                    <input type="file" className="hidden" accept="image/*" disabled={uploading}
                      onChange={e => { if (e.target.files?.[0]) handlePhotoUpload(e.target.files[0]); }} />
                  </label>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Notes</label>
              <Textarea className="text-xs min-h-[60px]" placeholder="Optional notes..."
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
