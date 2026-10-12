// Inline-editable table over one Supabase table: add, edit on blur, delete.
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

export function EditableTable<T extends { id: string }>({
  tableName, columns, data, setData, fetchData, defaultRow,
}: {
  tableName: string;
  columns: { key: string; label: string; type?: string; width?: string }[];
  data: T[];
  setData: (d: T[]) => void;
  fetchData: () => void;
  defaultRow: Partial<T>;
}) {
  const addRow = async () => {
    const client = supabase as any;
    const { error } = await client.from(tableName).insert(defaultRow).select().single();
    if (error) { toast.error(error.message); return; }
    fetchData();
    toast.success('Row added');
  };

  const updateField = async (id: string, field: string, value: any) => {
    const client = supabase as any;
    const { error } = await client.from(tableName).update({ [field]: value }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setData(data.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const deleteRow = async (id: string) => {
    const client = supabase as any;
    const { error } = await client.from(tableName).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    fetchData();
    toast.success('Row deleted');
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <Button size="sm" variant="outline" onClick={addRow} className="gap-1 h-7 text-xs">
          <Plus className="h-3 w-3" /> Add Row
        </Button>
      </div>
      <div className="border rounded-md overflow-auto">
        <Table className="dense-table">
          <TableHeader>
            <TableRow>
              {columns.map(c => (
                <TableHead key={c.key} style={{ width: c.width }}>{c.label}</TableHead>
              ))}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(row => (
              <TableRow key={row.id}>
                {columns.map(col => (
                  <TableCell key={col.key}>
                    {col.type === 'readonly' ? (
                      <span className="calc-field px-1 rounded">
                        {String((row as any)[col.key] ?? '')}
                      </span>
                    ) : col.type === 'tags' ? (
                      <div className="flex flex-wrap gap-1">
                        {((row as any)[col.key] || []).map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[10px] h-5 cursor-pointer"
                            onClick={() => {
                              const tags = [...((row as any)[col.key] || [])];
                              tags.splice(i, 1);
                              updateField(row.id, col.key, tags);
                            }}>
                            {tag} ×
                          </Badge>
                        ))}
                        <input
                          className="border-none outline-none bg-transparent text-xs w-16"
                          placeholder="+"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                              const val = (e.target as HTMLInputElement).value.trim();
                              const tags = [...((row as any)[col.key] || []), val];
                              updateField(row.id, col.key, tags);
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <Input
                        className="h-7 text-xs border-transparent hover:border-input focus:border-input"
                        type={col.type === 'number' ? 'number' : 'text'}
                        defaultValue={(row as any)[col.key] ?? ''}
                        onBlur={(e) => {
                          const val = col.type === 'number' ? Number(e.target.value) : e.target.value;
                          if (val !== (row as any)[col.key]) {
                            updateField(row.id, col.key, val);
                          }
                        }}
                      />
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteRow(row.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground py-8">
                  No data. Click "Add Row" to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
