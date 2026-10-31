import { Fragment, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlarmClock, ChevronDown, ChevronRight, Loader2, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { buildLateReport, type AttendanceEntry, type LateSettings, type EmployeeLateRow, type Warning } from '@/lib/late-report';

const DEFAULTS: LateSettings = { late_start: '09:15', late_end: '09:45', very_late_start: '09:45', very_late_limit: 2, grace_count: 0, penalty_inr: 100, hr_tag: 'Discipline' };
const hm = (t: string) => t.slice(0, 5);
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const monthStart = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export default function LateReport() {
  useDocumentTitle('Late Report');
  const [settings, setSettings] = useState<LateSettings>(DEFAULTS);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [entries, setEntries] = useState<AttendanceEntry[] | null>(null);
  const [ran, setRan] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    supabase.from('late_report_settings').select('*').maybeSingle().then(({ data }) => {
      if (data) setSettings({ ...data, late_start: hm(data.late_start), late_end: hm(data.late_end), very_late_start: hm(data.very_late_start), penalty_inr: Number(data.penalty_inr) });
    });
  }, []);

  const rows = useMemo(() => entries && ran ? buildLateReport(entries, settings, ran.from, ran.to) : [], [entries, settings, ran]);
  const allWarnings = useMemo(() => rows.flatMap(r => r.warnings.map(w => ({ r, w }))), [rows]);

  useEffect(() => {
    const keys = allWarnings.map(x => x.w.key);
    if (!keys.length) { setLogged(new Set()); return; }
    supabase.from('hr_notes').select('source_key').in('source_key', keys).then(({ data }) => setLogged(new Set((data ?? []).map(d => d.source_key!))));
  }, [allWarnings]);

  const run = async () => {
    if (from > to) { toast.error('Start date is after end date'); return; }
    setLoading(true); setSelected(new Set());
    const { data, error } = await supabase.functions.invoke('odoo-late-report', { body: { from, to } });
    setLoading(false);
    if (error || data?.error) {
      let msg = data?.error || error?.message || 'Odoo request failed';
      try { msg = (await (error as { context?: Response })?.context?.json())?.error || msg; } catch { /* keep */ }
      toast.error(String(msg)); return;
    }
    setEntries(data.entries ?? []); setRan({ from, to });
  };

  const createNotes = async () => {
    const picks = allWarnings.filter(x => selected.has(x.w.key) && !logged.has(x.w.key));
    if (!picks.length) return;
    setCreating(true);
    const notes = picks.map(({ r, w }) => noteRow(r, w, settings, ran!));
    const { error } = await supabase.from('hr_notes').upsert(notes, { onConflict: 'source_key', ignoreDuplicates: true });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${picks.length} HR note${picks.length > 1 ? 's' : ''} created`);
    setLogged(s => new Set([...s, ...picks.map(p => p.w.key)])); setSelected(new Set());
  };

  const openable = allWarnings.filter(x => !logged.has(x.w.key));
  const totals = { people: rows.length, late: rows.reduce((a, r) => a + r.lateCount, 0), penalty: rows.reduce((a, r) => a + r.penaltyInr, 0), warnings: allWarnings.length };

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center gap-2">
          <h1 className="page-title flex items-center gap-2 flex-1"><AlarmClock className="h-5 w-5 text-muted-foreground" /> Late Report</h1>
          <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4 mr-1" />Settings</Button>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 w-40" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 w-40" /></div>
          <Button size="sm" onClick={run} disabled={loading}>{loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Run report</Button>
          <p className="text-xs text-muted-foreground ml-auto">
            Late {settings.late_start}–{settings.late_end} · Very late from {settings.very_late_start} · {settings.grace_count} forgiven · {inr(settings.penalty_inr)}/late · warning after {settings.very_late_limit} very late
          </p>
        </div>

        {ran && (
          <>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
              {[['People with late entries', totals.people], ['Late arrivals', totals.late], ['Total penalty', inr(totals.penalty)], ['Warnings', totals.warnings]].map(([l, v]) => (
                <Card key={l as string}><CardContent className="p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-lg font-semibold">{v}</p></CardContent></Card>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={!openable.length} onClick={() => setSelected(new Set(openable.map(x => x.w.key)))}>Select all warnings</Button>
              <Button size="sm" disabled={!selected.size || creating} onClick={createNotes}>
                {creating && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Create HR notes ({selected.size})
              </Button>
              <span className="text-xs text-muted-foreground">Tag: {settings.hr_tag}</span>
            </div>
            <div className="border rounded-md overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr><th className="text-left p-2">Employee</th><th className="p-2 text-right">Late</th><th className="p-2 text-right">Penalty</th><th className="p-2 text-right">Very late</th><th className="p-2 text-right">Warnings</th></tr>
                </thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">No late arrivals in this range.</td></tr>}
                  {rows.map(r => {
                    const isOpen = open.has(r.employeeId);
                    return (
                      <Fragment key={r.employeeId}>
                        <tr className="border-t cursor-pointer hover:bg-muted/30" onClick={() => setOpen(s => { const n = new Set(s); n.has(r.employeeId) ? n.delete(r.employeeId) : n.add(r.employeeId); return n; })}>
                          <td className="p-2 flex items-center gap-1">{isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}{r.employeeName}</td>
                          <td className="p-2 text-right">{r.lateCount}</td>
                          <td className="p-2 text-right" title={`${r.lateCount} late − ${settings.grace_count} forgiven = ${r.chargeableLate} × ${inr(settings.penalty_inr)}`}>{inr(r.penaltyInr)}</td>
                          <td className="p-2 text-right">{r.veryLateCount}</td>
                          <td className="p-2 text-right">{r.warnings.length ? <Badge variant="destructive">{r.warnings.length}</Badge> : 0}</td>
                        </tr>
                        {isOpen && r.arrivals.map(a => {
                          const w = r.warnings.find(x => x.date === a.date);
                          return (
                            <tr key={a.date} className="bg-muted/20 text-xs">
                              <td className="p-1.5 pl-8">{a.date} · signed in {a.time}</td>
                              <td className="p-1.5 text-right">{a.late ? 'Late' : ''}</td>
                              <td />
                              <td className="p-1.5 text-right">{a.veryLate ? 'Very late' : ''}</td>
                              <td className="p-1.5 text-right">
                                {w && (logged.has(w.key)
                                  ? <Badge variant="secondary">Warning #{w.number} · HR note logged</Badge>
                                  : <label className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                      <Checkbox checked={selected.has(w.key)} onCheckedChange={c => setSelected(s => { const n = new Set(s); c ? n.add(w.key) : n.delete(w.key); return n; })} />
                                      Warning #{w.number}
                                    </label>)}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">Uses each person's first Odoo check-in of the day (India time). Click a name to see the days.</p>
          </>
        )}
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} value={settings} onSaved={setSettings} />
    </AppLayout>
  );
}

function noteRow(r: EmployeeLateRow, w: Warning, s: LateSettings, range: { from: string; to: string }) {
  return {
    employees: [{ id: r.employeeId, name: r.employeeName }], employee_odoo_id: r.employeeId, employee_name: r.employeeName,
    tag: s.hr_tag, status: 'Active', source_key: w.key,
    title: `Attendance warning #${w.number}: very late on ${w.date} (${w.time})`,
    notes: `Signed in at ${w.time} on ${w.date}. Very late ${r.veryLateCount} times between ${range.from} and ${range.to} (limit ${s.very_late_limit}); this is warning #${w.number}.`,
    created_at: new Date(`${w.date}T12:00:00+05:30`).toISOString(),
  };
}

