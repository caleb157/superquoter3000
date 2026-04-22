import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, Users, Mail, Phone, ExternalLink, Package } from 'lucide-react';

type Vendor = {
  id: string;
  name: string;
  category: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

type ProductLink = {
  product_id: string;
  product_name: string;
  pending: number;
  completed: number;
  total: number;
};

type VendorWithProducts = Vendor & {
  products: ProductLink[];
  totalSamples: number;
};

export default function Vendors() {
  const [vendors, setVendors] = useState<VendorWithProducts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [vendorsRes, samplesRes] = await Promise.all([
        supabase.from('vendors').select('id, name, category, email, phone, notes').order('name'),
        supabase
          .from('samples')
          .select('vendor_id, status, product_id, products(id, name)')
          .not('vendor_id', 'is', null),
      ]);
      if (cancel) return;

      const linkMap = new Map<string, Map<string, ProductLink>>();
      (samplesRes.data ?? []).forEach((s: any) => {
        if (!s.vendor_id || !s.products) return;
        const productId = s.products.id;
        const productName = s.products.name;
        let pmap = linkMap.get(s.vendor_id);
        if (!pmap) {
          pmap = new Map();
          linkMap.set(s.vendor_id, pmap);
        }
        const existing = pmap.get(productId) ?? {
          product_id: productId,
          product_name: productName,
          pending: 0,
          completed: 0,
          total: 0,
        };
        existing.total += 1;
        if (s.status === 'pending') existing.pending += 1;
        if (s.status === 'completed') existing.completed += 1;
        pmap.set(productId, existing);
      });

      const enriched: VendorWithProducts[] = (vendorsRes.data ?? []).map(v => {
        const products = Array.from(linkMap.get(v.id)?.values() ?? []).sort((a, b) =>
          a.product_name.localeCompare(b.product_name),
        );
        return {
          ...v,
          products,
          totalSamples: products.reduce((sum, p) => sum + p.total, 0),
        };
      });

      setVendors(enriched);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v => {
      if (v.name.toLowerCase().includes(q)) return true;
      if (v.category?.toLowerCase().includes(q)) return true;
      if (v.email?.toLowerCase().includes(q)) return true;
      if (v.products.some(p => p.product_name.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [vendors, search]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-semibold">Vendors</h1>
            <Badge variant="secondary" className="text-xs">{vendors.length}</Badge>
          </div>
          <Link to="/settings#vendors">
            <Button size="sm" variant="outline">
              Manage in Settings
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>

        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search vendors or products…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              {search ? 'No vendors match your search.' : 'No vendors yet.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map(v => (
              <Card key={v.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate">{v.name}</CardTitle>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {v.category && (
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {v.category}
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {v.products.length} product{v.products.length === 1 ? '' : 's'} · {v.totalSamples} sample{v.totalSamples === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>
                  {(v.email || v.phone) && (
                    <div className="flex flex-col gap-1 mt-2 text-xs text-muted-foreground">
                      {v.email && (
                        <a href={`mailto:${v.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                          <Mail className="h-3 w-3" /> {v.email}
                        </a>
                      )}
                      {v.phone && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="h-3 w-3" /> {v.phone}
                        </span>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  {v.products.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">No products linked yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <Package className="h-3 w-3" />
                        Linked products
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {v.products.map(p => (
                          <Link key={p.product_id} to={`/product/${p.product_id}`}>
                            <Badge variant="secondary" className="text-xs cursor-pointer hover:bg-accent gap-1.5">
                              <span className="font-medium">{p.product_name}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {p.pending > 0 && (
                                  <span className="text-amber-600 dark:text-amber-400">{p.pending} pending</span>
                                )}
                                {p.pending > 0 && p.completed > 0 && <span> · </span>}
                                {p.completed > 0 && (
                                  <span className="text-emerald-600 dark:text-emerald-400">{p.completed} done</span>
                                )}
                              </span>
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
