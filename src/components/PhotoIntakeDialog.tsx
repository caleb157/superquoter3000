// Photo intake: snap or pick a photo of each product, give its outer W × D × H, and HQ drafts the
// product with type, % wood, finishing difficulty and likely cost lines (estimate-product function),
// then opens it in the costing workspace. Each draft is flagged "estimated" until marked checked.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Camera, Check, ImagePlus, Loader2, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  createProductFromEstimate, estimateFromPhotos, prepareImage,
  type DimUnit, type PreparedImage,
} from '@/lib/photo-intake';

type Status = 'ready' | 'estimating' | 'saving' | 'done' | 'error';
type Item = {
  key: number; images: PreparedImage[];
  w: string; d: string; h: string; name: string; notes: string; qty: string;
  status: Status; error?: string; productId?: string; productName?: string; warnings?: string[];
};

const MAX_PHOTOS = 3;
const PARALLEL = 2;
let nextKey = 1;
const blank = (): Item => ({ key: nextKey++, images: [], w: '', d: '', h: '', name: '', notes: '', qty: '', status: 'ready' });
const num = (s: string) => { const n = Number(s); return Number.isFinite(n) && n > 0 ? n : NaN; };
const isReady = (it: Item) => it.images.length > 0 && [it.w, it.d, it.h].every(s => num(s) > 0);
const busyStatus = (s: Status) => s === 'estimating' || s === 'saving';

