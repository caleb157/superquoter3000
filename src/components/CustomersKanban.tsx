import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Building2, FileText } from 'lucide-react';
import { SALES_STAGE_LABELS, type SalesStage } from '@/lib/sales/sales-core';
import { SALES_STAGE_COLORS } from '@/components/sales/SalesStageBadge';
import { cn } from '@/lib/utils';

type Customer = { id: string; name: string; company: string | null; sales_stage: string | null; dnc?: boolean };

/** The board runs from a first reply to a customer, plus Not now. Queued and In outreach live in Sales > Prospects / Pipeline. */
export const KANBAN_STAGES = ['responded', 'in_conversation', 'inquiry', 'customer', 'not_now'] as const satisfies readonly SalesStage[];

interface Props {
  customers: Customer[];
  inquiriesByCustomer: Record<string, unknown[]>;
  onStageChange: (customerId: string, next: SalesStage) => void;
  onOpenCustomer: (id: string) => void;
}

export function CustomersKanban({ customers, inquiriesByCustomer, onStageChange, onOpenCustomer }: Props) {
  const grouped = useMemo(() => {
    const g: Record<string, Customer[]> = {};
    KANBAN_STAGES.forEach(s => (g[s] = []));
    customers.forEach(c => { if (c.sales_stage && g[c.sales_stage] && !c.dnc) g[c.sales_stage].push(c); });
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
  const handleDrop = (e: React.DragEvent, stage: SalesStage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/customer-id');
    const c = customers.find(x => x.id === id);
    if (c && c.sales_stage !== stage) onStageChange(id, stage);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      {KANBAN_STAGES.map(stage => {
        const items = grouped[stage] || [];
        return (
          <div
            key={stage}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, stage)}
            className="rounded-lg border bg-muted/30 flex flex-col min-h-[300px]"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b sticky top-0 bg-muted/50 backdrop-blur rounded-t-lg">
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded', SALES_STAGE_COLORS[stage])}>
                {SALES_STAGE_LABELS[stage]}
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
