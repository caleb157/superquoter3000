import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, FileText } from 'lucide-react';
import { LEAD_STATUS_ORDER, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS, type LeadStatus } from '@/components/LeadStatusBadge';
import { cn } from '@/lib/utils';

type Customer = { id: string; name: string; company: string | null; lead_status: string };

interface Props {
  customers: Customer[];
  inquiriesByCustomer: Record<string, any[]>;
  onStatusChange: (customerId: string, next: LeadStatus) => void;
  onOpenCustomer: (id: string) => void;
}

export function CustomersKanban({ customers, inquiriesByCustomer, onStatusChange, onOpenCustomer }: Props) {
  const grouped = useMemo(() => {
    const g: Record<string, Customer[]> = {};
    LEAD_STATUS_ORDER.forEach(s => (g[s] = []));
    customers.forEach(c => {
      const s = (c.lead_status || 'lead') as LeadStatus;
      (g[s] ||= []).push(c);
    });
    return g;
  }, [customers]);

  const handleDragStart = (e: React.DragEvent, customerId: string) => {
    e.dataTransfer.setData('text/customer-id', customerId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (e: React.DragEvent, status: LeadStatus) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/customer-id');
    if (id) onStatusChange(id, status);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {LEAD_STATUS_ORDER.map(status => {
        const items = grouped[status] || [];
        return (
          <div
            key={status}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, status)}
            className="rounded-lg border bg-muted/30 flex flex-col min-h-[300px]"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b sticky top-0 bg-muted/50 backdrop-blur rounded-t-lg">
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded', LEAD_STATUS_COLORS[status])}>
                {LEAD_STATUS_LABELS[status]}
              </span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            <div className="p-2 space-y-2 flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="text-[10px] text-muted-foreground/60 text-center py-4 border border-dashed rounded">
                  Drop here
                </div>
              ) : items.map(c => {
                const inqs = inquiriesByCustomer[c.id] || [];
                return (
                  <Card
                    key={c.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, c.id)}
                    onClick={() => onOpenCustomer(c.id)}
                    className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
                  >
                    <CardContent className="p-2.5 space-y-1">
                      <div className="text-sm font-medium truncate">{c.company || c.name}</div>
                      {c.company && c.name && c.name !== c.company && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1 truncate">
                          <Building2 className="h-2.5 w-2.5 shrink-0" /> {c.name}
                        </div>
                      )}
                      {inqs.length > 0 && (
                        <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <FileText className="h-2.5 w-2.5" /> {inqs.length} inquir{inqs.length === 1 ? 'y' : 'ies'}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
