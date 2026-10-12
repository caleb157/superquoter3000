import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Pencil, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { CurrencyCombobox, invalidateCurrencies } from '@/components/CurrencyCombobox';

const sb = supabase as any;

// ============== Currencies ==============
/** The currencies Odoo has active (INR is the base). Others keep their row but have no rate. */
const isLiveCurrency = (r: any) => r.code === 'INR' || r.import_rate != null;

export function CurrenciesSettings() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchRows = async () => {
    const { data } = await sb.from('currencies').select('*')
      .order('is_featured', { ascending: false })
      .order('sort_priority', { ascending: true })
      .order('code', { ascending: true });
    setRows((data || []).filter(isLiveCurrency));
    invalidateCurrencies();
  };
  useEffect(() => { fetchRows(); }, []);

  const refresh = async () => {
    setSyncing(true);
    const { syncLiveRates } = await import('@/lib/live-rates-sync');
    const res = await syncLiveRates();
    setSyncing(false);
    if (res.error) { toast.error(res.error); return; }
    if (res.warnings?.length) toast.warning(res.warnings.join(' · '));
    else toast.success('Currencies refreshed from Odoo');
    fetchRows();
  };

  const filtered = rows.filter(r => {
    if (featuredOnly && !r.is_featured) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.code.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q);
  });

  // Only the picker order is edited here; names, symbols and rates come from Odoo.
  const updateInline = async (code: string, field: 'is_featured' | 'sort_priority', value: any) => {
    const { error } = await sb.from('currencies').update({ [field]: value }).eq('code', code);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(x => x.code === code ? { ...x, [field]: value } : x));
    invalidateCurrencies();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        The currencies active in Odoo, with Odoo's rates (₹ per unit). They update with Live rates; to add or remove one, activate or archive it in Odoo. Featured and Sort set the order in currency pickers.
      </p>
      <div className="flex flex-wrap gap-2 items-center">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name…" className="h-8 text-xs max-w-xs" />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={featuredOnly} onCheckedChange={v => setFeaturedOnly(!!v)} />
          Featured only
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={refresh} disabled={syncing}>
          <RefreshCw className={syncing ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} /> {syncing ? 'Refreshing…' : 'Refresh from Odoo'}
        </Button>
      </div>
      <div className="border rounded-md overflow-auto">
        <Table className="dense-table">
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Sort</TableHead>
              <TableHead className="text-right">Rate (₹)</TableHead>
              <TableHead className="text-right">Per</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(r => (
              <TableRow key={r.code}>
                <TableCell className="font-mono font-medium">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.symbol ?? '—'}</TableCell>
                <TableCell><Checkbox checked={!!r.is_featured} onCheckedChange={v => updateInline(r.code, 'is_featured', !!v)} /></TableCell>
                <TableCell>
                  <Input type="number" defaultValue={r.sort_priority ?? 100} className="h-7 text-xs w-16"
                    onBlur={e => { const v = Number(e.target.value); if (v !== r.sort_priority) updateInline(r.code, 'sort_priority', v); }} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.code === 'INR' ? '1' : Number(r.import_rate).toFixed(4)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.units_per_inr_base}</TableCell>
                <TableCell className="text-muted-foreground">{r.code === 'INR' ? 'Base' : r.effective_start_date ?? '—'}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground text-xs">No currencies match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============== Finishing Difficulty ==============
