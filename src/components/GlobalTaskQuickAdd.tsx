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
    const inquiryMatch = location.pathname.match(/^\/inquiry\/([^/]+)/);
    if (inquiryMatch) return { inquiryId: inquiryMatch[1] };
    const productMatch = location.pathname.match(/^\/product\/([^/]+)/);
    if (productMatch) return { productId: productMatch[1] };
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