export function PhotoIntakeDialog({ open, onOpenChange, inquiryId, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; inquiryId: string; onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([blank()]);
  const [unit, setUnit] = useState<DimUnit>('in');
  const [running, setRunning] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => { if (!open && !running) setItems([blank()]); }, [open, running]);

  const patch = (key: number, p: Partial<Item>) => setItems(prev => prev.map(it => it.key === key ? { ...it, ...p } : it));

  const runOne = async (it: Item): Promise<string | null> => {
    const input = { width: num(it.w), depth: num(it.d), height: num(it.h), unit, name: it.name, notes: it.notes, quantity: num(it.qty) || undefined };
    patch(it.key, { status: 'estimating', error: undefined });
    try {
      const est = await estimateFromPhotos(it.images, input);
      patch(it.key, { status: 'saving' });
      const { id, warnings } = await createProductFromEstimate(inquiryId, est, input, it.images[0] ?? null);
      patch(it.key, { status: 'done', productId: id, productName: it.name.trim() || est.name, warnings });
      return warnings.length ? null : id;
    } catch (e: any) {
      patch(it.key, { status: 'error', error: e?.message || 'Estimate failed' });
      return null;
    }
  };

  const runAll = async () => {
    const queue = itemsRef.current.filter(it => (it.status === 'ready' || it.status === 'error') && isReady(it));
    if (!queue.length) return;
    const total = queue.length;
    const clean: string[] = [];
    setRunning(true);
    await Promise.all(Array.from({ length: Math.min(PARALLEL, total) }, async () => {
      for (let it = queue.shift(); it; it = queue.shift()) { const id = await runOne(it); if (id) clean.push(id); }
    }));
    setRunning(false);
    onCreated();
    // Everything went through without a warning: go straight to the workspace. Otherwise stay so
    // the failures and warnings can be read.
    if (clean.length === total) {
      toast.success(`Drafted ${total} product${total === 1 ? '' : 's'} from photos`);
      onOpenChange(false);
      navigate(`/inquiry/${inquiryId}/costing${total === 1 ? `?sku=${clean[0]}` : ''}`);
    }
  };

  const pending = items.filter(it => it.status === 'ready' || it.status === 'error');
  const readyCount = pending.filter(isReady).length;
  const doneCount = items.filter(it => it.status === 'done').length;

  return (
    <Dialog open={open} onOpenChange={o => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Add products from photos</DialogTitle>
          <DialogDescription>
            For each product, add a photo and its outer size. Claude drafts the type, wood share, finishing and likely costs
            from your recent costings, and the product opens in the costing workspace marked as estimated. Check it before quoting.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sizes in</span>
          <div className="inline-flex rounded-md border p-0.5">
            {(['in', 'cm', 'mm'] as const).map(u => (
              <button key={u} type="button" disabled={running}
                className={cn('rounded px-2.5 py-1 text-xs', unit === u ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                onClick={() => setUnit(u)}>{u === 'in' ? 'inch' : u}</button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {items.map((it, i) => (
            <ItemCard key={it.key} it={it} index={i} unit={unit} locked={running || it.status === 'done'}
              canRemove={items.length > 1 && !busyStatus(it.status)}
              onPatch={p => patch(it.key, p)}
              onRemove={() => setItems(prev => prev.filter(x => x.key !== it.key))}
              onOpen={() => { onOpenChange(false); navigate(`/inquiry/${inquiryId}/costing?sku=${it.productId}`); }} />
          ))}
        </div>

        <Button variant="outline" size="sm" className="w-fit gap-1.5" disabled={running} onClick={() => setItems(prev => [...prev, blank()])}>
          <Plus className="h-3.5 w-3.5" /> Another product
        </Button>

        <DialogFooter className="gap-2 sm:items-center">
          <span className="mr-auto text-xs text-muted-foreground">Each photo costs roughly ₹5–15 of Claude usage.</span>
          {doneCount > 0 && !running && (
            <Button variant="outline" onClick={() => { onOpenChange(false); navigate(`/inquiry/${inquiryId}/costing`); }}>Open costing workspace</Button>
          )}
          <Button onClick={() => void runAll()} disabled={running || readyCount === 0} className="gap-1.5">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'Drafting…' : readyCount > 1 ? `Draft ${readyCount} products` : 'Draft product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemCard({ it, index, unit, locked, canRemove, onPatch, onRemove, onOpen }: {
  it: Item; index: number; unit: DimUnit; locked: boolean; canRemove: boolean;
  onPatch: (p: Partial<Item>) => void; onRemove: () => void; onOpen: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const add = async (files: FileList | null | undefined) => {
    if (!files?.length) return;
    setReadError(null);
    const room = MAX_PHOTOS - it.images.length;
    try {
      const next = await Promise.all(Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, room).map(prepareImage));
      onPatch({ images: [...it.images, ...next] });
    } catch { setReadError('Could not read that image. Try a JPEG or PNG.'); }
  };

  return (
    <div className={cn('rounded-lg border p-3', it.status === 'done' && 'border-emerald-500/40 bg-emerald-500/[0.03]', it.status === 'error' && 'border-destructive/40')}>
      <div className="mb-2 flex items-center gap-2 text-sm">
        <span className="font-medium">Product {index + 1}</span>
        <StatusLine it={it} />
        {it.status === 'done' && <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={onOpen}>Open</Button>}
        {canRemove && it.status !== 'done' && (
          <Button size="icon" variant="ghost" className="ml-auto h-7 w-7" onClick={onRemove} aria-label="Remove product"><Trash2 className="h-3.5 w-3.5" /></Button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 gap-2">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void add(e.target.files); e.target.value = ''; }} />
          {it.images.map((img, k) => (
            <div key={k} className="relative">
              <img src={img.preview} alt="" className="h-20 w-20 rounded-md border bg-muted object-cover" />
              {!locked && (
                <button type="button" className="absolute -right-1.5 -top-1.5 rounded-full border bg-background p-0.5 shadow-sm" aria-label="Remove photo"
                  onClick={() => onPatch({ images: it.images.filter((_, j) => j !== k) })}><X className="h-3 w-3" /></button>
              )}
            </div>
          ))}
          {!locked && it.images.length < MAX_PHOTOS && (
            <button type="button" onClick={() => fileRef.current?.click()}
              onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void add(e.dataTransfer.files); }}
              className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground">
              <span className="flex gap-1"><ImagePlus className="h-4 w-4" /><Camera className="h-4 w-4" /></span>
              {it.images.length ? 'Another angle' : 'Photo'}
            </button>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(['w', 'd', 'h'] as const).map((k, j) => (
              <span key={k} className="flex items-center gap-1.5">
                {j > 0 && <span className="text-muted-foreground">×</span>}
                <Input type="number" inputMode="decimal" min={0} step="any" disabled={locked} aria-label={{ w: 'Width', d: 'Depth', h: 'Height' }[k]}
                  placeholder={k.toUpperCase()} value={it[k]} onChange={e => onPatch({ [k]: e.target.value } as Partial<Item>)} className="h-9 w-20" />
              </span>
            ))}
            <span className="text-xs text-muted-foreground">{unit === 'in' ? 'inch' : unit}</span>
            <Input type="number" inputMode="numeric" min={0} disabled={locked} aria-label="Quantity" placeholder="Qty 100"
              value={it.qty} onChange={e => onPatch({ qty: e.target.value })} className="ml-auto h-9 w-24" />
          </div>
          <Input disabled={locked} placeholder="Name (optional, Claude suggests one)" value={it.name} onChange={e => onPatch({ name: e.target.value })} className="h-9" />
          <Textarea disabled={locked} rows={2} placeholder="What is it? Wood, finish, anything hidden in the photo (optional, helps a lot)"
            value={it.notes} onChange={e => onPatch({ notes: e.target.value })} />
          {readError && <p className="text-xs text-destructive">{readError}</p>}
          {it.status === 'error' && <p className="flex items-start gap-1.5 text-xs text-destructive"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{it.error}</p>}
          {it.status === 'done' && !!it.warnings?.length && (
            <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">{it.warnings.map((w, k) => <li key={k}>• {w}</li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusLine({ it }: { it: Item }) {
  if (it.status === 'estimating') return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Reading the photo…</span>;
  if (it.status === 'saving') return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Adding to the inquiry…</span>;
  if (it.status === 'done') return <span className="flex min-w-0 items-center gap-1 truncate text-xs text-emerald-700 dark:text-emerald-400"><Check className="h-3 w-3 shrink-0" /> Added {it.productName}</span>;
  if (it.status === 'error') return <span className="flex items-center gap-1 text-xs text-destructive"><RotateCcw className="h-3 w-3" /> Failed, draft again to retry</span>;
  if (!isReady(it)) return <span className="text-xs text-muted-foreground">{it.images.length ? 'Enter W × D × H' : 'Add a photo and W × D × H'}</span>;
  return null;
}
