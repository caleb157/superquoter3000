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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { CurrencyCombobox, invalidateCurrencies } from '@/components/CurrencyCombobox';

const sb = supabase as any;

// ============== Currencies ==============
export function CurrenciesSettings() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const fetchRows = async () => {
    const { data } = await sb.from('currencies').select('*')
      .order('is_featured', { ascending: false })
      .order('sort_priority', { ascending: true })
      .order('code', { ascending: true });
    setRows(data || []);
    invalidateCurrencies();
  };
  useEffect(() => { fetchRows(); }, []);

  const filtered = rows.filter(r => {
    if (featuredOnly && !r.is_featured) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return r.code.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q);
  });

  const startAdd = () => { setEditing({ code: '', name: '', units_per_inr_base: 1, import_rate: null, export_rate: null, effective_start_date: '', sort_priority: 100, is_featured: false, __isNew: true }); setOpen(true); };
  const startEdit = (r: any) => { setEditing({ ...r }); setOpen(true); };

  const save = async () => {
    if (!editing) return;
    const code = (editing.code || '').toUpperCase().trim();
    if (!code) { toast.error('Code required'); return; }
    const payload = {
      code,
      name: editing.name,
      units_per_inr_base: Number(editing.units_per_inr_base) || 1,
      import_rate: editing.import_rate === '' || editing.import_rate == null ? null : Number(editing.import_rate),
      export_rate: editing.export_rate === '' || editing.export_rate == null ? null : Number(editing.export_rate),
      effective_start_date: editing.effective_start_date || null,
      sort_priority: Number(editing.sort_priority) || 100,
      is_featured: !!editing.is_featured,
    };
    let err;
    if (editing.__isNew) {
      ({ error: err } = await sb.from('currencies').insert(payload));
    } else {
      ({ error: err } = await sb.from('currencies').update(payload).eq('code', editing.code));
    }
    if (err) { toast.error(err.message); return; }
    setOpen(false); setEditing(null);
    fetchRows();
    toast.success('Saved');
  };

  const toggleFeatured = async (r: any, v: boolean) => {
    const { error } = await sb.from('currencies').update({ is_featured: v }).eq('code', r.code);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(x => x.code === r.code ? { ...x, is_featured: v } : x));
    invalidateCurrencies();
  };

  const updateInline = async (code: string, field: string, value: any) => {
    const { error } = await sb.from('currencies').update({ [field]: value }).eq('code', code);
    if (error) { toast.error(error.message); return; }
    setRows(rows.map(x => x.code === code ? { ...x, [field]: value } : x));
    invalidateCurrencies();
  };

  const del = async (r: any) => {
    if (r.code === 'INR') return;
    if (!confirm(`Delete ${r.code}?`)) return;
    const { error } = await sb.from('currencies').delete().eq('code', r.code);
    if (error) { toast.error(error.message); return; }
    fetchRows();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code or name…" className="h-8 text-xs max-w-xs" />
        <label className="flex items-center gap-1.5 text-xs">
          <Checkbox checked={featuredOnly} onCheckedChange={v => setFeaturedOnly(!!v)} />
          Featured only
        </label>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={startAdd}>
          <Plus className="h-3 w-3" /> Add Currency
        </Button>
      </div>
      <div className="border rounded-md overflow-auto">
        <Table className="dense-table">
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Featured</TableHead>
              <TableHead>Sort</TableHead>
              <TableHead>Import Rate</TableHead>
              <TableHead>Export Rate</TableHead>
              <TableHead>Units / INR base</TableHead>
              <TableHead>Effective start</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(r => (
              <TableRow key={r.code}>
                <TableCell className="font-mono font-medium">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell><Checkbox checked={!!r.is_featured} onCheckedChange={v => toggleFeatured(r, !!v)} /></TableCell>
                <TableCell>
                  <Input type="number" defaultValue={r.sort_priority ?? 100} className="h-7 text-xs w-16"
                    onBlur={e => { const v = Number(e.target.value); if (v !== r.sort_priority) updateInline(r.code, 'sort_priority', v); }} />
                </TableCell>
                <TableCell>
                  <Input type="number" step="0.0001" defaultValue={r.import_rate ?? ''} className="h-7 text-xs w-24"
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== r.import_rate) updateInline(r.code, 'import_rate', v); }} />
                </TableCell>
                <TableCell>
                  <Input type="number" step="0.0001" defaultValue={r.export_rate ?? ''} className="h-7 text-xs w-24"
                    onBlur={e => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== r.export_rate) updateInline(r.code, 'export_rate', v); }} />
                </TableCell>
                <TableCell>{r.units_per_inr_base}</TableCell>
                <TableCell>
                  <Input type="date" defaultValue={r.effective_start_date ?? ''} className="h-7 text-xs w-32"
                    onBlur={e => { const v = e.target.value || null; if (v !== r.effective_start_date) updateInline(r.code, 'effective_start_date', v); }} />
                </TableCell>
                <TableCell className="flex gap-1">
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(r)}><Pencil className="h-3 w-3" /></Button>
                  {r.code === 'INR' ? (
                    <TooltipProvider><Tooltip><TooltipTrigger asChild>
                      <span><Button size="icon" variant="ghost" className="h-6 w-6" disabled><Trash2 className="h-3 w-3 text-muted-foreground" /></Button></span>
                    </TooltipTrigger><TooltipContent>Base currency cannot be deleted</TooltipContent></Tooltip></TooltipProvider>
                  ) : (
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => del(r)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-6 text-muted-foreground text-xs">No currencies match.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.__isNew ? 'Add' : 'Edit'} Currency</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div><Label className="text-xs">Code (ISO)</Label>
                <Input value={editing.code} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} disabled={!editing.__isNew} maxLength={4} />
              </div>
              <div><Label className="text-xs">Name</Label><Input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Import rate</Label><Input type="number" step="0.0001" value={editing.import_rate ?? ''} onChange={e => setEditing({ ...editing, import_rate: e.target.value })} /></div>
                <div><Label className="text-xs">Export rate</Label><Input type="number" step="0.0001" value={editing.export_rate ?? ''} onChange={e => setEditing({ ...editing, export_rate: e.target.value })} /></div>
                <div><Label className="text-xs">Units per INR base</Label><Input type="number" step="1" value={editing.units_per_inr_base ?? 1} onChange={e => setEditing({ ...editing, units_per_inr_base: e.target.value })} /></div>
                <div><Label className="text-xs">Sort priority</Label><Input type="number" value={editing.sort_priority ?? 100} onChange={e => setEditing({ ...editing, sort_priority: e.target.value })} /></div>
                <div><Label className="text-xs">Effective start</Label><Input type="date" value={editing.effective_start_date ?? ''} onChange={e => setEditing({ ...editing, effective_start_date: e.target.value })} /></div>
                <label className="flex items-end gap-2 text-xs"><Checkbox checked={!!editing.is_featured} onCheckedChange={v => setEditing({ ...editing, is_featured: !!v })} /> Featured</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
    const { error } = await sb.from('finishing_difficulty').insert({ name: 'New Difficulty', adjustment_factor: 1.0, sort_order: (rows.at(-1)?.sort_order ?? 0) + 1 });
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
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Adjustment Factor</TableHead><TableHead>Sort</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.id}>
                <TableCell><Input className="h-7 text-xs" defaultValue={r.name} onBlur={e => { if (e.target.value !== r.name) upd(r.id, 'name', e.target.value); }} /></TableCell>
                <TableCell><Input className="h-7 text-xs w-24" type="number" step="0.1" defaultValue={r.adjustment_factor} onBlur={e => { const v = Number(e.target.value); if (v !== r.adjustment_factor) upd(r.id, 'adjustment_factor', v); }} /></TableCell>
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
