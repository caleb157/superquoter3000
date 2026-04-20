import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { TaskList } from '@/components/TaskList';
import { TaskDialog } from '@/components/TaskDialog';

type Props = { productId: string; inquiryId?: string | null };

export function ProductTasksTab({ productId, inquiryId }: Props) {
  const [open, setOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tasks</h2>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add Task</Button>
      </div>

      <TaskList productId={productId} status="all" refreshKey={refreshKey} />

      <TaskDialog
        open={open}
        onOpenChange={setOpen}
        context={{ productId, inquiryId: inquiryId ?? undefined }}
        onSaved={() => setRefreshKey(k => k + 1)}
      />
    </div>
  );
}
