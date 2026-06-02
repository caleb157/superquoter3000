import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { ProjectionsTable } from '@/components/analytics/ProjectionsTable';
import { EntityCashflowTable } from '@/components/analytics/EntityCashflowTable';
import { cn } from '@/lib/utils';

type Entity = { id: string; name: string };

/**
 * Wrapper for the Projections analytics tab: sub-views are
 * "All" (the existing combined projections table) plus one cashflow
 * view per entity that appears as a selling or producing entity on
 * any in-window inquiry.
 */
export function ProjectionsView() {
  const [params, setParams] = useSearchParams();
  const sub = params.get('p_sub') || 'all';

  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => {
    (async () => {
      // Pull only entities referenced by some projection (selling or producing)
      // — exposes the relevant tabs without hardcoding names.
      const [{ data: projs }, { data: ents }] = await Promise.all([
        supabase
          .from('inquiry_projections')
          .select('selling_entity_id, producing_entity_id'),
        supabase.from('company_entities').select('id, name').order('name'),
      ]);
      const used = new Set<string>();
      (projs || []).forEach((p: any) => {
        if (p.selling_entity_id) used.add(p.selling_entity_id);
        if (p.producing_entity_id) used.add(p.producing_entity_id);
      });
      const list: Entity[] = (ents || [])
        .filter((e: any) => used.has(e.id))
        .map((e: any) => ({ id: e.id, name: e.name }));
      setEntities(list);
    })();
  }, []);

  const setSub = (v: string) => {
    const np = new URLSearchParams(params);
    np.set('p_sub', v);
    setParams(np, { replace: true });
  };

  const current = sub === 'all' ? null : entities.find((e) => e.id === sub);

  return (
    <div className="space-y-4">
      {/* Sub-view selector */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={sub === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSub('all')}
          className={cn('h-8')}
        >
          All (projections)
        </Button>
        {entities.map((e) => (
          <Button
            key={e.id}
            variant={sub === e.id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSub(e.id)}
            className={cn('h-8')}
          >
            {e.name} cashflow
          </Button>
        ))}
      </div>

      {sub === 'all' && <ProjectionsTable />}
      {current && (
        <EntityCashflowTable
          key={current.id}
          entityId={current.id}
          entityName={current.name}
        />
      )}
    </div>
  );
}
