import { useState } from 'react';
import { CheckSquare, Lightbulb, Plus, Users } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { TaskDialog } from '@/components/TaskDialog';
import { LearningDialog } from '@/components/notes/LearningDialog';
import { HrNoteDialog } from '@/components/notes/HrNoteDialog';
import { useAuth } from '@/contexts/AuthContext';
import type { TaskContext } from '@/lib/task-types';
import { cn } from '@/lib/utils';

/**
 * Mobile floating "+" speed dial (Google Keep style): tapping it shows
 * New Task / New Learning / HR Note bubbles above it. New Task keeps the
 * route-derived context (inquiry, product, customer).
 */
export function MobileTaskFab({ className }: { className?: string }) {
  const { isAdmin } = useAuth();
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<'task' | 'learning' | 'hr' | null>(null);
  const [context, setContext] = useState<TaskContext | undefined>(undefined);
  const location = useLocation();

  const buildContext = async (): Promise<TaskContext | undefined> => {
    const path = location.pathname;
    const inquiryMatch = path.match(/^\/(?:inquiry|inquiries)\/([^/?#]+)/);
    if (inquiryMatch) return { inquiryId: inquiryMatch[1] };
    const customerMatch = path.match(/^\/(?:customer|customers)\/([^/?#]+)/);
    if (customerMatch) return { customerId: customerMatch[1] };
    const productMatch = path.match(/^\/(?:product|products)\/([^/?#]+)/);
    if (productMatch) {
      const productId = productMatch[1];
      const { data } = await supabase.from('products').select('id, customer_rfq_id').eq('id', productId).maybeSingle();
      return { productId, inquiryId: data?.customer_rfq_id ?? undefined };
    }
    return undefined;
  };

  const pick = async (kind: 'task' | 'learning' | 'hr') => {
    setMenu(false);
    if (kind === 'task') setContext(await buildContext());
    setOpen(kind);
  };

  const options = [
    { kind: 'hr' as const, label: 'HR Note', icon: Users, show: isAdmin },
    { kind: 'learning' as const, label: 'New Learning', icon: Lightbulb, show: true },
    { kind: 'task' as const, label: 'New Task', icon: CheckSquare, show: true },
  ].filter(o => o.show);

  const bottom = 'calc(env(safe-area-inset-bottom) + 4.5rem)';
  return (
    <>
      {menu && <div className="md:hidden fixed inset-0 z-40 bg-background/70 backdrop-blur-[1px]" onClick={() => setMenu(false)} />}
      {menu && (
        <div className="md:hidden fixed right-4 z-50 flex flex-col items-end gap-3" style={{ bottom: `calc(${bottom} + 4.25rem)` }}>
          {options.map((o, i) => (
            <button key={o.kind} type="button" onClick={() => pick(o.kind)}
              style={{ animationDelay: `${(options.length - 1 - i) * 40}ms` }}
              className="animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex items-center gap-2 rounded-full bg-card text-card-foreground border shadow-md pl-3 pr-4 h-11 text-sm font-medium active:scale-95 transition-transform">
              <o.icon className="h-4 w-4 text-primary" /> {o.label}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setMenu(m => !m)}
        aria-label={menu ? 'Close quick add' : 'Quick add'}
        aria-expanded={menu}
        className={cn(
          'md:hidden fixed right-4 z-50 h-14 w-14 rounded-full',
          'bg-primary text-primary-foreground shadow-lg shadow-primary/30',
          'flex items-center justify-center active:scale-95 transition-transform',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          className,
        )}
        style={{ bottom }}
      >
        <Plus className={cn('h-6 w-6 transition-transform', menu && 'rotate-45')} />
      </button>

      <TaskDialog open={open === 'task'} onOpenChange={o => setOpen(o ? 'task' : null)} context={context} />
      <LearningDialog open={open === 'learning'} onOpenChange={o => setOpen(o ? 'learning' : null)} />
      {isAdmin && <HrNoteDialog open={open === 'hr'} onOpenChange={o => setOpen(o ? 'hr' : null)} />}
    </>
  );
}
