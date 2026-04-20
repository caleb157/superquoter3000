import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';

export default function ProjectRedirect() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      if (!id) return navigate('/inquiries', { replace: true });
      const { data } = await (supabase as any)
        .from('projects').select('customer_rfq_id').eq('id', id).maybeSingle();
      if (data?.customer_rfq_id) navigate(`/inquiry/${data.customer_rfq_id}`, { replace: true });
      else navigate('/inquiries', { replace: true });
    })();
  }, [id, navigate]);
  return <AppLayout><div className="text-center py-12 text-muted-foreground">Redirecting…</div></AppLayout>;
}
