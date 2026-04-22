import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Users, ExternalLink } from 'lucide-react';

type VendorRollup = {
  vendor_id: string | null;
  vendor_name: string;
  total: number;
  pending: number;
  completed: number;
};

export function ProductVendorsPanel({ productId }: { productId: string }) {
  const [rows, setRows] = useState<VendorRollup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('samples')
        .select('vendor_id, vendor_name, status')
        .eq('product_id', productId);
      if (cancel) return;
      const map = new Map<string, VendorRollup>();
      (data ?? []).forEach((s: any) => {
        const name = (s.vendor_name ?? '').trim();
        if (!name && !s.vendor_id) return;
        const key = s.vendor_id ?? `name:${name.toLowerCase()}`;
        const existing = map.get(key) ?? {
          vendor_id: s.vendor_id ?? null,
          vendor_name: name || 'Unnamed vendor',
          total: 0, pending: 0, completed: 0,
        };
        existing.total += 1;
        if (s.status === 'pending') existing.pending += 1;
        if (s.status === 'completed') existing.completed += 1;
        map.set(key, existing);
      });
      setRows(Array.from(map.values()).sort((a, b) => a.vendor_name.localeCompare(b.vendor_name)));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [productId]);

  if (loading) return null;
  if (rows.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 px-3 rounded-md border border-dashed">
        <Users className="h-3.5 w-3.5" />
        <span>No vendors assigned yet. Add one from the Sample Log tab.</span>
      </div>
    );
  }

  return (
    <div className="py-2 px-3 rounded-md border bg-muted/30">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Users className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned Vendors</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rows.map(r => {
          const label = (
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium">{r.vendor_name}</span>
              <span className="text-[10px] text-muted-foreground">
                {r.pending > 0 && <span className="text-amber-600 dark:text-amber-400">{r.pending} pending</span>}
                {r.pending > 0 && r.completed > 0 && <span> · </span>}
                {r.completed > 0 && <span className="text-emerald-600 dark:text-emerald-400">{r.completed} done</span>}
              </span>
              {r.vendor_id && <ExternalLink className="h-3 w-3 opacity-60" />}
            </span>
          );
          return r.vendor_id ? (
            <Link
              key={r.vendor_id}
              to="/settings#vendors"
              className="inline-flex"
              title={`Open ${r.vendor_name} in vendor settings`}
            >
              <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-accent">
                {label}
              </Badge>
            </Link>
          ) : (
            <Badge key={r.vendor_name} variant="outline" className="text-xs" title="Free-text vendor — not linked to a vendor record">
              {label}
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
