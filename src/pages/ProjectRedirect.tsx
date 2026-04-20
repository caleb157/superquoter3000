import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';

export default function ProjectRedirect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      if (!id) return navigate('/', { replace: true });
      const { data: project } = await (supabase as any)
        .from('projects').select('*').eq('id', id).maybeSingle();

      if (!project) return navigate('/', { replace: true });
      if (project.customer_rfq_id) {
        return navigate(`/inquiry/${project.customer_rfq_id}`, { replace: true });
      }

      // Legacy project — create an inquiry from it on the fly, link it, and migrate products.
      const { data: inq, error } = await (supabase as any)
        .from('customer_rfqs')
        .insert({
          customer_id: project.customer_id ?? null,
          title: project.name,
          status: project.status === 'po_confirmed' ? 'po' : 'active',
          priority: 'normal',
        })
        .select('id')
        .single();

      if (error || !inq) {
        console.error('Failed to create inquiry from project', error);
        return navigate('/', { replace: true });
      }

      await (supabase as any).from('projects').update({ customer_rfq_id: inq.id }).eq('id', id);
      await (supabase as any).from('products').update({ customer_rfq_id: inq.id }).eq('project_id', id);

      navigate(`/inquiry/${inq.id}`, { replace: true });
    })();
  }, [id, navigate]);
  return <AppLayout><div className="text-center py-12 text-muted-foreground">Opening inquiry…</div></AppLayout>;
}
