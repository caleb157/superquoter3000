import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { TaskDialog } from '@/components/TaskDialog';
import type { TaskContext } from '@/lib/task-types';
import { cn } from '@/lib/utils';

/**
 * Mobile-only floating "+" that always opens the New Task dialog,
 * pre-filled with context derived from the current route.
 *
 * Routes handled:
 *  - /inquiry/:id           → inquiryId
 *  - /product/:id           → productId (+ owning inquiry)
 *  - /customer/:id          → customerId
 *  - everything else        → no pre-fill
 */
export function MobileTaskFab({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<TaskContext | undefined>(undefined);
  const location = useLocation();
  const params = useParams();

  // Derive context from URL when the FAB is tapped (fresh each open).
  const buildContext = async (): Promise<TaskContext | undefined> => {
    const path = location.pathname;

    // /inquiry/:id  or  /inquiries/:id
    const inquiryMatch = path.match(/^\/(?:inquiry|inquiries)\/([^/?#]+)/);
    if (inquiryMatch) return { inquiryId: inquiryMatch[1] };

    // /customer/:id  or  /customers/:id (but NOT the list page)
    const customerMatch = path.match(/^\/(?:customer|customers)\/([^/?#]+)/);
    if (customerMatch) return { customerId: customerMatch[1] };

    // /product/:id  or  /products/:id  → look up owning inquiry
    const productMatch = path.match(/^\/(?:product|products)\/([^/?#]+)/);
    if (productMatch) {
      const productId = productMatch[1];
      const { data } = await supabase
        .from('products')
        .select('id, customer_rfq_id')
        .eq('id', productId)
        .maybeSingle();
      return {
        productId,
        inquiryId: data?.customer_rfq_id ?? undefined,
      };
    }

    return undefined;
  };

  const handleClick = async () => {
    const ctx = await buildContext();
    setContext(ctx);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label="New task"
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
        <Plus className="h-6 w-6" />
        <span className="sr-only">New task</span>
      </button>

      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        context={context}
      />
    </>
  );
}
