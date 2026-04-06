import { useMemo, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SortableHeader } from '@/components/SortableHeader';
import { useTableSort } from '@/hooks/use-table-sort';
import { daysBetween, getStage, STAGE_LABELS, STAGE_COLORS, type PipelineItem } from '@/lib/pipeline-helpers';

interface Props {
  items: PipelineItem[];
  customers: Record<string, string>;
  onEdit: (item: PipelineItem) => void;
  onRefresh: () => void;
}

export function PipelineTable({ items, customers, onEdit, onRefresh }: Props) {
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<PipelineItem>({ storageKey: 'pipeline-sort' });
  const [editingDate, setEditingDate] = useState<{ id: string; field: string } | null>(null);

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
    const { error } = await supabase.from('pipeline_items').update({ [field]: value || null }).eq('id', id);
    if (error) toast.error(error.message);
    else onRefresh();
    setEditingDate(null);
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
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHeader column="customer" label="Customer" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="name" label="Item Name" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="who" label="Who" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <TableHead className="w-10 text-center">Design</TableHead>
            <TableHead className="w-10 text-center">Photo</TableHead>
            <SortableHeader column="rfq_date" label="RFQ Date" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="initial_quote_date" label="Quote Date" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="days_to_quote" label="Days→Quote" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="sample_request_date" label="Sample Req" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="initial_sample_date" label="Initial Sample" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <SortableHeader column="final_sample_date" label="Final Sample" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
            <TableHead>Stage</TableHead>
            <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onToggle={toggleSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map(item => {
            const stage = getStage(item);
            const dtq = daysBetween(item.rfq_date, item.initial_quote_date);
            return (
              <TableRow key={item.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onEdit(item)}>
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
                  <Badge variant="outline" className={`text-[10px] ${STAGE_COLORS[stage]}`}>{STAGE_LABELS[stage]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={item.status === 'active' ? 'default' : 'secondary'} className="text-[10px] h-4 capitalize">
                    {item.status}
                  </Badge>
                </TableCell>
              </TableRow>
            );
          })}
          {sorted.length === 0 && (
            <TableRow><TableCell colSpan={13} className="text-center text-sm text-muted-foreground py-8">No pipeline items</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
