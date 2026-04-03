import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Minus, Plus, Package, Ship, Check, Loader2, AlertCircle } from 'lucide-react';

interface QuoteProduct {
  name: string;
  sku?: string;
  quantity: number;
  unit_price_usd: number;
  total_usd: number;
  unit_cbm: number;
  product_id?: string;
  photo_url?: string;
  moq?: number;
  width_inch?: number;
  depth_inch?: number;
  height_inch?: number;
  weight_kg?: number;
  variants?: Array<{ id: string; variant_name: string; photo_url?: string; wood_price_factor?: number }>;
}

interface QuoteData {
  snapshot: {
    id: string;
    quote_number: string;
    currency: string;
    valid_until: string;
    status: string;
    products: QuoteProduct[];
    totals: { grand_total: number; total_qty: number; total_cbm: number; sku_count: number };
    customer_selections?: any;
    approved_at?: string;
  };
  entity: {
    name: string;
    legal_name?: string;
    logo_url?: string;
    phone?: string;
    email?: string;
    website?: string;
  } | null;
  project: {
    name: string;
    customer_name?: string;
    customer_email?: string;
  } | null;
}

// Selection state per product
interface ProductSelection {
  quantity: number;
  selectedVariant?: string;
}

const CONTAINERS = [
  { name: '20ft', cbm: 33 },
  { name: '40ft', cbm: 67 },
  { name: '40ft HC', cbm: 76 },
];

