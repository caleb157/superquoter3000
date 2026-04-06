import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getStage, STAGE_LABELS, STAGE_COLORS, daysSince, type PipelineItem, type PipelineStage } from '@/lib/pipeline-helpers';

const KANBAN_STAGES: PipelineStage[] = [
  'needs_design', 'needs_quote', 'needs_sample', 'sample_in_progress', 'needs_followup', 'done',
];

interface Props {
  items: PipelineItem[];
  customers: Record<string, string>;
  onEdit: (item: PipelineItem) => void;
}

export function PipelineKanban({ items, customers, onEdit }: Props) {
  const columns = useMemo(() => {
    const map: Record<PipelineStage, PipelineItem[]> = {} as any;
    KANBAN_STAGES.forEach(s => (map[s] = []));
    items.forEach(item => {
      const stage = getStage(item);
      if (map[stage]) map[stage].push(item);
      else map.needs_sample.push(item);
    });
    return map;
  }, [items]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {KANBAN_STAGES.map(stage => (
        <div key={stage} className="min-w-[220px] w-[220px] flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className={STAGE_COLORS[stage]}>{STAGE_LABELS[stage]}</Badge>
            <span className="text-xs text-muted-foreground">{columns[stage].length}</span>
          </div>
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {columns[stage].map(item => (
              <Card
                key={item.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onEdit(item)}
              >
                <CardContent className="p-3">
                  <p className="text-sm font-medium leading-tight">{item.name}</p>
                  {item.customer_id && customers[item.customer_id] && (
                    <p className="text-xs text-muted-foreground mt-0.5">{customers[item.customer_id]}</p>
                  )}
                  <div className="flex items-center gap-1 mt-1.5">
                    {item.who && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">{item.who}</Badge>
                    )}
                    {item.rfq_date && (
                      <span className="text-[10px] text-muted-foreground">
                        {daysSince(item.rfq_date)}d since RFQ
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {columns[stage].length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No items</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
