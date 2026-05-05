import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Layers, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';

type Assembly = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  moq: number | null;
  target_price_usd: number | null;
  markup_percent: number | null;
  updated_at: string | null;
  components_count?: number;
  current_unit_price_usd?: number;
};

export function InquiryAssembliesTab({ inquiryId }: { inquiryId: string }) {
  const navigate = useNavigate();
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState(100);
  const [refresh, setRefresh] = useState(0);
  const [inquiryProducts, setInquiryProducts] = useState<{ id: string; name: string; sku: string | null }[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<Record<string, number>>({}); // productId -> qty/asm

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from('product_assemblies')
        .select('id, name, sku, quantity, moq, target_price_usd, updated_at, assembly_components(id)')
        .eq('customer_rfq_id', inquiryId)
        .order('updated_at', { ascending: false });
      const mapped: Assembly[] = (data || []).map((a: any) => ({
        ...a,
        components_count: (a.assembly_components || []).length,
      }));
      setAssemblies(mapped);
      setLoading(false);
    })();
  }, [inquiryId, refresh]);

  const openCreate = async () => {
    setCreateOpen(true);
    setSelectedComponents({});
    const { data } = await (supabase as any)
      .from('products')
      .select('id, name, sku')
      .eq('customer_rfq_id', inquiryId)
      .order('name');
    setInquiryProducts(data || []);
  };

  const toggleComponent = (productId: string) => {
    setSelectedComponents(prev => {
      const next = { ...prev };
      if (productId in next) delete next[productId];
      else next[productId] = 1;
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Name is required'); return; }
    const { data, error } = await (supabase as any).from('product_assemblies').insert({
      customer_rfq_id: inquiryId,
      name: name.trim(),
      sku: sku.trim() || null,
      quantity: quantity || 100,
    }).select().single();
    if (error) { toast.error(error.message); return; }

    const componentEntries = Object.entries(selectedComponents);
    if (data?.id && componentEntries.length > 0) {
      const rows = componentEntries.map(([product_id, qty], idx) => ({
        assembly_id: data.id,
        product_id,
        quantity_per_assembly: qty || 1,
        sort_order: idx,
      }));
      const { error: compErr } = await (supabase as any).from('assembly_components').insert(rows);
      if (compErr) toast.error('Components failed: ' + compErr.message);
      // Sync component product quantities to assembly quantity * qty/asm
      await Promise.all(componentEntries.map(([pid, qty]) =>
        (supabase as any).from('products').update({ quantity: (quantity || 100) * (qty || 1) }).eq('id', pid)
      ));
    }

    toast.success('Assembly created');
    setCreateOpen(false);
    setName(''); setSku(''); setQuantity(100); setSelectedComponents({});
    if (data?.id) navigate(`/assembly/${data.id}`);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('product_assemblies').delete().eq('id', id);
    if (error) throw error;
    setRefresh(r => r + 1);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Bundle multiple products into a single sellable kit (e.g. dining set, bed package).
        </p>
        <Button size="sm" onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" /> New assembly
        </Button>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : assemblies.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground space-y-2">
          <Layers className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <div>No assemblies in this inquiry yet.</div>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">SKU</TableHead>
                <TableHead className="text-xs text-right">Components</TableHead>
                <TableHead className="text-xs text-right">Qty</TableHead>
                <TableHead className="text-xs text-right">Target ($)</TableHead>
                <TableHead className="text-xs">Updated</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assemblies.map(a => (
                <TableRow key={a.id}>
                  <TableCell>
                    <button className="text-sm font-medium hover:underline text-left"
                      onClick={() => navigate(`/assembly/${a.id}`)}>{a.name}</button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.sku || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="secondary" className="text-[10px]">{a.components_count ?? 0}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono">{a.quantity}</TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    {a.target_price_usd ? `$${a.target_price_usd.toFixed(2)}` : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {a.updated_at ? formatDistanceToNow(new Date(a.updated_at), { addSuffix: true }) : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7 text-xs"
                        onClick={() => navigate(`/assembly/${a.id}`)}>Open</Button>
                      <ConfirmDeleteButton
                        itemLabel={`assembly "${a.name}"`}
                        iconOnly
                        onConfirm={() => handleDelete(a.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Assembly</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Name *</label>
              <Input className="h-9" placeholder="e.g. Dining Set — 6 Seater"
                value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">SKU</label>
                <Input className="h-9" placeholder="DS-6S-001"
                  value={sku} onChange={e => setSku(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Quantity</label>
                <Input className="h-9" type="number" value={quantity}
                  onChange={e => setQuantity(Number(e.target.value))} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-muted-foreground">Components from this inquiry</label>
                <span className="text-[10px] text-muted-foreground">
                  {Object.keys(selectedComponents).length} selected
                </span>
              </div>
              {inquiryProducts.length === 0 ? (
                <div className="text-xs text-muted-foreground border rounded-md p-3 text-center">
                  No products in this inquiry yet. Add products first, or create the assembly empty and add components later.
                </div>
              ) : (
                <div className="border rounded-md max-h-64 overflow-auto divide-y">
                  {inquiryProducts.map(p => {
                    const checked = p.id in selectedComponents;
                    return (
                      <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40">
                        <Checkbox checked={checked} onCheckedChange={() => toggleComponent(p.id)} />
                        <button className="flex-1 text-left text-xs" onClick={() => toggleComponent(p.id)}>
                          <div className="font-medium">{p.name}</div>
                          {p.sku && <div className="text-[10px] text-muted-foreground">{p.sku}</div>}
                        </button>
                        {checked && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">qty/asm</span>
                            <Input
                              className="h-7 w-14 text-xs"
                              type="number"
                              min={1}
                              value={selectedComponents[p.id]}
                              onChange={e => setSelectedComponents(prev => ({
                                ...prev, [p.id]: Math.max(1, Number(e.target.value) || 1),
                              }))}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create & open</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
