// Loads and saves the manual cash-flow entries for one forecast (PV analytics or DKT Cash Flow).
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { ManualEntry, ManualScope } from '@/lib/manual-cash-entries';

const db = supabase as any;
const TABLE = 'cash_flow_manual_entries';
export type ManualDraft = Omit<ManualEntry, 'id' | 'scope'>;

const mapRow = (r: any): ManualEntry => ({
  id: r.id, scope: r.scope, name: r.name ?? '', kind: r.kind === 'income' ? 'income' : 'expense',
  amount: Number(r.amount) || 0, currency: r.currency === 'INR' ? 'INR' : 'USD',
  start_date: String(r.start_date).slice(0, 10), end_date: r.end_date ? String(r.end_date).slice(0, 10) : null,
});

export function useManualCashEntries(scope: ManualScope) {
  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db.from(TABLE).select('*').eq('scope', scope).order('start_date');
    if (error) { setError(error.message); return; }
    setError(null);
    setEntries((data || []).map(mapRow));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const add = async (d: ManualDraft) => {
    const { data, error } = await db.from(TABLE).insert({ ...d, scope }).select('*').single();
    if (error) { toast.error(`Couldn't add the entry: ${error.message}`); return false; }
    setEntries(es => [...es, mapRow(data)].sort((a, b) => a.start_date.localeCompare(b.start_date)));
    return true;
  };
  const update = async (id: string, d: ManualDraft) => {
    const { error } = await db.from(TABLE).update({ ...d, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast.error(`Couldn't save the entry: ${error.message}`); return false; }
    setEntries(es => es.map(e => (e.id === id ? { ...e, ...d } : e)).sort((a, b) => a.start_date.localeCompare(b.start_date)));
    return true;
  };
  const remove = async (id: string) => {
    const { error } = await db.from(TABLE).delete().eq('id', id);
    if (error) { toast.error(`Couldn't delete the entry: ${error.message}`); return; }
    setEntries(es => es.filter(e => e.id !== id));
  };

  return { entries, error, add, update, remove };
}
