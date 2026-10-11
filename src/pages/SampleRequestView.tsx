import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, Clock, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ConfirmDeleteButton } from '@/components/ConfirmDeleteButton';
import { CLOCK_TONE_CLASSES } from '@/components/InquiryClockStrip';
import { SampleDialog, VendorCombobox } from '@/components/ProductSampleLogTab';
import { SAMPLE_STATUSES, SAMPLE_STATUS_LABEL, computeSampleClock } from '@/lib/sample-requests';
import { useDocumentTitle } from '@/hooks/use-document-title';

type Line = {
  id: string;
  product_id: string | null;
  vendor_id: string | null;
  status: string;
  completed_at: string | null;
  feedback: string | null;
  product: { id: string; name: string; sku: string | null; photo_url: string | null } | null;
};

type Request = {
  id: string;
  request_number: string;
  customer_rfq_id: string | null;
  requested_date: string;
  customer_requested_date: string | null;
  required_by_date: string | null;
  notes: string | null;
};

const toDateInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** One sample request: its dates, the sample clock, and a line per product. */
export default function SampleRequestView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [req, setReq] = useState<Request | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [inquiry, setInquiry] = useState<{ id: string; rfq_number: string; title: string | null; customer: string | null } | null>(null);
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [inquiryProducts, setInquiryProducts] = useState<Array<{ id: string; name: string; sku: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [detail, setDetail] = useState<{ productId: string; sampleId: string } | null>(null);
  useDocumentTitle(req ? `Samples ${req.request_number}` : 'Samples');

  const load = async () => {
    const { data: r } = await (supabase as any).from('sample_requests')
      .select('id, request_number, customer_rfq_id, requested_date, customer_requested_date, required_by_date, notes')
      .eq('id', id).maybeSingle();
    if (!r) { setLoading(false); return; }
    setReq(r);
    setNotes(r.notes ?? '');
    const [{ data: ls }, { data: vs }, inqRes, prodRes] = await Promise.all([
      (supabase as any).from('samples')
        .select('id, product_id, vendor_id, status, completed_at, feedback, product:products(id, name, sku, photo_url)')
        .eq('request_id', id),
      supabase.from('vendors').select('id, name').order('name'),
      r.customer_rfq_id
        ? (supabase as any).from('customer_rfqs').select('id, rfq_number, title, customers(name, company)').eq('id', r.customer_rfq_id).maybeSingle()
        : Promise.resolve({ data: null }),
      r.customer_rfq_id
        ? (supabase as any).from('products').select('id, name, sku').eq('customer_rfq_id', r.customer_rfq_id).is('archived_at', null).order('name')
        : Promise.resolve({ data: [] }),
    ]);
    const sorted = ((ls ?? []) as Line[]).sort((a, b) =>
      (a.product?.name ?? '').localeCompare(b.product?.name ?? '', undefined, { numeric: true, sensitivity: 'base' }));
    setLines(sorted);
    setVendors((vs ?? []) as any);
    const i = (inqRes as any).data;
    setInquiry(i ? { id: i.id, rfq_number: i.rfq_number, title: i.title, customer: i.customers?.company || i.customers?.name || null } : null);
    setInquiryProducts(((prodRes as any).data ?? []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const clock = useMemo(() => (req ? computeSampleClock(req, lines) : null), [req, lines]);

  const saveRequest = async (patch: Partial<Request>) => {
    if (!req) return;
    setReq({ ...req, ...patch });
    const { error } = await (supabase as any).from('sample_requests').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', req.id);
    if (error) toast.error(error.message);
  };

  const saveLine = async (lineId: string, patch: Record<string, any>) => {
    const { error } = await (supabase as any).from('samples').update(patch).eq('id', lineId);
    if (error) { toast.error(error.message); return; }
    load();
  };

  const setVendor = async (line: Line, vendorId: string, vendorName: string) => {
    let vid = vendorId || null;
    const name = vendorName.trim();
    if (!vid && name) {
      const existing = vendors.find(v => v.name.toLowerCase() === name.toLowerCase());
      if (existing) vid = existing.id;
      else {
        const { data: nv, error } = await supabase.from('vendors').insert({ name, category: 'sampling' }).select('id, name').single();
        if (error) { toast.error('Could not create vendor: ' + error.message); return; }
        vid = nv!.id;
      }
    }
    saveLine(line.id, { vendor_id: vid });
  };

  const addProduct = async (productId: string) => {
    if (!req) return;
    const { error } = await (supabase as any).from('samples').insert({
      request_id: req.id, product_id: productId, customer_rfq_id: req.customer_rfq_id, status: 'pending', requested_date: req.requested_date,
    });
    if (error) { toast.error(error.message); return; }
    load();
  };

  const markAllReceived = async () => {
    const open = lines.filter(l => l.status === 'pending').map(l => l.id);
    if (open.length === 0) return;
    const { error } = await (supabase as any).from('samples').update({ status: 'completed' }).in('id', open);
    if (error) { toast.error(error.message); return; }
    toast.success(`${open.length} sample${open.length === 1 ? '' : 's'} marked received`);
    load();
  };

  if (loading) return <AppLayout><div className="py-12 text-center text-muted-foreground">Loading…</div></AppLayout>;
  if (!req) return <AppLayout><div className="py-12 text-center text-muted-foreground">Sample request not found.</div></AppLayout>;

  const onRequest = new Set(lines.map(l => l.product_id));
  const addable = inquiryProducts.filter(p => !onRequest.has(p.id));

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" className="gap-1 -ml-2" onClick={() => navigate(inquiry ? `/inquiry/${inquiry.id}?tab=samples` : '/samples')}>
            <ArrowLeft className="h-4 w-4" /> {inquiry ? 'Back to inquiry' : 'All samples'}
          </Button>
          <ConfirmDeleteButton
            itemLabel={`sample request ${req.request_number}`}
            description={`This removes ${req.request_number} and its ${lines.length} sample line${lines.length === 1 ? '' : 's'}. This cannot be undone.`}
            onConfirm={async () => {
              const { error } = await (supabase as any).from('sample_requests').delete().eq('id', req.id);
              if (error) throw error;
              navigate(inquiry ? `/inquiry/${inquiry.id}?tab=samples` : '/samples');
            }}
          />
        </div>

        <div>
          <h1 className="text-xl font-semibold"><span className="font-mono">{req.request_number}</span></h1>
          {inquiry && (
            <p className="text-sm text-muted-foreground">
              <Link to={`/inquiry/${inquiry.id}?tab=samples`} className="font-mono text-primary hover:underline">{inquiry.rfq_number}</Link>
              {inquiry.title ? ` · ${inquiry.title}` : ''}{inquiry.customer ? ` · ${inquiry.customer}` : ''}
            </p>
          )}
        </div>

        {clock && (
          <div className={cn('flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm', CLOCK_TONE_CLASSES[clock.tone])}>
            <Clock className="h-4 w-4 shrink-0" />
            <span className="font-medium">{clock.label}</span>
            <span className="ml-auto text-xs opacity-80">Stops when each sample is received at our factory</span>
          </div>
        )}

        <Card>
          <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Requested on</Label>
              <Input type="date" className="h-9 mt-1" value={req.requested_date?.slice(0, 10) ?? ''}
                onChange={e => e.target.value && saveRequest({ requested_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Customer asked on <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="date" className="h-9 mt-1" value={req.customer_requested_date?.slice(0, 10) ?? ''}
                onChange={e => saveRequest({ customer_requested_date: e.target.value || null })} />
            </div>
            <div>
              <Label className="text-xs">Required by <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="date" className="h-9 mt-1" value={req.required_by_date?.slice(0, 10) ?? ''}
                onChange={e => saveRequest({ required_by_date: e.target.value || null })} />
            </div>
            <div className="sm:col-span-3">
              <Label className="text-xs">Notes</Label>
              <Textarea className="mt-1 text-sm min-h-[60px]" value={notes} onChange={e => setNotes(e.target.value)}
                onBlur={() => notes !== (req.notes ?? '') && saveRequest({ notes: notes.trim() || null })}
                placeholder="Finish, size or anything the vendor needs to know" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b">
              <div className="text-sm font-semibold">Samples ({lines.length})</div>
              <div className="ml-auto flex items-center gap-2">
                {addable.length > 0 && (
                  <Select value="" onValueChange={addProduct}>
                    <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Add a product…" /></SelectTrigger>
                    <SelectContent>
                      {addable.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {lines.some(l => l.status === 'pending') && (
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={markAllReceived}>Mark all received</Button>
                )}
              </div>
            </div>
            {lines.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No products on this request yet.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Product</TableHead>
                    <TableHead className="text-xs w-56">Vendor</TableHead>
                    <TableHead className="text-xs w-44">Status</TableHead>
                    <TableHead className="text-xs w-40">Received on</TableHead>
                    <TableHead className="text-xs w-20 text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map(l => {
                    const vendor = vendors.find(v => v.id === l.vendor_id);
                    return (
                      <TableRow key={l.id}>
                        <TableCell className="text-sm">
                          <div className="flex items-center gap-2">
                            {l.product?.photo_url
                              ? <img src={l.product.photo_url} alt="" className="h-9 w-9 rounded object-cover bg-muted" />
                              : <div className="h-9 w-9 rounded bg-muted" />}
                            <div>
                              {l.product ? <Link to={`/product/${l.product.id}?tab=sample-log`} className="font-medium hover:underline">{l.product.name}</Link> : '—'}
                              {l.product?.sku && <div className="text-[11px] text-muted-foreground">{l.product.sku}</div>}
                              {l.feedback && <div className="text-[11px] text-muted-foreground line-clamp-1">Feedback: {l.feedback}</div>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <VendorCombobox vendors={vendors} vendorId={l.vendor_id ?? ''} vendorName={vendor?.name ?? ''}
                            onChange={(vid, name) => setVendor(l, vid, name)} />
                        </TableCell>
                        <TableCell>
                          <Select value={l.status} onValueChange={v => saveLine(l.id, { status: v })}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SAMPLE_STATUSES.map(s => <SelectItem key={s} value={s}>{SAMPLE_STATUS_LABEL[s]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input type="date" className="h-8 text-xs" disabled={l.status !== 'completed'}
                            value={toDateInput(l.completed_at)}
                            onChange={e => e.target.value && saveLine(l.id, { completed_at: new Date(`${e.target.value}T12:00:00`).toISOString() })} />
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {l.product_id && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Photos, size, finish, feedback"
                              onClick={() => setDetail({ productId: l.product_id!, sampleId: l.id })}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Remove from request"
                            onClick={async () => {
                              const { error } = await (supabase as any).from('samples').delete().eq('id', l.id);
                              if (error) { toast.error(error.message); return; }
                              load();
                            }}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {detail && (
        <SampleDialog
          open={!!detail}
          onOpenChange={o => { if (!o) setDetail(null); }}
          productId={detail.productId}
          sampleId={detail.sampleId}
          onSaved={() => { setDetail(null); load(); }}
        />
      )}
    </AppLayout>
  );
}
