import { useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getStage, STAGE_LABELS, STAGE_COLORS, daysSince, type PipelineItem, type PipelineStage } from '@/lib/pipeline-helpers';

const KANBAN_STAGES: PipelineStage[] = [
  'needs_design', 'needs_quote', 'needs_sample', 'sample_in_progress', 'needs_followup', 'done',
];

/** Compute the field updates needed to place an item into a target stage */
function fieldsForStage(stage: PipelineStage): Partial<PipelineItem> {
  const today = new Date().toISOString().slice(0, 10);
  switch (stage) {
    case 'needs_design':
      return { design_done: false, status: 'active' };
    case 'needs_quote':
      return { design_done: true, photo_done: true, rfq_date: today, initial_quote_date: null, status: 'active' };
    case 'needs_sample':
      return { design_done: true, photo_done: true, initial_quote_date: today, sample_request_date: null, status: 'active' };
    case 'sample_in_progress':
      return { design_done: true, photo_done: true, sample_request_date: today, final_sample_date: null, status: 'active' };
    case 'needs_followup':
      // Set a quote date far enough back to trigger >21 days
      return { design_done: true, photo_done: true, initial_quote_date: today, status: 'active' };
    case 'done':
      return { status: 'done' };
    default:
      return {};
  }
}

interface Props {
  items: PipelineItem[];
  customers: Record<string, string>;
  onEdit: (item: PipelineItem) => void;
  onRefresh?: () => void;
}

export function PipelineKanban({ items, customers, onEdit, onRefresh }: Props) {
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

  const handleDragEnd = async (result: DropResult) => {
    const { draggableId, destination, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;

    const targetStage = destination.droppableId as PipelineStage;
    const updates = fieldsForStage(targetStage);

    // Only set date fields if item doesn't already have them (preserve existing dates)
    const item = items.find(i => i.id === draggableId);
    if (!item) return;

    const patch: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(updates)) {
      // For date fields, only set if item doesn't have a value and we're setting (not clearing)
      if (['rfq_date', 'initial_quote_date', 'sample_request_date'].includes(key)) {
        const current = (item as any)[key];
        if (val === null) {
          patch[key] = null; // always allow clearing
        } else if (!current) {
          patch[key] = val; // only set if empty
        }
      } else {
        patch[key] = val;
      }
    }

    const { error } = await supabase.from('pipeline_items').update(patch as any).eq('id', draggableId);
    if (error) {
      toast.error('Failed to move item');
    } else {
      toast.success(`Moved to ${STAGE_LABELS[targetStage]}`);
      onRefresh?.();
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_STAGES.map(stage => (
          <div key={stage} className="min-w-[220px] w-[220px] flex-shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="outline" className={STAGE_COLORS[stage]}>{STAGE_LABELS[stage]}</Badge>
              <span className="text-xs text-muted-foreground">{columns[stage].length}</span>
            </div>
            <Droppable droppableId={stage}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`space-y-2 max-h-[60vh] overflow-y-auto min-h-[60px] rounded-md p-1 transition-colors ${
                    snapshot.isDraggingOver ? 'bg-accent/50' : ''
                  }`}
                >
                  {columns[stage].map((item, index) => (
                    <Draggable key={item.id} draggableId={item.id} index={index}>
                      {(prov, snap) => (
                        <Card
                          ref={prov.innerRef}
                          {...prov.draggableProps}
                          {...prov.dragHandleProps}
                          className={`cursor-grab hover:shadow-md transition-shadow ${snap.isDragging ? 'shadow-lg ring-2 ring-primary/30' : ''}`}
                          onClick={() => !snap.isDragging && onEdit(item)}
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
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {columns[stage].length === 0 && !snapshot.isDraggingOver && (
                    <p className="text-xs text-muted-foreground text-center py-4">No items</p>
                  )}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  );
}
