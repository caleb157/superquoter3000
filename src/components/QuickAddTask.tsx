import { useCallback, useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ListTodo, Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export function QuickAddTask() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [items, setItems] = useState<{ id: string; name: string }[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const searchItems = useCallback(async (q: string) => {
    if (!q.trim()) { setItems([]); return; }
    const { data } = await supabase
      .from('pipeline_items')
      .select('id, name')
      .ilike('name', `%${q}%`)
      .limit(8);
    setItems(data ?? []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchItems(itemSearch), 200);
    return () => clearTimeout(t);
  }, [itemSearch, searchItems]);

  const handleSave = async () => {
    if (!title.trim() || !selectedItemId) {
      toast.error('Title and pipeline item are required');
      return;
    }
    setSaving(true);
    const actor = user?.email?.split('@')[0] ?? 'Unknown';
    const { error } = await supabase.from('pipeline_tasks').insert({
      pipeline_item_id: selectedItemId,
      title: title.trim(),
      assigned_to: assignedTo || null,
      due_date: dueDate || null,
      created_by: actor,
    });
    if (error) { toast.error(error.message); setSaving(false); return; }

    await supabase.from('pipeline_activity').insert({
      pipeline_item_id: selectedItemId,
      action: 'task_created',
      description: `Created task "${title.trim()}"`,
      actor,
    });

    toast.success('Task added');
    setTitle('');
    setAssignedTo('');
    setDueDate('');
    setItemSearch('');
    setSelectedItemId(null);
    setSaving(false);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-xs gap-1">
          <ListTodo className="h-3.5 w-3.5" />
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Quick Add Task</h4>

          <div>
            <Label className="text-xs">Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Follow up next Friday" className="h-8 text-xs" />
          </div>

          <div>
            <Label className="text-xs">Pipeline Item</Label>
            <Input
              value={itemSearch}
              onChange={e => { setItemSearch(e.target.value); setSelectedItemId(null); }}
              placeholder="Search by name…"
              className="h-8 text-xs"
            />
            {items.length > 0 && !selectedItemId && (
              <div className="border rounded-md mt-1 max-h-[120px] overflow-y-auto">
                {items.map(i => (
                  <button
                    key={i.id}
                    className="w-full text-left text-xs px-2 py-1.5 hover:bg-muted"
                    onClick={() => { setSelectedItemId(i.id); setItemSearch(i.name); }}
                  >
                    {i.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Assigned to</Label>
              <Input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} placeholder="CQ" className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Due date</Label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          <Button size="sm" className="w-full" onClick={handleSave} disabled={saving || !title.trim() || !selectedItemId}>
            {saving ? 'Saving…' : 'Add Task'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
