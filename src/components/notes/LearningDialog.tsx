import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Camera, ImagePlus, Lightbulb, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { OdooOrderPicker } from '@/components/OdooOrderPicker';
import { LEARNING_STATUSES, uploadNotePhotos } from '@/lib/notes';
import type { Tables } from '@/integrations/supabase/types';

export type Learning = Tables<'learnings'>;

export function LearningDialog({ open, onOpenChange, learning, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; learning?: Learning | null; onSaved?: () => void;
}) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<string>('Idea');
  const [so, setSo] = useState(''); const [soLabel, setSoLabel] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(learning?.title ?? ''); setNotes(learning?.notes ?? ''); setStatus(learning?.status ?? 'Idea');
    setSo(learning?.so_number ?? ''); setSoLabel(learning?.so_label ?? ''); setPhotos(learning?.photo_urls ?? []);
  }, [open, learning]);

  const addFiles = async (files: FileList | null) => {
    setUploading(true);
    try { const urls = await uploadNotePhotos(files, 'learnings'); setPhotos(p => [...p, ...urls]); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; if (camRef.current) camRef.current.value = ''; }
  };

  const save = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    const row = { title: title.trim(), notes: notes.trim() || null, status, so_number: so || null, so_label: soLabel || null, photo_urls: photos };
    const { error } = learning
      ? await supabase.from('learnings').update(row).eq('id', learning.id)
      : await supabase.from('learnings').insert(row);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(learning ? 'Learning updated' : 'Learning saved');
    onSaved?.(); onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Lightbulb className="h-4 w-4" />{learning ? 'Edit learning' : 'New learning'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Idea, issue or lesson" /></div>
          <div><Label>Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} /></div>
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{LEARNING_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sales order (optional)</Label>
            <div className="flex gap-1 items-start">
              <div className="flex-1"><OdooOrderPicker kind="so" value={so} label={soLabel} onPick={(n, l) => { setSo(n); setSoLabel(l ?? ''); }} /></div>
              {so && <Button variant="ghost" size="icon" className="h-9 w-9 mt-1.5" aria-label="Clear sales order" onClick={() => { setSo(''); setSoLabel(''); }}><X className="h-4 w-4" /></Button>}
            </div>
          </div>
          <div>
            <Label>Photos</Label>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {photos.map(u => (
                <div key={u} className="relative h-16 w-16">
                  <img src={u} alt="" className="h-16 w-16 rounded object-cover border" />
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos(p => p.filter(x => x !== u))}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-background border flex items-center justify-center"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => camRef.current?.click()}><Camera className="h-4 w-4 mr-1" />Camera</Button>
              <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4 mr-1" />Upload</Button>
              {uploading && <Loader2 className="h-4 w-4 animate-spin self-center" />}
            </div>
            <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => addFiles(e.target.files)} />
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || uploading}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
