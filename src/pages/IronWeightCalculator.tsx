// Iron Weight Calculator (/tools/iron-weight): weight and cost of iron furniture parts built
// from bars and tubes. Math lives in src/lib/iron-weight-core.ts; this page edits a Build,
// keeps a local working draft, saves named builds by SKU (iron_builds) and can draft the
// parts from a photo (estimate-iron-parts function).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FolderOpen, Plus, RotateCcw, Save, Sparkles, Weight } from 'lucide-react';
import { toast } from 'sonner';
import { AppLayout } from '@/components/AppLayout';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AssemblyCard } from '@/components/iron-weight/AssemblyCard';
import { MISSING_TABLE_MSG, OpenBuildDialog, SaveBuildDialog } from '@/components/iron-weight/BuildsDialogs';
import { NumInput } from '@/components/iron-weight/PartRow';
import { PhotoEstimateDialog } from '@/components/iron-weight/PhotoEstimateDialog';
import { ResultsCard } from '@/components/iron-weight/ResultsCard';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { grandTotal } from '@/lib/iron-weight-core';
import { getBuild, isMissingTable } from '@/lib/iron-builds';
import {
  exampleBuild, kg, loadDraft, newId, part, rupees, saveDraft, summaryText,
  type Draft, type EditLeg,
} from '@/lib/iron-weight';

