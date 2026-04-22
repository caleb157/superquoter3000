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

  return (
    <TableHead
      style={{ width, minWidth: width, maxWidth: width }}
      className={cn('relative group', align === 'right' && 'text-right', className)}
    >
      <span className="block truncate pr-2">{children}</span>
      <span
        role="separator"
        aria-orientation="vertical"
        onMouseDown={onMouseDown}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          try { window.localStorage.setItem(`colw:${storageKey}`, String(defaultWidth)); } catch { /* ignore */ }
        }}
        title="Drag to resize · double-click to reset"
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none
                   bg-transparent group-hover:bg-border hover:!bg-primary/60 transition-colors"
      />
    </TableHead>
  );
}
