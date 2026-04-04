import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Minus, Plus, Package, Ship, Check, Loader2, AlertCircle, Ruler, Weight, Box, Mail, Phone, Globe } from 'lucide-react';

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
    notes?: string;
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

interface ProductSelection {
  quantity: number;
  selectedVariant?: string;
}

const CONTAINERS = [
  { name: '20ft', cbm: 33, icon: '📦' },
  { name: '40ft', cbm: 67, icon: '🚛' },
  { name: '40ft HC', cbm: 76, icon: '🚢' },
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

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/40">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
            <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary relative" />
          </div>
          <p className="text-sm text-muted-foreground font-medium tracking-wide">Loading your quote…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 px-4">
        <Card className="max-w-md w-full shadow-xl border-destructive/20">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
            <h2 className="text-xl font-bold tracking-tight">Quote Not Found</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {error || 'This quote link may have expired or is invalid. Please contact us for assistance.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { snapshot, entity, project } = data;
  const isExpired = snapshot.valid_until && new Date(snapshot.valid_until) < new Date();

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/20 via-background to-muted/30">
      {/* Header */}
      <header className="bg-background/80 backdrop-blur-lg border-b border-border/50 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              {entity?.logo_url ? (
                <img src={entity.logo_url} alt={entity.name} className="h-9 w-auto object-contain" />
              ) : (
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Package className="h-5 w-5 text-primary" />
                </div>
              )}
              <div>
                <h1 className="text-base font-semibold tracking-tight">{entity?.name || 'Quote'}</h1>
                <p className="text-xs text-muted-foreground">
                  {snapshot.quote_number} · Valid until {snapshot.valid_until ? new Date(snapshot.valid_until).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isExpired && (
                <Badge variant="destructive" className="font-medium">Expired</Badge>
              )}
              {confirmed && (
                <Badge className="bg-emerald-600 hover:bg-emerald-700 font-medium gap-1">
                  <Check className="h-3 w-3" /> Confirmed
                </Badge>
              )}
              {!isExpired && !confirmed && (
                <Badge variant="outline" className="font-medium text-primary border-primary/30">Active</Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Title Section */}
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            {snapshot.quote_number ? 'Quotation' : project?.name || 'Quote'}
          </h2>
          {project?.customer_name && (
            <p className="text-base text-muted-foreground mt-1">
              Prepared for <span className="font-medium text-foreground">{project.customer_name}</span>
            </p>
          )}
          {snapshot.notes && (
            <p className="text-sm text-muted-foreground mt-3 max-w-2xl leading-relaxed">{snapshot.notes}</p>
          )}
        </div>

        {/* Confirmed Banner */}
        {confirmed && (
          <div className="mb-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 p-5 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center flex-shrink-0">
              <Check className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">Order Confirmed</p>
              <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-0.5">
                Thank you for your order! Our team will be in touch shortly with next steps.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Product Cards */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Products ({snapshot.products.length})
              </h3>
            </div>

            {snapshot.products.map((product, idx) => {
              const sel = selections[idx];
              const qty = sel?.quantity ?? product.quantity;
              const lineTotal = (product.unit_price_usd || 0) * qty;

              return (
                <Card key={idx} className="overflow-hidden hover:shadow-lg transition-shadow duration-300 border-border/60">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row">
                      {/* Product Photo - larger, prominent */}
                      <div className="sm:w-48 h-48 sm:h-auto bg-muted/50 flex-shrink-0 overflow-hidden relative group">
                        {product.photo_url ? (
                          <img
                            src={product.photo_url}
                            alt={product.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center min-h-[140px]">
                            <div className="text-center space-y-2">
                              <Package className="h-10 w-10 text-muted-foreground/25 mx-auto" />
                              <span className="text-[10px] text-muted-foreground/40 font-medium">No image</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="flex-1 p-5 flex flex-col justify-between min-w-0">
                        <div>
                          {/* Header row */}
                          <div className="flex items-start justify-between gap-3 mb-3">
                            <div className="min-w-0">
                              <h3 className="text-lg font-semibold tracking-tight leading-tight">{product.name}</h3>
                              {product.sku && (
                                <p className="text-xs text-muted-foreground font-mono mt-0.5 bg-muted/50 inline-block px-1.5 py-0.5 rounded">
                                  {product.sku}
                                </p>
                              )}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xl font-bold tracking-tight">
                                {symbol}{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {symbol}{(product.unit_price_usd || 0).toFixed(2)} per unit
                              </p>
                            </div>
                          </div>

                          {/* Specs row */}
                          {(product.width_inch || product.weight_kg || product.unit_cbm > 0) && (
                            <div className="flex flex-wrap gap-3 mb-4">
                              {product.width_inch && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-full">
                                  <Ruler className="h-3 w-3" />
                                  {product.width_inch}" × {product.depth_inch}" × {product.height_inch}"
                                </span>
                              )}
                              {product.weight_kg && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-full">
                                  <Weight className="h-3 w-3" />
                                  {product.weight_kg} kg
                                </span>
                              )}
                              {product.unit_cbm > 0 && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-full">
                                  <Box className="h-3 w-3" />
                                  {product.unit_cbm.toFixed(4)} CBM
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Controls */}
                        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border/40">
                          {/* Quantity adjuster */}
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground font-medium">Qty</Label>
                            <div className="flex items-center border rounded-lg overflow-hidden">
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 rounded-none hover:bg-muted"
                                onClick={() => updateQuantity(idx, -10)}
                                disabled={confirmed || !!isExpired}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <Input
                                className="h-8 w-20 text-center text-sm font-medium border-0 border-x rounded-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                type="number"
                                value={qty}
                                onChange={e => setQuantity(idx, parseInt(e.target.value) || 0)}
                                disabled={confirmed || !!isExpired}
                                min={product.moq || 1}
                              />
                              <Button
                                variant="ghost" size="icon"
                                className="h-8 w-8 rounded-none hover:bg-muted"
                                onClick={() => updateQuantity(idx, 10)}
                                disabled={confirmed || !!isExpired}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {product.moq && product.moq > 1 && (
                              <span className="text-[10px] text-muted-foreground">MOQ: {product.moq}</span>
                            )}
                          </div>

                          {/* Variant selector */}
                          {product.variants && product.variants.length > 0 && (
                            <Select
                              value={sel?.selectedVariant || ''}
                              onValueChange={v => setVariant(idx, v)}
                              disabled={confirmed || !!isExpired}
                            >
                              <SelectTrigger className="h-8 text-xs w-44">
                                <SelectValue placeholder="Select variant…" />
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

          {/* Sidebar */}
          <div className="space-y-5">
            <Card className="sticky top-24 shadow-lg border-border/60">
              <CardContent className="p-6 space-y-6">
                {/* Order Summary */}
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
                    Order Summary
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Products</span>
                      <span className="font-medium">{summary.totalItems}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total Quantity</span>
                      <span className="font-medium">{summary.totalQty.toLocaleString()}</span>
                    </div>
                    {summary.totalCbm > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Total Volume</span>
                        <span className="font-medium">{summary.totalCbm.toFixed(2)} CBM</span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-medium">Total</span>
                      <span className="text-2xl font-bold tracking-tight">
                        {symbol}{summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Container Fill */}
                {summary.totalCbm > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
                      <Ship className="h-4 w-4" /> Container Fill
                    </h3>
                    <div className="space-y-3">
                      {CONTAINERS.map(c => {
                        const fill = Math.min((summary.totalCbm / c.cbm) * 100, 100);
                        const colorClass = fill > 95
                          ? 'bg-red-500'
                          : fill > 80
                          ? 'bg-amber-500'
                          : fill > 50
                          ? 'bg-primary'
                          : 'bg-primary/70';
                        return (
                          <div key={c.name} className="space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground font-medium">{c.icon} {c.name}</span>
                              <span className="font-semibold tabular-nums">{fill.toFixed(0)}%</span>
                            </div>
                            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ease-out ${colorClass}`}
                                style={{ width: `${fill}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-muted-foreground tabular-nums">
                              {summary.totalCbm.toFixed(1)} / {c.cbm} CBM
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Confirm Button */}
                {!confirmed && !isExpired && (
                  <Button
                    className="w-full h-12 text-base font-semibold gap-2 shadow-md hover:shadow-lg transition-shadow"
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Check className="h-5 w-5" /> Confirm Order
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Entity Contact Card */}
            {entity && (
              <Card className="border-border/40">
                <CardContent className="p-5 space-y-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contact</h4>
                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{entity.name}</p>
                    {entity.legal_name && entity.legal_name !== entity.name && (
                      <p className="text-xs text-muted-foreground">{entity.legal_name}</p>
                    )}
                    {entity.phone && (
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Phone className="h-3 w-3" /> {entity.phone}
                      </p>
                    )}
                    {entity.email && (
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Mail className="h-3 w-3" />
                        <a href={`mailto:${entity.email}`} className="hover:text-primary transition-colors">{entity.email}</a>
                      </p>
                    )}
                    {entity.website && (
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Globe className="h-3 w-3" />
                        <a href={entity.website} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">{entity.website}</a>
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-16 border-t border-border/30 bg-muted/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {entity?.name && `© ${new Date().getFullYear()} ${entity.name}. `}
            All prices are subject to final confirmation.
          </p>
        </div>
      </footer>

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm Your Order</DialogTitle>
            <DialogDescription>Review your selections and provide your details to confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {/* Order recap */}
            <div className="bg-muted/40 rounded-xl p-4 space-y-2.5">
              {data.snapshot.products.map((p, i) => {
                const qty = selections[i]?.quantity ?? p.quantity;
                const lineTotal = (p.unit_price_usd || 0) * qty;
                return (
                  <div key={i} className="flex justify-between items-center text-sm">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {p.photo_url && (
                        <img src={p.photo_url} alt={p.name} className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      )}
                      <span className="truncate">{p.name}</span>
                      <span className="text-muted-foreground flex-shrink-0">× {qty}</span>
                    </div>
                    <span className="font-semibold flex-shrink-0 ml-3">
                      {symbol}{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
              <Separator />
              <div className="flex justify-between items-baseline font-bold text-base">
                <span>Total</span>
                <span className="text-lg">
                  {symbol}{summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Customer details */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Your Name</Label>
                <Input
                  className="h-10"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Email Address</Label>
                <Input
                  className="h-10"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="email@example.com"
                  type="email"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={submitting || !customerName} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Confirm Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerQuote;
