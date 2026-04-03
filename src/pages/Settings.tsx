import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';

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
    const { data: newRow, error } = await client.from(tableName).insert(defaultRow).select().single();
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
    { key: 'num_laborers', label: 'Number of Laborers', type: 'number' },
    { key: 'available_hours_per_month', label: 'Available Hours/Month', type: 'number' },
    { key: 'indirect_overhead_monthly', label: 'Indirect Overhead Monthly (₹)', type: 'number' },
    { key: 'packaging_cost_per_cbm', label: 'Packaging Cost/CBM (₹)', type: 'number' },
    { key: 'contractor_to_inhouse_decrease', label: 'Contractor→In-house Decrease', type: 'number' },
    { key: 'local_transport_cost_per_cbm', label: 'Local Transport Cost/CBM (₹)', type: 'number', hint: 'Cost to transport raw goods from supplier cities (Agra, Moradabad, Saharanpur) to Jodhpur' },
  ];

  const indirectOhPerMh = settings.num_laborers * settings.available_hours_per_month > 0
    ? settings.indirect_overhead_monthly / (settings.num_laborers * settings.available_hours_per_month)
    : 0;

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

      {/* Default Shipping Type dropdown */}
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

const Settings = () => {
  const [shippingTypes, setShippingTypes] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<any[]>([]);
  const [boxData, setBoxData] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [chemicals, setChemicals] = useState<any[]>([]);
  const [hardware, setHardware] = useState<any[]>([]);
  const [woodPrices, setWoodPrices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);

  const fetchAll = () => {
    supabase.from('shipping_types').select('*').order('name').then(({ data }) => data && setShippingTypes(data));
    supabase.from('product_types').select('*').order('name').then(({ data }) => data && setProductTypes(data));
    supabase.from('box_data').select('*').order('box_type').then(({ data }) => data && setBoxData(data));
    supabase.from('labor_employees').select('*').order('name').then(({ data }) => data && setEmployees(data));
    supabase.from('chemical_prices').select('*').order('name').then(({ data }) => data && setChemicals(data));
    supabase.from('hardware_prices').select('*').order('name').then(({ data }) => data && setHardware(data));
    supabase.from('wood_prices').select('*').order('wood_type').then(({ data }) => data && setWoodPrices(data));
    (supabase as any).from('customers').select('*').order('name').then(({ data }: any) => data && setCustomers(data));
  };

  useEffect(() => { fetchAll(); }, []);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-lg font-bold mb-4">Global Settings</h1>
        <Tabs defaultValue="general">
          <TabsList className="mb-4 flex-wrap h-auto gap-1">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="shipping">Shipping</TabsTrigger>
            <TabsTrigger value="product-types">Product Types</TabsTrigger>
            <TabsTrigger value="box-data">Box Data</TabsTrigger>
            <TabsTrigger value="employees">Employees</TabsTrigger>
            <TabsTrigger value="chemicals">Chemicals</TabsTrigger>
            <TabsTrigger value="hardware">Hardware</TabsTrigger>
            <TabsTrigger value="wood">Wood Prices</TabsTrigger>
          </TabsList>

          <TabsContent value="general"><GeneralSettings /></TabsContent>

          <TabsContent value="customers">
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
          </TabsContent>

          <TabsContent value="shipping">
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
          </TabsContent>

          <TabsContent value="product-types">
            <EditableTable
              tableName="product_types"
              data={productTypes} setData={setProductTypes}
              fetchData={() => supabase.from('product_types').select('*').order('name').then(({ data }) => data && setProductTypes(data))}
              defaultRow={{ name: 'New Type', contractor_base_rate_per_ri: 0, ic_addition_per_side_inch: 0.5, finishing_color_per_100ri: 0, finishing_sealer_per_100ri: 0, finishing_lacquer_per_100ri: 0, packaging_mh_per_cbm: 10.8 }}
              columns={[
                { key: 'name', label: 'Name', width: '160px' },
                { key: 'contractor_base_rate_per_ri', label: 'Rate/RI', type: 'number', width: '80px' },
                { key: 'ic_addition_per_side_inch', label: 'IC Add/Side', type: 'number', width: '90px' },
                { key: 'finishing_color_per_100ri', label: 'Color/100RI', type: 'number', width: '90px' },
                { key: 'finishing_sealer_per_100ri', label: 'Sealer/100RI', type: 'number', width: '90px' },
                { key: 'finishing_lacquer_per_100ri', label: 'Lacquer/100RI', type: 'number', width: '100px' },
                { key: 'packaging_mh_per_cbm', label: 'Pkg MH/CBM', type: 'number', width: '100px' },
              ]}
            />
          </TabsContent>

          <TabsContent value="box-data">
            <EditableTable
              tableName="box_data"
              data={boxData} setData={setBoxData}
              fetchData={() => supabase.from('box_data').select('*').order('box_type').then(({ data }) => data && setBoxData(data))}
              defaultRow={{ box_type: '7 ply', width_inch: 0, depth_inch: 0, height_inch: 0, cost_inr: 0 }}
              columns={[
                { key: 'box_type', label: 'Type', width: '150px' },
                { key: 'width_inch', label: 'W (in)', type: 'number', width: '70px' },
                { key: 'depth_inch', label: 'D (in)', type: 'number', width: '70px' },
                { key: 'height_inch', label: 'H (in)', type: 'number', width: '70px' },
                { key: 'cost_inr', label: 'Cost (₹)', type: 'number', width: '90px' },
                { key: 'surface_area_sq_in', label: 'SA (sq in)', type: 'readonly', width: '90px' },
                { key: 'cost_per_sq_in', label: '₹/sq in', type: 'readonly', width: '80px' },
              ]}
            />
          </TabsContent>

          <TabsContent value="employees">
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
          </TabsContent>

          <TabsContent value="chemicals">
            <EditableTable
              tableName="chemical_prices"
              data={chemicals} setData={setChemicals}
              fetchData={() => supabase.from('chemical_prices').select('*').order('name').then(({ data }) => data && setChemicals(data))}
              defaultRow={{ name: 'New Chemical', price_per_litre_inr: 0, category: 'Color' }}
              columns={[
                { key: 'name', label: 'Name', width: '200px' },
                { key: 'price_per_litre_inr', label: 'Price/L (₹)', type: 'number', width: '110px' },
                { key: 'category', label: 'Category', width: '120px' },
              ]}
            />
          </TabsContent>

          <TabsContent value="hardware">
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
          </TabsContent>

          <TabsContent value="wood">
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
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Settings;
