// Save the current build under a SKU, and open/delete saved builds.
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { deleteBuild, findBuild, isMissingTable, listBuilds, saveBuild, type IronBuildMeta } from '@/lib/iron-builds';
import { kg, rupees, type Build } from '@/lib/iron-weight';

export const MISSING_TABLE_MSG = 'Saving builds needs a one-time database update (the iron_builds table). The calculator works without it.';

export function SaveBuildDialog({ open, onOpenChange, build, initial, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; build: Build;
  initial: { sku: string; label: string } | null;
  onSaved: (meta: IronBuildMeta) => void;
}) {
  const [sku, setSku] = useState('');
  const [label, setLabel] = useState('');
  const [existing, setExisting] = useState<IronBuildMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setSku(initial?.sku ?? ''); setLabel(initial?.label ?? ''); setError(null); } }, [open, initial]);
  // Warn before overwriting a different build that already uses this SKU + label.
  useEffect(() => {
    if (!open || !sku.trim()) { setExisting(null); return; }
    const t = setTimeout(() => {
      findBuild(sku.trim(), label.trim()).then(setExisting).catch(e => { setExisting(null); if (isMissingTable(e)) setError(MISSING_TABLE_MSG); });
    }, 250);
    return () => clearTimeout(t);
  }, [open, sku, label]);

  const overwriting = existing && !(initial && existing.sku === initial.sku && existing.label === initial.label);
  const submit = async () => {
    if (!sku.trim()) return;
    setBusy(true); setError(null);
    try {
      const meta = await saveBuild(sku.trim(), label.trim(), build);
      toast.success(`Saved ${meta.sku}${meta.label ? ` · ${meta.label}` : ''}`);
      onSaved(meta); onOpenChange(false);
    } catch (e: any) {
      setError(isMissingTable(e) ? MISSING_TABLE_MSG : e?.message || 'Could not save');
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save build</DialogTitle>
          <DialogDescription>Saved builds are shared with your team. The SKU is just a name here — it doesn't have to exist in Products.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
          <div className="space-y-1">
            <Label htmlFor="ib-sku">SKU</Label>
            <Input id="ib-sku" autoFocus value={sku} onChange={e => setSku(e.target.value)} placeholder="e.g. CN-4733-SC" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ib-label">Version / note <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="ib-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. 40×20 tube option" />
          </div>
          {overwriting && <p className="text-sm text-warning">A build named {existing!.sku}{existing!.label ? ` · ${existing!.label}` : ''} already exists. Saving will replace it.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!sku.trim() || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}{overwriting ? 'Replace' : 'Save'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OpenBuildDialog({ open, onOpenChange, onOpen, currentId, onDeleted }: {
  open: boolean; onOpenChange: (o: boolean) => void; onOpen: (id: string) => void; currentId: string | null; onDeleted: (id: string) => void;
}) {
  const [rows, setRows] = useState<IronBuildMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(null); setError(null); setQ(''); setConfirmId(null);
    listBuilds().then(setRows).catch(e => { setRows([]); setError(isMissingTable(e) ? MISSING_TABLE_MSG : e?.message || 'Could not load builds'); });
  }, [open]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter(r => !s || `${r.sku} ${r.label}`.toLowerCase().includes(s));
  }, [rows, q]);

  const remove = async (id: string) => {
    try { await deleteBuild(id); setRows(r => (r ?? []).filter(x => x.id !== id)); onDeleted(id); toast.success('Build deleted'); }
    catch (e: any) { toast.error(e?.message || 'Could not delete'); }
    setConfirmId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Saved builds</DialogTitle>
          <DialogDescription>Open a build to load it into the calculator.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU" className="pl-8" />
        </div>
        <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
          {rows == null ? (
            <div className="py-8 grid place-items-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : error ? (
            <p className="py-6 text-sm text-destructive">{error}</p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{rows.length ? 'No builds match.' : 'No saved builds yet. Use Save to keep the current build under a SKU.'}</p>
          ) : (
            <ul className="divide-y">
              {shown.map(r => (
                <li key={r.id} className="flex items-center gap-2 py-2">
                  <button className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => { onOpen(r.id); onOpenChange(false); }}>
                    <div className="truncate font-medium">{r.sku}{r.label ? <span className="font-normal text-muted-foreground"> · {r.label}</span> : null}
                      {r.id === currentId && <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">OPEN</span>}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {r.total_kg != null ? `${kg(Number(r.total_kg))} kg` : 'incomplete'}{r.total_cost != null ? ` · ${rupees(Number(r.total_cost))}` : ''} · {new Date(r.updated_at).toLocaleDateString()}
                    </div>
                  </button>
                  {confirmId === r.id ? (
                    <Button size="sm" variant="destructive" onClick={() => void remove(r.id)}>Delete</Button>
                  ) : (
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.sku}`} onClick={() => setConfirmId(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
