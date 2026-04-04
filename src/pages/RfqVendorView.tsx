import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Package, FileText } from 'lucide-react';

const RfqVendorView = () => {
  const { token } = useParams<{ token: string }>();
  const [rfq, setRfq] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [entity, setEntity] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!token) return;
      // Use anon client to fetch by share_token
      const { data: rfqData } = await (supabase as any).from('rfqs').select('*').eq('share_token', token).single();
      if (!rfqData) { setLoading(false); return; }
      setRfq(rfqData);

      const [itemsRes, projRes] = await Promise.all([
        (supabase as any).from('rfq_line_items').select('*').eq('rfq_id', rfqData.id).order('sort_order'),
        supabase.from('projects').select('name, customer_name').eq('id', rfqData.project_id).single(),
      ]);
      setItems(itemsRes.data || []);
      setProject(projRes.data);
      setLoading(false);
    };
    fetch();
  }, [token]);

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
      console.error('Failed to load RFQ PDF');
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading...</div>;
  if (!rfq) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">RFQ not found.</div>;

  const total = items.reduce((s, item) => s + (item.target_price || 0) * (item.quantity || 0), 0);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-5 w-5 text-primary" />
              <span className="font-bold text-sm">DKT Costing</span>
            </div>
            <h1 className="text-xl font-bold">{rfq.title || 'Request for Quotation'}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span>{rfq.rfq_number}</span>
              {rfq.response_due && <span>Due: {new Date(rfq.response_due).toLocaleDateString()}</span>}
            </div>
            {project && (
              <p className="text-sm text-muted-foreground mt-1">
                Project: <strong>{project.name}</strong>
                {project.customer_name && ` — ${project.customer_name}`}
              </p>
            )}
          </div>
          <Button size="sm" className="gap-1.5" onClick={downloadPdf}>
            <Download className="h-3.5 w-3.5" /> Download PDF
          </Button>
        </div>

        {/* Items Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-8">#</TableHead>
                  <TableHead className="text-xs w-12">Photo</TableHead>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Dimensions</TableHead>
                  <TableHead className="text-xs text-right">Qty</TableHead>
                  <TableHead className="text-xs">Units</TableHead>
                  <TableHead className="text-xs text-right">Target Price</TableHead>
                  <TableHead className="text-xs text-right">Line Total</TableHead>
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
                    <TableCell className="text-xs">{item.dimensions || '—'}</TableCell>
                    <TableCell className="text-xs text-right">{item.quantity}</TableCell>
                    <TableCell className="text-xs">{item.units || '—'}</TableCell>
                    <TableCell className="text-xs text-right">{item.target_price != null ? `₹${Number(item.target_price).toFixed(2)}` : '—'}</TableCell>
                    <TableCell className="text-xs text-right font-medium">
                      {item.target_price != null ? `₹${(item.target_price * item.quantity).toFixed(2)}` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Total */}
        <div className="text-right text-sm">
          <span className="text-muted-foreground">Total Target Value: </span>
          <strong>₹{total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
        </div>

        {/* Notes & Terms */}
        {(rfq.notes || rfq.delivery_deadline || rfq.payment_terms) && (
          <Card>
            <CardContent className="py-4 space-y-2 text-sm">
              {rfq.notes && <div><strong className="text-xs text-muted-foreground">Notes:</strong><p className="whitespace-pre-wrap">{rfq.notes}</p></div>}
              {rfq.delivery_deadline && <div><strong className="text-xs text-muted-foreground">Delivery Deadline:</strong> {rfq.delivery_deadline}</div>}
              {rfq.payment_terms && <div><strong className="text-xs text-muted-foreground">Payment Terms:</strong> {rfq.payment_terms}</div>}
              {rfq.response_due && <div><strong className="text-xs text-muted-foreground">Please respond by:</strong> {new Date(rfq.response_due).toLocaleDateString()}</div>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default RfqVendorView;
