// Photo → estimated iron parts. The user gives a photo and the piece's outer W × D × H; the
// estimate-iron-parts function asks Claude for the likely sections, lengths and counts, and the
// result is loaded as an editable draft (each part flagged "estimated" until edited).
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { legsFromEstimate, type EditLeg, type IronEstimate } from '@/lib/iron-weight';
import { cn } from '@/lib/utils';
import { NumInput, fieldCls } from './PartRow';

type Dims = { w: number; d: number; h: number; unit: 'in' | 'cm' | 'mm' };
const MAX_EDGE = 1568; // larger images are downscaled by the API anyway

/** Downscale to a JPEG data URL so phone photos upload quickly. */
async function prepareImage(file: File): Promise<{ data: string; mediaType: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', preview: url };
}

export function PhotoEstimateDialog({ open, onOpenChange, hasWork, onApply }: {
  open: boolean; onOpenChange: (o: boolean) => void; hasWork: boolean;
  onApply: (legs: EditLeg[], mode: 'replace' | 'add', estimate: IronEstimate) => void;
}) {
  const [img, setImg] = useState<{ data: string; mediaType: string; preview: string } | null>(null);
  const [dims, setDims] = useState<Dims>({ w: NaN, d: NaN, h: NaN, unit: 'in' });
  const [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setError(null); }, [open]);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try { setImg(await prepareImage(f)); } catch { setError('Could not read that image. Try a JPEG or PNG.'); }
  };
  const dimsOk = [dims.w, dims.d, dims.h].every(n => n > 0);

  const run = async () => {
    if (!img || !dimsOk) return;
    setBusy(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('estimate-iron-parts', {
        body: { image: img.data, media_type: img.mediaType, width: dims.w, depth: dims.d, height: dims.h, unit: dims.unit, notes: notes.trim() },
      });
      if (error) {
        let msg = error.message;
        try { msg = (await (error as any).context?.json?.())?.error || msg; } catch { /* keep generic */ }
        throw new Error(msg);
      }
      const est = data as IronEstimate;
      const legs = legsFromEstimate(est);
      if (!legs.length) throw new Error(est?.summary || 'No iron parts could be identified in that photo.');
      onApply(legs, mode, est);
      onOpenChange(false);
    } catch (e: any) {
      setError(/Failed to send|non-2xx|FunctionsFetchError/i.test(e?.message || '')
        ? 'The photo estimator is not available yet (the estimate-iron-parts function has not been deployed).'
        : e?.message || 'Estimate failed');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Estimate from a photo</DialogTitle>
          <DialogDescription>Claude identifies the iron sections and sizes them from the outer dimensions. You'll get an editable draft — check it before relying on the numbers.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => void pick(e.target.files?.[0])} />
          {img ? (
            <button type="button" onClick={() => fileRef.current?.click()} className="group relative block w-full overflow-hidden rounded-lg border bg-muted">
              <img src={img.preview} alt="Furniture to estimate" className="mx-auto max-h-64 object-contain" />
              <span className="absolute bottom-2 right-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow-sm group-hover:bg-background">Change photo</span>
            </button>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void pick(e.dataTransfer.files?.[0]); }}
              className="flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm text-muted-foreground hover:border-primary/50 hover:text-foreground">
              <span className="flex gap-2"><ImagePlus className="h-6 w-6" /><Camera className="h-6 w-6" /></span>
              Take or choose a photo of the iron piece
            </button>
          )}

          <div>
            <Label className="text-sm">Outer dimensions</Label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {(['w', 'd', 'h'] as const).map((k, i) => (
                <span key={k} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-muted-foreground">×</span>}
                  <span className="flex flex-col">
                    <NumInput label={{ w: 'Width', d: 'Depth', h: 'Height' }[k]} value={dims[k]} className="w-20" onChange={n => setDims(d => ({ ...d, [k]: n }))} />
                    <span className="mt-0.5 text-center text-[11px] text-muted-foreground">{{ w: 'W', d: 'D', h: 'H' }[k]}</span>
                  </span>
                </span>
              ))}
              <select aria-label="Unit" className={cn(fieldCls, 'w-20 self-start')} value={dims.unit} onChange={e => setDims(d => ({ ...d, unit: e.target.value as Dims['unit'] }))}>
                <option value="in">inch</option><option value="cm">cm</option><option value="mm">mm</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ie-notes" className="text-sm">What is it? <span className="font-normal text-muted-foreground">(optional, helps a lot)</span></Label>
            <Textarea id="ie-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Console table base, wood top not included, 40×20 tube frame" />
          </div>

          {hasWork && (
            <div className="flex gap-2 text-sm">
              {(['replace', 'add'] as const).map(m => (
                <button key={m} type="button" onClick={() => setMode(m)}
                  className={cn('flex-1 rounded-md border px-3 py-2 text-left', mode === m ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground')}>
                  {m === 'replace' ? 'Replace current parts' : 'Add to current parts'}
                </button>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void run()} disabled={!img || !dimsOk || busy} className="gap-1.5">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> Estimating… (up to a minute)</> : <><Sparkles className="h-4 w-4" /> Estimate parts</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
