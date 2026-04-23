import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { TaskDialog } from '@/components/TaskDialog';
import type { TaskContext } from '@/lib/task-types';

export function GlobalTaskQuickAdd() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const context = useMemo<TaskContext>(() => {
    const path = location.pathname;
    const inquiryMatch = path.match(/^\/(?:inquiry|inquiries)\/([^/?#]+)/);
    if (inquiryMatch) return { inquiryId: inquiryMatch[1] };
    const productMatch = path.match(/^\/(?:product|products)\/([^/?#]+)/);
    if (productMatch) return { productId: productMatch[1] };
    const customerMatch = path.match(/^\/(?:customer|customers)\/([^/?#]+)/);
    if (customerMatch) return { customerId: customerMatch[1] };
    return {};
  }, [location.pathname]);

  return (
    <>
      <Button variant="ghost" size="icon" className="h-8 w-8" title="New task" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
      </Button>
      {open && (
        <TaskDialog open={open} onOpenChange={setOpen} context={context} />
      )}
    </>
  );
}