function SettingsDialog({ open, onOpenChange, value, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; value: LateSettings; onSaved: (s: LateSettings) => void }) {
  const [v, setV] = useState(value);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setV(value);
    supabase.from('hr_note_tags').select('name').order('created_at').then(({ data }) => setTags((data ?? []).map(t => t.name)));
  }, [open, value]);
  const set = <K extends keyof LateSettings>(k: K, x: LateSettings[K]) => setV(p => ({ ...p, [k]: x }));
  const save = async () => {
    if (v.late_end <= v.late_start) { toast.error('Late end must be after late start'); return; }
    setSaving(true);
    const { error } = await supabase.from('late_report_settings').upsert({ id: true, ...v, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Settings saved'); onSaved(v); onOpenChange(false);
  };
  const num = (k: 'very_late_limit' | 'grace_count' | 'penalty_inr', label: string) => (
    <div><Label className="text-xs">{label}</Label><Input type="number" min={0} value={v[k]} onChange={e => set(k, Math.max(0, Number(e.target.value) || 0))} className="h-8" /></div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Late Report settings</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label className="text-xs">Late starts at</Label><Input type="time" value={v.late_start} onChange={e => set('late_start', e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs">Late ends at</Label><Input type="time" value={v.late_end} onChange={e => set('late_end', e.target.value)} className="h-8" /></div>
          <div><Label className="text-xs">Very late starts at</Label><Input type="time" value={v.very_late_start} onChange={e => set('very_late_start', e.target.value)} className="h-8" /></div>
          {num('very_late_limit', 'Very late allowed before warning')}
          {num('grace_count', 'Late arrivals forgiven')}
          {num('penalty_inr', 'Penalty per late (₹)')}
          <div className="col-span-2"><Label className="text-xs">HR note tag for warnings</Label>
            <Select value={v.hr_tag} onValueChange={x => set('hr_tag', x)}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{[...new Set([v.hr_tag, ...tags])].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
