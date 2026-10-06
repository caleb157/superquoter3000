import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Copy, Save } from 'lucide-react';
import { toast } from 'sonner';
import { TASK_TRIGGERS, TEMPLATE_VARIABLES, type TaskTemplate } from '@/lib/task-automation';
import { useAuth } from '@/contexts/AuthContext';

type Rule = { id: string; name: string; trigger_event: string; active: boolean; tasks: TaskTemplate[] };

const WEBHOOK_URL = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/odoo-task-webhook`;

export default function TaskAutomationsSettings() {
  const { isAdmin } = useAuth() as any;
  const [rules, setRules] = useState<Rule[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [token, setToken] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await (supabase as any).from('task_automation_rules').select('*').order('created_at');
    if (error) toast.error(error.message);
    setRules((data ?? []).map((r: any) => ({ ...r, tasks: Array.isArray(r.tasks) ? r.tasks : [] })));
    setDirty(new Set());
    const { data: cfg } = await (supabase as any).from('task_automation_config').select('webhook_token').eq('id', 1).maybeSingle();
    setToken(cfg?.webhook_token ?? null);
  };
  useEffect(() => { load(); }, []);

  const patch = (id: string, p: Partial<Rule>) => {
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...p } : r));
    setDirty(d => new Set(d).add(id));
  };
  const patchTask = (rule: Rule, i: number, p: Partial<TaskTemplate>) =>
    patch(rule.id, { tasks: rule.tasks.map((t, j) => j === i ? { ...t, ...p } : t) });

  const addRule = async () => {
    const { error } = await (supabase as any).from('task_automation_rules').insert({
      name: 'New task set', trigger_event: 'so_confirmed',
      tasks: [{ title: 'Kick off {{so_number}} for {{customer}}', priority: 'normal', due_offset_days: 2 }],
    });
    if (error) toast.error(error.message); else load();
  };
  const save = async (r: Rule) => {
    const { error } = await (supabase as any).from('task_automation_rules')
      .update({ name: r.name, trigger_event: r.trigger_event, active: r.active, tasks: r.tasks }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Saved');
    setDirty(d => { const n = new Set(d); n.delete(r.id); return n; });
  };
  const remove = async (r: Rule) => {
    if (!confirm(`Delete "${r.name}"?`)) return;
    const { error } = await (supabase as any).from('task_automation_rules').delete().eq('id', r.id);
    if (error) toast.error(error.message); else load();
  };
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast.success('Copied'); };

  return (
    <div className="space-y-4 max-w-4xl">
      <p className="text-xs text-muted-foreground">
        When Odoo reports one of the events below, every active task set for that event creates its tasks, already linked to the SO or MO.
        Use variables in titles: {TEMPLATE_VARIABLES.map(v => <code key={v} className="mx-0.5 px-1 rounded bg-muted text-[11px]">{`{{${v}}}`}</code>)}
      </p>

      {rules.map(r => (
        <Card key={r.id}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input value={r.name} onChange={e => patch(r.id, { name: e.target.value })} className="h-8 text-sm w-56 font-medium" />
              <Select value={r.trigger_event} onValueChange={v => patch(r.id, { trigger_event: v })}>
                <SelectTrigger className="h-8 text-xs w-60"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_TRIGGERS.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs">
                <Switch checked={r.active} onCheckedChange={v => patch(r.id, { active: v })} /> Active
              </label>
              <div className="ml-auto flex gap-1">
                <Button size="sm" className="h-8 gap-1" disabled={!dirty.has(r.id)} onClick={() => save(r)}><Save className="h-3.5 w-3.5" />Save</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">{TASK_TRIGGERS.find(t => t.value === r.trigger_event)?.hint}</p>

            <div className="space-y-1.5">
              <div className="grid grid-cols-[1fr_90px_100px_90px_32px] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground px-0.5">
                <span>Task title</span><span>Assignee</span><span>Priority</span><span>Due (+days)</span><span />
              </div>
              {r.tasks.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_90px_100px_90px_32px] gap-2">
                  <Input value={t.title} onChange={e => patchTask(r, i, { title: e.target.value })} className="h-8 text-sm" />
                  <Input value={t.assignee ?? ''} placeholder="—" onChange={e => patchTask(r, i, { assignee: e.target.value || null })} className="h-8 text-sm" />
                  <Select value={t.priority ?? 'normal'} onValueChange={v => patchTask(r, i, { priority: v as any })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['urgent', 'high', 'normal', 'low'].map(p => <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" value={t.due_offset_days ?? ''} placeholder="none"
                    onChange={e => patchTask(r, i, { due_offset_days: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 text-sm" />
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => patch(r.id, { tasks: r.tasks.filter((_, j) => j !== i) })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                onClick={() => patch(r.id, { tasks: [...r.tasks, { title: '', priority: 'normal', due_offset_days: 1 }] })}>
                <Plus className="h-3 w-3" />Add task
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button size="sm" onClick={addRule} className="gap-1"><Plus className="h-4 w-4" />New task set</Button>

      <Card>
        <CardContent className="pt-4 space-y-2 text-xs">
          <div className="font-semibold text-sm">Connecting Odoo</div>
          <p className="text-muted-foreground">In Odoo, create an Automation Rule (e.g. on Sales Order when Status becomes "Sales Order") with action "Send Webhook Notification" or a small Python action that POSTs JSON to this address:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1">{WEBHOOK_URL}</code>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(WEBHOOK_URL)}><Copy className="h-3.5 w-3.5" /></Button>
          </div>
          {token ? (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0">Header <code>x-webhook-token</code>:</span>
              <code className="flex-1 truncate rounded bg-muted px-2 py-1">{token}</code>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(token)}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
          ) : (
            <p className="text-muted-foreground italic">{isAdmin === false ? 'Only admins can see the webhook token.' : 'Loading token…'}</p>
          )}
          <pre className="rounded bg-muted p-2 text-[11px] overflow-x-auto">{`{
  "event": "so_confirmed",        // ${TASK_TRIGGERS.map(t => t.value).join(' | ')}
  "so_number": "S00108",
  "customer": "West Elm",
  "customer_ref": "Dining Table Fall Drop",
  "mo_number": "WH/MO/00225",     // MO events
  "sku": "TBL-ACACIA-84"          // MO events
}`}</pre>
        </CardContent>
      </Card>
    </div>
  );
}
