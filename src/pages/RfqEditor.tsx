import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ArrowLeft, Save, Download, Link2, Send, CheckCircle, Plus, Trash2, CalendarIcon, LayoutGrid, TableIcon } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = ['draft', 'sent', 'responded', 'accepted', 'rejected'];
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700', sent: 'bg-blue-100 text-blue-700',
  responded: 'bg-amber-100 text-amber-700', accepted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const RFQ_TYPE_CATEGORY: Record<string, string> = {
  boxes: 'boxes', chemicals: 'chemicals', hardware: 'hardware', raw_pieces: 'raw_pieces',
};

const RfqEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rfq, setRfq] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [vendorOpen, setVendorOpen] = useState(false);

  const fetchRfq = async () => {
    if (!id) return;
    const [rfqRes, itemsRes, vendorsRes] = await Promise.all([
      (supabase as any).from('rfqs').select('*').eq('id', id).single(),
      (supabase as any).from('rfq_line_items').select('*').eq('rfq_id', id).order('sort_order'),
      (supabase as any).from('vendors').select('*').order('name'),
    ]);
    if (rfqRes.error) { toast.error('RFQ not found'); navigate('/rfqs'); return; }
    setRfq(rfqRes.data);
    setItems(itemsRes.data || []);
    setVendors(vendorsRes.data || []);
    // Default view: table for boxes, card for others
    if (rfqRes.data?.rfq_type === 'boxes') setViewMode('table');
    setLoading(false);
  };

  useEffect(() => { fetchRfq(); }, [id]);

  const updateRfqField = (field: string, value: any) => {
    setRfq((prev: any) => ({ ...prev, [field]: value }));
  };

  const roundTarget = (estCost: number, discountDecimal: number) => {
    const discountPercent = discountDecimal * 100;
    return Math.round((estCost * (1 - discountPercent / 100)) / 10) * 10;
  };

  const updateItem = (itemId: string, field: string, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const updated = { ...item, [field]: value };
      if (field === 'estimated_cost' && rfq?.discount_percent != null && value > 0) {
        updated.target_price = roundTarget(value, rfq.discount_percent);
      }
      return updated;
    }));
  };

  const recalculateTargetPrices = (discount: number) => {
    setItems(prev => prev.map(item => ({
      ...item,
      target_price: item.estimated_cost ? roundTarget(item.estimated_cost, discount) : item.target_price,
    })));
  };

  const addItem = () => {
    setItems(prev => [...prev, {
      id: `new-${Date.now()}`, rfq_id: id, item_name: '', description: '', dimensions: '',
      quantity: 0, units: 'pc', estimated_cost: null, target_price: null, vendor_price: null,
      notes: '', sort_order: prev.length, _isNew: true,
    }]);
  };

  const removeItem = (itemId: string) => setItems(prev => prev.filter(item => item.id !== itemId));

  const save = async () => {
    if (!id || !rfq) return;
    setSaving(true);
    try {
      const { error: rfqErr } = await (supabase as any).from('rfqs').update({
        title: rfq.title, vendor_name: rfq.vendor_name, vendor_email: rfq.vendor_email,
        vendor_phone: rfq.vendor_phone, vendor_address: rfq.vendor_address,
        discount_percent: rfq.discount_percent, notes: rfq.notes,
        delivery_deadline: rfq.delivery_deadline, payment_terms: rfq.payment_terms,
        response_due: rfq.response_due, status: rfq.status,
      }).eq('id', id);
      if (rfqErr) throw rfqErr;

      const existingIds = items.filter(i => !i._isNew).map(i => i.id);
      await (supabase as any).from('rfq_line_items').delete().eq('rfq_id', id).not('id', 'in', `(${existingIds.join(',')})`);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const row = {
          rfq_id: id, product_id: item.product_id || null, product_name: item.product_name || null,
          product_photo_url: item.product_photo_url || null, item_name: item.item_name || 'Item',
          description: item.description || null, dimensions: item.dimensions || null,
          quantity: item.quantity || 0, units: item.units || 'pc',
          estimated_cost: item.estimated_cost || null, target_price: item.target_price || null,
          vendor_price: item.vendor_price || null, notes: item.notes || null, sort_order: i,
        };
        if (item._isNew) await (supabase as any).from('rfq_line_items').insert(row);
        else await (supabase as any).from('rfq_line_items').update(row).eq('id', item.id);
      }
      toast.success('RFQ saved');
      fetchRfq();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const markAsSent = async () => {
    if (!id) return;
    await (supabase as any).from('rfqs').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id);
    updateRfqField('status', 'sent');
    toast.success('Marked as sent');
  };

  const copyShareLink = () => {
    if (!rfq?.share_token) return;
    navigator.clipboard.writeText(`${window.location.origin}/rfq/view/${rfq.share_token}`);
    toast.success('Share link copied');
  };

  const downloadPdf = async () => {
    if (!rfq?.share_token) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-rfq-pdf?token=${rfq.share_token}`);
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (w) w.onload = () => URL.revokeObjectURL(url);
    } catch (err) {
      toast.error('Failed to load RFQ PDF');
    }
  };

  const priceColor = (item: any) => {
    if (!item.vendor_price) return '';
    if (item.vendor_price <= (item.target_price || 0)) return 'text-emerald-600';
    if (item.vendor_price <= (item.estimated_cost || 0)) return 'text-amber-600';
    return 'text-red-600';
  };

  const totals = useMemo(() => {
    let estTotal = 0, targetTotal = 0, vendorTotal = 0;
    items.forEach(item => {
      estTotal += (item.estimated_cost || 0) * (item.quantity || 0);
      targetTotal += (item.target_price || 0) * (item.quantity || 0);
      vendorTotal += (item.vendor_price || 0) * (item.quantity || 0);
    });
    return { count: items.length, estTotal, targetTotal, vendorTotal, savings: estTotal - vendorTotal };
  }, [items]);

  // Vendor dropdown helpers
  const rfqCategory = rfq ? RFQ_TYPE_CATEGORY[rfq.rfq_type] || '' : '';
  const sortedVendors = useMemo(() => {
    if (!rfqCategory) return vendors;
    return [...vendors].sort((a, b) => {
      const aMatch = a.category === rfqCategory ? 0 : 1;
      const bMatch = b.category === rfqCategory ? 0 : 1;
      return aMatch - bMatch || (a.name || '').localeCompare(b.name || '');
    });
  }, [vendors, rfqCategory]);

  const selectVendor = (vendor: any) => {
    updateRfqField('vendor_name', vendor.name);
    updateRfqField('vendor_email', vendor.email || '');
    updateRfqField('vendor_phone', vendor.phone || '');
    updateRfqField('vendor_address', vendor.address || '');
    setVendorOpen(false);
  };

  if (loading || !rfq) {
    return <AppLayout><div className="text-center py-12 text-muted-foreground">Loading...</div></AppLayout>;
  }

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        {/* Back + Actions */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Badge className={STATUS_COLORS[rfq.status] || ''} variant="secondary">{rfq.status}</Badge>
            <span className="text-xs text-muted-foreground">{rfq.rfq_number}</span>
          </div>
        </div>

        {/* Header Section */}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Title</label>
                <Input className="h-8 text-sm" value={rfq.title || ''} onChange={e => updateRfqField('title', e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Status</label>
                <Select value={rfq.status} onValueChange={v => updateRfqField('status', v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Vendor Name</label>
                <Popover open={vendorOpen} onOpenChange={setVendorOpen}>
                  <PopoverTrigger asChild>
                    <Input className="h-8 text-sm cursor-pointer" value={rfq.vendor_name || ''} 
                      onChange={e => updateRfqField('vendor_name', e.target.value)}
                      onFocus={() => setVendorOpen(true)}
                      placeholder="Type or select vendor..." />
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start" onOpenAutoFocus={e => e.preventDefault()}>
                    <Command>
                      <CommandInput placeholder="Search vendors..." />
                      <CommandList>
                        <CommandEmpty>No vendors found. Type a name above.</CommandEmpty>
                        <CommandGroup>
                          {sortedVendors.map(v => (
                            <CommandItem key={v.id} onSelect={() => selectVendor(v)} className="text-xs">
                              <div className="flex-1">
                                <span className="font-medium">{v.name}</span>
                                {v.category && v.category !== 'general' && (
                                  <Badge variant="secondary" className="ml-2 text-[9px] h-4">{v.category}</Badge>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vendor Email</label>
                <Input className="h-8 text-sm" value={rfq.vendor_email || ''} onChange={e => updateRfqField('vendor_email', e.target.value)} placeholder="vendor@email.com" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Vendor Phone</label>
                <Input className="h-8 text-sm" value={rfq.vendor_phone || ''} onChange={e => updateRfqField('vendor_phone', e.target.value)} placeholder="Phone" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Response Due</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("h-8 text-xs w-full justify-start", !rfq.response_due && "text-muted-foreground")}>
                      <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
                      {rfq.response_due ? format(new Date(rfq.response_due), 'PPP') : 'Pick date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={rfq.response_due ? new Date(rfq.response_due) : undefined}
                      onSelect={(d) => updateRfqField('response_due', d ? format(d, 'yyyy-MM-dd') : null)}
                      className={cn("p-3 pointer-events-auto")} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Vendor Address</label>
                <Input className="h-8 text-sm" value={rfq.vendor_address || ''} onChange={e => updateRfqField('vendor_address', e.target.value)} placeholder="Address" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Delivery Deadline</label>
                <Input className="h-8 text-sm" value={rfq.delivery_deadline || ''} onChange={e => updateRfqField('delivery_deadline', e.target.value)} placeholder="e.g. 4 weeks from PO" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Payment Terms</label>
                <Input className="h-8 text-sm" value={rfq.payment_terms || ''} onChange={e => updateRfqField('payment_terms', e.target.value)} placeholder="e.g. Net 30" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Notes / Instructions to Vendor</label>
              <Textarea className="text-sm min-h-[60px]" value={rfq.notes || ''} onChange={e => updateRfqField('notes', e.target.value)} placeholder="General notes..." />
            </div>
          </CardContent>
        </Card>

        {/* Discount + View Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Target prices are set</span>
            <Input type="number" className="h-8 w-20 text-sm text-center"
              value={rfq.discount_percent != null ? +(rfq.discount_percent * 100).toFixed(1) : ''}
              onChange={e => { const val = parseFloat(e.target.value) / 100; updateRfqField('discount_percent', isNaN(val) ? null : val); }}
              onBlur={() => { if (rfq.discount_percent != null) recalculateTargetPrices(rfq.discount_percent); }}
            />
            <span className="text-muted-foreground">% below estimates</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant={viewMode === 'card' ? 'default' : 'outline'} size="sm" className="h-7 gap-1 text-xs"
              onClick={() => setViewMode('card')}><LayoutGrid className="h-3 w-3" /> Cards</Button>
            <Button variant={viewMode === 'table' ? 'default' : 'outline'} size="sm" className="h-7 gap-1 text-xs"
              onClick={() => setViewMode('table')}><TableIcon className="h-3 w-3" /> Table</Button>
          </div>
        </div>

        {/* Line Items — Card View */}
        {viewMode === 'card' && (
          <div className="space-y-3">
            {items.map((item, idx) => (
              <Card key={item.id} className="border">
                <CardContent className="pt-3 pb-3 space-y-2">
                  {/* Header */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono w-5">{idx + 1}.</span>
                    {item.product_photo_url && <img src={item.product_photo_url} alt="" className="h-8 w-8 rounded object-cover shrink-0" />}
                    <Input className="h-8 text-sm font-medium flex-1" value={item.item_name || ''} onChange={e => updateItem(item.id, 'item_name', e.target.value)} placeholder="Item name" />
                    <Badge variant="outline" className="text-[10px] shrink-0">{item.units || 'pc'}</Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeItem(item.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                  {/* Numbers row */}
                  <div className="grid grid-cols-6 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Qty</label>
                      <Input type="number" className="h-7 text-xs" value={item.quantity || ''} onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Units</label>
                      <Input className="h-7 text-xs" value={item.units || ''} onChange={e => updateItem(item.id, 'units', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Est. Cost</label>
                      <Input type="number" className="h-7 text-xs text-muted-foreground" value={item.estimated_cost || ''} onChange={e => updateItem(item.id, 'estimated_cost', parseFloat(e.target.value) || null)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Target</label>
                      <Input type="number" className="h-7 text-xs" value={item.target_price || ''} onChange={e => updateItem(item.id, 'target_price', parseFloat(e.target.value) || null)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Vendor Price</label>
                      <Input type="number" className={cn("h-7 text-xs font-medium", priceColor(item))} value={item.vendor_price || ''} onChange={e => updateItem(item.id, 'vendor_price', parseFloat(e.target.value) || null)} />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Dimensions</label>
                      <Input className="h-7 text-xs" value={item.dimensions || ''} onChange={e => updateItem(item.id, 'dimensions', e.target.value)} />
                    </div>
                  </div>
                  {/* Description + Notes */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Description</label>
                      <Textarea className="text-xs min-h-[48px] resize-y" rows={2} value={item.description || ''} onChange={e => updateItem(item.id, 'description', e.target.value)} placeholder="Product breakdown..." />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Notes</label>
                      <Textarea className="text-xs min-h-[48px] resize-y" rows={2} value={item.notes || ''} onChange={e => updateItem(item.id, 'notes', e.target.value)} placeholder="Specs, preferences..." />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addItem}>
              <Plus className="h-3.5 w-3.5" /> Add Item
            </Button>
          </div>
        )}

        {/* Line Items — Table View */}
        {viewMode === 'table' && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs w-8">#</TableHead>
                    <TableHead className="text-xs w-10">Photo</TableHead>
                    <TableHead className="text-xs" style={{ width: '15%' }}>Item</TableHead>
                    <TableHead className="text-xs" style={{ width: '22%' }}>Description</TableHead>
                    <TableHead className="text-xs" style={{ width: '10%' }}>Dimensions</TableHead>
                    <TableHead className="text-xs text-right w-16">Qty</TableHead>
                    <TableHead className="text-xs w-14">Units</TableHead>
                    <TableHead className="text-xs text-right w-20">Est.</TableHead>
                    <TableHead className="text-xs text-right w-20">Target</TableHead>
                    <TableHead className="text-xs text-right w-20">Vendor</TableHead>
                    <TableHead className="text-xs" style={{ minWidth: '120px' }}>Notes</TableHead>
                    <TableHead className="text-xs w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        {item.product_photo_url ? <img src={item.product_photo_url} alt="" className="h-8 w-8 rounded object-cover" /> : <div className="h-8 w-8 rounded bg-muted" />}
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs border-transparent hover:border-input" value={item.item_name || ''} onChange={e => updateItem(item.id, 'item_name', e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Textarea className="text-xs min-h-[40px] border-transparent hover:border-input resize-y" rows={2} value={item.description || ''} onChange={e => updateItem(item.id, 'description', e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs border-transparent hover:border-input" value={item.dimensions || ''} onChange={e => updateItem(item.id, 'dimensions', e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" className="h-7 text-xs text-right border-transparent hover:border-input" value={item.quantity || ''} onChange={e => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)} />
                      </TableCell>
                      <TableCell>
                        <Input className="h-7 text-xs border-transparent hover:border-input w-14" value={item.units || ''} onChange={e => updateItem(item.id, 'units', e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" className="h-7 text-xs text-right border-transparent hover:border-input text-muted-foreground" value={item.estimated_cost || ''} onChange={e => updateItem(item.id, 'estimated_cost', parseFloat(e.target.value) || null)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" className="h-7 text-xs text-right border-transparent hover:border-input" value={item.target_price || ''} onChange={e => updateItem(item.id, 'target_price', parseFloat(e.target.value) || null)} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" className={cn("h-7 text-xs text-right border-transparent hover:border-input font-medium", priceColor(item))} value={item.vendor_price || ''} onChange={e => updateItem(item.id, 'vendor_price', parseFloat(e.target.value) || null)} />
                      </TableCell>
                      <TableCell>
                        <Textarea className="text-xs min-h-[40px] border-transparent hover:border-input resize-y" rows={2} value={item.notes || ''} onChange={e => updateItem(item.id, 'notes', e.target.value)} />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(item.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="p-2">
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5" /> Add Row
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Bar */}
        <div className="flex items-center gap-6 text-xs border rounded-lg p-3 bg-muted/30">
          <span><strong>{totals.count}</strong> items</span>
          <span>Est. Total: <strong>{fmt.inr(totals.estTotal)}</strong></span>
          <span>Target Total: <strong>{fmt.inr(totals.targetTotal)}</strong></span>
          {totals.vendorTotal > 0 && (
            <>
              <span>Vendor Total: <strong>{fmt.inr(totals.vendorTotal)}</strong></span>
              <span className={totals.savings > 0 ? 'text-emerald-600' : 'text-red-600'}>
                Savings: <strong>{fmt.inr(totals.savings)}</strong>
              </span>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> {saving ? 'Saving...' : 'Save Draft'}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadPdf}>
            <Download className="h-3.5 w-3.5" /> Download PDF
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copyShareLink}>
            <Link2 className="h-3.5 w-3.5" /> Copy Share Link
          </Button>
          {rfq.status === 'draft' && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={markAsSent}>
              <Send className="h-3.5 w-3.5" /> Mark as Sent
            </Button>
          )}
          {rfq.status === 'sent' && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => updateRfqField('status', 'responded')}>
              <CheckCircle className="h-3.5 w-3.5" /> Mark as Responded
            </Button>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default RfqEditor;
