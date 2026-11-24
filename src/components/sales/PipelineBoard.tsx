// Pipeline kanban: drag a card to another column to move the account's stage (mouse, touch, keyboard).
// Moves go through moveStageWithReason (same patch as the connector's set_sales_stage, reason logged),
// update the page at once, roll back on error, and offer Undo. Rules in canMoveStage (sales-core.ts).
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent, type DragStartEvent, type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CHANNEL_ICON } from '@/components/sales/SalesAccountPanel';
import { SALES_STAGES, SALES_STAGE_LABELS, canMoveStage, type SalesStage } from '@/lib/sales/sales-core';
import type { TouchRow } from '@/lib/sales/needs-you';
import { GripVertical } from 'lucide-react';

export type BoardAccount = {
  id: string; name: string; company: string | null; sales_stage: string | null; dnc: boolean; lead_status?: string | null;
  persona: string | null; fit_score: number | null; last_contacted_at: string | null;
};

/** Cards drawn per column; the rest are a search away (Queued can hold thousands). */
const COLUMN_CAP = 200;

const nameOf = (a: BoardAccount) => a.company || a.name;
const label = (s: string | null | undefined) => (s ? SALES_STAGE_LABELS[s as SalesStage] ?? s : 'no stage');

/** Pointer first (what is under the finger), then overlap (keyboard and edges). */
const collision: CollisionDetection = args => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

/** Arrow keys jump a whole column: Right/Down = next stage, Left/Up = previous. */
const columnKeys: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const step = ['ArrowRight', 'ArrowDown'].includes(event.code) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 0;
  if (!step) return undefined;
  event.preventDefault();
  const at = (SALES_STAGES as readonly string[]).indexOf(String(context.over?.id ?? context.active?.data.current?.stage));
  const next = SALES_STAGES[Math.min(SALES_STAGES.length - 1, Math.max(0, (at < 0 ? 0 : at) + step))];
  const rect = context.droppableRects.get(next);
  const self = context.collisionRect;
  if (!rect || !self) return currentCoordinates;
  // Centre the card on the top of the target column (coordinates are the card's top-left on the page).
  const dx = rect.left + rect.width / 2 - (self.left + self.width / 2);
  const dy = rect.top + 48 - self.top;
  return { x: currentCoordinates.x + dx, y: currentCoordinates.y + dy };
};

