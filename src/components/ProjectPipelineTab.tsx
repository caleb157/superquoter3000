import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { PipelineTable } from '@/components/PipelineTable';
import { PipelineItemDialog } from '@/components/PipelineItemDialog';
import type { PipelineItem } from '@/lib/pipeline-helpers';

interface Props {
  projectId: string;
  customerId?: string;
}

export function ProjectPipelineTab({ projectId, customerId }: Props) {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<PipelineItem | null>(null);

  const fetch = useCallback(async () => {
    const { data } = await supabase.from('pipeline_items').select('*').eq('project_id', projectId).order('sort_order');
    setItems(data ?? []);
    const { data: custs } = await supabase.from('customers').select('id, name');
    const m: Record<string, string> = {};
    custs?.forEach(c => (m[c.id] = c.name));
    setCustomers(m);
  }, [projectId]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditItem(null); setDialogOpen(true); }}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Pipeline Item
        </Button>
      </div>
      <PipelineTable items={items} customers={customers} onEdit={i => { setEditItem(i); setDialogOpen(true); }} onRefresh={fetch} />
      <PipelineItemDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editItem}
        onSaved={fetch}
        defaultProjectId={projectId}
        defaultCustomerId={customerId}
      />
    </div>
  );
}
