import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Package, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

const VendorRfqPublicView = () => {
  const { token } = useParams<{ token: string }>();
  const [rfq, setRfq] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [overallNotes, setOverallNotes] = useState('');
  const [overallLeadTime, setOverallLeadTime] = useState<string>('');

  const fetchData = async () => {
    if (!token) return;
    const { data: rfqRows } = await (supabase as any).rpc('get_rfq_by_share_token', { _token: token });
    const rfqData = rfqRows?.[0];
    if (!rfqData) { setLoading(false); return; }
    setRfq(rfqData);
    setOverallNotes(rfqData.vendor_response_notes || '');
    setOverallLeadTime(rfqData.vendor_response_lead_time_days != null ? String(rfqData.vendor_response_lead_time_days) : '');

    const { data: itemsData } = await (supabase as any).rpc('get_rfq_line_items_with_responses_by_share_token', { _token: token });
    const mapped = (itemsData || []).map((it: any) => ({
      ...it,
      // editable values, prefilled from any existing response
      quoted_unit_price: it.existing_quoted_unit_price != null ? String(it.existing_quoted_unit_price) : '',
      quoted_lead_time_days: it.existing_quoted_lead_time_days != null ? String(it.existing_quoted_lead_time_days) : '',
      vendor_notes: it.existing_vendor_notes || '',
    }));
    setItems(mapped);
    // Auto-open the form if any prior response exists
    if (mapped.some((m: any) => m.quoted_unit_price || m.vendor_notes) || rfqData.vendor_response_submitted_at) {
      setPricingOpen(true);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [token]);

  const updateItem = (id: string, field: string, value: string) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it));
  };

  const downloadPdf = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-rfq-pdf?token=${token}`);
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (w) w.onload = () => URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to load PDF');
    }
  };

  const canSubmit = useMemo(() => {
    const anyPrice = items.some(it => it.quoted_unit_price && it.quoted_unit_price.trim() !== '');
    const anyNotes = (overallNotes || '').trim() !== '' || items.some(it => (it.vendor_notes || '').trim() !== '');
    return anyPrice || anyNotes;
  }, [items, overallNotes]);

  const submitResponse = async () => {
    if (!token || !canSubmit) return;
    setSubmitting(true);
    const lineResponses = items.map(it => ({
      line_item_id: it.id,
      quoted_unit_price: it.quoted_unit_price?.trim() || null,
      quoted_lead_time_days: it.quoted_lead_time_days?.trim() || null,
      vendor_notes: it.vendor_notes?.trim() || null,
    }));
    const { data, error } = await (supabase as any).rpc('submit_vendor_rfq_response', {
      _token: token,
      _line_responses: lineResponses,
      _overall_notes: overallNotes.trim() || null,
      _overall_lead_time_days: overallLeadTime.trim() ? parseInt(overallLeadTime, 10) : null,
    });
    setSubmitting(false);
    if (error || !data?.ok) {
      toast.error('Could not submit pricing. Please try again or contact us by email.');
      return;
    }
    toast.success('Pricing submitted. Thank you!');
    fetchData();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-sans">Loading...</div>;
  if (!rfq) return <div className="min-h-screen flex items-center justify-center text-muted-foreground font-sans">Vendor RFQ not found.</div>;

  const total = items.reduce((s, item) => s + (item.target_price || 0) * (item.quantity || 0), 0);
  const lockedStatus = rfq.status === 'accepted' || rfq.status === 'rejected';
  const lastSubmittedAt = rfq.vendor_response_submitted_at ? new Date(rfq.vendor_response_submitted_at) : null;

  return (
    <div className="min-h-screen bg-background font-sans">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-5 w-5 text-primary" />
              <span className="font-bold text-sm">Product HQ</span>
            </div>
            <h1 className="text-xl font-bold">{rfq.title || 'Vendor Request for Quotation'}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span>{rfq.rfq_number}</span>
              {rfq.response_due && <span>Response requested by: <strong>{new Date(rfq.response_due).toLocaleDateString()}</strong></span>}
            </div>
            {rfq.vendor_name && (
              <p className="text-sm text-muted-foreground mt-1">
                Vendor: <strong>{rfq.vendor_name}</strong>
              </p>
            )}
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadPdf}>
            <Download className="h-3.5 w-3.5" /> Download PDF
          </Button>
        </div>

        {/* Submission confirmation banner */}
        {lastSubmittedAt && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 text-emerald-900 px-4 py-3 flex items-start gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Pricing submitted on {lastSubmittedAt.toLocaleString()}.</div>
              {!lockedStatus && <div className="text-xs mt-0.5">You can update and resubmit any time{rfq.response_due ? ` before ${new Date(rfq.response_due).toLocaleDateString()}` : ''}.</div>}
            </div>
          </div>
        )}

        {/* Primary CTA */}
        {!lockedStatus && !pricingOpen && (
          <Button size="lg" className="w-full sm:w-auto" onClick={() => setPricingOpen(true)}>
            Submit your pricing
          </Button>
        )}

        {/* Items Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-8">#</TableHead>
                  <TableHead className="text-xs w-12">Photo</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs">Units</TableHead>
                  <TableHead className="text-xs text-right">Target Price</TableHead>
                  {pricingOpen && !lockedStatus && (
                    <>
                      <TableHead className="text-xs text-right w-32">Your Unit Price (INR)</TableHead>
                      <TableHead className="text-xs text-right w-24">Lead time (days)</TableHead>
                      <TableHead className="text-xs w-48">Notes</TableHead>
                    </>
                  )}
                  {!pricingOpen && (
                    <TableHead className="text-xs text-right">Line Total</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      {item.product_photo_url ? (
                        <img src={item.product_photo_url} alt="" className="h-8 w-8 rounded object-cover" />
                      ) : <div className="h-8 w-8 rounded bg-muted" />}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{item.item_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{item.description || '—'}</TableCell>
                    <TableCell className="text-xs text-right">{item.quantity}</TableCell>
                    <TableCell className="text-xs">{item.units || '—'}</TableCell>
                    <TableCell className="text-xs text-right">{item.target_price != null ? `₹${Number(item.target_price).toFixed(2)}` : '—'}</TableCell>
                    {pricingOpen && !lockedStatus ? (
                      <>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="decimal"
                            className="h-8 text-xs text-right"
                            placeholder="—"
                            value={item.quoted_unit_price}
                            onChange={e => updateItem(item.id, 'quoted_unit_price', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            inputMode="numeric"
                            className="h-8 text-xs text-right"
                            placeholder="—"
                            value={item.quoted_lead_time_days}
                            onChange={e => updateItem(item.id, 'quoted_lead_time_days', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs"
                            placeholder="Optional"
                            value={item.vendor_notes}
                            onChange={e => updateItem(item.id, 'vendor_notes', e.target.value)}
                          />
                        </TableCell>
                      </>
                    ) : (
                      <TableCell className="text-xs text-right font-medium">
                        {item.target_price != null ? `₹${(item.target_price * item.quantity).toFixed(2)}` : '—'}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Total */}
        {!pricingOpen && (
          <div className="text-right text-sm">
            <span className="text-muted-foreground">Total Target Value: </span>
            <strong>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
          </div>
        )}

        {/* Pricing form footer */}
        {pricingOpen && !lockedStatus && (
          <Card>
            <CardContent className="py-4 space-y-3">
              <h2 className="text-sm font-semibold">Overall response</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Notes / payment terms (optional)</label>
                  <Textarea
                    className="text-sm min-h-[80px]"
                    placeholder="e.g. 30% advance, balance against BOL"
                    value={overallNotes}
                    onChange={e => setOverallNotes(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Overall lead time (days)</label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    className="h-8 text-sm"
                    placeholder="e.g. 30"
                    value={overallLeadTime}
                    onChange={e => setOverallLeadTime(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Used when individual line lead times aren't filled.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <Button onClick={submitResponse} disabled={!canSubmit || submitting}>
                  {submitting ? 'Submitting...' : (lastSubmittedAt ? 'Resubmit pricing' : 'Submit pricing')}
                </Button>
                <Button variant="ghost" onClick={() => setPricingOpen(false)} disabled={submitting}>
                  Cancel
                </Button>
                {!canSubmit && (
                  <span className="text-[11px] text-muted-foreground">Enter at least one price or note to submit.</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes & Terms */}
        {(rfq.notes || rfq.delivery_deadline || rfq.payment_terms) && (
          <Card>
            <CardContent className="py-4 space-y-2 text-sm">
              {rfq.notes && <div><strong className="text-xs text-muted-foreground">Notes:</strong><p className="whitespace-pre-wrap">{rfq.notes}</p></div>}
              {rfq.delivery_deadline && <div><strong className="text-xs text-muted-foreground">Delivery Deadline:</strong> {rfq.delivery_deadline}</div>}
              {rfq.payment_terms && <div><strong className="text-xs text-muted-foreground">Payment Terms:</strong> {rfq.payment_terms}</div>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default VendorRfqPublicView;
