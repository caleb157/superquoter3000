import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_QUOTE_CLAUSES, type QuoteClause } from '@/lib/quote-terms';

/**
 * Edits the terms and policies printed on this entity's quotes. A quote copies the list when it
 * is created, so changes here apply to new quotes only. `value` null = built-in defaults.
 */
export function EntityTermsEditor({ entityId, value, onSave }: {
  entityId: string;
  value: QuoteClause[] | null;
  onSave: (terms: QuoteClause[] | null) => Promise<void>;
}) {
  const effective = (v: QuoteClause[] | null) => (Array.isArray(v) && v.length > 0 ? v : DEFAULT_QUOTE_CLAUSES);
  const [draft, setDraft] = useState<QuoteClause[]>(() => effective(value).map(c => ({ ...c })));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reload when switching entity.
  useEffect(() => { setDraft(effective(value).map(c => ({ ...c }))); setDirty(false); }, [entityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (next: QuoteClause[]) => { setDraft(next); setDirty(true); };
  const patch = (i: number, p: Partial<QuoteClause>) => edit(draft.map((c, j) => (j === i ? { ...c, ...p } : c)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.length) return;
    const next = [...draft];
    [next[i], next[j]] = [next[j], next[i]];
    edit(next);
  };
  const add = () => edit([...draft, { key: `custom_${Date.now()}`, title: 'New clause', text: '' }]);
  const remove = (i: number) => edit(draft.filter((_, j) => j !== i));

  const save = async (terms: QuoteClause[] | null) => {
    setSaving(true);
    await onSave(terms);
    setSaving(false);
    setDirty(false);
  };
  const resetToDefaults = async () => {
    setDraft(DEFAULT_QUOTE_CLAUSES.map(c => ({ ...c })));
    await save(null);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Quote Terms &amp; Policies</CardTitle>
        <p className="text-xs text-muted-foreground">
          Printed on this entity's quotes: the first four as key terms, all of them on the PDF's last page.
          Each quote keeps the terms it was created with, so edits here apply to new quotes only.
          The Payment clause is replaced by a quote's own payment terms when it has them.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {draft.map((c, i) => (
          <div key={c.key} className="border rounded-md p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
              <Input className="h-8 text-sm font-medium" value={c.title} onChange={e => patch(i, { title: e.target.value })} />
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move(i, -1)} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === draft.length - 1} onClick={() => move(i, 1)} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(i)} title="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <Textarea className="text-sm min-h-[56px]" value={c.text} onChange={e => patch(i, { text: e.target.value })} />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={add}><Plus className="h-3.5 w-3.5" /> Add clause</Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={resetToDefaults} disabled={saving}>Reset to defaults</Button>
          <Button size="sm" onClick={() => save(draft)} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save terms'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
