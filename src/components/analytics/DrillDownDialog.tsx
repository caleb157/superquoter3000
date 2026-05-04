import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export type DrillColumn<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
};

type Props<T> = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  columns: DrillColumn<T>[];
  rows: T[];
  emptyText?: string;
  onRowClick?: (row: T) => void;
  rowKey: (row: T, i: number) => string;
};

export function DrillDownDialog<T>({
  open, onOpenChange, title, description, columns, rows, emptyText = 'No records.', onRowClick, rowKey,
}: Props<T>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </DialogHeader>
        <div className="overflow-auto flex-1">
          {rows.length === 0 ? (
            <div className="px-6 py-8 text-sm text-muted-foreground text-center">{emptyText}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c, i) => (
                    <TableHead key={i} className={cn('h-8 text-xs', c.align === 'right' && 'text-right', c.className)}>
                      {c.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow
                    key={rowKey(r, i)}
                    onClick={onRowClick ? () => { onRowClick(r); onOpenChange(false); } : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                  >
                    {columns.map((c, j) => (
                      <TableCell key={j} className={cn('py-2 text-xs', c.align === 'right' && 'text-right tabular-nums', c.className)}>
                        {c.cell(r)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground pt-1">{rows.length} record{rows.length === 1 ? '' : 's'}</div>
      </DialogContent>
    </Dialog>
  );
}
