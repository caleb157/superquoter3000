import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Plus, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Generic dialog for viewing & editing the history of a status/stage field.
 * Used for: customer lead status, inquiry status, product stage events.
 *
 * Backdating works by editing the `occurred_at` column on each event row,
 * not by mutating the parent record. This preserves a clean audit trail.
 */

export type HistoryConfig = {
  /** Table that stores the events */
  table: 'customer_status_events' | 'inquiry_status_events' | 'product_stage_events';
  /** FK column linking events to the parent record */
  parentColumn: 'customer_id' | 'inquiry_id' | 'product_id';
  /** Parent record id */
  parentId: string;
  /** Allowed values for to_status / to_stage */
  options: string[];
  /** Column name used for the "value" in this table */
  valueColumn: 'to_status' | 'to_stage';
  /** Column name for the previous value */
  fromColumn: 'from_status' | 'from_stage';
  /** Optional extra column required when inserting (e.g. product_stage_events.track) */
  extraInsert?: Record<string, any>;
  /** Optional filter applied when loading events (e.g. {track: 'design'}) */
  filter?: Record<string, any>;
  /** Human label shown in the dialog title */
  label: string;
};

type EventRow = {
  id: string;
  occurred_at: string;
  from_status?: string | null;
  to_status?: string | null;
  from_stage?: string | null;
  to_stage?: string | null;
  actor?: string | null;
  note?: string | null;
  track?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: HistoryConfig;
  /** Called when an edit/insert/delete is saved so the parent can re-fetch if needed */
  onChanged?: () => void;
};

// datetime-local needs YYYY-MM-DDTHH:mm (no seconds, no timezone)
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

export function EditHistoryDialog({ open, onOpenChange, config, onChanged }: Props) {
  const [rows, setRows] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState<string>(config.options[0] ?? '');
  const [newDate, setNewDate] = useState<string>(toLocalInput(new Date().toISOString()));
  const [newNote, setNewNote] = useState('');

  const valueCol = config.valueColumn;
  const fromCol = config.fromColumn;

  const load = async () => {
    setLoading(true);
    let q: any = (supabase as any)
      .from(config.table)
      .select('*')
      .eq(config.parentColumn, config.parentId)
      .order('occurred_at', { ascending: false });
    if (config.filter) {
      for (const [k, v] of Object.entries(config.filter)) q = q.eq(k, v);
    }
    const { data, error } = await q;
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data || []) as EventRow[]);
  };

  useEffect(() => {
    if (open) {
      load();
      setNewValue(config.options[0] ?? '');
      setNewDate(toLocalInput(new Date().toISOString()));
      setNewNote('');
      setAdding(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config.parentId, config.table]);

  const updateRow = async (id: string, patch: Partial<EventRow>) => {
    setSaving(id);
    const { error } = await (supabase as any).from(config.table).update(patch).eq('id', id);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
    onChanged?.();
  };

  const deleteRow = async (id: string) => {
    if (!confirm('Delete this history entry? This cannot be undone.')) return;
    const { error } = await (supabase as any).from(config.table).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRows(rs => rs.filter(r => r.id !== id));
    toast.success('Entry deleted');
    onChanged?.();
  };

  const addRow = async () => {
    if (!newValue) { toast.error('Pick a value'); return; }
    const occurred_at = fromLocalInput(newDate);
    // from_* should be the previous (in time) event's value, if any
    const prev = [...rows]
      .filter(r => new Date(r.occurred_at).getTime() < new Date(occurred_at).getTime())
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0];
    const prevValue = prev ? (prev as any)[valueCol] : null;

    const insertPayload: any = {
      [config.parentColumn]: config.parentId,
      [valueCol]: newValue,
      [fromCol]: prevValue,
      occurred_at,
      note: newNote.trim() || null,
      ...(config.extraInsert || {}),
    };
    setSaving('__new__');
    const { error } = await (supabase as any).from(config.table).insert(insertPayload);
    setSaving(null);
    if (error) { toast.error(error.message); return; }
    setAdding(false);
    setNewNote('');
    toast.success('History entry added');
    await load();
    onChanged?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit history — {config.label}</DialogTitle>
          <DialogDescription>
            Change the date/time of past events to reflect when they actually happened.
            Useful for migrating in older records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No history yet.</div>
          ) : (
            rows.map(r => {
              const value = (r as any)[valueCol] as string;
              const from = (r as any)[fromCol] as string | null;
              return (
                <div key={r.id} className="grid grid-cols-12 gap-2 items-center border rounded-md p-2 text-sm">
                  <div className="col-span-12 sm:col-span-3">
                    <Label className="text-[10px] text-muted-foreground">Status</Label>
                    <Select value={value} onValueChange={(v) => updateRow(r.id, { [valueCol]: v } as any)}>
                      <SelectTrigger className="h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {config.options.map(o => <SelectItem key={o} value={o} className="capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {from && <div className="text-[10px] text-muted-foreground mt-0.5 capitalize">from {from.replace(/_/g, ' ')}</div>}
                  </div>
                  <div className="col-span-8 sm:col-span-5">
                    <Label className="text-[10px] text-muted-foreground">Occurred at</Label>
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={toLocalInput(r.occurred_at)}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        updateRow(r.id, { occurred_at: fromLocalInput(v) });
                      }}
                    />
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {format(parseISO(r.occurred_at), 'PPp')}
                      {r.actor && r.actor !== 'system' && ` · ${r.actor}`}
                    </div>
                  </div>
                  <div className="col-span-3 sm:col-span-3">
                    <Label className="text-[10px] text-muted-foreground">Note</Label>
                    <Input
                      className="h-8 text-xs"
                      defaultValue={r.note ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== (r.note ?? null)) updateRow(r.id, { note: v });
                      }}
                    />
                  </div>
                  <div className="col-span-1 sm:col-span-1 flex justify-end">
                    {saving === r.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteRow(r.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {adding && (
            <div className={cn('grid grid-cols-12 gap-2 items-end border-2 border-dashed rounded-md p-2 text-sm bg-muted/30')}>
              <div className="col-span-12 sm:col-span-3">
                <Label className="text-[10px] text-muted-foreground">Status</Label>
                <Select value={newValue} onValueChange={setNewValue}>
                  <SelectTrigger className="h-8 text-xs capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {config.options.map(o => <SelectItem key={o} value={o} className="capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-8 sm:col-span-5">
                <Label className="text-[10px] text-muted-foreground">Occurred at</Label>
                <Input type="datetime-local" className="h-8 text-xs" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
              <div className="col-span-12 sm:col-span-3">
                <Label className="text-[10px] text-muted-foreground">Note</Label>
                <Textarea rows={1} className="text-xs min-h-8" value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Optional" />
              </div>
              <div className="col-span-12 sm:col-span-1 flex sm:justify-end gap-1">
                <Button size="sm" className="h-8" onClick={addRow} disabled={saving === '__new__'}>
                  {saving === '__new__' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {!adding ? (
            <Button variant="outline" size="sm" className="gap-1.5 mr-auto" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Add past event
            </Button>
          ) : (
            <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setAdding(false)}>Cancel add</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
