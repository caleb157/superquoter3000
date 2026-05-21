import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import CompanyEntitiesSettings from '@/components/CompanyEntitiesSettings';
import DataExportSection from '@/components/DataExportSection';
import TeamManagementContent from '@/components/TeamManagementContent';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CurrenciesSettings, FinishingDifficultySettings, RawMaterialCostsSettings, CogsCategoriesSettings, LocalTransportSettings } from '@/components/Phase2Settings';

// Generic editable table component
function EditableTable<T extends { id: string }>({
  tableName, columns, data, setData, fetchData, defaultRow,
}: {
  tableName: string;
  columns: { key: string; label: string; type?: string; width?: string }[];
  data: T[];
  setData: (d: T[]) => void;
  fetchData: () => void;
  defaultRow: Partial<T>;
}) {
  const addRow = async () => {
    const client = supabase as any;
    const { error } = await client.from(tableName).insert(defaultRow).select().single();
    if (error) { toast.error(error.message); return; }
    fetchData();
    toast.success('Row added');
  };

  const updateField = async (id: string, field: string, value: any) => {
    const client = supabase as any;
    const { error } = await client.from(tableName).update({ [field]: value }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setData(data.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const deleteRow = async (id: string) => {
    const client = supabase as any;
    const { error } = await client.from(tableName).delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    fetchData();
    toast.success('Row deleted');
  };

  return (
    <div>
      <div className="flex justify-end mb-2">
        <Button size="sm" variant="outline" onClick={addRow} className="gap-1 h-7 text-xs">
          <Plus className="h-3 w-3" /> Add Row
        </Button>
      </div>
      <div className="border rounded-md overflow-auto">
        <Table className="dense-table">
          <TableHeader>
            <TableRow>
              {columns.map(c => (
                <TableHead key={c.key} style={{ width: c.width }}>{c.label}</TableHead>
              ))}
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(row => (
              <TableRow key={row.id}>
                {columns.map(col => (
                  <TableCell key={col.key}>
                    {col.type === 'readonly' ? (
                      <span className="calc-field px-1 rounded">
                        {String((row as any)[col.key] ?? '')}
                      </span>
                    ) : col.type === 'tags' ? (
                      <div className="flex flex-wrap gap-1">
                        {((row as any)[col.key] || []).map((tag: string, i: number) => (
                          <Badge key={i} variant="secondary" className="text-[10px] h-5 cursor-pointer"
                            onClick={() => {
                              const tags = [...((row as any)[col.key] || [])];
                              tags.splice(i, 1);
                              updateField(row.id, col.key, tags);
                            }}>
                            {tag} ×
                          </Badge>
                        ))}
                        <input
                          className="border-none outline-none bg-transparent text-xs w-16"
                          placeholder="+"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                              const val = (e.target as HTMLInputElement).value.trim();
                              const tags = [...((row as any)[col.key] || []), val];
                              updateField(row.id, col.key, tags);
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                        />
                      </div>
                    ) : (
                      <Input
                        className="h-7 text-xs border-transparent hover:border-input focus:border-input"
                        type={col.type === 'number' ? 'number' : 'text'}
                        defaultValue={(row as any)[col.key] ?? ''}
                        onBlur={(e) => {
                          const val = col.type === 'number' ? Number(e.target.value) : e.target.value;
                          if (val !== (row as any)[col.key]) {
                            updateField(row.id, col.key, val);
                          }
                        }}
                      />
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteRow(row.id)}>
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {data.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="text-center text-muted-foreground py-8">
                  No data. Click "Add Row" to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Global Settings form (single row)
function GeneralSettings() {
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
    { key: 'exchange_rate', label: 'Exchange Rate (INR/USD)', type: 'number' },
    { key: 'total_available_mh_per_month', label: 'Total Available MH/Month', type: 'number', hint: 'Total man-hours available per month. Used as the divisor for indirect overhead per MH.' },
    { key: 'indirect_overhead_monthly', label: 'Indirect Overhead Monthly (₹)', type: 'number' },
    { key: 'auto_transport_cost_per_cbm', label: 'Auto Transport Cost/CBM (₹)', type: 'number', hint: 'Average local auto transport cost per CBM — auto-added to non-unit COGS for every product' },
    { key: 'slow_quote_days', label: 'Slow Quote Threshold (days)', type: 'number', hint: 'RFQs unanswered for more than this many days appear in the Operations slow-movers list.' },
    { key: 'slow_sample_days', label: 'Slow Sample Threshold (days)', type: 'number', hint: 'Pending samples older than this appear in the Operations slow-movers list.' },
    { key: 'below_moq_surcharge_percent', label: 'Below-MOQ Surcharge', type: 'number', hint: 'Multiplier added to unit price when a customer orders less than the MOQ but at least the hard MOQ. Enter as a decimal (e.g. 0.15 = +15%).' },
  ];

  const totalMh = Number(settings.total_available_mh_per_month) || 0;
  const indirectOhPerMh = totalMh > 0 ? settings.indirect_overhead_monthly / totalMh : 0;

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

      <div className="flex items-center gap-3 pt-2 border-t">
        <label className="text-xs font-medium w-52 shrink-0">Indirect OH / Man-Hour (₹)</label>
        <span className="calc-field px-2 py-1 rounded text-sm">{fmt.inr(indirectOhPerMh)}</span>
      </div>
    </div>
  );
}

// Wrapping settings (subset of global_settings)
function WrappingSettings() {
  const [settings, setSettings] = useState<any>(null);
  useEffect(() => {
    supabase.from('global_settings').select('*').limit(1).single().then(({ data }) => data && setSettings(data));
  }, []);
  const update = async (field: string, value: any) => {
    if (!settings) return;
    const { error } = await supabase.from('global_settings').update({ [field]: value } as any).eq('id', settings.id);
    if (error) { toast.error(error.message); return; }
    setSettings({ ...settings, [field]: value });
    if (field === 'mc_height_buffer_inch') {
      const { clearProductDefaultsCache } = await import('@/lib/product-defaults');
      clearProductDefaultsCache();
    }
  };
  if (!settings) return <div className="py-8 text-center text-muted-foreground">Loading...</div>;
  const fields = [
    { key: 'mc_height_buffer_inch', label: 'MC Height Buffer (in)', hint: 'Default vertical buffer added inside master cartons. Seeded onto each new product.' },
    { key: 'corrugate_kg_per_sq_in', label: 'Corrugate KG / sq in', hint: 'Mass of corrugate wrap per square inch of product surface area.' },
    { key: 'bubble_kg_per_sq_in', label: 'Bubble Wrap KG / sq in', hint: 'Mass of bubble wrap per square inch of product surface area.' },
    { key: 'corrugate_price_per_kg', label: 'Corrugate Price (₹/kg)' },
    { key: 'bubble_price_per_kg', label: 'Bubble Wrap Price (₹/kg)' },
  ];
  return (
    <div className="space-y-4 max-w-lg">
      {fields.map(f => (
        <div key={f.key}>
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium w-52 shrink-0">{f.label}</label>
            <Input
              className="h-8 text-sm"
              type="number"
              step="0.01"
              defaultValue={settings[f.key] ?? ''}
              onBlur={(e) => {
                const val = Number(e.target.value);
                if (val !== settings[f.key]) update(f.key, val);
              }}
            />
          </div>
          {(f as any).hint && <p className="text-[10px] text-muted-foreground ml-[13.5rem] mt-0.5">{(f as any).hint}</p>}
        </div>
      ))}
    </div>
  );
}

type SectionId =
  | 'general' | 'entities' | 'team'
  | 'vendors' | 'customers' | 'employees'
  | 'product-types' | 'wood' | 'chemicals' | 'hardware'
  | 'shipping' | 'box-data' | 'wrapping'
  | 'currencies' | 'finishing-difficulty'
  | 'raw-materials' | 'cogs-categories'
  | 'local-transport' | 'data-export';

const NAV_GROUPS: { label: string; items: { id: SectionId; label: string }[] }[] = [
  {
    label: 'General',
    items: [
      { id: 'general', label: 'General' },
      { id: 'currencies', label: 'Currencies' },
      { id: 'entities', label: 'Company entities' },
      { id: 'team', label: 'Team' },
    ],
  },
  {
    label: 'People',
    items: [
      { id: 'vendors', label: 'Vendors' },
      { id: 'customers', label: 'Customers' },
      { id: 'employees', label: 'Employees' },
    ],
  },
  {
    label: 'Labor',
    items: [
      { id: 'finishing-difficulty', label: 'Finishing difficulty' },
    ],
  },
  {
    label: 'Products',
    items: [
      { id: 'product-types', label: 'Product types' },
      { id: 'wood', label: 'Wood prices' },
      { id: 'chemicals', label: 'Chemicals' },
      { id: 'hardware', label: 'Hardware' },
    ],
  },
  {
    label: 'Raw Materials',
    items: [
      { id: 'raw-materials', label: 'Raw material costs' },
      { id: 'cogs-categories', label: 'COGS categories' },
    ],
  },
  {
    label: 'Logistics',
    items: [
      { id: 'shipping', label: 'Shipping' },
      { id: 'local-transport', label: 'Local transport' },
    ],
  },
  {
    label: 'Packaging',
    items: [
      { id: 'wrapping', label: 'Wrapping' },
      { id: 'box-data', label: 'Box prices' },
    ],
  },
  {
    label: 'Backups',
    items: [
      { id: 'data-export', label: 'Data export' },
    ],
  },
];

const VALID_SECTIONS: SectionId[] = ['general','entities','team','vendors','customers','employees','product-types','wood','chemicals','hardware','shipping','box-data','wrapping','currencies','finishing-difficulty','raw-materials','cogs-categories','local-transport','data-export'];

const Settings = () => {
  const initialSection = (() => {
    if (typeof window === 'undefined') return 'general';
    const hash = window.location.hash.replace('#', '');
    return (VALID_SECTIONS as string[]).includes(hash) ? (hash as SectionId) : 'general';
  })();
  const [section, setSection] = useState<SectionId>(initialSection);
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
  const [woodPrices, setWoodPrices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);

  const fetchAll = () => {
    supabase.from('shipping_types').select('*').order('name').then(({ data }) => data && setShippingTypes(data));
    supabase.from('product_types').select('*').order('name').then(({ data }) => data && setProductTypes(data));
    supabase.from('box_data').select('*').order('box_type').then(({ data }) => data && setBoxData(data));
    supabase.from('labor_employees').select('*').order('name').then(({ data }) => data && setEmployees(data));
    supabase.from('chemical_prices').select('*').order('name').then(({ data }) => data && setChemicals(data));
    supabase.from('hardware_prices').select('*').order('name').then(({ data }) => data && setHardware(data));
    supabase.from('wood_prices').select('*').order('wood_type').then(({ data }) => data && setWoodPrices(data));
    (supabase as any).from('customers').select('*').order('name').then(({ data }: any) => data && setCustomers(data));
    (supabase as any).from('vendors').select('*').order('name').then(({ data }: any) => data && setVendors(data));
  };

  useEffect(() => { fetchAll(); }, []);

  const renderSection = () => {
    switch (section) {
      case 'general': return <GeneralSettings />;
      case 'wrapping': return <WrappingSettings />;
      case 'entities': return <CompanyEntitiesSettings />;
      case 'team': return <TeamManagementContent />;
      case 'currencies': return <CurrenciesSettings />;
      case 'finishing-difficulty': return <FinishingDifficultySettings />;
      case 'data-export': return <DataExportSection />;
      case 'local-transport': return <LocalTransportSettings />;
      case 'cogs-categories': return <CogsCategoriesSettings />;
      case 'raw-materials': return <RawMaterialCostsSettings />;
      case 'customers':
        return (
          <EditableTable
            tableName="customers"
            data={customers} setData={setCustomers}
            fetchData={() => (supabase as any).from('customers').select('*').order('name').then(({ data }: any) => data && setCustomers(data))}
            defaultRow={{ name: 'New Customer' } as any}
            columns={[
              { key: 'name', label: 'Name', width: '160px' },
              { key: 'company', label: 'Company', width: '150px' },
              { key: 'email', label: 'Email', width: '180px' },
              { key: 'phone', label: 'Phone', width: '120px' },
              { key: 'notes', label: 'Notes' },
            ]}
          />
        );
      case 'vendors':
        return (
          <EditableTable
            tableName="vendors"
            data={vendors} setData={setVendors}
            fetchData={() => (supabase as any).from('vendors').select('*').order('name').then(({ data }: any) => data && setVendors(data))}
            defaultRow={{ name: 'New Vendor', category: 'general' } as any}
            columns={[
              { key: 'name', label: 'Name', width: '160px' },
              { key: 'email', label: 'Email', width: '160px' },
              { key: 'phone', label: 'Phone', width: '120px' },
              { key: 'address', label: 'Address', width: '200px' },
              { key: 'category', label: 'Category', width: '120px' },
              { key: 'notes', label: 'Notes', width: '150px' },
            ]}
          />
        );
      case 'shipping':
        return (
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
        );
      case 'product-types':
        return (
          <EditableTable
            tableName="product_types"
            data={productTypes} setData={setProductTypes}
            fetchData={() => supabase.from('product_types').select('*').order('name').then(({ data }) => data && setProductTypes(data))}
            defaultRow={{ name: 'New Type', pkg_ic_add_per_side_in: 0.5, finishing_color_per_100ri: 0, finishing_sealer_l_per_100ri: 0, finishing_lacquer_per_100ri: 0, finishing_mh_per_100ri: 0, pkg_corrugate_bubble_rate_mh_per_cbm: 10.8, pkg_ic_rate_mh_per_cbm: 0, pkg_ic_mc_rate_mh_per_cbm: 0, default_percent_wood_for_finishing: 1.0 }}
            columns={[
              { key: 'name', label: 'Name', width: '160px' },
              { key: 'finishing_mh_per_100ri', label: 'Finish MH/100RI', type: 'number', width: '110px' },
              { key: 'finishing_color_per_100ri', label: 'Color L/100RI', type: 'number', width: '100px' },
              { key: 'finishing_sealer_l_per_100ri', label: 'Sealer L/100RI', type: 'number', width: '110px' },
              { key: 'finishing_lacquer_per_100ri', label: 'Lacquer L/100RI', type: 'number', width: '110px' },
              { key: 'pkg_ic_add_per_side_in', label: 'IC Add/Side (in)', type: 'number', width: '110px' },
              { key: 'pkg_corrugate_bubble_rate_mh_per_cbm', label: 'Pkg Corr+Bub MH/CBM', type: 'number', width: '140px' },
              { key: 'pkg_ic_rate_mh_per_cbm', label: 'Pkg IC MH/CBM', type: 'number', width: '120px' },
              { key: 'pkg_ic_mc_rate_mh_per_cbm', label: 'Pkg IC+MC MH/CBM', type: 'number', width: '130px' },
              { key: 'default_percent_wood_for_finishing', label: 'Default % Wood (0-1)', type: 'number', width: '130px' },
            ]}
          />
        );
      case 'box-data':
        return (
          <div className="space-y-2">
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
      case 'wood':
        return (
          <EditableTable
            tableName="wood_prices"
            data={woodPrices} setData={setWoodPrices}
            fetchData={() => supabase.from('wood_prices').select('*').order('wood_type').then(({ data }) => data && setWoodPrices(data))}
            defaultRow={{ wood_type: 'New Wood', price_per_cft_inr: 0 }}
            columns={[
              { key: 'wood_type', label: 'Wood Type', width: '200px' },
              { key: 'price_per_cft_inr', label: 'Price/CFT (₹)', type: 'number', width: '120px' },
            ]}
          />
        );
    }
  };

  const activeLabel = NAV_GROUPS.flatMap(g => g.items).find(i => i.id === section)?.label ?? '';

  return (
    <AppLayout>
      <div className="flex gap-6 -mt-2">
        {/* Sidebar */}
        <aside className="w-[180px] shrink-0 border-r border-border bg-card min-h-[calc(100vh-8rem)]">
          <div className="px-3 py-4">
            <h1 className="text-base font-serif font-medium tracking-tight mb-4 px-2">Settings</h1>
            <nav className="space-y-4">
              {NAV_GROUPS.map(group => (
                <div key={group.label}>
                  <div className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => { setSection(item.id); if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${item.id}`); }}
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
