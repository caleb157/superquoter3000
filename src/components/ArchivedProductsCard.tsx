import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArchiveRestore } from 'lucide-react';
import { toast } from 'sonner';

type Row = { id: string; name: string; sku: string | null; archived_at: string | null };

export function ArchivedProductsCard({ inquiryId, onChange }: { inquiryId: string; onChange?: () => void }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from('products')
      .select('id, name, sku, archived_at')
      .eq('customer_rfq_id', inquiryId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false });
    setRows((data ?? []) as Row[]);
  }, [inquiryId]);

  useEffect(() => { load(); }, [load]);

  const unarchive = async (id: string) => {
    const { error } = await (supabase as any).from('products').update({ archived_at: null }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Product unarchived');
    load();
    onChange?.();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Archived products ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-4 text-xs text-muted-foreground">No archived products in this inquiry.</div>
        ) : (
          <div className="divide-y">
            {rows.map(r => (
              <div key={r.id} className="flex items-center gap-2 px-6 py-2">
                <button
                  className="min-w-0 flex-1 text-left text-sm hover:underline"
                  onClick={() => navigate(`/product/${r.id}`)}
                >
                  <span className="truncate">{r.name}</span>
                  {r.sku && <span className="ml-2 text-[11px] italic text-muted-foreground/70">{r.sku}</span>}
                </button>
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  {r.archived_at ? new Date(r.archived_at).toLocaleDateString() : ''}
                </span>
                <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={() => unarchive(r.id)}>
                  <ArchiveRestore className="h-3.5 w-3.5" /> Unarchive
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
