import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Props = {
  done: boolean;
  onToggle: () => void;
  children: ReactNode;
};

const THRESHOLD = 72; // px to trigger
const MAX = 110;      // visual max drag

/**
 * Mobile swipe-to-complete row.
 * - Swipe right → mark done (green reveal with check)
 * - Swipe left  → reopen if done (amber reveal with undo)
 * Desktop (no touch) — pass-through, no behavior change.
 */
export function SwipeableTaskRow({ done, onToggle, children }: Props) {
  const [dx, setDx] = useState(0);
  const [animating, setAnimating] = useState(false);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const locked = useRef<'h' | 'v' | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    locked.current = null;
    setAnimating(false);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (startX.current == null || startY.current == null) return;
    const dX = e.touches[0].clientX - startX.current;
    const dY = e.touches[0].clientY - startY.current;

    // Decide axis on first meaningful movement so vertical scroll still works.
    if (locked.current == null) {
      if (Math.abs(dX) < 6 && Math.abs(dY) < 6) return;
      locked.current = Math.abs(dX) > Math.abs(dY) ? 'h' : 'v';
    }
    if (locked.current === 'v') return;

    // Constrain to the meaningful direction based on current state.
    const allowed = done ? Math.min(0, dX) : Math.max(0, dX);
    const clamped = Math.max(-MAX, Math.min(MAX, allowed));
    setDx(clamped);
  };

  const onTouchEnd = () => {
    if (locked.current === 'h' && Math.abs(dx) >= THRESHOLD) {
      // Animate off, fire toggle, then snap back.
      setAnimating(true);
      setDx(dx > 0 ? MAX : -MAX);
      setTimeout(() => {
        onToggle();
        setDx(0);
        // remove animation flag after snap-back tick
        setTimeout(() => setAnimating(false), 180);
      }, 120);
    } else {
      setAnimating(true);
      setDx(0);
      setTimeout(() => setAnimating(false), 180);
    }
    startX.current = null;
    startY.current = null;
    locked.current = null;
  };

  const showRight = dx > 8;   // revealing left side bg → swiping right
  const showLeft = dx < -8;   // revealing right side bg → swiping left
  const armed = Math.abs(dx) >= THRESHOLD;

  return (
    <div className="relative overflow-hidden touch-pan-y">
      {/* Underlay reveal */}
      {showRight && (
        <div
          className={cn(
            'absolute inset-y-0 left-0 flex items-center justify-start pl-4 transition-colors',
            armed ? 'bg-emerald-500 text-white' : 'bg-emerald-500/40 text-emerald-900 dark:text-emerald-50',
          )}
          style={{ width: Math.abs(dx) + 24 }}
          aria-hidden
        >
          <Check className="h-5 w-5" />
        </div>
      )}
      {showLeft && (
        <div
          className={cn(
            'absolute inset-y-0 right-0 flex items-center justify-end pr-4 transition-colors',
            armed ? 'bg-amber-500 text-white' : 'bg-amber-500/40 text-amber-900 dark:text-amber-50',
          )}
          style={{ width: Math.abs(dx) + 24 }}
          aria-hidden
        >
          <RotateCcw className="h-5 w-5" />
        </div>
      )}

      {/* Foreground */}
      <div
        className={cn('relative bg-background', animating && 'transition-transform duration-150 ease-out')}
        style={{ transform: `translate3d(${dx}px, 0, 0)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
