import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Search, Upload } from 'lucide-react';
import { fmt } from '@/lib/formatters';
import { UploadParseDialog } from '@/components/UploadParseDialog';

const Products = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [cbmMap, setCbmMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterProject, setFilterProject] = useState('all');
  const [filterCustomer, setFilterCustomer] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [showUploadParse, setShowUploadParse] = useState(false);
  const [uploadProjectId, setUploadProjectId] = useState('');
  const [showProjectPicker, setShowProjectPicker] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      const [prodRes, projRes, custRes, typesRes, cbmRes] = await Promise.all([
        supabase.from('products').select('*').order('created_at', { ascending: false }),
        supabase.from('projects').select('*'),
        supabase.from('customers').select('*'),
        supabase.from('product_types').select('*'),
        supabase.from('cbm_estimates').select('*'),
      ]);
      if (prodRes.data) setProducts(prodRes.data);
      if (projRes.data) setProjects(projRes.data);
      if (custRes.data) setCustomers(custRes.data);
      if (typesRes.data) setProductTypes(typesRes.data);
      if (cbmRes.data) {
        const map: Record<string, any> = {};
        cbmRes.data.forEach((c: any) => { if (c.product_id) map[c.product_id] = c; });
        setCbmMap(map);
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const customerMap = Object.fromEntries(customers.map(c => [c.id, c]));

  const filtered = products.filter(p => {
    if (search) {
      const s = search.toLowerCase();
      if (!(p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s))) return false;
    }
    if (filterProject !== 'all' && p.project_id !== filterProject) return false;
    if (filterType !== 'all' && p.product_type_id !== filterType) return false;
    if (filterCustomer !== 'all') {
      const proj = projectMap[p.project_id];
      if (!proj || proj.customer_id !== filterCustomer) return false;
    }
    return true;
  });

  const getStatus = (p: any) => {
    const flags = [p.cbm_done, p.cogs_done, p.overhead_done, p.shipping_done, p.revenue_done];
    const done = flags.filter(Boolean).length;
    if (done === 5) return 'green';
    if (done > 0) return 'yellow';
    return 'gray';
  };

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto space-y-4">
        <h1 className="text-lg font-bold">All Products</h1>
        
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by name or SKU..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Projects" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterCustomer} onValueChange={setFilterCustomer}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Customers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue placeholder="All Types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {productTypes.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="text-center py-12 text-muted-foreground">Loading...</div>
        ) : (
          <div className="border rounded-md overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit CBM</TableHead>
                  <TableHead className="text-right">Cost ($)</TableHead>
                  <TableHead className="text-right">Price ($)</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(p => {
                  const proj = projectMap[p.project_id];
                  const cust = proj?.customer_id ? customerMap[proj.customer_id] : null;
                  const cbm = cbmMap[p.id];
                  const status = getStatus(p);
                  return (
                    <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/product/${p.id}`)}>
                      <TableCell>
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={p.photo_url || ''} />
                          <AvatarFallback className="text-[10px]">{p.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell className="font-medium text-sm">{p.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.sku || '—'}</TableCell>
                      <TableCell>
                        <span className="text-xs text-primary hover:underline" onClick={e => { e.stopPropagation(); if (proj) navigate(`/project/${proj.id}`); }}>
                          {proj?.name || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">{cust?.name || proj?.customer_name || '—'}</TableCell>
                      <TableCell className="text-right text-xs">{fmt.qty(p.quantity)}</TableCell>
                      <TableCell className="text-right text-xs">{cbm?.final_unit_cbm ? fmt.cbm(cbm.final_unit_cbm) : '—'}</TableCell>
                      <TableCell className="text-right text-xs">—</TableCell>
                      <TableCell className="text-right text-xs">—</TableCell>
                      <TableCell className="text-center">
                        <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                          status === 'green' ? 'bg-emerald-500' : status === 'yellow' ? 'bg-amber-500' : 'bg-gray-300'
                        }`} />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No products found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default Products;
