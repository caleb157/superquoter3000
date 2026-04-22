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
  const dragging = useRef<{ startX: number; startW: number } | null>(null);

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging.current) return;
    const next = Math.min(maxWidth, Math.max(minWidth, dragging.current.startW + (e.clientX - dragging.current.startX)));
    setWidth(next);
  }, [minWidth, maxWidth]);

  const onMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try { window.localStorage.setItem(`colw:${storageKey}`, String(width)); } catch { /* ignore */ }
  }, [storageKey, width]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    dragging.current = { startX: t.clientX, startW: width };
  };
  const onTouchMove = useCallback((e: TouchEvent) => {
    if (!dragging.current) return;
    const t = e.touches[0];
    if (!t) return;
    e.preventDefault();
    const next = Math.min(maxWidth, Math.max(minWidth, dragging.current.startW + (t.clientX - dragging.current.startX)));
    setWidth(next);
  }, [minWidth, maxWidth]);
  const onTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = null;
    try { window.localStorage.setItem(`colw:${storageKey}`, String(width)); } catch { /* ignore */ }
  }, [storageKey, width]);

  useEffect(() => {
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onTouchMove, onTouchEnd]);

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
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          try { window.localStorage.setItem(`colw:${storageKey}`, String(defaultWidth)); } catch { /* ignore */ }
        }}
        title="Drag to resize · double-click to reset"
        className={cn(
          // Wider hit target on touch, narrow visual on hover
          "absolute top-0 right-0 h-full select-none touch-none cursor-col-resize z-10",
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