const CustomerQuote = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selections, setSelections] = useState<Record<number, ProductSelection>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  useEffect(() => {
    const fetchQuote = async () => {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/get-quote?token=${token}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Quote not found');
        }
        const quoteData: QuoteData = await res.json();
        setData(quoteData);

        // Initialize selections from snapshot quantities or customer_selections
        const existing = quoteData.snapshot.customer_selections;
        const initSelections: Record<number, ProductSelection> = {};
        quoteData.snapshot.products.forEach((p, i) => {
          initSelections[i] = {
            quantity: existing?.products?.[i]?.quantity ?? p.quantity,
            selectedVariant: existing?.products?.[i]?.selectedVariant,
          };
        });
        setSelections(initSelections);

        if (quoteData.project?.customer_name) setCustomerName(quoteData.project.customer_name);
        if (quoteData.project?.customer_email) setCustomerEmail(quoteData.project.customer_email);
        if (quoteData.snapshot.status === 'approved') setConfirmed(true);
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    };
    if (token) fetchQuote();
  }, [token, supabaseUrl]);

  const updateQuantity = (idx: number, delta: number) => {
    setSelections(prev => {
      const current = prev[idx]?.quantity || 0;
      const moq = data?.snapshot.products[idx]?.moq || 1;
      const newQty = Math.max(moq, current + delta);
      return { ...prev, [idx]: { ...prev[idx], quantity: newQty } };
    });
  };

  const setQuantity = (idx: number, qty: number) => {
    const moq = data?.snapshot.products[idx]?.moq || 1;
    setSelections(prev => ({
      ...prev,
      [idx]: { ...prev[idx], quantity: Math.max(moq, qty) },
    }));
  };

  const setVariant = (idx: number, variantId: string) => {
    setSelections(prev => ({
      ...prev,
      [idx]: { ...prev[idx], selectedVariant: variantId },
    }));
  };

  const summary = useMemo(() => {
    if (!data) return { totalItems: 0, totalQty: 0, totalCbm: 0, totalValue: 0 };
    let totalQty = 0, totalCbm = 0, totalValue = 0;
    data.snapshot.products.forEach((p, i) => {
      const qty = selections[i]?.quantity ?? p.quantity;
      totalQty += qty;
      totalCbm += (p.unit_cbm || 0) * qty;
      totalValue += (p.unit_price_usd || 0) * qty;
    });
    return { totalItems: data.snapshot.products.length, totalQty, totalCbm, totalValue };
  }, [data, selections]);

  const symbol = data?.snapshot.currency === 'INR' ? '₹' : '$';

  const handleConfirm = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const customerSelections = {
        products: data?.snapshot.products.map((p, i) => ({
          name: p.name,
          sku: p.sku,
          quantity: selections[i]?.quantity ?? p.quantity,
          selectedVariant: selections[i]?.selectedVariant,
          line_total: (p.unit_price_usd || 0) * (selections[i]?.quantity ?? p.quantity),
        })),
        summary: { ...summary, confirmed_at: new Date().toISOString() },
      };

      const res = await fetch(`${supabaseUrl}/functions/v1/get-quote?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_selections: customerSelections,
          customer_name: customerName,
          customer_email: customerEmail,
          confirmed: true,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit');
      setConfirmed(true);
      setConfirmOpen(false);
      toast.success('Order confirmed successfully!');
    } catch {
      toast.error('Failed to confirm order. Please try again.');
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading your quote...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-10 w-10 mx-auto text-destructive" />
            <h2 className="text-lg font-semibold">Quote Not Found</h2>
            <p className="text-sm text-muted-foreground">{error || 'This quote link may have expired or is invalid.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { snapshot, entity, project } = data;
  const isExpired = snapshot.valid_until && new Date(snapshot.valid_until) < new Date();

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Header */}
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {entity?.logo_url && (
              <img src={entity.logo_url} alt={entity.name} className="h-8 w-auto" />
            )}
            <div>
              <h1 className="text-sm font-semibold">{entity?.name || 'Quote'}</h1>
              <p className="text-[10px] text-muted-foreground">
                Quote #{snapshot.quote_number} • Valid until {snapshot.valid_until ? new Date(snapshot.valid_until).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isExpired && <Badge variant="destructive" className="text-[10px]">Expired</Badge>}
            {confirmed && <Badge className="text-[10px] bg-green-600">Confirmed</Badge>}
            {!isExpired && !confirmed && <Badge variant="secondary" className="text-[10px]">Open</Badge>}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Project title */}
        {project && (
          <div className="mb-6">
            <h2 className="text-xl font-bold">{snapshot.quote_number ? `Quotation` : project.name}</h2>
            {project.customer_name && (
              <p className="text-sm text-muted-foreground mt-1">Prepared for {project.customer_name}</p>
            )}
          </div>
        )}

        {confirmed && (
          <Card className="mb-6 border-green-200 bg-green-50 dark:bg-green-950/20">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800 dark:text-green-200">Order Confirmed</p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  Thank you! Your order has been confirmed. We'll be in touch shortly.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Product Cards */}
          <div className="lg:col-span-2 space-y-4">
            {snapshot.products.map((product, idx) => {
              const sel = selections[idx];
              const qty = sel?.quantity ?? product.quantity;
              const lineTotal = (product.unit_price_usd || 0) * qty;

              return (
                <Card key={idx} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex gap-4">
                      {/* Photo */}
                      <div className="w-20 h-20 rounded-md bg-muted flex-shrink-0 overflow-hidden">
                        {product.photo_url ? (
                          <img src={product.photo_url} alt={product.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Package className="h-6 w-6 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold truncate">{product.name}</h3>
                            {product.sku && <p className="text-[10px] text-muted-foreground font-mono">{product.sku}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold">{symbol}{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            <p className="text-[10px] text-muted-foreground">{symbol}{(product.unit_price_usd || 0).toFixed(2)} / unit</p>
                          </div>
                        </div>

                        {/* Dimensions */}
                        {product.width_inch && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {product.width_inch}" × {product.depth_inch}" × {product.height_inch}"
                            {product.unit_cbm ? ` • ${product.unit_cbm.toFixed(4)} CBM` : ''}
                          </p>
                        )}

                        <div className="flex items-center gap-4 mt-3">
                          {/* Quantity adjuster */}
                          <div className="flex items-center gap-1">
                            <Label className="text-[10px] text-muted-foreground mr-1">Qty</Label>
                            <Button
                              variant="outline" size="icon" className="h-7 w-7"
                              onClick={() => updateQuantity(idx, -10)}
                              disabled={confirmed || isExpired}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <Input
                              className="h-7 w-16 text-center text-sm"
                              type="number"
                              value={qty}
                              onChange={e => setQuantity(idx, parseInt(e.target.value) || 0)}
                              disabled={confirmed || isExpired}
                              min={product.moq || 1}
                            />
                            <Button
                              variant="outline" size="icon" className="h-7 w-7"
                              onClick={() => updateQuantity(idx, 10)}
                              disabled={confirmed || isExpired}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                            {product.moq && (
                              <span className="text-[9px] text-muted-foreground ml-1">MOQ: {product.moq}</span>
                            )}
                          </div>

                          {/* Variant selector */}
                          {product.variants && product.variants.length > 0 && (
                            <Select
                              value={sel?.selectedVariant || ''}
                              onValueChange={v => setVariant(idx, v)}
                              disabled={confirmed || isExpired}
                            >
                              <SelectTrigger className="h-7 text-xs w-40">
                                <SelectValue placeholder="Select variant..." />
                              </SelectTrigger>
                              <SelectContent>
                                {product.variants.map(v => (
                                  <SelectItem key={v.id} value={v.id} className="text-xs">{v.variant_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Sidebar: Summary + Container Fill */}
          <div className="space-y-4">
            <Card className="sticky top-20">
              <CardContent className="pt-5 space-y-5">
                {/* Order Summary */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Package className="h-4 w-4" /> Order Summary
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Products</span>
                      <span>{summary.totalItems}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Quantity</span>
                      <span>{summary.totalQty.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total CBM</span>
                      <span>{summary.totalCbm.toFixed(2)}</span>
                    </div>
                    <div className="border-t pt-2 flex justify-between font-bold text-base">
                      <span>Total</span>
                      <span>{symbol}{summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>

                {/* Container Fill */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Ship className="h-4 w-4" /> Container Fill
                  </h3>
                  <div className="space-y-3">
                    {CONTAINERS.map(c => {
                      const fill = Math.min((summary.totalCbm / c.cbm) * 100, 100);
                      const color = fill > 95 ? 'bg-red-500' : fill > 80 ? 'bg-yellow-500' : 'bg-primary';
                      return (
                        <div key={c.name}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground">{c.name}</span>
                            <span className="font-medium">{fill.toFixed(0)}%</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${color}`}
                              style={{ width: `${fill}%` }}
                            />
                          </div>
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            {summary.totalCbm.toFixed(1)} / {c.cbm} CBM
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Confirm Button */}
                {!confirmed && !isExpired && (
                  <Button
                    className="w-full gap-2"
                    size="lg"
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Check className="h-4 w-4" /> Confirm Order
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Entity Contact */}
            {entity && (
              <Card>
                <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">{entity.name}</p>
                  {entity.phone && <p>{entity.phone}</p>}
                  {entity.email && <p>{entity.email}</p>}
                  {entity.website && <p>{entity.website}</p>}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm Your Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
              {data.snapshot.products.map((p, i) => {
                const qty = selections[i]?.quantity ?? p.quantity;
                return (
                  <div key={i} className="flex justify-between">
                    <span className="truncate mr-2">{p.name} × {qty}</span>
                    <span className="font-medium flex-shrink-0">
                      {symbol}{((p.unit_price_usd || 0) * qty).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
              <div className="border-t pt-2 flex justify-between font-bold">
                <span>Total</span>
                <span>{symbol}{summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label className="text-xs">Your Name</Label>
                <Input
                  className="h-8 text-sm mt-1"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div>
                <Label className="text-xs">Email Address</Label>
                <Input
                  className="h-8 text-sm mt-1"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="email@example.com"
                  type="email"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={submitting || !customerName}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              Confirm Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerQuote;
