import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, ArrowLeft, Package, Download, FileText, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import * as calc from '@/lib/calculations';
import { exportToExcel, downloadSummaryPDF, generateCustomerQuotePDF, type ExportProduct, type ExportAggregates, type ExportContext } from '@/lib/exports';
import ProjectSummary from './ProjectSummary';
import ProjectSettingsTab from './ProjectSettingsTab';

const STATUS_OPTIONS = ['draft', 'costing', 'quoted', 'po_confirmed', 'archived'];

const ProjectDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductTypeId, setNewProductTypeId] = useState('');

  const activeTab = searchParams.get('tab') || 'products';
  const setActiveTab = (tab: string) => setSearchParams({ tab });

  const fetchProject = async () => {
    if (!id) return;
    const { data } = await supabase.from('projects').select('*').eq('id', id).single();
    if (data) setProject(data);
  };

  const fetchProducts = async () => {
    if (!id) return;
    const { data } = await supabase.from('products').select('*').eq('project_id', id).order('sort_order');
    if (data) setProducts(data);
  };

  const fetchProductTypes = async () => {
    const { data } = await supabase.from('product_types').select('*').order('name');
    if (data) setProductTypes(data);
  };

  useEffect(() => {
    fetchProject();
    fetchProducts();
    fetchProductTypes();
  }, [id]);

  const updateProject = async (field: string, value: any) => {
    if (!id) return;
    const { error } = await supabase.from('projects').update({ [field]: value } as any).eq('id', id);
    if (error) toast.error(error.message);
    else setProject({ ...project, [field]: value });
  };

  const addProduct = async () => {
    if (!newProductName.trim() || !id) return;
    const { data, error } = await supabase.from('products').insert({
      project_id: id,
      name: newProductName.trim(),
      product_type_id: newProductTypeId || null,
      sort_order: products.length,
    }).select().single();

    if (error) { toast.error(error.message); return; }

    if (data) {
      const defaultCogs = [
        { product_id: data.id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 1', sort_order: 0 },
        { product_id: data.id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 2', sort_order: 1 },
        { product_id: data.id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 1', sort_order: 2 },
        { product_id: data.id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 2', sort_order: 3 },
        { product_id: data.id, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, sort_order: 4 },
        { product_id: data.id, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, sort_order: 5 },
        { product_id: data.id, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, sort_order: 6 },
        { product_id: data.id, cogs_type: 'Packaging', component_name: 'IC Box', is_auto_calculated: true, waste_factor: 0.05, sort_order: 7 },
        { product_id: data.id, cogs_type: 'Packaging', component_name: 'MC Box', is_auto_calculated: true, sort_order: 8 },
        { product_id: data.id, cogs_type: 'Packaging', component_name: 'Other Packaging', sort_order: 9 },
        { product_id: data.id, cogs_type: 'Hardware', component_name: 'Hardware 1', waste_factor: 0.05, sort_order: 10 },
        { product_id: data.id, cogs_type: 'Hardware', component_name: 'Hardware 2', waste_factor: 0.05, sort_order: 11 },
        { product_id: data.id, cogs_type: 'Accessories', component_name: 'Accessory 1', waste_factor: 0.05, sort_order: 12 },
        { product_id: data.id, cogs_type: 'Accessories', component_name: 'Accessory 2', waste_factor: 0.05, sort_order: 13 },
      ];
      await supabase.from('cogs_items').insert(defaultCogs as any);

      const defaultOverhead = [
        { product_id: data.id, labor_type: 'Manufacturing', sort_order: 0 },
        { product_id: data.id, labor_type: 'QC', man_hours_per_unit: 0.05, sort_order: 1 },
        { product_id: data.id, labor_type: 'Sanding', sort_order: 2 },
        { product_id: data.id, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
        { product_id: data.id, labor_type: 'Assembly', sort_order: 4 },
        { product_id: data.id, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
        { product_id: data.id, labor_type: 'Market', sort_order: 6 },
      ];
      await supabase.from('overhead_items').insert(defaultOverhead as any);

      await supabase.from('cbm_estimates').insert({ product_id: data.id } as any);

      // Auto-add "Auto Transport" non-unit COGS
      const { data: gs } = await supabase.from('global_settings').select('auto_transport_cost_per_cbm').limit(1).single();
      const autoTransportRate = (gs as any)?.auto_transport_cost_per_cbm || 500;
      await (supabase as any).from('non_unit_cogs').insert({
        product_id: data.id,
        name: 'Auto Transport',
        total_quantity: 1,
        cost_each_inr: 0,
        include: 'Yes',
        sort_order: 0,
      });
    }

    toast.success('Product created with default BOM');
    setNewProductName(''); setNewProductTypeId(''); setShowAddProduct(false);
    fetchProducts();
  };

  if (!project) return <AppLayout><div className="text-center py-12">Loading...</div></AppLayout>;

  const statusDot = (done: boolean | null) => (
    <span className={`status-dot ${done ? 'status-done' : 'status-pending'}`} />
  );

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <Input
              className="text-lg font-bold border-transparent hover:border-input h-9 px-2"
              defaultValue={project.name}
              onBlur={(e) => updateProject('name', e.target.value)}
            />
          </div>
          <Select value={project.status} onValueChange={(v) => updateProject('status', v)}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Customer info */}
        <div className="flex gap-3">
          <Input
            className="h-8 text-sm"
            placeholder="Customer name"
            defaultValue={project.customer_name || ''}
            onBlur={(e) => updateProject('customer_name', e.target.value)}
          />
          <Input
            className="h-8 text-sm"
            placeholder="Customer email"
            defaultValue={project.customer_email || ''}
            onBlur={(e) => updateProject('customer_email', e.target.value)}
          />
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="products">Products ({products.length})</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            {/* Add product button */}
            <div className="flex items-center justify-between mb-2">
              <div />
              <Dialog open={showAddProduct} onOpenChange={setShowAddProduct}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 h-7 text-xs">
                    <Plus className="h-3 w-3" /> Add Product
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Product</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <Input placeholder="Product name" value={newProductName} onChange={e => setNewProductName(e.target.value)} autoFocus />
                    <Select value={newProductTypeId} onValueChange={setNewProductTypeId}>
                      <SelectTrigger><SelectValue placeholder="Product type" /></SelectTrigger>
                      <SelectContent>
                        {productTypes.map(pt => (
                          <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={addProduct} className="w-full">Create Product</Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {products.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No products yet. Add your first product to start costing.</p>
              </CardContent></Card>
            ) : (
              <div className="border rounded-md overflow-auto">
                <Table className="dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Dims (in)</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit CBM</TableHead>
                      <TableHead className="text-right">Cost (USD)</TableHead>
                      <TableHead className="text-right">Price (USD)</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.map(p => (
                      <TableRow key={p.id} className="cursor-pointer hover:bg-accent/50"
                        onClick={() => navigate(`/product/${p.id}`)}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.sku || '—'}</TableCell>
                        <TableCell>{fmt.dim(p.width_inch, p.depth_inch, p.height_inch)}</TableCell>
                        <TableCell className="text-right">{fmt.qty(p.quantity)}</TableCell>
                        <TableCell className="text-right calc-field">—</TableCell>
                        <TableCell className="text-right calc-field">—</TableCell>
                        <TableCell className="text-right calc-field">—</TableCell>
                        <TableCell className="text-center space-x-1">
                          {statusDot(p.cbm_done)}
                          {statusDot(p.cogs_done)}
                          {statusDot(p.overhead_done)}
                          {statusDot(p.shipping_done)}
                          {statusDot(p.revenue_done)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="summary">
            {id && <ProjectSummary projectId={id} />}
          </TabsContent>

          <TabsContent value="settings">
            {id && <ProjectSettingsTab projectId={id} />}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default ProjectDetail;
