// "Manual entries" box under a cash flow chart: add, edit and delete one-off or spread
// income/expense lines. Used by PV analytics and DKT Cash Flow.
import { useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { entryMonths, type ManualEntry } from '@/lib/manual-cash-entries';
import type { ManualDraft } from '@/hooks/use-manual-cash-entries';

type Props = {
  entries: ManualEntry[];
  error?: string | null;
  add: (d: ManualDraft) => Promise<boolean>;
  update: (id: string, d: ManualDraft) => Promise<boolean>;
  remove: (id: string) => void;
  /** Currencies the form offers; the first is the default. DKT is USD only. */
  currencies: ManualEntry['currency'][];
  defaultCurrency?: ManualEntry['currency'];
  fmt: (amount: number, currency: ManualEntry['currency']) => string;
  className?: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const blank = (currency: ManualEntry['currency']): ManualDraft =>
  ({ name: '', kind: 'expense', amount: 0, currency, start_date: today(), end_date: null });
const fieldCls = 'h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring';
const label = (m: string) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function ManualCashEntriesCard({ entries, error, add, update, remove, currencies, defaultCurrency, fmt, className }: Props) {
  const cur0 = defaultCurrency && currencies.includes(defaultCurrency) ? defaultCurrency : currencies[0];
  const [draft, setDraft] = useState<ManualDraft>(() => blank(cur0));
  const [amountText, setAmountText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<ManualDraft>) => setDraft(d => ({ ...d, ...p }));
  const reset = () => { setDraft(blank(cur0)); setAmountText(''); setEditing(null); };

  const amount = Number(amountText.replace(/[,\s]/g, ''));
  const endBefore = !!draft.end_date && draft.end_date.slice(0, 7) < draft.start_date.slice(0, 7);
  const ok = draft.name.trim() && amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.start_date) && !endBefore;
  const n = ok ? entryMonths(draft).length : 0;

  const submit = async () => {
    if (!ok || saving) return;
    setSaving(true);
    const d = { ...draft, name: draft.name.trim(), amount, end_date: draft.end_date || null };
    const done = editing ? await update(editing, d) : await add(d);
    setSaving(false);
    if (done) reset();
  };
  const edit = (e: ManualEntry) => {
    setEditing(e.id);
    setDraft({ name: e.name, kind: e.kind, amount: e.amount, currency: e.currency, start_date: e.start_date, end_date: e.end_date });
    setAmountText(String(e.amount));
  };

  return (
    <div className={cn('rounded-md border bg-muted/20 p-3 space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="text-xs font-semibold">Manual entries</div>
        <div className="text-[11px] text-muted-foreground">Only a date: all of it lands that month. With an end date: split evenly across every month from start to end.</div>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); submit(); }}>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground flex-1 min-w-[10rem]">Name
          <Input className="h-8 text-xs" value={draft.name} placeholder="e.g. Machine purchase" onChange={e => set({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">Type
          <select className={fieldCls} value={draft.kind} onChange={e => set({ kind: e.target.value as ManualDraft['kind'] })}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">Amount{n > 1 ? ' (total)' : ''}
          <div className="flex gap-1">
            {currencies.length > 1 && (
              <select aria-label="Currency" className={fieldCls} value={draft.currency} onChange={e => set({ currency: e.target.value as ManualDraft['currency'] })}>
                {currencies.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <Input className="h-8 w-28 text-xs tabular-nums" inputMode="decimal" value={amountText} placeholder={currencies.length > 1 ? '0' : '$0'} onChange={e => setAmountText(e.target.value)} />
          </div>
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">Date
          <Input type="date" className="h-8 w-36 text-xs" value={draft.start_date} onChange={e => set({ start_date: e.target.value })} />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">End date <span className="sr-only">(optional)</span>
          <div className="flex gap-1 items-center">
            <Input type="date" className={cn('h-8 w-36 text-xs', endBefore && 'border-destructive')} value={draft.end_date ?? ''} onChange={e => set({ end_date: e.target.value || null })} />
            {draft.end_date && <button type="button" aria-label="Clear end date" className="text-muted-foreground hover:text-foreground" onClick={() => set({ end_date: null })}><X className="h-3.5 w-3.5" /></button>}
          </div>
        </label>
        <div className="flex gap-1">
          <Button type="submit" size="sm" className="h-8" disabled={!ok || saving}>
            {editing ? 'Save' : <><Plus className="h-3.5 w-3.5 mr-1" />Add</>}
          </Button>
          {editing && <Button type="button" size="sm" variant="ghost" className="h-8" onClick={reset}>Cancel</Button>}
        </div>
      </form>
      {endBefore && <p className="text-[11px] text-destructive">The end date is before the start date.</p>}
      {ok && n > 1 && <p className="text-[11px] text-muted-foreground">{fmt(amount / n, draft.currency)} a month for {n} months, {label(draft.start_date.slice(0, 7))} to {label(draft.end_date!.slice(0, 7))}.</p>}
      {error && <p className="text-[11px] text-warning">Manual entries didn't load ({error}). If this is new, the database table may still need to be created.</p>}
      {entries.length > 0 && (
        <div className="divide-y text-xs">
          {entries.map(e => {
            const ms = entryMonths(e);
            return (
              <div key={e.id} className={cn('flex items-center gap-3 py-1.5', editing === e.id && 'bg-muted/50')}>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', e.kind === 'income' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive')}>
                  {e.kind === 'income' ? 'In' : 'Out'}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{e.name || 'Unnamed'}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {ms.length > 1 ? `${label(ms[0])} to ${label(ms[ms.length - 1])} · ${fmt(e.amount / ms.length, e.currency)}/mo` : label(ms[0])}
                </span>
                <span className={cn('tabular-nums whitespace-nowrap w-24 text-right', e.kind === 'expense' && 'text-destructive')}>
                  {e.kind === 'expense' ? '−' : ''}{fmt(e.amount, e.currency)}
                </span>
                <button type="button" aria-label={`Edit ${e.name}`} className="text-muted-foreground hover:text-foreground" onClick={() => edit(e)}><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label={`Delete ${e.name}`} className="text-muted-foreground hover:text-destructive" onClick={() => { if (editing === e.id) reset(); remove(e.id); }}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
