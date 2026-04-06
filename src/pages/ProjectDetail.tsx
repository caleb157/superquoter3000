import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Plus, ArrowLeft, Package, Download, FileText, FileSpreadsheet, Loader2, Upload, ImagePlus, Search, Trash2, Eye, EyeOff } from 'lucide-react';
import { BulkPhotoUpload } from '@/components/BulkPhotoUpload';
import { ProjectRfqTab } from '@/components/ProjectRfqTab';
import { UploadParseDialog } from '@/components/UploadParseDialog';
import { SortableHeader } from '@/components/SortableHeader';
import { ProductStatusIndicator, getStatusLevel } from '@/components/ProductStatusIndicator';
import { useTableSort } from '@/hooks/use-table-sort';
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
  const [assemblies, setAssemblies] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [costData, setCostData] = useState<Record<string, { unit_cbm: number; cost_usd: number; price_usd: number }>>({});
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddAssembly, setShowAddAssembly] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductTypeId, setNewProductTypeId] = useState('');
  const [newAssemblyName, setNewAssemblyName] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [showUploadParse, setShowUploadParse] = useState(false);
  // New state for bulk select, search, filter, hide completed
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [hideCompleted, setHideCompleted] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const activeTab = searchParams.get('tab') || 'products';
  const setActiveTab = (tab: string) => setSearchParams({ tab });
  const { sortColumn, sortDirection, toggleSort, sortItems } = useTableSort<any>({
    storageKey: 'project-products-sort',
  });

  const filteredProducts = useMemo(() => {
    let list = products;
    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q)
      );
    }
    // Type filter
    if (filterType !== 'all') {
      list = list.filter(p => p.product_type_id === filterType);
    }
    // Hide completed
    if (hideCompleted) {
      list = list.filter(p => getStatusLevel(p) < 3);
    }
    return list;
  }, [products, searchQuery, filterType, hideCompleted]);

  const sortedProducts = useMemo(() => {
    const getters: Record<string, (p: any) => string | number> = {
      name: (p) => (p.name || '').toLowerCase(),
      sku: (p) => (p.sku || '').toLowerCase(),
      qty: (p) => p.quantity || 0,
      status: (p) => getStatusLevel(p),
    };
    return sortItems(filteredProducts, getters);
  }, [filteredProducts, sortColumn, sortDirection]);

  const allSelected = sortedProducts.length > 0 && sortedProducts.every(p => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedProducts.map(p => p.id)));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} selected product${count > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      // Delete related data first
      await Promise.all([
        supabase.from('cogs_items').delete().in('product_id', ids),
        supabase.from('non_unit_cogs').delete().in('product_id', ids),
        supabase.from('overhead_items').delete().in('product_id', ids),
        supabase.from('shipping_items').delete().in('product_id', ids),
        supabase.from('cbm_estimates').delete().in('product_id', ids),
        supabase.from('product_variants').delete().in('product_id', ids),
      ]);
      const { error } = await supabase.from('products').delete().in('id', ids);
      if (error) throw error;
      toast.success(`Deleted ${count} product${count > 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      fetchProducts();
      fetchCostData();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
    setDeleting(false);
  };

  const completedCount = useMemo(() => products.filter(p => getStatusLevel(p) === 3).length, [products]);

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

  const fetchAssemblies = async () => {
    if (!id) return;
    const { data } = await (supabase as any).from('product_assemblies').select('*').eq('project_id', id).order('name');
    if (data) setAssemblies(data);
  };

  const fetchProductTypes = async () => {
    const { data } = await supabase.from('product_types').select('*').order('name');
    if (data) setProductTypes(data);
  };

  const fetchCostData = async () => {
    if (!id) return;
    const { data: prods } = await supabase.from('products').select('id, quantity, markup_percent, weight_kg').eq('project_id', id);
    if (!prods || prods.length === 0) return;
    const productIds = prods.map((p: any) => p.id);
    const [gsRes, empRes, stRes, cbmRes, cogsRes, nucRes, ohRes, shipRes, psRes] = await Promise.all([
      supabase.from('global_settings').select('*').limit(1).single(),
      supabase.from('labor_employees').select('*'),
      supabase.from('shipping_types').select('*'),
      supabase.from('cbm_estimates').select('*').in('product_id', productIds),
      supabase.from('cogs_items').select('*').in('product_id', productIds),
      supabase.from('non_unit_cogs').select('*').in('product_id', productIds),
      supabase.from('overhead_items').select('*').in('product_id', productIds),
      supabase.from('shipping_items').select('*').in('product_id', productIds),
      supabase.from('project_settings').select('*').eq('project_id', id).maybeSingle(),
    ]);
    const gs = gsRes.data;
    const employees = empRes.data || [];
    const shTypes = stRes.data || [];
    const ps = psRes.data as any;
    const exchangeRate = (ps && !ps.use_global_exchange_rate && ps.exchange_rate_override) ? ps.exchange_rate_override : (gs?.exchange_rate || 90);
    const map: Record<string, { unit_cbm: number; cost_usd: number; price_usd: number }> = {};

    prods.forEach((p: any) => {
      const cbmEst = (cbmRes.data || []).find((c: any) => c.product_id === p.id);
      const pCogs = (cogsRes.data || []).filter((c: any) => c.product_id === p.id);
      const pNuc = (nucRes.data || []).filter((c: any) => c.product_id === p.id);
      const pOh = (ohRes.data || []).filter((c: any) => c.product_id === p.id);
      const pShip = (shipRes.data || []).filter((c: any) => c.product_id === p.id);
      const qty = p.quantity || 100;
      const unit_cbm = cbmEst?.final_unit_cbm || calc.prePackagedCbm(p.width_inch || 0, p.depth_inch || 0, p.height_inch || 0);

      const cogsPerUnit = pCogs.filter((i: any) => i.include !== 'No').reduce((sum: number, item: any) => {
        const c = calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 });
        return sum + c.unit_cost;
      }, 0);
      const autoTransportRate = (gs as any)?.auto_transport_cost_per_cbm || 500;
      const nucWithLiveTransport = pNuc.map((i: any) => {
        if (i.name === 'Auto Transport' && unit_cbm > 0) {
          return { include: i.include || 'Yes', total_quantity: +(unit_cbm * qty).toFixed(4), cost_each_inr: autoTransportRate };
        }
        return { include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr };
      });
      const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(nucWithLiveTransport, qty);
      const ohItems = pOh.map((item: any) => ({ include: item.include, labor_type: item.labor_type, man_hours_per_unit: item.man_hours_per_unit || 0, hourly_rate: calc.avgRateByDesignation(employees, item.labor_type) }));
      const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
      const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
      const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs as any) : 0;
      const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);
      const shipItem = pShip[0];
      const shipType = shTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
      const shippingPerUnit = shipType ? calc.calcShippingPerUnit({ cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG', final_unit_cbm: unit_cbm, weight_kg: p.weight_kg || 0 }) : 0;
      const markupPercent = (ps?.apply_uniform_markup && ps.default_markup_override != null) ? ps.default_markup_override : (p.markup_percent || 0.2);
      const summary = calc.calcProductCostSummary(cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit, shippingPerUnit, markupPercent, exchangeRate, qty);
      map[p.id] = { unit_cbm, cost_usd: summary.product_cost_per_unit_usd, price_usd: summary.unit_price_usd };
    });
    setCostData(map);
  };

  useEffect(() => {
    fetchProject();
    fetchProducts();
    fetchAssemblies();
    fetchProductTypes();
    fetchCostData();
  }, [id]);

  const addAssembly = async () => {
    if (!newAssemblyName.trim() || !id) return;
    const { data, error } = await (supabase as any).from('product_assemblies').insert({
      project_id: id,
      name: newAssemblyName.trim(),
    }).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success('Assembly created');
    setNewAssemblyName(''); setShowAddAssembly(false);
    if (data) navigate(`/assembly/${data.id}`);
  };

  const updateProject = async (field: string, value: any) => {
    if (!id) return;

    // When customer_name changes, auto-create or link a customer record
    if (field === 'customer_name' && value?.trim()) {
      const name = value.trim();
      // Check if a customer with this name already exists
      const { data: existing } = await (supabase as any).from('customers').select('id, name, email').eq('name', name).maybeSingle();
      if (existing) {
        // Link to existing customer
        const { error } = await supabase.from('projects').update({
          customer_name: existing.name,
          customer_id: existing.id,
        } as any).eq('id', id);
        if (error) { toast.error(error.message); return; }
        setProject({ ...project, customer_name: existing.name, customer_id: existing.id });
      } else {
        // Create new customer and link
        const { data: newCust, error: custErr } = await (supabase as any).from('customers').insert({
          name,
          email: project.customer_email || null,
        }).select().single();
        if (custErr) { toast.error(custErr.message); return; }
        const { error } = await supabase.from('projects').update({
          customer_name: name,
          customer_id: newCust.id,
        } as any).eq('id', id);
        if (error) { toast.error(error.message); return; }
        setProject({ ...project, customer_name: name, customer_id: newCust.id });
      }
      return;
    }

    // When customer_email changes, also update the linked customer record
    if (field === 'customer_email' && project.customer_id) {
      await (supabase as any).from('customers').update({ email: value || null }).eq('id', project.customer_id);
    }

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
        { product_id: data.id, cogs_type: 'Hardware', component_name: '', waste_factor: 0.05, sort_order: 10 },
        { product_id: data.id, cogs_type: 'Hardware', component_name: '', waste_factor: 0.05, sort_order: 11 },
        { product_id: data.id, cogs_type: 'Accessories', component_name: '', waste_factor: 0.05, sort_order: 12 },
        { product_id: data.id, cogs_type: 'Accessories', component_name: '', waste_factor: 0.05, sort_order: 13 },
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

  // Export functionality
  const buildExportContext = async (): Promise<ExportContext | null> => {
    const [productsRes, gsRes, empRes, stRes, settingsRes, entRes, ptRes] = await Promise.all([
      supabase.from('products').select('*').eq('project_id', id!).order('sort_order'),
      supabase.from('global_settings').select('*').limit(1).single(),
      supabase.from('labor_employees').select('*'),
      supabase.from('shipping_types').select('*'),
      supabase.from('project_settings').select('*').eq('project_id', id!).maybeSingle(),
      (supabase as any).from('company_entities').select('*').order('name'),
      supabase.from('product_types').select('*'),
    ]);

    const prods = productsRes.data || [];
    const gs = gsRes.data;
    const employees = empRes.data || [];
    const shTypes = stRes.data || [];
    const ps = settingsRes.data as any;
    const pTypes = ptRes.data || [];

    const exchangeRate = (ps && !ps.use_global_exchange_rate && ps.exchange_rate_override)
      ? ps.exchange_rate_override : (gs?.exchange_rate || 90);

    const productIds = prods.map((p: any) => p.id);
    if (productIds.length === 0) { toast.error('No products to export'); return null; }

    const [cogsRes, nucRes, ohRes, shipRes, cbmRes] = await Promise.all([
      supabase.from('cogs_items').select('*').in('product_id', productIds),
      supabase.from('non_unit_cogs').select('*').in('product_id', productIds),
      supabase.from('overhead_items').select('*').in('product_id', productIds),
      supabase.from('shipping_items').select('*').in('product_id', productIds),
      supabase.from('cbm_estimates').select('*').in('product_id', productIds),
    ]);

    const allCogs = cogsRes.data || [];
    const allNuc = nucRes.data || [];
    const allOh = ohRes.data || [];
    const allShip = shipRes.data || [];
    const allCbm = cbmRes.data || [];

    const exportProducts: ExportProduct[] = prods.map((p: any) => {
      const cbmEst = allCbm.find((c: any) => c.product_id === p.id);
      const pCogs = allCogs.filter((c: any) => c.product_id === p.id);
      const pNuc = allNuc.filter((c: any) => c.product_id === p.id);
      const pOh = allOh.filter((c: any) => c.product_id === p.id);
      const pShip = allShip.filter((c: any) => c.product_id === p.id);
      const pQty = p.quantity || 100;

      // Use persisted CBM, or compute on-the-fly as fallback
      let unit_cbm = cbmEst?.final_unit_cbm || 0;
      if (unit_cbm === 0 && p.width_inch && p.depth_inch && p.height_inch) {
        const ptType = pTypes.find((t: any) => t.id === p.product_type_id);
        const icAdd = ptType?.ic_addition_per_side_inch || 0.5;
        const icDims = calc.calcICDimensions(p.width_inch, p.depth_inch, p.height_inch, icAdd);
        const icVol = calc.calcICVolumeCbm(icDims.ic_width, icDims.ic_depth, icDims.ic_height);
        const productsPerIc = cbmEst?.products_per_ic || 1;
        const includeMc = cbmEst?.include_mc ?? true;
        if (includeMc) {
          const mcPack = calc.calcMCPacking({
            include_mc: true, mc_type: cbmEst?.mc_type || '7 ply',
            mc_max_width: cbmEst?.mc_max_width || 25, mc_max_depth: cbmEst?.mc_max_depth || 25,
            mc_max_height: cbmEst?.mc_max_height || 25, mc_buffer_inch: cbmEst?.mc_buffer_inch || 1,
            mc_weight_limit_kg: cbmEst?.mc_weight_limit_kg || 20, mc_empty_weight_kg: cbmEst?.mc_empty_weight_kg || 1.5,
            product_weight_kg: p.weight_kg || 0, quantity: pQty, products_per_ic: productsPerIc,
            ic_width: icDims.ic_width, ic_depth: icDims.ic_depth, ic_height: icDims.ic_height,
          });
          unit_cbm = calc.calcFinalUnitCbm(true, icVol, productsPerIc, mcPack.mc_volume_cbm, mcPack.products_per_mc);
        } else {
          unit_cbm = calc.calcFinalUnitCbm(false, icVol, productsPerIc, 0, 0);
        }
      }
      const total_cbm = unit_cbm * pQty;

      const cogsPerUnit = pCogs.filter((i: any) => i.include !== 'No').reduce((sum: number, item: any) => {
        const c = calc.calcCogsItemCost({ include: item.include, components_per_product: item.components_per_product || 0, unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0 });
        return sum + c.unit_cost;
      }, 0);
      const autoTransportRate2 = (gs as any)?.auto_transport_cost_per_cbm || 500;
      const nucWithLiveTransport2 = pNuc.map((i: any) => {
        if (i.name === 'Auto Transport' && unit_cbm > 0) {
          return { include: i.include || 'Yes', total_quantity: +(unit_cbm * pQty).toFixed(4), cost_each_inr: autoTransportRate2 };
        }
        return { include: i.include, total_quantity: i.total_quantity, cost_each_inr: i.cost_each_inr };
      });
      const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(nucWithLiveTransport2, pQty);
      const ohItems = pOh.map((item: any) => ({ include: item.include, labor_type: item.labor_type, man_hours_per_unit: item.man_hours_per_unit || 0, hourly_rate: calc.avgRateByDesignation(employees, item.labor_type) }));
      const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, pQty);
      const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
      const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
      const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);
      const shipItem = pShip[0];
      const shipType = shTypes.find((s: any) => s.id === shipItem?.shipping_type_id);
      const shippingPerUnit = shipType ? calc.calcShippingPerUnit({ cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG', final_unit_cbm: unit_cbm, weight_kg: p.weight_kg || 0 }) : 0;
      const markupPercent = (ps?.apply_uniform_markup && ps.default_markup_override != null) ? ps.default_markup_override : (p.markup_percent || 0.2);
      const summary = calc.calcProductCostSummary(cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit, shippingPerUnit, markupPercent, exchangeRate, pQty);
      const reviewCount = pCogs.filter((i: any) => i.include === 'Review').length + pOh.filter((i: any) => i.include === 'Review').length;
      let remaining_to_target_inr: number | null = null;
      if (p.target_price_usd && summary.unit_price_usd > 0) {
        const targetCostRatio = summary.product_cost_per_unit_inr / summary.unit_price_inr;
        remaining_to_target_inr = (p.target_price_usd * targetCostRatio - summary.product_cost_per_unit_usd) * exchangeRate;
      }
      return {
        name: p.name, sku: p.sku, quantity: pQty, target_price_usd: p.target_price_usd, markup_percent: markupPercent,
        cbm_done: p.cbm_done, cogs_done: p.cogs_done, overhead_done: p.overhead_done, shipping_done: p.shipping_done, revenue_done: p.revenue_done,
        unit_cbm, total_cbm, unit_cost_inr: summary.product_cost_per_unit_inr, unit_cost_usd: summary.product_cost_per_unit_usd,
        unit_price_usd: summary.unit_price_usd, total_cost_usd: summary.product_cost_per_unit_usd * pQty,
        total_revenue_usd: summary.unit_price_usd * pQty, total_profit_usd: (summary.unit_price_usd - summary.product_cost_per_unit_usd) * pQty,
        gpm: summary.gpm, npm: summary.npm, remaining_to_target_inr,
        total_direct_mh: totalDirectMhPerUnit * pQty, total_cogs: (cogsPerUnit + nonUnitCogsPerUnit) * pQty,
        total_direct_oh: directOhPerUnit * pQty, total_indirect_oh: indirectOhPerUnit * pQty,
        total_shipping: shippingPerUnit * pQty, review_count: reviewCount,
        width_inch: p.width_inch, depth_inch: p.depth_inch, height_inch: p.height_inch, weight_kg: p.weight_kg, finishing_difficulty: p.finishing_difficulty,
      };
    });

    const totalQty = exportProducts.reduce((s, r) => s + r.quantity, 0);
    const totalCbm = exportProducts.reduce((s, r) => s + r.total_cbm, 0);
    const totalCost = exportProducts.reduce((s, r) => s + r.total_cost_usd, 0);
    const totalRevenue = exportProducts.reduce((s, r) => s + r.total_revenue_usd, 0);
    const totalProfit = exportProducts.reduce((s, r) => s + r.total_profit_usd, 0);
    const weightedGpm = totalRevenue > 0 ? exportProducts.reduce((s, r) => s + r.gpm * r.total_revenue_usd, 0) / totalRevenue : 0;
    const weightedNpm = totalRevenue > 0 ? exportProducts.reduce((s, r) => s + r.npm * r.total_revenue_usd, 0) / totalRevenue : 0;
    const totalMh = exportProducts.reduce((s, r) => s + r.total_direct_mh, 0);
    const totalReview = exportProducts.reduce((s, r) => s + r.review_count, 0);
    const fullyCosted = exportProducts.filter(r => r.cbm_done && r.cogs_done && r.overhead_done && r.shipping_done && r.revenue_done).length;
    const bCogs = exportProducts.reduce((s, r) => s + r.total_cogs, 0);
    const bDoh = exportProducts.reduce((s, r) => s + r.total_direct_oh, 0);
    const bIoh = exportProducts.reduce((s, r) => s + r.total_indirect_oh, 0);
    const bShip = exportProducts.reduce((s, r) => s + r.total_shipping, 0);
    const bTotal = bCogs + bDoh + bIoh + bShip;

    const allEntities = entRes.data || [];
    const selectedEntity = ps?.quoting_entity_id
      ? allEntities.find((e: any) => e.id === ps.quoting_entity_id)
      : allEntities[0] || null;

    return {
      projectName: project.name, customerName: project.customer_name || undefined,
      customerEmail: project.customer_email || undefined,
      customerLogoUrl: ps?.customer_logo_url || undefined,
      products: exportProducts,
      aggregates: { skuCount: exportProducts.length, totalQty, totalCbm, totalCost, totalRevenue, totalProfit, weightedGpm, weightedNpm, totalMh, totalReview, fullyCosted, bCogs, bDoh, bIoh, bShip, bTotal },
      exchangeRate,
      quoteTitle: ps?.quote_title, quoteNotes: ps?.quote_notes, quoteValidityDays: ps?.quote_validity_days,
      quoteCurrency: ps?.quote_currency, showCbm: ps?.show_cbm_on_quote ?? true,
      showDimensions: ps?.show_dimensions_on_quote ?? true, showWeight: ps?.show_weight_on_quote ?? false,
      showSku: ps?.show_sku_on_quote ?? true, showPhotos: ps?.show_photos_on_quote ?? true,
      entity: selectedEntity || undefined,
    };
  };

  const handleExport = async (type: 'excel' | 'pdf' | 'quote') => {
    setExporting(type);
    try {
      const ctx = await buildExportContext();
      if (!ctx) { setExporting(null); return; }
      switch (type) {
        case 'excel': exportToExcel(ctx); toast.success('Excel exported'); break;
        case 'pdf': downloadSummaryPDF(ctx); toast.success('Summary PDF downloaded'); break;
        case 'quote': {
          // Generate sequential quote number
          const prefix = ctx.entity?.entity_type === 'India' ? 'PV' : 'DKT';
          const year = new Date().getFullYear();
          const { data: lastQuote } = await (supabase as any)
            .from('quote_snapshots')
            .select('quote_number')
            .like('quote_number', `${prefix}-${year}-%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          let nextSeq = 1;
          if (lastQuote?.quote_number) {
            const parts = lastQuote.quote_number.split('-');
            const lastSeq = parseInt(parts[parts.length - 1], 10);
            if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
          }
          const quoteNumber = `${prefix}-${year}-${String(nextSeq).padStart(3, '0')}`;
          ctx.quoteNumber = quoteNumber;
          const result = await generateCustomerQuotePDF(ctx);
          // Save snapshot to quote_snapshots table
          const productsSnapshot = ctx.products.map(p => ({
            name: p.name, sku: p.sku, quantity: p.quantity,
            unit_price: ctx.quoteCurrency === 'INR' ? p.unit_cost_inr * (1 + p.markup_percent) : p.unit_price_usd,
            total: ctx.quoteCurrency === 'INR' ? p.unit_cost_inr * (1 + p.markup_percent) * p.quantity : p.unit_price_usd * p.quantity,
            unit_cbm: p.unit_cbm, total_cbm: p.total_cbm, weight_kg: p.weight_kg,
            photo_url: p.photo_url,
          }));
          const shareToken = crypto.randomUUID();
          const { error: snapError } = await (supabase as any).from('quote_snapshots').insert({
            project_id: id,
            quote_number: result.quoteNumber,
            currency: result.currency,
            valid_until: result.validUntil,
            status: 'draft',
            share_token: shareToken,
            entity_id: (ctx.entity as any)?.id || null,
            notes: ctx.quoteNotes || null,
            products: productsSnapshot,
            totals: {
              sku_count: ctx.aggregates.skuCount,
              total_qty: ctx.aggregates.totalQty,
              total_cbm: ctx.aggregates.totalCbm,
              grand_total: result.grandTotal,
            },
          });
          if (snapError) {
            console.error('Failed to save quote snapshot:', snapError);
            toast.warning('PDF downloaded but quote record failed to save');
          } else {
            toast.success('Customer quote generated & saved');
          }
          break;
        }
      }
    } catch (err: any) { toast.error(`Export failed: ${err.message}`); }
    setExporting(null);
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" disabled={!!exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('pdf')} className="gap-2 text-xs">
                <Download className="h-3.5 w-3.5" /> Summary PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('quote')} className="gap-2 text-xs">
                <FileText className="h-3.5 w-3.5" /> Customer Quote
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('excel')} className="gap-2 text-xs">
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
            <TabsTrigger value="rfqs">RFQs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            {/* Toolbar: search, filter, actions */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-sm"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {productTypes.map(pt => (
                    <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={hideCompleted ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setHideCompleted(!hideCompleted)}
              >
                {hideCompleted ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {hideCompleted ? `Showing incomplete (${completedCount} hidden)` : 'Hide completed'}
              </Button>
              <div className="flex-1" />
              {someSelected && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  onClick={handleBulkDelete}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete {selectedIds.size}
                </Button>
              )}
              <BulkPhotoUpload products={products} onPhotosUploaded={fetchProducts}>
                <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                  <ImagePlus className="h-3.5 w-3.5" /> Bulk Photos
                </Button>
              </BulkPhotoUpload>
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => setShowUploadParse(true)}>
                <Upload className="h-3.5 w-3.5" /> Upload & Parse
              </Button>
              <Dialog open={showAddAssembly} onOpenChange={setShowAddAssembly}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs">
                    <Package className="h-3.5 w-3.5" /> Create Assembly
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Assembly</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <Input placeholder="Assembly name (e.g. Dining Table Set)" value={newAssemblyName} onChange={e => setNewAssemblyName(e.target.value)} autoFocus />
                    <Button onClick={addAssembly} className="w-full">Create Assembly</Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Dialog open={showAddProduct} onOpenChange={setShowAddProduct}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 h-8 text-xs">
                    <Plus className="h-3.5 w-3.5" /> Add Product
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

            <UploadParseDialog
              open={showUploadParse}
              onOpenChange={setShowUploadParse}
              projectId={id!}
              productTypes={productTypes}
              onProductsCreated={fetchProducts}
            />

            {filteredProducts.length === 0 && products.length > 0 ? (
              <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">
                {hideCompleted ? 'All products are completed. Toggle "Hide completed" to show them.' : 'No products match your search or filter.'}
              </CardContent></Card>
            ) : products.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p>No products yet. Add your first product to start costing.</p>
              </CardContent></Card>
            ) : (
              <div className="border rounded-md overflow-auto">
                <Table className="dense-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <SortableHeader column="name" label="Name" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                      <SortableHeader column="sku" label="SKU" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} />
                      <TableHead>Dims (in)</TableHead>
                      <SortableHeader column="qty" label="Qty" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-right" />
                      <TableHead className="text-right">Unit CBM</TableHead>
                      <TableHead className="text-right">Cost (USD)</TableHead>
                      <TableHead className="text-right">Price (USD)</TableHead>
                      <SortableHeader column="status" label="Status" sortColumn={sortColumn} sortDirection={sortDirection} onSort={toggleSort} className="text-center" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProducts.map(p => (
                      <TableRow key={p.id} className={`cursor-pointer hover:bg-accent/50 ${selectedIds.has(p.id) ? 'bg-primary/5' : ''}`}
                        onClick={() => navigate(`/product/${p.id}`)}>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={() => toggleSelect(p.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-muted-foreground">{p.sku || '—'}</TableCell>
                        <TableCell>{fmt.dim(p.width_inch, p.depth_inch, p.height_inch)}</TableCell>
                        <TableCell className="text-right">{fmt.qty(p.quantity)}</TableCell>
                        <TableCell className="text-right calc-field">{costData[p.id]?.unit_cbm ? fmt.cbm(costData[p.id].unit_cbm) : '—'}</TableCell>
                        <TableCell className="text-right calc-field">{costData[p.id]?.cost_usd ? fmt.usd(costData[p.id].cost_usd) : '—'}</TableCell>
                        <TableCell className="text-right calc-field">{costData[p.id]?.price_usd ? fmt.usd(costData[p.id].price_usd) : '—'}</TableCell>
                        <TableCell className="text-center">
                          <ProductStatusIndicator
                            cbm_done={p.cbm_done}
                            cogs_done={p.cogs_done}
                            overhead_done={p.overhead_done}
                            shipping_done={p.shipping_done}
                            revenue_done={p.revenue_done}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {/* Aggregate footer */}
                {Object.keys(costData).length > 0 && (
                  <div className="border-t bg-muted/30 px-3 py-2 flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
                    <span><strong>{sortedProducts.length}</strong>{sortedProducts.length !== products.length ? ` of ${products.length}` : ''} products</span>
                    <span>Qty: <strong>{fmt.qty(sortedProducts.reduce((s, p) => s + (p.quantity || 0), 0))}</strong></span>
                    <span>CBM: <strong>{sortedProducts.reduce((s, p) => s + ((costData[p.id]?.unit_cbm || 0) * (p.quantity || 0)), 0).toFixed(2)}</strong></span>
                    {(() => {
                      const totalCbm = sortedProducts.reduce((s, p) => s + ((costData[p.id]?.unit_cbm || 0) * (p.quantity || 0)), 0);
                      return totalCbm > 0 ? (
                        <span className="text-muted-foreground">
                          Container: {[{ name: '20ft', cbm: 33 }, { name: '40ft', cbm: 67 }, { name: '40ft HC', cbm: 76 }]
                            .map(c => `${((totalCbm / c.cbm) * 100).toFixed(0)}% ${c.name}`).join(' | ')}
                        </span>
                      ) : null;
                    })()}
                    <span>Cost: <strong>{fmt.usd(sortedProducts.reduce((s, p) => s + ((costData[p.id]?.cost_usd || 0) * (p.quantity || 0)), 0))}</strong></span>
                    <span>Revenue: <strong>{fmt.usd(sortedProducts.reduce((s, p) => s + ((costData[p.id]?.price_usd || 0) * (p.quantity || 0)), 0))}</strong></span>
                  </div>
                )}
              </div>
             )}

            {/* Assemblies */}
            {assemblies.length > 0 && (
              <div className="mt-4">
                <h3 className="text-xs font-semibold text-muted-foreground mb-1">📦 Assemblies</h3>
                <div className="border rounded-md overflow-auto">
                  <Table className="dense-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Assembly</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Target (USD)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assemblies.map(a => (
                        <TableRow key={a.id} className="cursor-pointer hover:bg-accent/50" onClick={() => navigate(`/assembly/${a.id}`)}>
                          <TableCell className="font-medium"><Package className="h-3 w-3 inline mr-1 text-primary" />{a.name}</TableCell>
                          <TableCell className="text-muted-foreground">{a.sku || '—'}</TableCell>
                          <TableCell className="text-right">{fmt.qty(a.quantity)}</TableCell>
                          <TableCell className="text-right">{a.target_price_usd ? fmt.usd(a.target_price_usd) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="summary">
            {id && <ProjectSummary projectId={id} />}
          </TabsContent>

          <TabsContent value="rfqs">
            {id && <ProjectRfqTab projectId={id} />}
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