export function PipelineBoard({ byStage, lastTouch, onMove }: {
  byStage: Record<string, BoardAccount[]>;
  lastTouch: Map<string, TouchRow>;
  onMove: (account: BoardAccount, to: SalesStage) => void;
}) {
  const [active, setActive] = useState<BoardAccount | null>(null);
  const justDragged = useRef(false);
  const sensors = useSensors(
    // A small move before a drag starts, so a click still opens the account.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press and hold on phones, so a swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    // Space picks up and drops (Enter still opens the account), Escape cancels.
    useSensor(KeyboardSensor, { coordinateGetter: columnKeys, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );
  const byId = useMemo(() => {
    const m = new Map<string, BoardAccount>();
    for (const s of SALES_STAGES) for (const a of byStage[s] ?? []) m.set(a.id, a);
    return m;
  }, [byStage]);

  const announcements: Announcements = useMemo(() => ({
    onDragStart: ({ active: a }) => `Picked up ${nameOf(byId.get(String(a.id)) ?? ({ name: 'card' } as BoardAccount))}, in ${label(a.data.current?.stage)}. Use the arrow keys to pick a column, Space to drop, Escape to cancel.`,
    onDragOver: ({ active: a, over }) => over ? `Over ${label(String(over.id))}${canMoveStage(byId.get(String(a.id)) ?? {}, String(over.id)).allowed ? '' : ', cannot drop here'}.` : 'Not over a column.',
    onDragEnd: ({ active: a, over }) => over ? `Dropped ${nameOf(byId.get(String(a.id)) ?? ({ name: 'card' } as BoardAccount))} on ${label(String(over.id))}.` : 'Dropped outside the columns. Nothing moved.',
    onDragCancel: () => 'Move cancelled. Nothing moved.',
  }), [byId]);

  const onStart = useCallback((e: DragStartEvent) => { justDragged.current = true; setActive(byId.get(String(e.active.id)) ?? null); }, [byId]);
  const onEnd = useCallback((e: DragEndEvent) => {
    setActive(null);
    // The click that ends a mouse drag must not open the account.
    setTimeout(() => { justDragged.current = false; }, 0);
    const a = byId.get(String(e.active.id));
    const to = e.over?.id as SalesStage | undefined;
    if (!a || !to) return;
    if (canMoveStage(a, to).allowed) onMove(a, to);
  }, [byId, onMove]);
  const onCancel = useCallback(() => { setActive(null); setTimeout(() => { justDragged.current = false; }, 0); }, []);
  const blockClick = useCallback((e: React.MouseEvent) => { if (justDragged.current) e.preventDefault(); }, []);

  return (
    <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={onCancel}
      autoScroll={{ threshold: { x: 0.15, y: 0.15 }, acceleration: 12 }}
      accessibility={{ announcements, screenReaderInstructions: { draggable: 'To move this account, press Space, use the arrow keys to pick a stage, then press Space again. Escape cancels.' } }}>
      {/* Phones: columns side by side in a swipe row (drag to an edge and it scrolls); wider screens: a grid. */}
      <div className={cn('flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 lg:grid-cols-6 sm:overflow-visible', !active && 'snap-x snap-mandatory')}>
        {SALES_STAGES.map(s => (
          <Column key={s} stage={s} accounts={byStage[s] ?? []} lastTouch={lastTouch} active={active} onCardClick={blockClick} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 150 }}>
        {active ? <CardBody account={active} touch={lastTouch.get(active.id)} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ stage, accounts, lastTouch, active, onCardClick }: {
  stage: SalesStage; accounts: BoardAccount[]; lastTouch: Map<string, TouchRow>; active: BoardAccount | null; onCardClick: (e: React.MouseEvent) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const verdict = active ? canMoveStage(active, stage) : null;
  const allowed = !!verdict?.allowed;
  const refused = !!active && !allowed && !verdict?.noop;
  return (
    <div ref={setNodeRef} data-stage={stage}
      className={cn('rounded-lg bg-muted/40 p-2 min-w-0 flex flex-col transition-colors w-[78vw] shrink-0 snap-start sm:w-auto sm:shrink',
        active && allowed && 'bg-primary/5 ring-1 ring-primary/20',
        isOver && allowed && 'bg-primary/10 ring-2 ring-primary',
        isOver && refused && 'bg-destructive/10 ring-2 ring-destructive/60')}>
      <div className="flex items-center justify-between px-1 pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{SALES_STAGE_LABELS[stage]}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{accounts.length}</span>
      </div>
      {isOver && refused && verdict?.reason && <div className="text-[11px] text-destructive px-1 pb-2">{verdict.reason}.</div>}
      <div className="space-y-2 overflow-y-auto overscroll-contain max-h-[70vh] min-h-16 pr-0.5 -mr-0.5">
        {accounts.slice(0, COLUMN_CAP).map(a => <DraggableCard key={a.id} account={a} touch={lastTouch.get(a.id)} onClick={onCardClick} />)}
        {accounts.length > COLUMN_CAP && <div className="text-[11px] text-center text-muted-foreground py-1">+{accounts.length - COLUMN_CAP} more. Use Find to narrow.</div>}
        {accounts.length === 0 && <div className="text-[11px] text-center text-muted-foreground py-4">Drop a card here</div>}
      </div>
    </div>
  );
}

const DraggableCard = memo(function DraggableCard({ account, touch, onClick }: { account: BoardAccount; touch?: TouchRow; onClick: (e: React.MouseEvent) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: account.id, data: { stage: account.sales_stage } });
  return (
    <Link ref={setNodeRef} to={`/customers/${account.id}?tab=sales`} draggable={false} onClick={onClick}
      {...listeners} {...attributes} aria-roledescription="Draggable account" aria-label={`${nameOf(account)}, ${label(account.sales_stage)}`}
      className={cn('group block rounded-md border bg-card p-2 hover:bg-accent/40 touch-manipulation select-none cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', isDragging && 'opacity-40')}>
      <CardInner account={account} touch={touch} />
    </Link>
  );
});

function CardBody({ account, touch, lifted }: { account: BoardAccount; touch?: TouchRow; lifted?: boolean }) {
  return (
    <div className={cn('rounded-md border bg-card p-2', lifted && 'shadow-lg ring-1 ring-primary/30 cursor-grabbing rotate-1')}>
      <CardInner account={account} touch={touch} />
    </div>
  );
}

function CardInner({ account: a, touch }: { account: BoardAccount; touch?: TouchRow }) {
  const I = touch ? CHANNEL_ICON[touch.channel] : null;
  return (
    <>
      <div className="flex items-center gap-1">
        <div className="text-sm font-medium truncate flex-1">{nameOf(a)}</div>
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden />
      </div>
      <div className="flex flex-wrap items-center gap-1 mt-1 text-[11px] text-muted-foreground">
        {a.dnc && <Badge variant="secondary" className="text-[10px] px-1 py-0 bg-destructive/15 text-destructive">Do not contact</Badge>}
        {a.persona && <span>{a.persona}</span>}
        {a.fit_score != null && <Badge variant="outline" className="text-[10px] px-1 py-0">Fit {a.fit_score}</Badge>}
        {I && <I className="h-3 w-3 ml-auto" />}
        {a.last_contacted_at && <span>{formatDistanceToNow(new Date(a.last_contacted_at), { addSuffix: true })}</span>}
      </div>
    </>
  );
}
