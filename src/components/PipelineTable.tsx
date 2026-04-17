import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, X, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { daysBetween, getStage, STAGE_LABELS, type PipelineItem, type PipelineStage } from '@/lib/pipeline-helpers';
import { cn } from '@/lib/utils';

interface Props {
  items: PipelineItem[];
  customers: Record<string, string>;
  onEdit: (item: PipelineItem) => void;
  onRefresh: () => void;
}

/** Vivid row background based on pipeline stage */
function rowBg(stage: PipelineStage): string {
  switch (stage) {
    case 'needs_design':
      return 'bg-red-100/80 hover:bg-red-200/80 dark:bg-red-900/30 dark:hover:bg-red-900/50';
    case 'needs_photo':
      return 'bg-orange-100/80 hover:bg-orange-200/80 dark:bg-orange-900/30 dark:hover:bg-orange-900/50';
    case 'needs_quote':
      return 'bg-blue-200/70 hover:bg-blue-300/70 dark:bg-blue-900/40 dark:hover:bg-blue-900/60'; // costing / quoting
    case 'needs_sample':
    case 'sample_in_progress':
      return 'bg-amber-200/70 hover:bg-amber-300/70 dark:bg-amber-900/40 dark:hover:bg-amber-900/60'; // sampling
    case 'needs_followup':
      return 'bg-rose-200/70 hover:bg-rose-300/70 dark:bg-rose-900/40 dark:hover:bg-rose-900/60';
    case 'done':
      return 'bg-emerald-200/70 hover:bg-emerald-300/70 dark:bg-emerald-900/40 dark:hover:bg-emerald-900/60'; // done
  }
}

const STATUS_OPTIONS = ['active', 'paused', 'done', 'cancelled'] as const;

export function PipelineTable({ items, customers, onEdit, onRefresh }: Props) {
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<PipelineItem>({ storageKey: 'pipeline-sort' });
  const [editingDate, setEditingDate] = useState<{ id: string; field: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const getters: Record<string, (i: PipelineItem) => string | number> = {
    customer: i => customers[i.customer_id ?? ''] ?? '',
    name: i => i.name,
    who: i => i.who ?? '',
    rfq_date: i => i.rfq_date ?? '',
    initial_quote_date: i => i.initial_quote_date ?? '',
    days_to_quote: i => daysBetween(i.rfq_date, i.initial_quote_date) ?? 999,
    sample_request_date: i => i.sample_request_date ?? '',
    initial_sample_date: i => i.initial_sample_date ?? '',
    final_sample_date: i => i.final_sample_date ?? '',
    status: i => i.status,
  };

  const sorted = useMemo(() => sortItems(items, getters), [items, sortItems]);

  const handleDateChange = async (id: string, field: string, value: string) => {
    const { error } = await supabase.from('pipeline_items').update({ [field]: value || null } as any).eq('id', id);
    if (error) toast.error(error.message);
    else onRefresh();
    setEditingDate(null);
  };

  // Selection helpers
  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map(i => i.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Bulk update
  const bulkUpdate = async (patch: Record<string, any>) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const { error } = await supabase.from('pipeline_items').update(patch as any).in('id', ids);
    if (error) toast.error(error.message);
    else {
      toast.success(`Updated ${ids.length} items`);
      setSelected(new Set());
      onRefresh();
    }
  };

  const DateCell = ({ item, field }: { item: PipelineItem; field: keyof PipelineItem }) => {
    const val = item[field] as string | null;
    const isEditing = editingDate?.id === item.id && editingDate?.field === field;
    if (isEditing) {
      return (
        <Input
          type="date"
          defaultValue={val ?? ''}
          className="h-7 w-[130px] text-xs"
          autoFocus
          onBlur={e => handleDateChange(item.id, field, e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      );
    }
    return (
      <span
        className="cursor-pointer hover:underline text-xs"
        onClick={e => { e.stopPropagation(); setEditingDate({ id: item.id, field }); }}
      >
        {val ? new Date(val + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'}
      </span>
    );
  };

  const BoolIcon = ({ val }: { val: boolean }) =>
    val ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <X className="h-3.5 w-3.5 text-muted-foreground/40" />;

  return (
    <div className="space-y-2">
      {/* Bulk actions toolbar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs">
          <span className="font-medium">{selected.size} selected</span>
          <div className="h-4 w-px bg-border" />

          <Select onValueChange={v => bulkUpdate({ status: v })}>
            <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue placeholder="Set Status" /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select onValueChange={v => bulkUpdate({ who: v === '__clear' ? null : v })}>
            <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue placeholder="Set Who" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__clear">Clear</SelectItem>
              <SelectItem value="CQ">CQ</SelectItem>
              <SelectItem value="PH">PH</SelectItem>
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => bulkUpdate({ design_done: true })}>
            <Check className="h-3 w-3 mr-1" /> Design ✓
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => bulkUpdate({ photo_done: true })}>
            <Check className="h-3 w-3 mr-1" /> Photo ✓
          </Button>

          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <div className="rounded-md border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 px-2">
                <Checkbox
                  checked={allSelected}
                  // @ts-ignore indeterminate works
                  indeterminate={someSelected}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <SortableHeader column="customer" label="Customer" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="name" label="Item Name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="who" label="Who" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <TableHead className="w-10 text-center">Design</TableHead>
              <TableHead className="w-10 text-center">Photo</TableHead>
              <SortableHeader column="rfq_date" label="RFQ Date" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="initial_quote_date" label="Quote Date" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="days_to_quote" label="Days→Quote" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="sample_request_date" label="Sample Req" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="initial_sample_date" label="Initial Sample" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="final_sample_date" label="Final Sample" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
              <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map(item => {
              const stage = getStage(item);
              const dtq = daysBetween(item.rfq_date, item.initial_quote_date);
              const isSelected = selected.has(item.id);
              return (
                <TableRow
                  key={item.id}
                  className={cn(
                    'cursor-pointer transition-colors',
                    isSelected ? 'bg-primary/10' : rowBg(stage),
                    !isSelected && 'hover:bg-muted/50',
                  )}
                  onClick={() => onEdit(item)}
                >
                  <TableCell className="px-2" onClick={e => e.stopPropagation()}>
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleOne(item.id)} />
                  </TableCell>
                  <TableCell className="text-xs">{customers[item.customer_id ?? ''] ?? '—'}</TableCell>
                  <TableCell className="text-xs font-medium">{item.name}</TableCell>
                  <TableCell>
                    {item.who && <Badge variant="secondary" className="text-[10px] h-4">{item.who}</Badge>}
                  </TableCell>
                  <TableCell className="text-center"><BoolIcon val={item.design_done} /></TableCell>
                  <TableCell className="text-center"><BoolIcon val={item.photo_done} /></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><DateCell item={item} field="rfq_date" /></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><DateCell item={item} field="initial_quote_date" /></TableCell>
                  <TableCell className="text-xs text-center">{dtq !== null ? dtq : '—'}</TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><DateCell item={item} field="sample_request_date" /></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><DateCell item={item} field="initial_sample_date" /></TableCell>
                  <TableCell onClick={e => e.stopPropagation()}><DateCell item={item} field="final_sample_date" /></TableCell>
                  <TableCell>
                    <Badge variant={item.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-4 capitalize">
                      {item.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {sorted.length === 0 && (
              <TableRow><TableCell colSpan={14} className="text-center text-sm text-muted-foreground py-8">No pipeline items</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
