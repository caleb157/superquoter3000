import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FobRatesSettings } from '@/components/FobRatesSettings';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import CompanyEntitiesSettings from '@/components/CompanyEntitiesSettings';
import QuoteTermsSettings from '@/components/QuoteTermsSettings';
import DataExportSection from '@/components/DataExportSection';
import TeamManagementContent from '@/components/TeamManagementContent';
import TaskAutomationsSettings from '@/components/TaskAutomationsSettings';
import ProjectionDefaultsSettings from '@/components/ProjectionDefaultsSettings';
import LiveRatesSettings from '@/components/LiveRatesSettings';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CurrenciesSettings, FinishingDifficultySettings, RawMaterialCostsSettings, CogsCategoriesSettings, LocalTransportSettings } from '@/components/Phase2Settings';
import { ProductTypeDefaultChemicalsEditor } from '@/components/ProductTypeDefaultChemicalsEditor';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { ALL_SECTIONS, VALID_SECTIONS, searchSettings, type SectionId } from '@/lib/settings-nav';
import { EditableTable } from '@/components/EditableTable';


// Global Settings form (single row)
function GeneralSettings() {
  useDocumentTitle('Settings');
  const [settings, setSettings] = useState<any>(null);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);

  const fetchSettings = async () => {
    const [settingsRes, stRes] = await Promise.all([
      supabase.from('global_settings').select('*').limit(1).single(),
      supabase.from('shipping_types').select('*').order('name'),
    ]);
    if (settingsRes.data) setSettings(settingsRes.data);
    if (stRes.data) setShippingTypes(stRes.data);
  };

  useEffect(() => { fetchSettings(); }, []);

  const update = async (field: string, value: any) => {
    if (!settings) return;
    const { error } = await supabase.from('global_settings').update({ [field]: value } as any).eq('id', settings.id);
    if (error) { toast.error(error.message); return; }
    setSettings({ ...settings, [field]: value });
  };

  if (!settings) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;

  const fields = [
    { key: 'auto_transport_cost_per_cbm', label: 'Auto Transport Cost/CBM (₹)', type: 'number', hint: 'Average local auto transport cost per CBM — auto-added to non-unit COGS for every product' },
    { key: 'below_moq_surcharge_percent', label: 'Below-MOQ Surcharge', type: 'number', hint: 'Multiplier added to unit price when a customer orders less than the MOQ but at least the hard MOQ. Enter as a decimal (e.g. 0.15 = +15%).' },
  ];

  return (
    <div className="space-y-4 max-w-lg">
      {fields.map(f => (
        <div key={f.key}>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium w-52 shrink-0">{f.label}</label>
            <Input
              className="h-8 text-sm"
              type={f.type}
              defaultValue={settings[f.key]}
              onBlur={(e) => {
                const val = f.type === 'number' ? Number(e.target.value) : e.target.value;
                if (val !== settings[f.key]) update(f.key, val);
              }}
            />
          </div>
          {(f as any).hint && <p className="text-[10px] text-muted-foreground ml-[13.5rem] mt-0.5">{(f as any).hint}</p>}
        </div>
      ))}

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium w-52 shrink-0">Default Shipping Type</label>
        <Select value={settings.default_shipping_type || ''} onValueChange={v => update('default_shipping_type', v)}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent>
            {shippingTypes.map(st => (
              <SelectItem key={st.id} value={st.name}>{st.name} — {fmt.inr(st.cost_inr)}/{st.per_unit}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// Master carton height buffer (one global_settings field), shown above the box prices.
function McHeightBufferSetting() {
  const [settings, setSettings] = useState<{ id: string; mc_height_buffer_inch: number | null } | null>(null);
  useEffect(() => {
    supabase.from('global_settings').select('id, mc_height_buffer_inch').limit(1).single().then(({ data }) => data && setSettings(data as any));
  }, []);
  if (!settings) return null;
  const save = async (val: number) => {
    const { error } = await supabase.from('global_settings').update({ mc_height_buffer_inch: val } as any).eq('id', settings.id);
    if (error) { toast.error(error.message); return; }
    setSettings({ ...settings, mc_height_buffer_inch: val });
    const { clearProductDefaultsCache } = await import('@/lib/product-defaults');
    clearProductDefaultsCache();
  };
  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3">
        <label className="text-xs font-medium w-52 shrink-0">MC Height Buffer (in)</label>
        <Input
          className="h-8 text-sm"
          type="number"
          step="0.01"
          defaultValue={settings.mc_height_buffer_inch ?? ''}
          onBlur={(e) => {
            const val = Number(e.target.value);
            if (val !== settings.mc_height_buffer_inch) void save(val);
          }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground ml-[13.5rem] mt-0.5">Default vertical buffer added inside master cartons. Seeded onto each new product.</p>
    </div>
  );
}

// Vendors and Customers are edited on their own pages now; old links land there.
const MOVED: Record<string, string> = { vendors: '/vendors?edit=1', customers: '/customers' };

const Settings = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const to = MOVED[window.location.hash.replace('#', '')];
    if (to) navigate(to, { replace: true });
  }, [navigate]);
  const initialSection = (() => {
    if (typeof window === 'undefined') return 'general';
    const hash = window.location.hash.replace('#', '');
    return (VALID_SECTIONS as string[]).includes(hash) ? (hash as SectionId) : 'general';
  })();
  const [section, setSection] = useState<SectionId>(initialSection);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      if ((VALID_SECTIONS as string[]).includes(h)) setSection(h as SectionId);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [boxData, setBoxData] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [hardware, setHardware] = useState<any[]>([]);
  const [containerTypes, setContainerTypes] = useState<any[]>([]);
  const fetchContainerTypes = () => (supabase as any).from('container_types').select('*').order('sort_order').then(({ data }: any) => data && setContainerTypes(data));
  useEffect(() => { fetchContainerTypes(); }, []);

  const fetchAll = () => {
    supabase.from('shipping_types').select('*').order('name').then(({ data }) => data && setShippingTypes(data));
    supabase.from('product_types').select('*').order('name').then(({ data }) => data && setProductTypes(data));
    supabase.from('box_data').select('*').order('box_type').then(({ data }) => data && setBoxData(data));
    supabase.from('labor_employees').select('*').order('name').then(({ data }) => data && setEmployees(data));
    supabase.from('chemical_prices').select('*').order('name').then(({ data }) => data && setChemicals(data));
    supabase.from('hardware_prices').select('*').order('name').then(({ data }) => data && setHardware(data));
  };

  useEffect(() => { fetchAll(); }, []);

  const renderSection = () => {
    switch (section) {
      case 'general': return <GeneralSettings />;
      case 'live-rates': return <LiveRatesSettings />;
      case 'entities': return <CompanyEntitiesSettings />;
      case 'quote-terms': return <QuoteTermsSettings />;
      case 'team': return <TeamManagementContent />;
      case 'task-automations': return <TaskAutomationsSettings />;
      case 'projections': return <ProjectionDefaultsSettings />;
      case 'currencies': return <CurrenciesSettings />;
      case 'finishing-difficulty': return <FinishingDifficultySettings />;
      case 'data-export': return <DataExportSection />;
      case 'local-transport': return <LocalTransportSettings />;
      case 'cogs-categories': return <CogsCategoriesSettings />;
      case 'raw-materials': return <RawMaterialCostsSettings />;
      case 'container-types':
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Internal dimensions in inches. Usable volume factor accounts for pallet loss / unusable space (0.85 = 85% of internal volume).
            </p>
            <EditableTable
              tableName="container_types"
              data={containerTypes} setData={setContainerTypes}
              fetchData={fetchContainerTypes}
              defaultRow={{ name: 'New Container', internal_width_in: 0, internal_depth_in: 0, internal_height_in: 0, max_weight_kg: 0, usable_volume_factor: 0.85, sort_order: 99 } as any}
              columns={[
                { key: 'name', label: 'Name', width: '160px' },
                { key: 'internal_width_in', label: 'Int. W (in)', type: 'number', width: '110px' },
                { key: 'internal_depth_in', label: 'Int. D (in)', type: 'number', width: '110px' },
                { key: 'internal_height_in', label: 'Int. H (in)', type: 'number', width: '110px' },
                { key: 'max_weight_kg', label: 'Max weight (kg)', type: 'number', width: '130px' },
                { key: 'usable_volume_factor', label: 'Usable factor', type: 'number', width: '110px' },
                { key: 'sort_order', label: 'Sort', type: 'number', width: '70px' },
              ]}
            />
          </div>
        );
      case 'fob-rates':
        return <FobRatesSettings />;
      case 'shipping':
        return (
          <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Per Unit: <b>CBM</b> = cost × unit CBM · <b>KG</b> = cost × unit weight · <b>FOB_FCL</b> = cheapest 20ft/40ft mix ex-Jodhpur ICD · <b>FOB_LCL</b> = LCL incl. trucking · <b>FOB_LCL_NO_TRUCK</b> = LCL excl. trucking. FOB types ignore Cost, price the whole inquiry shipment and use Settings → FOB Rates.</p>
          <EditableTable
            tableName="shipping_types"
            data={shippingTypes} setData={setShippingTypes}
            fetchData={() => supabase.from('shipping_types').select('*').order('name').then(({ data }) => data && setShippingTypes(data))}
            defaultRow={{ name: 'New Shipping', cost_inr: 0, per_unit: 'CBM' }}
            columns={[
              { key: 'name', label: 'Name', width: '200px' },
              { key: 'cost_inr', label: 'Cost (₹)', type: 'number', width: '120px' },
              { key: 'per_unit', label: 'Per Unit', width: '100px' },
            ]}
          />
          </div>
        );
      case 'product-types':
        return (
          <div className="space-y-4">
            <EditableTable
              tableName="product_types"
              data={productTypes} setData={setProductTypes}
              fetchData={() => supabase.from('product_types').select('*').order('name').then(({ data }) => data && setProductTypes(data))}
              defaultRow={{ name: 'New Type', pkg_ic_add_per_side_in: 0.5, finishing_color_per_100ri: 0, finishing_sealer_l_per_100ri: 0, finishing_lacquer_per_100ri: 0, finishing_wax_g_per_sqin: 0.1, }}
              columns={[
                { key: 'name', label: 'Name', width: '160px' },
                { key: 'finishing_color_per_100ri', label: 'Color L/100RI', type: 'number', width: '100px' },
                { key: 'finishing_sealer_l_per_100ri', label: 'Sealer L/100RI', type: 'number', width: '110px' },
                { key: 'finishing_lacquer_per_100ri', label: 'Lacquer L/100RI', type: 'number', width: '110px' },
                { key: 'finishing_wax_g_per_sqin', label: 'Wax g/sq.in', type: 'number', width: '100px' },
                { key: 'pkg_ic_add_per_side_in', label: 'IC Add/Side (in)', type: 'number', width: '110px' },
              ]}
            />
            <div className="space-y-1">
              <div className="text-xs font-medium">Default finishing chemicals per product type</div>
              <p className="text-[11px] text-muted-foreground">Newly-created products of a type get these chemicals auto-included.</p>
              <ProductTypeDefaultChemicalsEditor productTypes={productTypes as any} />
            </div>
          </div>
        );
      case 'box-data':
        return (
          <div className="space-y-4">
            <McHeightBufferSetting />
            <p className="text-[11px] text-muted-foreground">OD = Inner Dimension + (these offsets). Used for shipping volume calculations and master carton sizing in Phase 3.</p>
            <EditableTable
              tableName="box_data"
              data={boxData} setData={setBoxData}
              fetchData={() => supabase.from('box_data').select('*').order('box_type').then(({ data }) => data && setBoxData(data))}
              defaultRow={{ box_type: '7 ply', width_inch: 0, depth_inch: 0, height_inch: 0, cost_inr: 0, od_length_add_in: 0.375, od_width_add_in: 0.375, od_height_add_in: 1.25 }}
              columns={[
                { key: 'box_type', label: 'Type', width: '150px' },
                { key: 'width_inch', label: 'W (in)', type: 'number', width: '70px' },
                { key: 'depth_inch', label: 'D (in)', type: 'number', width: '70px' },
                { key: 'height_inch', label: 'H (in)', type: 'number', width: '70px' },
                { key: 'cost_inr', label: 'Cost (₹)', type: 'number', width: '90px' },
                { key: 'date_quoted', label: 'Date', width: '100px' },
                { key: 'od_length_add_in', label: 'OD L+ (in)', type: 'number', width: '90px' },
                { key: 'od_width_add_in', label: 'OD W+ (in)', type: 'number', width: '90px' },
                { key: 'od_height_add_in', label: 'OD H+ (in)', type: 'number', width: '90px' },
                { key: 'surface_area_sq_in', label: 'SA (sq in)', type: 'readonly', width: '90px' },
                { key: 'cost_per_sq_in', label: '₹/sq in', type: 'readonly', width: '80px' },
              ]}
            />
          </div>
        );
      case 'employees':
        return (
          <EditableTable
            tableName="labor_employees"
            data={employees} setData={setEmployees}
            fetchData={() => supabase.from('labor_employees').select('*').order('name').then(({ data }) => data && setEmployees(data))}
            defaultRow={{ name: 'New Employee', hourly_rate_inr: 0, designations: [] }}
            columns={[
              { key: 'name', label: 'Name', width: '150px' },
              { key: 'hourly_rate_inr', label: 'Rate (₹/hr)', type: 'number', width: '100px' },
              { key: 'designations', label: 'Designations', type: 'tags' },
            ]}
          />
        );
      case 'chemicals':
        return (
          <EditableTable
            tableName="chemical_prices"
            data={chemicals} setData={setChemicals}
            fetchData={() => supabase.from('chemical_prices').select('*').order('name').then(({ data }) => data && setChemicals(data))}
            defaultRow={{ name: 'New Chemical', price_per_unit_inr: 0, unit_type: 'L', category: 'Color' }}
            columns={[
              { key: 'name', label: 'Name', width: '200px' },
              { key: 'category', label: 'Category', width: '120px' },
              { key: 'unit_type', label: 'Unit', width: '80px' },
              { key: 'price_per_unit_inr', label: 'Price/Unit (₹)', type: 'number', width: '120px' },
            ]}
          />
        );
      case 'hardware':
        return (
          <EditableTable
            tableName="hardware_prices"
            data={hardware} setData={setHardware}
            fetchData={() => supabase.from('hardware_prices').select('*').order('name').then(({ data }) => data && setHardware(data))}
            defaultRow={{ name: 'New Hardware', unit_cost_inr: 0, units: 'pc' }}
            columns={[
              { key: 'name', label: 'Name', width: '200px' },
              { key: 'unit_cost_inr', label: 'Cost (₹)', type: 'number', width: '110px' },
              { key: 'units', label: 'Units', width: '80px' },
            ]}
          />
        );
    }
  };

  const activeLabel = ALL_SECTIONS.find(i => i.id === section)?.label ?? '';
  const groups = searchSettings(query);
  const go = (id: SectionId) => { setSection(id); if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${id}`); };

  return (
    <AppLayout>
      <div className="flex gap-6 -mt-2">
        {/* Sidebar */}
        <aside className="w-[200px] shrink-0 border-r border-border bg-card min-h-[calc(100vh-8rem)]">
          <div className="px-3 py-4">
            <h1 className="text-base font-serif font-medium tracking-tight mb-4 px-2">Settings</h1>
            <div className="relative mb-4">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && groups[0]?.items[0]) go(groups[0].items[0].id);
                  if (e.key === 'Escape') setQuery('');
                }}
                placeholder="Search settings"
                aria-label="Search settings"
                className="h-8 pl-7 text-xs"
              />
            </div>
            <nav className="space-y-4">
              {groups.length === 0 && <p className="px-2 text-xs text-muted-foreground">No setting matches “{query}”.</p>}
              {groups.map(group => (
                <div key={group.label}>
                  <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => go(item.id)}
                        className={cn(
                          'w-full text-left px-2 py-1.5 rounded text-xs transition-colors',
                          section === item.id
                            ? 'bg-accent text-accent-foreground font-medium'
                            : 'text-foreground/80 hover:bg-accent/50'
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 min-w-0 py-2">
          <h2 className="text-base font-semibold mb-4">{activeLabel}</h2>
          {renderSection()}
        </main>
      </div>
    </AppLayout>
  );
};

export default Settings;