export default function IronWeightCalculator() {
  useDocumentTitle('Iron Weight Calculator');
  const [draft, setDraft] = useState<Draft>(() => loadDraft() ?? { ...exampleBuild(), loaded: null });
  const [photoOpen, setPhotoOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [estimateNote, setEstimateNote] = useState<{ summary: string; assumptions: string[] } | null>(null);

  useEffect(() => saveDraft(draft), [draft]);

  const price = draft.pricePerKg && draft.pricePerKg > 0 ? draft.pricePerKg : null;
  const total = useMemo(() => grandTotal(draft.legs, { pricePerKg: price ?? undefined }), [draft.legs, price]);
  const loaded = draft.loaded ?? null;
  const summary = useMemo(
    () => summaryText(draft, loaded ? `Iron weight — ${loaded.sku}${loaded.label ? ` · ${loaded.label}` : ''}` : undefined),
    [draft, loaded],
  );

  const setLegs = (fn: (legs: EditLeg[]) => EditLeg[]) => setDraft(d => ({ ...d, legs: fn(d.legs) }));
  const setLeg = (id: string, next: EditLeg) => setLegs(ls => ls.map(l => (l.id === id ? next : l)));
  const addLeg = () => setLegs(ls => [...ls, {
    id: newId(), name: `Assembly ${ls.length + 1}`, qty: 1, parts: [part('Part 1', 'rect_tube', { w: 40, h: 20, t: 2 }, 700, 1)],
  }]);
  const duplicateLeg = (leg: EditLeg) => setLegs(ls => {
    const i = ls.findIndex(l => l.id === leg.id);
    const copy = { ...leg, id: newId(), name: `${leg.name} (copy)`, parts: leg.parts.map(p => ({ ...p, id: newId(), dims: { ...p.dims } })) };
    return [...ls.slice(0, i + 1), copy, ...ls.slice(i + 1)];
  });

  const openBuild = async (id: string) => {
    try {
      const row = await getBuild(id);
      setDraft({ pricePerKg: row.data.pricePerKg ?? row.price_per_kg, legs: row.data.legs, loaded: { id: row.id, sku: row.sku, label: row.label } });
      setEstimateNote(null);
      toast.success(`Opened ${row.sku}${row.label ? ` · ${row.label}` : ''}`);
    } catch (e: any) {
      toast.error(isMissingTable(e) ? MISSING_TABLE_MSG : e?.message || 'Could not open build');
    }
  };

  return (
    <AppLayout>
      <TooltipProvider delayDuration={200}>
        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
          {/* Title + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/tools">
              <Button variant="ghost" size="sm" className="h-8 gap-1.5"><ArrowLeft className="h-3.5 w-3.5" /> Tools</Button>
            </Link>
            <h1 className="text-lg font-semibold flex items-center gap-2"><Weight className="h-4 w-4" /> Iron Weight Calculator</h1>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-8 gap-1.5" onClick={() => setPhotoOpen(true)}><Sparkles className="h-3.5 w-3.5" /> From photo</Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setOpenOpen(true)}><FolderOpen className="h-3.5 w-3.5" /> Open</Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setSaveOpen(true)}><Save className="h-3.5 w-3.5" /> Save</Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-muted-foreground" onClick={() => setResetOpen(true)}><RotateCcw className="h-3.5 w-3.5" /> Reset to example</Button>
            </div>
          </div>

          {/* Build identity + price */}
          <Card className="flex flex-wrap items-end gap-x-6 gap-y-3 p-3 sm:p-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Build</div>
              <div className="truncate font-medium">
                {loaded ? <>{loaded.sku}{loaded.label && <span className="text-muted-foreground font-normal"> · {loaded.label}</span>}</> : <span className="text-muted-foreground font-normal">Unsaved — your work is kept on this device until you save it under a SKU</span>}
              </div>
            </div>
            <div className="text-sm text-muted-foreground">Wrought iron · 7750 kg/m³</div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Price per kg ₹</span>
              <NumInput label="Price per kg (₹)" value={draft.pricePerKg ?? NaN} className="w-24"
                onChange={n => setDraft(d => ({ ...d, pricePerKg: Number.isFinite(n) ? n : null }))} />
            </label>
          </Card>

          {/* Phone: total stays in view while editing */}
          <div className="lg:hidden sticky top-12 z-20 -mx-4 border-y bg-background/95 px-4 py-2 backdrop-blur">
            {total.ok ? (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-lg font-semibold tabular-nums">{kg(total.totalKg)} kg</span>
                {total.totalCost != null && <span className="font-semibold text-primary tabular-nums">{rupees(total.totalCost)}</span>}
              </div>
            ) : <span className="text-sm font-medium text-destructive">Fix the highlighted fields to see the total</span>}
          </div>

          {estimateNote && (
            <Card className="border-amber-300/60 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="min-w-0 space-y-1">
                  <p><span className="font-medium">Estimated from photo.</span> {estimateNote.summary}</p>
                  {estimateNote.assumptions.length > 0 && (
                    <ul className="list-disc pl-4 text-muted-foreground">{estimateNote.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  )}
                </div>
                <Button variant="ghost" size="sm" className="ml-auto h-7 shrink-0" onClick={() => setEstimateNote(null)}>Dismiss</Button>
              </div>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
            <div className="space-y-3 min-w-0">
              {draft.legs.map(leg => (
                <AssemblyCard key={leg.id} leg={leg} price={price}
                  onChange={next => setLeg(leg.id, next)}
                  onRemove={() => setLegs(ls => ls.filter(l => l.id !== leg.id))}
                  onDuplicate={() => duplicateLeg(leg)} />
              ))}
              <Button variant="outline" className="w-full gap-1.5 border-dashed" onClick={addLeg}><Plus className="h-4 w-4" /> Add assembly</Button>
            </div>
            <div className="lg:sticky lg:top-16">
              <ResultsCard build={draft} total={total} summary={summary} />
            </div>
          </div>
        </div>

        <PhotoEstimateDialog open={photoOpen} onOpenChange={setPhotoOpen} hasWork={draft.legs.length > 0}
          onApply={(legs, mode, est) => {
            setDraft(d => ({ ...d, legs: mode === 'add' ? [...d.legs, ...legs] : legs, loaded: mode === 'add' ? d.loaded : null }));
            setEstimateNote({ summary: est.summary, assumptions: est.assumptions ?? [] });
          }} />
        <SaveBuildDialog open={saveOpen} onOpenChange={setSaveOpen} build={draft} initial={loaded}
          onSaved={meta => setDraft(d => ({ ...d, loaded: { id: meta.id, sku: meta.sku, label: meta.label } }))} />
        <OpenBuildDialog open={openOpen} onOpenChange={setOpenOpen} onOpen={id => void openBuild(id)} currentId={loaded?.id ?? null}
          onDeleted={id => { if (loaded?.id === id) setDraft(d => ({ ...d, loaded: null })); }} />
        <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset to the example?</AlertDialogTitle>
              <AlertDialogDescription>This replaces what's on screen with the example U-frame and solid-bar legs. Saved builds are not affected.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setDraft({ ...exampleBuild(), loaded: null }); setEstimateNote(null); }}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TooltipProvider>
    </AppLayout>
  );
}