export function FinishingDifficultySettings() {
  const [rows, setRows] = useState<any[]>([]);
  const fetchRows = async () => {
    const { data } = await sb.from('finishing_difficulty').select('*').order('sort_order');
    setRows(data || []);
  };
  useEffect(() => { fetchRows(); }, []);

  const add = async () => {
    const { error } = await sb.from('finishing_difficulty').insert({ name: 'New Difficulty', sort_order: (rows.at(-1)?.sort_order ?? 0) + 1 });
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };
  const upd = async (id: string, field: string, value: any) => {
    const { error } = await sb.from('finishing_difficulty').update({ [field]: value }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const del = async (r: any) => {
    const { count } = await sb.from('products').select('id', { count: 'exact', head: true }).eq('finishing_difficulty', r.name);
    const n = count ?? 0;
    if (n > 0) {
      if (!confirm(`Used by ${n} product(s). Deleting will not change those products, but they may have an unknown difficulty. Continue?`)) return;
    } else {
      if (!confirm(`Delete "${r.name}"?`)) return;
    }
    const { error } = await sb.from('finishing_difficulty').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={add}><Plus className="h-3 w-3" /> Add Row</Button>
      </div>
      <div className="border rounded-md overflow-auto max-w-2xl">
        <Table className="dense-table">
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead title="Wood finishing labor budget per running inch">₹ / running inch (wood)</TableHead><TableHead>Sort</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Input className="h-7 text-xs" defaultValue={r.name} onBlur={e => { if (e.target.value !== r.name) upd(r.id, 'name', e.target.value); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-24" type="number" step="0.5" defaultValue={r.rupees_per_ri ?? ''} placeholder="—" onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (r.rupees_per_ri ?? null)) upd(r.id, 'rupees_per_ri', v); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-20" type="number" defaultValue={r.sort_order} onBlur={e => { const v = Number(e.target.value); if (v !== r.sort_order) upd(r.id, 'sort_order', v); }} /></TableCell>
                <TableCell><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => del(r)}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============== COGS Categories ==============
export function CogsCategoriesSettings() {
  const [rows, setRows] = useState<any[]>([]);
  const fetchRows = async () => {
    const { data } = await sb.from('cogs_categories').select('*').order('sort_order');
    setRows(data || []);
  };
  useEffect(() => { fetchRows(); }, []);

  const add = async () => {
    const { error } = await sb.from('cogs_categories').insert({ name: 'New Category', default_unit_type: 'pc', sort_order: (rows.at(-1)?.sort_order ?? 0) + 1, is_subcontracting: false });
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };
  const upd = async (id: string, field: string, value: any) => {
    const { error } = await sb.from('cogs_categories').update({ [field]: value }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const del = async (r: any) => {
    const { count } = await sb.from('raw_material_costs').select('id', { count: 'exact', head: true }).eq('category', r.name);
    if ((count ?? 0) > 0) { toast.error(`Used by ${count} raw material(s). Reassign first.`); return; }
    if (!confirm(`Delete "${r.name}"?`)) return;
    const { error } = await sb.from('cogs_categories').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={add}><Plus className="h-3 w-3" /> Add Category</Button>
      </div>
      <div className="border rounded-md overflow-auto max-w-3xl">
        <Table className="dense-table">
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Default unit</TableHead><TableHead>Sort</TableHead><TableHead>Subcontracting</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Input className="h-7 text-xs" defaultValue={r.name} onBlur={e => { if (e.target.value !== r.name) upd(r.id, 'name', e.target.value); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-24" defaultValue={r.default_unit_type ?? ''} onBlur={e => { if (e.target.value !== r.default_unit_type) upd(r.id, 'default_unit_type', e.target.value); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-20" type="number" defaultValue={r.sort_order} onBlur={e => { const v = Number(e.target.value); if (v !== r.sort_order) upd(r.id, 'sort_order', v); }} /></TableCell>
                <TableCell><Checkbox checked={!!r.is_subcontracting} onCheckedChange={v => upd(r.id, 'is_subcontracting', !!v)} /></TableCell>
                <TableCell><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => del(r)}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ============== Raw Material Costs ==============
export function RawMaterialCostsSettings() {
  const [rows, setRows] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('__all__');
  const [activeOnly, setActiveOnly] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const fetchRows = async () => {
    const { data } = await sb.from('raw_material_costs').select('*').order('category').order('name');
    setRows(data || []);
  };
  const fetchCats = async () => {
    const { data } = await sb.from('cogs_categories').select('*').order('sort_order');
    setCategories(data || []);
  };
  useEffect(() => { fetchRows(); fetchCats(); }, []);

  const filtered = rows.filter(r => {
    if (activeOnly && !r.active) return false;
    if (categoryFilter !== '__all__' && r.category !== categoryFilter) return false;
    const q = search.trim().toLowerCase();
    if (q && !(r.name || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const startAdd = () => {
    const first = categories[0];
    setEditing({ category: first?.name || 'Other', name: '', cost: 0, unit_type: first?.default_unit_type || 'pc', currency: 'INR', notes: '', active: true, __isNew: true });
    setOpen(true);
  };
  const startEdit = (r: any) => { setEditing({ ...r }); setOpen(true); };

  const save = async () => {
    if (!editing) return;
    const payload = {
      category: editing.category, name: editing.name, cost: Number(editing.cost) || 0,
      unit_type: editing.unit_type, currency: editing.currency, notes: editing.notes || null, active: editing.active !== false,
    };
    if (!payload.name) { toast.error('Name required'); return; }
    let err;
    if (editing.__isNew) ({ error: err } = await sb.from('raw_material_costs').insert(payload));
    else ({ error: err } = await sb.from('raw_material_costs').update(payload).eq('id', editing.id));
    if (err) { toast.error(err.message); return; }
    setOpen(false); setEditing(null);
    fetchRows();
  };

  const softDelete = async (r: any) => {
    const { error } = await sb.from('raw_material_costs').update({ active: false }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(x => x.id === r.id ? { ...x, active: false } : x));
  };

  const reactivate = async (r: any) => {
    const { error } = await sb.from('raw_material_costs').update({ active: true }).eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(x => x.id === r.id ? { ...x, active: true } : x));
  };

  const onCategoryChange = (cat: string) => {
    const c = categories.find(x => x.name === cat);
    setEditing({ ...editing, category: cat, unit_type: c?.default_unit_type || editing.unit_type });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name…" className="h-8 text-xs max-w-xs" />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 text-xs w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={activeOnly} onCheckedChange={v => setActiveOnly(!!v)} /> Active only
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={startAdd}><Plus className="h-3 w-3" /> Add Material</Button>
      </div>
      <div className="border rounded-md overflow-auto">
        <Table className="dense-table">
          <TableHeader><TableRow>
            <TableHead>Category</TableHead><TableHead>Name</TableHead><TableHead>Cost</TableHead><TableHead>Unit</TableHead><TableHead>Currency</TableHead><TableHead>Active</TableHead><TableHead>Notes</TableHead><TableHead className="w-20" />
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map(r => (
              <TableRow key={r.id} className={!r.active ? 'opacity-60' : ''}>
                <TableCell>{r.category}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.cost}</TableCell>
                <TableCell>{r.unit_type}</TableCell>
                <TableCell className="font-mono text-xs">{r.currency}</TableCell>
                <TableCell><Checkbox checked={!!r.active} onCheckedChange={v => v ? reactivate(r) : softDelete(r)} /></TableCell>
                <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">{r.notes}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(r)}><Pencil className="h-3 w-3" /></Button>
                  {r.active && <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => softDelete(r)}><Trash2 className="h-3 w-3 text-destructive" /></Button>}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-6 text-muted-foreground text-xs">No materials match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="text-[10px] text-muted-foreground">Master pricing reference. Existing product costing sheets continue to use their stored prices.</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.__isNew ? 'Add' : 'Edit'} Raw Material</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label className="text-xs">Category</Label>
                <Select value={editing.category} onValueChange={onCategoryChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label className="text-xs">Name</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Cost</Label><Input type="number" step="0.01" value={editing.cost} onChange={e => setEditing({ ...editing, cost: e.target.value })} /></div>
                <div><Label className="text-xs">Unit type</Label><Input value={editing.unit_type || ''} onChange={e => setEditing({ ...editing, unit_type: e.target.value })} /></div>
              </div>
              <div><Label className="text-xs">Currency</Label><CurrencyCombobox value={editing.currency || 'INR'} onChange={v => setEditing({ ...editing, currency: v })} /></div>
              <div><Label className="text-xs">Notes</Label><Textarea rows={2} value={editing.notes || ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-xs"><Checkbox checked={editing.active !== false} onCheckedChange={v => setEditing({ ...editing, active: !!v })} /> Active</label>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============== Local Transport Locations ==============
export function LocalTransportSettings() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const fetchRows = async () => {
    const { data } = await sb.from('local_transport_locations').select('*').order('sort_order').order('name');
    setRows(data || []);
  };
  useEffect(() => { fetchRows(); }, []);

  const add = async () => {
    const name = prompt('Location name?'); if (!name) return;
    const { error } = await sb.from('local_transport_locations').insert({ name, cost_per_cbm_inr: 0, sort_order: (rows.at(-1)?.sort_order ?? 0) + 1 });
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };
  const upd = async (id: string, field: string, value: any) => {
    const { error } = await sb.from('local_transport_locations').update({ [field]: value }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
  };
  const del = async (r: any) => {
    if (!confirm(`Delete "${r.name}"?`)) return;
    const { error } = await sb.from('local_transport_locations').delete().eq('id', r.id);
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };

  const filtered = rows.filter(r => !search.trim() || r.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" className="h-8 text-xs max-w-xs" />
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={add}><Plus className="h-3 w-3" /> Add Location</Button>
      </div>
      <div className="border rounded-md overflow-auto max-w-3xl">
        <Table className="dense-table">
          <TableHeader><TableRow><TableHead>Location</TableHead><TableHead>₹/CBM</TableHead><TableHead>Sort</TableHead><TableHead>Active</TableHead><TableHead>Notes</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>
            {filtered.map(r => (
              <TableRow key={r.id}>
                <TableCell><Input className="h-7 text-xs" defaultValue={r.name} onBlur={e => { if (e.target.value !== r.name) upd(r.id, 'name', e.target.value); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-28" type="number" defaultValue={r.cost_per_cbm_inr} onBlur={e => { const v = Number(e.target.value); if (v !== r.cost_per_cbm_inr) upd(r.id, 'cost_per_cbm_inr', v); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-20" type="number" defaultValue={r.sort_order} onBlur={e => { const v = Number(e.target.value); if (v !== r.sort_order) upd(r.id, 'sort_order', v); }} /></TableCell>
                <TableCell><Checkbox checked={!!r.active} onCheckedChange={v => upd(r.id, 'active', !!v)} /></TableCell>
                <TableCell><Input className="h-7 text-xs" defaultValue={r.notes ?? ''} onBlur={e => { if (e.target.value !== r.notes) upd(r.id, 'notes', e.target.value); }} /></TableCell>
                <TableCell><Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => del(r)}><Trash2 className="h-3 w-3 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
