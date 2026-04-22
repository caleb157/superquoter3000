import { useEffect, useRef, useState, useCallback } from 'react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Props = {
  storageKey: string; // unique per column, e.g. "cogs.component"
  defaultWidth: number; // px
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
};

/**
 * Table header cell with a drag handle on its right edge.
 * Persists the user-chosen width to localStorage under `colw:<storageKey>`.
 */
export function ResizableTableHead({
  storageKey, defaultWidth, minWidth = 40, maxWidth = 600,
  align = 'left', children, className,
}: Props) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return defaultWidth;
    const v = window.localStorage.getItem(`colw:${storageKey}`);
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= minWidth && n <= maxWidth ? n : defaultWidth;
  });
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef<{ startX: number; startW: number; pointerId: number } | null>(null);
  const handleRef = useRef<HTMLSpanElement | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    // Only react to primary button / touch / pen
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = { startX: e.clientX, startW: widthRef.current, pointerId: e.pointerId };
    try { handleRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragging.current || dragging.current.pointerId !== e.pointerId) return;
    const next = Math.min(maxWidth, Math.max(minWidth, dragging.current.startW + (e.clientX - dragging.current.startX)));
    setWidth(next);
  }, [minWidth, maxWidth]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (!dragging.current || dragging.current.pointerId !== e.pointerId) return;
    try { handleRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    dragging.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try { window.localStorage.setItem(`colw:${storageKey}`, String(widthRef.current)); } catch { /* ignore */ }
  }, [storageKey]);

  // Safety: if drag was abandoned (e.g. focus loss), clean up on unmount
  useEffect(() => () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const isDragging = dragging.current !== null;

  return (
    <TableHead
      style={{ width, minWidth: width, maxWidth: width }}
      className={cn('relative group', align === 'right' && 'text-right pr-3', className)}
    >
      <span className={cn('block truncate', align === 'right' ? 'pl-1 pr-1' : 'pr-3')}>
        {children}
      </span>
      <span
        ref={handleRef}
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          try { window.localStorage.setItem(`colw:${storageKey}`, String(defaultWidth)); } catch { /* ignore */ }
        }}
        title="Drag to resize · double-click to reset"
        className={cn(
          // Wider hit target on touch, narrow visual on hover
          "absolute top-0 right-0 h-full select-none touch-none cursor-col-resize z-20",
          "w-3 sm:w-2",
          // Visible affordance: a thin vertical bar centered in the hit area
          "before:absolute before:top-1/2 before:right-0 before:-translate-y-1/2",
          "before:h-5 before:w-px before:bg-border before:transition-colors",
          "group-hover:before:bg-foreground/40 hover:before:!bg-primary hover:before:w-0.5",
          isDragging && "before:!bg-primary before:w-0.5",
        )}
      />
    </TableHead>
  );
}
