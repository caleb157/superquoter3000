import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />,
);
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  ),
);
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot ref={ref} className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)} {...props} />
  ),
);
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn("border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/50", className)}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

// Stable string hash for storage keys
const hashString = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
};

interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Disable built-in resize handle. */
  noResize?: boolean;
  /** Override storage key for width persistence. */
  resizeKey?: string;
  minWidth?: number;
  maxWidth?: number;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, children, noResize, resizeKey, minWidth = 24, maxWidth = 800, style, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTableCellElement | null>(null);
    const setRefs = (el: HTMLTableCellElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTableCellElement | null>).current = el;
    };

    const [storageKey, setStorageKey] = React.useState<string | null>(resizeKey ?? null);
    const [width, setWidth] = React.useState<number | null>(null);
    const widthRef = React.useRef<number | null>(null);
    widthRef.current = width;
    const dragging = React.useRef<{ startX: number; startW: number; pointerId: number } | null>(null);
    const handleRef = React.useRef<HTMLSpanElement | null>(null);

    // Derive a stable storage key from route + column position + header text once mounted.
    React.useEffect(() => {
      if (noResize) return;
      const el = innerRef.current;
      if (!el) return;
      let key = resizeKey ?? null;
      if (!key) {
        const tr = el.parentElement as HTMLTableRowElement | null;
        const colIndex = tr ? Array.prototype.indexOf.call(tr.children, el) : 0;
        const text = (el.textContent || '').trim().slice(0, 40);
        const path = typeof window !== 'undefined'
          ? window.location.pathname.replace(/\/[0-9a-f-]{8,}/gi, '/:id')
          : '';
        key = `colw:th:${path}:${colIndex}:${hashString(text)}`;
      }
      setStorageKey(key);
      try {
        const v = window.localStorage.getItem(key);
        const n = v ? parseInt(v, 10) : NaN;
        if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) setWidth(n);
      } catch { /* ignore */ }
    }, [noResize, resizeKey, minWidth, maxWidth]);

    const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      const el = innerRef.current;
      const startW = widthRef.current ?? (el ? el.getBoundingClientRect().width : 100);
      dragging.current = { startX: e.clientX, startW, pointerId: e.pointerId };
      try { handleRef.current?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }, []);

    const onPointerMove = React.useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
      if (!dragging.current || dragging.current.pointerId !== e.pointerId) return;
      const next = Math.min(maxWidth, Math.max(minWidth, dragging.current.startW + (e.clientX - dragging.current.startX)));
      setWidth(next);
    }, [minWidth, maxWidth]);

    const endDrag = React.useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
      if (!dragging.current || dragging.current.pointerId !== e.pointerId) return;
      try { handleRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      dragging.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (storageKey && widthRef.current != null) {
        try { window.localStorage.setItem(storageKey, String(widthRef.current)); } catch { /* ignore */ }
      }
    }, [storageKey]);

    React.useEffect(() => () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }, []);

    const mergedStyle: React.CSSProperties = width != null
      ? { ...style, width, minWidth: width, maxWidth: width }
      : (style || {});

    return (
      <th
        ref={setRefs}
        className={cn(
          "h-12 px-4 text-left align-middle text-xs uppercase tracking-wider font-medium font-display text-muted-foreground [&:has([role=checkbox])]:pr-0",
          !noResize && "relative group overflow-hidden",
          className,
        )}
        style={mergedStyle}
        {...props}
      >
        {!noResize ? (
          <span className="block truncate pr-3">{children}</span>
        ) : (
          children
        )}
        {!noResize && (
          <span
            ref={handleRef}
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => {
              setWidth(null);
              if (storageKey) {
                try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
              }
            }}
            title="Drag to resize · double-click to reset"
            className={cn(
              "absolute top-0 right-0 h-full select-none touch-none cursor-col-resize z-20 w-3 sm:w-2",
              "before:absolute before:top-1/2 before:right-0 before:-translate-y-1/2",
              "before:h-5 before:w-px before:bg-border before:transition-colors",
              "group-hover:before:bg-foreground/40 hover:before:!bg-primary hover:before:w-0.5",
            )}
          />
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
  ),
);
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(
  ({ className, ...props }, ref) => (
    <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  ),
);
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
