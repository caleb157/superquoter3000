import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';

export default function ProjectRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/inquiries', { replace: true });
  }, [navigate]);
  return (
    <AppLayout>
      <div className="text-center py-12 text-sm text-muted-foreground">Redirecting…</div>
    </AppLayout>
  );
}
