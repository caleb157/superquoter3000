import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { EntityTermsEditor } from '@/components/EntityTermsEditor';
import { diffQuoteTerms, effectiveQuoteClauses, type QuoteClause } from '@/lib/quote-terms';

type Entity = { id: string; name: string; default_terms: QuoteClause[] | null };
type Change = { id: string; changed_at: string; changed_by_name: string | null; changes: string[] };

/**
 * Settings → Quote Terms: the terms and policies list each selling entity puts on new quotes,
 * plus a changelog of every save. Sent and existing quotes keep the terms they were created with.
 */
export default function QuoteTermsSettings() {
  const { user } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState<string>('');
  const [log, setLog] = useState<Change[] | null>(null);
  const [logMissing, setLogMissing] = useState(false);

  useEffect(() => {
    (supabase as any).from('company_entities').select('id, name, default_terms').order('name')
      .then(({ data }: any) => {
        const list = (data ?? []) as Entity[];
        setEntities(list);
        setEntityId(prev => prev || list[0]?.id || '');
      });
  }, []);

  const loadLog = async (id: string) => {
    const { data, error } = await (supabase as any).from('quote_terms_changes')
      .select('id, changed_at, changed_by_name, changes').eq('entity_id', id)
      .order('changed_at', { ascending: false }).limit(200);
    setLogMissing(!!error);
    setLog(error ? [] : (data ?? []) as Change[]);
  };
  useEffect(() => { if (entityId) loadLog(entityId); }, [entityId]);

  const entity = entities.find(e => e.id === entityId);

  const save = async (terms: QuoteClause[] | null) => {
    if (!entity) return;
    const changes = diffQuoteTerms(effectiveQuoteClauses(entity.default_terms), effectiveQuoteClauses(terms));
    const { error } = await (supabase as any).from('company_entities').update({ default_terms: terms }).eq('id', entity.id);
    if (error) { toast.error(error.message); return; }
    setEntities(prev => prev.map(e => (e.id === entity.id ? { ...e, default_terms: terms } : e)));
    toast.success(terms ? 'Terms saved; new quotes will use them' : 'Terms reset to defaults');
    if (changes.length === 0) return;
    let name: string | null = null;
    if (user?.id) {
      const { data } = await (supabase as any).from('profiles').select('display_name').eq('user_id', user.id).maybeSingle();
      name = data?.display_name || user.email || null;
    }
    const { error: logError } = await (supabase as any).from('quote_terms_changes').insert({
      entity_id: entity.id,
      changed_by_name: name,
      changes: terms ? changes : ['Reset to the built-in defaults', ...changes],
      terms: effectiveQuoteClauses(terms),
    });
    if (logError) toast.error(`Saved, but the change was not logged: ${logError.message}`);
    loadLog(entity.id);
  };

  if (entities.length === 0) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="space-y-4">
      {entities.length > 1 && (
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Entity</Label>
          <Select value={entityId} onValueChange={setEntityId}>
            <SelectTrigger className="h-8 w-56 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {entity && <EntityTermsEditor key={entity.id} entityId={entity.id} value={entity.default_terms} onSave={save} />}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Changelog</CardTitle>
          <p className="text-xs text-muted-foreground">Every save of {entity?.name ?? 'this entity'}'s terms, newest first.</p>
        </CardHeader>
        <CardContent>
          {logMissing ? (
            <p className="text-sm text-muted-foreground">The changelog table isn't set up yet, so changes aren't being logged.</p>
          ) : log == null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : log.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes logged yet.</p>
          ) : (
            <ul className="divide-y">
              {log.map(row => (
                <li key={row.id} className="py-2 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {new Date(row.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    {row.changed_by_name ? ` · ${row.changed_by_name}` : ''}
                  </div>
                  <ul className="mt-0.5 list-disc pl-5">
                    {(row.changes ?? []).map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
