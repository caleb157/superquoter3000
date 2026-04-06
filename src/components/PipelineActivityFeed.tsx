import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import type { PipelineActivity } from '@/lib/task-helpers';

interface Props {
  pipelineItemId: string;
}

export function PipelineActivityFeed({ pipelineItemId }: Props) {
  const [entries, setEntries] = useState<PipelineActivity[]>([]);

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('pipeline_activity')
      .select('*')
      .eq('pipeline_item_id', pipelineItemId)
      .order('created_at', { ascending: false })
      .limit(20);
    setEntries(data ?? []);
  }, [pipelineItemId]);

  useEffect(() => { fetch(); }, [fetch]);

  if (entries.length === 0) return null;

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Activity</h4>
      <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
        {entries.map(e => (
          <div key={e.id} className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/70">{e.actor ?? 'System'}</span>
            <span>{e.description}</span>
            <span className="ml-auto flex-shrink-0">
              {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
