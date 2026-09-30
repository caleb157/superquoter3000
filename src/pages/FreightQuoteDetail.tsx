import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { FqHeader } from '@/components/freight-quotes/FqHeader';
import { QuoteEditor, SourceViewer, type EditableQuote } from '@/components/freight-quotes/QuoteEditor';
import { Button } from '@/components/ui/button';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { findDuplicate, laneOf, loadQuote, loadRefs } from '@/lib/freight-quotes/data';
import { resolveRefs, saveEditable, toEditable } from '@/lib/freight-quotes/editable';

export default function FreightQuoteDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof loadRefs>> | null>(null);
  const [q, setQ] = useState<EditableQuote | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dup, setDup] = useState(false);

  useEffect(() => {
    (async () => {
      const [r, quote] = await Promise.all([loadRefs(), loadQuote(id!)]);
      setRefs(r);
      if (quote) { const e = toEditable(quote, r); setQ(e); setDup(!!(await findDuplicate(quote))); }
    })();
  }, [id]);

  const save = async () => {
    if (!q) return;
    try { await saveEditable(q); setDirty(false); toast.success('Saved'); setDup(!!(await findDuplicate(await resolveRefs(q)))); }
    catch (e: any) { toast.error(e.message); }
  };
  const del = async () => {
    const { error } = await (supabase as any).from('fq_quotes').delete().eq('id', id);
    if (error) throw error;
    nav('/freight-quotes');
  };

  return (
    <AppLayout>
      <div className="p-3 md:p-4 max-w-[1600px] mx-auto">
        <FqHeader title={q ? `${q.vendor_name || 'Quote'} · ${laneOf(q)} · ${q.mode}` : 'Freight quote'}
          actions={q && <>
            <ConfirmDeleteButton buttonVariant="outline" className="h-8 px-2 text-xs gap-1 text-destructive" itemLabel="freight quote" onConfirm={del} />
            <Button size="sm" onClick={save} disabled={!dirty}>{dirty ? 'Save changes' : 'Saved'}</Button>
          </>} />
        {dup && <p className="text-xs text-warning mb-2">Possible duplicate: another quote has the same vendor, lane, date and CBM.</p>}
        {!q || !refs ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="grid lg:grid-cols-[minmax(280px,2fr)_5fr] gap-3">
            <div className="lg:sticky lg:top-2 self-start"><SourceViewer path={q.source_file_path} text={q.raw_text} /></div>
            <QuoteEditor value={q} refs={refs} onChange={nq => { setQ(nq); setDirty(true); }} />
          </div>
        )}
      </div>
    </AppLayout>
  );
}
