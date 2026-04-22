import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Plus, Pencil, Trash2, X, Upload, Check, ChevronsUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

type Sample = {
  id: string;
  product_id: string | null;
  rfs_id: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  status: string;
  requested_date: string | null;
  initial_ready_date: string | null;
  final_ready_date: string | null;
  dimensions_inch: string | null;
  weight_kg: number | null;
  finish: string | null;
  photo_urls: string[];
  feedback: string | null;
  notes: string | null;
  created_at: string;
  rfs?: { rfs_number: string; customer_rfq_id: string | null } | null;
};

type Vendor = { id: string; name: string };

const STATUSES = ['requested', 'in_production', 'ready', 'received', 'approved', 'rejected'];
const STATUS_COLOR: Record<string, string> = {
  requested: 'bg-muted text-muted-foreground',
  in_production: 'bg-amber-100 text-amber-800',
  ready: 'bg-blue-100 text-blue-800',
  received: 'bg-indigo-100 text-indigo-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

type Props = { productId: string };

export function ProductSampleLogTab({ productId }: Props) {
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const fetchSamples = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('samples')
      .select('*, rfs:rfs(rfs_number, customer_rfq_id)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    setSamples(((data as any) ?? []).map((s: any) => ({ ...s, photo_urls: Array.isArray(s.photo_urls) ? s.photo_urls : [] })));
    setLoading(false);
  };

  useEffect(() => { fetchSamples(); }, [productId]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sample?')) return;
    const { error } = await supabase.from('samples').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Sample deleted');
    fetchSamples();
  };

  const openCreate = () => { setEditId(null); setDialogOpen(true); };
  const openEdit = (id: string) => { setEditId(id); setDialogOpen(true); };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Samples</h2>
        <Button size="sm" onClick={openCreate}><Plus className="h-3.5 w-3.5 mr-1" />Add Sample</Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground text-center py-8">Loading…</div>
      ) : samples.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          No samples yet. Click "Add Sample" to log one.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {samples.map(s => (
            <Card key={s.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.vendor_name || 'No vendor set'}</span>
                    <Badge variant="secondary" className={cn('text-[10px]', STATUS_COLOR[s.status] ?? 'bg-muted')}>{s.status}</Badge>
                    {s.rfs && (
                      <Badge variant="outline" className="text-[10px]">Batch: {s.rfs.rfs_number}</Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s.id)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                  {s.requested_date && <span>Requested: {format(new Date(s.requested_date), 'MMM d, yyyy')}</span>}
                  {s.initial_ready_date && <span>Initial ready: {format(new Date(s.initial_ready_date), 'MMM d, yyyy')}</span>}
                  {s.final_ready_date && <span>Final ready: {format(new Date(s.final_ready_date), 'MMM d, yyyy')}</span>}
                </div>

                {(s.dimensions_inch || s.weight_kg || s.finish) && (
                  <div className="text-xs flex flex-wrap gap-x-4 gap-y-1">
                    {s.dimensions_inch && <span><span className="text-muted-foreground">Dims:</span> {s.dimensions_inch}</span>}
                    {s.weight_kg != null && <span><span className="text-muted-foreground">Weight:</span> {s.weight_kg} kg</span>}
                    {s.finish && <span><span className="text-muted-foreground">Finish:</span> {s.finish}</span>}
                  </div>
                )}

                {s.photo_urls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {s.photo_urls.map((url, i) => (
                      <button key={i} onClick={() => setLightboxUrl(url)} className="block">
                        <img src={url} alt={`Sample ${i + 1}`} className="h-16 w-16 object-cover rounded border hover:ring-2 hover:ring-primary transition" />
                      </button>
                    ))}
                  </div>
                )}

                {s.feedback && (
                  <div className="text-xs"><span className="text-muted-foreground">Feedback:</span> {s.feedback}</div>
                )}
                {s.notes && (
                  <div className="text-xs"><span className="text-muted-foreground">Notes:</span> {s.notes}</div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SampleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        productId={productId}
        sampleId={editId ?? undefined}
        onSaved={fetchSamples}
      />

      {lightboxUrl && (
        <Dialog open={!!lightboxUrl} onOpenChange={() => setLightboxUrl(null)}>
          <DialogContent className="max-w-3xl">
            <img src={lightboxUrl} alt="Sample" className="w-full h-auto rounded" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ============= Sample Dialog =============

type SampleDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  productId: string;
  sampleId?: string;
  onSaved: () => void;
};

function SampleDialog({ open, onOpenChange, productId, sampleId, onSaved }: SampleDialogProps) {
  const isEdit = !!sampleId;
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState<string>('');
  const [vendorOverride, setVendorOverride] = useState('');
  const [status, setStatus] = useState('requested');
  const [requestedDate, setRequestedDate] = useState('');
  const [initialReady, setInitialReady] = useState('');
  const [finalReady, setFinalReady] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [weight, setWeight] = useState('');
  const [finish, setFinish] = useState('');
  const [feedback, setFeedback] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data: v } = await supabase.from('vendors').select('id, name').order('name');
      setVendors((v as any) ?? []);

      if (isEdit && sampleId) {
        const { data } = await supabase.from('samples').select('*').eq('id', sampleId).maybeSingle();
        if (data) {
          setVendorId(data.vendor_id ?? '');
          setVendorOverride(data.vendor_name ?? '');
          setStatus(data.status ?? 'requested');
          setRequestedDate(data.requested_date ?? '');
          setInitialReady(data.initial_ready_date ?? '');
          setFinalReady(data.final_ready_date ?? '');
          setDimensions(data.dimensions_inch ?? '');
          setWeight(data.weight_kg != null ? String(data.weight_kg) : '');
          setFinish(data.finish ?? '');
          setFeedback(data.feedback ?? '');
          setNotes(data.notes ?? '');
          setPhotoUrls(Array.isArray(data.photo_urls) ? (data.photo_urls as string[]) : []);
        }
      } else {
        setVendorId(''); setVendorOverride(''); setStatus('requested');
        setRequestedDate(''); setInitialReady(''); setFinalReady('');
        setDimensions(''); setWeight(''); setFinish('');
        setFeedback(''); setNotes(''); setPhotoUrls([]);
      }
    })();
  }, [open, sampleId, isEdit]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const newUrls: string[] = [];
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop() || 'jpg';
      const path = `${productId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from('sample-photos').upload(path, file, { contentType: file.type, upsert: true });
      if (error) { toast.error('Upload failed: ' + error.message); continue; }
      const { data } = supabase.storage.from('sample-photos').getPublicUrl(path);
      newUrls.push(data.publicUrl);
    }
    setPhotoUrls(prev => [...prev, ...newUrls]);
    setUploading(false);
  };

  const removePhoto = (url: string) => setPhotoUrls(prev => prev.filter(u => u !== url));

  const handleSave = async () => {
    setSaving(true);
    let finalVendorId = vendorId || null;
    let finalVendorName = vendorOverride.trim() || null;

    // If user typed a name that doesn't match an existing vendor, create one
    if (!finalVendorId && finalVendorName) {
      const existing = vendors.find(v => v.name.toLowerCase() === finalVendorName!.toLowerCase());
      if (existing) {
        finalVendorId = existing.id;
        finalVendorName = existing.name;
      } else {
        const { data: newVendor, error: vErr } = await supabase
          .from('vendors')
          .insert({ name: finalVendorName, category: 'sampling' })
          .select('id, name')
          .single();
        if (vErr) { setSaving(false); toast.error('Could not create vendor: ' + vErr.message); return; }
        finalVendorId = newVendor!.id;
        finalVendorName = newVendor!.name;
        setVendors(prev => [...prev, { id: newVendor!.id, name: newVendor!.name }].sort((a, b) => a.name.localeCompare(b.name)));
      }
    } else if (finalVendorId) {
      finalVendorName = vendors.find(v => v.id === finalVendorId)?.name ?? finalVendorName;
    }

    const payload: any = {
      product_id: productId,
      rfs_id: null,
      vendor_id: finalVendorId,
      vendor_name: finalVendorName,
      status,
      requested_date: requestedDate || null,
      initial_ready_date: initialReady || null,
      final_ready_date: finalReady || null,
      dimensions_inch: dimensions.trim() || null,
      weight_kg: weight ? Number(weight) : null,
      finish: finish.trim() || null,
      feedback: feedback.trim() || null,
      notes: notes.trim() || null,
      photo_urls: photoUrls,
    };
    let error;
    if (isEdit && sampleId) {
      ({ error } = await supabase.from('samples').update(payload).eq('id', sampleId));
    } else {
      ({ error } = await supabase.from('samples').insert(payload));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isEdit ? 'Sample updated' : 'Sample added');
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{isEdit ? 'Edit sample' : 'Add sample'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Vendor</Label>
            <VendorCombobox
              vendors={vendors}
              vendorId={vendorId}
              vendorName={vendorOverride}
              onChange={(id, name) => { setVendorId(id); setVendorOverride(name); }}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Pick an existing vendor, or type a new name to create one on save.
            </p>
          </div>

          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Requested</Label>
              <Input type="date" className="h-9 text-sm mt-1" value={requestedDate} onChange={e => setRequestedDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Initial ready</Label>
              <Input type="date" className="h-9 text-sm mt-1" value={initialReady} onChange={e => setInitialReady(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Final ready</Label>
              <Input type="date" className="h-9 text-sm mt-1" value={finalReady} onChange={e => setFinalReady(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Dimensions</Label>
              <Input className="h-9 text-sm mt-1" value={dimensions} onChange={e => setDimensions(e.target.value)} placeholder='e.g. 12 x 8 x 4"' />
            </div>
            <div>
              <Label className="text-xs">Weight (kg)</Label>
              <Input type="number" step="any" className="h-9 text-sm mt-1" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Finish</Label>
              <Input className="h-9 text-sm mt-1" value={finish} onChange={e => setFinish(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs">Photos</Label>
            <div className="mt-1 flex flex-wrap gap-2">
              {photoUrls.map((url) => (
                <div key={url} className="relative group">
                  <img src={url} alt="" className="h-16 w-16 object-cover rounded border" />
                  <button type="button" onClick={() => removePhoto(url)}
                    className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="h-16 w-16 border-2 border-dashed rounded flex flex-col items-center justify-center cursor-pointer hover:border-primary/50">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground mt-0.5">{uploading ? 'Uploading…' : 'Add'}</span>
                <input type="file" multiple accept="image/*" className="hidden"
                  onChange={(e) => { handleUpload(e.target.files); e.currentTarget.value = ''; }} />
              </label>
            </div>
          </div>

          <div>
            <Label className="text-xs">Feedback</Label>
            <Textarea rows={2} className="text-sm mt-1" value={feedback} onChange={e => setFeedback(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} className="text-sm mt-1" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
