import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

type Row = { id: string; product_id: string; cogs_type: string; component_name: string | null };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProductIds: string[];
  onApplied: () => void;
};

export function BulkDeleteCogsDialog({ open, onOpenChange, selectedProductIds, onApplied }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const productCount = selectedProductIds.length;

  useEffect(() => {
    if (!open || productCount === 0) return;
    setLoading(true);
    setSelectedKeys(new Set());
    (async () => {
      const { data, error } = await (supabase as any)
        .from('cogs_items')
        .select('id, product_id, cogs_type, component_name')
        .in('product_id', selectedProductIds);
      if (error) { toast.error(error.message); setLoading(false); return; }
      setRows((data || []) as Row[]);
      setLoading(false);
    })();
  }, [open, productCount, selectedProductIds.join(',')]);

  // Group by cogs_type -> component_name (case-insensitive)
  const groups = useMemo(() => {
    const map = new Map<string, Map<string, Row[]>>();
    for (const r of rows) {
      const type = r.cogs_type || 'Other';
      const name = (r.component_name || '').trim() || '(unnamed)';
      if (!map.has(type)) map.set(type, new Map());
      const inner = map.get(type)!;
      const nk = name.toLowerCase();
      if (!inner.has(nk)) inner.set(nk, []);
      inner.get(nk)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, inner]) => ({
        type,
        names: Array.from(inner.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([nk, rs]) => ({
            key: `${type}::${nk}`,
            label: rs[0].component_name || '(unnamed)',
            count: rs.length,
            ids: rs.map(r => r.id),
          })),
      }));
  }, [rows]);

  const allKeys = useMemo(() => groups.flatMap(g => g.names.map(n => n.key)), [groups]);
  const allChecked = allKeys.length > 0 && allKeys.every(k => selectedKeys.has(k));

  const toggle = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleGroup = (type: string) => {
    const keys = groups.find(g => g.type === type)?.names.map(n => n.key) ?? [];
    setSelectedKeys(prev => {
      const next = new Set(prev);
      const allOn = keys.every(k => next.has(k));
      if (allOn) keys.forEach(k => next.delete(k));
      else keys.forEach(k => next.add(k));
      return next;
    });
  };
  const toggleAll = () => {
    setSelectedKeys(prev => (allChecked ? new Set() : new Set(allKeys)));
  };

  const deleteIds = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const n of g.names) {
        if (selectedKeys.has(n.key)) n.ids.forEach(id => set.add(id));
      }
    }
    return Array.from(set);
  }, [groups, selectedKeys]);

  const handleDelete = async () => {
    if (deleteIds.length === 0) { toast.error('Nothing selected'); return; }
    setSaving(true);
    const { error } = await (supabase as any).from('cogs_items').delete().in('id', deleteIds);
    setSaving(false);
    if (error) { toast.error('Delete failed: ' + error.message); return; }
    toast.success(`Deleted ${deleteIds.length} COGS row${deleteIds.length === 1 ? '' : 's'} across ${productCount} SKU${productCount === 1 ? '' : 's'}`);
    onApplied();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk delete COGS rows</DialogTitle>
          <DialogDescription>
            Pick which cost rows to remove from {productCount} selected SKU{productCount === 1 ? '' : 's'}.
            Rows are grouped by type and name (case-insensitive) — the count shows how many SKUs currently have that row.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading rows…</div>
        ) : groups.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No COGS rows found on the selected SKUs.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                <span>Select all</span>
              </label>
              <div className="text-xs text-muted-foreground">
                {deleteIds.length} row{deleteIds.length === 1 ? '' : 's'} will be deleted
              </div>
            </div>

            <ScrollArea className="h-[380px] rounded-md border">
              <div className="p-3 space-y-4">
                {groups.map(g => {
                  const keys = g.names.map(n => n.key);
                  const groupAll = keys.every(k => selectedKeys.has(k));
                  const groupSome = !groupAll && keys.some(k => selectedKeys.has(k));
                  return (
                    <div key={g.type}>
                      <label className="flex items-center gap-2 text-sm font-medium mb-1.5">
                        <Checkbox
                          checked={groupAll ? true : (groupSome ? 'indeterminate' : false)}
                          onCheckedChange={() => toggleGroup(g.type)}
                        />
                        <span>{g.type}</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                          {g.names.length}
                        </Badge>
                      </label>
                      <div className="pl-6 space-y-1">
                        {g.names.map(n => (
                          <label
                            key={n.key}
                            className="flex items-center justify-between text-xs py-0.5 gap-2"
                          >
                            <span className="flex items-center gap-2">
                              <Checkbox
                                checked={selectedKeys.has(n.key)}
                                onCheckedChange={() => toggle(n.key)}
                              />
                              <span>{n.label}</span>
                            </span>
                            <span className="text-muted-foreground">
                              {n.count} SKU{n.count === 1 ? '' : 's'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={saving || deleteIds.length === 0}
          >
            {saving ? 'Deleting…' : `Delete ${deleteIds.length} row${deleteIds.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
