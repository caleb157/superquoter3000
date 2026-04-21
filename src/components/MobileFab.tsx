import { Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  onClick: () => void;
  label: string;
  icon?: LucideIcon;
  className?: string;
};

/**
 * Mobile-only floating action button.
 * Sits above the bottom tab bar (h-14 + safe-area inset).
 * Hidden on md+ where header actions are easily reachable.
 */
export function MobileFab({ onClick, label, icon: Icon = Plus, className }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'md:hidden fixed right-4 z-40 h-14 w-14 rounded-full',
        'bg-primary text-primary-foreground shadow-lg shadow-primary/30',
        'flex items-center justify-center',
        'active:scale-95 transition-transform',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 4.5rem)' }}
    >
      <Icon className="h-6 w-6" />
      <span className="sr-only">{label}</span>
    </button>
  );
}
