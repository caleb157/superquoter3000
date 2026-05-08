import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Minus, Plus, Package, Ship, Check, Loader2, AlertCircle, Download, Mail, Phone, Globe, MapPin, Building2, Landmark } from 'lucide-react';

interface QuoteComponent {
  product_id?: string | null;
  name: string;
  sku?: string | null;
  photo_url?: string | null;
  quantity_per_assembly: number;
  width_inch?: number | null;
  depth_inch?: number | null;
  height_inch?: number | null;
  weight_kg?: number | null;
  unit_cbm?: number | null;
  box_size?: string | null;
}

interface QuoteProduct {
  product_id?: string | null;
  assembly_id?: string | null;
  is_assembly?: boolean;
  name: string;
  sku?: string | null;
  quantity: number;
  unit_price_usd: number;
  total?: number;
  unit_cbm: number;
  photo_url?: string | null;
  moq?: number | null;
  hard_moq?: number | null;
  width_inch?: number | null;
  depth_inch?: number | null;
  height_inch?: number | null;
  weight_kg?: number | null;
  box_size?: string | null;
  components?: QuoteComponent[];
}

interface EntitySnap {
  id?: string;
  name?: string;
  legal_name?: string | null;
  entity_type?: string | null;
  logo_url?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  bank_name?: string | null;
  bank_branch?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  ifsc_code?: string | null;
  routing_number?: string | null;
  swift_code?: string | null;
  gst_number?: string | null;
  ein_number?: string | null;
}

interface CustomerSnap {
  id?: string;
  name?: string;
  company?: string | null;
  email?: string | null;
  logo_url?: string | null;
}

interface InquirySnap {
  id?: string;
  rfq_number?: string | null;
  title?: string | null;
}

interface QuoteData {
  snapshot: {
    id: string;
    quote_number: string;
    currency: string;
    valid_until: string | null;
    status: string;
    products: QuoteProduct[];
    totals: { grand_total: number; total_qty: number; total_cbm: number; sku_count: number; below_moq_surcharge_percent?: number };
    customer_selections?: any;
    approved_at?: string;
    notes?: string | null;
    payment_terms?: string | null;
    created_at?: string | null;
  };
  entity: EntitySnap | null;
  customer: CustomerSnap | null;
  inquiry: InquirySnap | null;
  // Legacy field for pre-refactor quotes
  project?: { name?: string; customer_name?: string; customer_email?: string } | null;
}

interface ProductSelection {
  quantity: number;
}

type ContainerKey = '20ft' | '40ft' | '40fthc';
const CONTAINERS: { key: ContainerKey; name: string; cbm: number }[] = [
  { key: '20ft', name: '20ft Standard', cbm: 28 },
  { key: '40ft', name: '40ft Standard', cbm: 56 },
  { key: '40fthc', name: '40ft High Cube', cbm: 68 },
];

function containerFill(totalCbm: number, containerCbm: number) {
  if (totalCbm <= 0) return { containerCount: 0, fullContainers: 0, lastContainerPct: 0, totalPct: 0 };
  const containerCount = Math.ceil(totalCbm / containerCbm);
  const fullContainers = Math.floor(totalCbm / containerCbm);
  const remainder = Math.max(0, totalCbm - fullContainers * containerCbm);
  const lastContainerPct = remainder > 0 ? (remainder / containerCbm) * 100 : 100;
  return {
    containerCount,
    fullContainers,
    lastContainerPct,
    totalPct: (totalCbm / (containerCount * containerCbm)) * 100,
  };
}

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

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
  const [printSize, setPrintSize] = useState<'A4' | 'Letter'>(() => {
    if (typeof window === 'undefined') return 'A4';
    return (localStorage.getItem('quotePrintSize') as 'A4' | 'Letter') || 'A4';
  });
  const [printOrientation, setPrintOrientation] = useState<'portrait' | 'landscape'>(() => {
    if (typeof window === 'undefined') return 'portrait';
    return (localStorage.getItem('quotePrintOrientation') as 'portrait' | 'landscape') || 'portrait';
  });
  useEffect(() => { try { localStorage.setItem('quotePrintSize', printSize); } catch {} }, [printSize]);
  useEffect(() => { try { localStorage.setItem('quotePrintOrientation', printOrientation); } catch {} }, [printOrientation]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadRef = useRef(true);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  // Force light theme on this customer-facing page regardless of app setting.
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains('dark');
    if (hadDark) root.classList.remove('dark');
    return () => { if (hadDark) root.classList.add('dark'); };
  }, []);

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
          initSelections[i] = { quantity: existing?.products?.[i]?.quantity ?? p.quantity };
        });
        setSelections(initSelections);

        // Pre-fill from snapshot.customer (or legacy project) for the confirm dialog.
        const cust: any = quoteData.customer ?? quoteData.project ?? {};
        const cName = cust.name ?? cust.customer_name ?? null;
        const cEmail = cust.email ?? cust.customer_email ?? null;
        if (cName) setCustomerName(cName);
        if (cEmail) setCustomerEmail(cEmail);
        if (quoteData.snapshot.status === 'approved') setConfirmed(true);
      } catch (err: any) {
        setError(err.message);
      }
      setLoading(false);
    };
    if (token) fetchQuote();
  }, [token, supabaseUrl]);

  const autoSave = useCallback(async (currentSelections: Record<number, ProductSelection>) => {
    if (!token || !data || confirmed) return;
    try {
      const pct = data.snapshot.totals?.below_moq_surcharge_percent ?? 0.15;
      const customerSelections = {
        products: data.snapshot.products.map((p, i) => {
          const q = currentSelections[i]?.quantity ?? p.quantity;
          const moq = Math.max(1, p.moq || 1);
          const unit = q < moq ? (p.unit_price_usd || 0) * (1 + pct) : (p.unit_price_usd || 0);
          return {
            name: p.name,
            sku: p.sku,
            quantity: q,
            unit_price: unit,
            below_moq: q < moq,
            line_total: unit * q,
          };
        }),
        draft_saved_at: new Date().toISOString(),
      };
      await fetch(`${supabaseUrl}/functions/v1/get-quote?token=${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_selections: customerSelections, confirmed: false }),
      });
    } catch { /* ignore */ }
  }, [token, data, confirmed, supabaseUrl]);

  useEffect(() => {
    if (initialLoadRef.current) { initialLoadRef.current = false; return; }
    if (confirmed || !data) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(selections), 1500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [selections, autoSave, confirmed, data]);

  // Below-MOQ surcharge & hard-floor helpers.
  // - hardFloor: absolute minimum quantity the customer can order.
  // - moq: standard MOQ. If qty is between hardFloor and moq-1, apply surcharge.
  const surchargePct = data?.snapshot.totals?.below_moq_surcharge_percent ?? 0.15;
  const getProductFloors = (p: QuoteProduct | undefined) => {
    const moq = Math.max(1, p?.moq || 1);
    const hardFloor = Math.max(1, p?.hard_moq ?? moq);
    return { moq, hardFloor };
  };
  const effectiveUnitPrice = (p: QuoteProduct, qty: number) => {
    const { moq } = getProductFloors(p);
    const base = p.unit_price_usd || 0;
    return qty < moq ? base * (1 + surchargePct) : base;
  };

  const updateQuantity = (idx: number, delta: number) => {
    setSelections(prev => {
      const current = prev[idx]?.quantity || 0;
      const { hardFloor } = getProductFloors(data?.snapshot.products[idx]);
      const newQty = Math.max(hardFloor, current + delta);
      return { ...prev, [idx]: { quantity: newQty } };
    });
  };

  const setQuantity = (idx: number, qty: number) => {
    const { hardFloor } = getProductFloors(data?.snapshot.products[idx]);
    setSelections(prev => ({ ...prev, [idx]: { quantity: Math.max(hardFloor, qty) } }));
  };

  const summary = useMemo(() => {
    if (!data) return { totalItems: 0, totalQty: 0, totalCbm: 0, totalValue: 0 };
    let totalQty = 0, totalCbm = 0, totalValue = 0;
    data.snapshot.products.forEach((p, i) => {
      const qty = selections[i]?.quantity ?? p.quantity;
      const unit = effectiveUnitPrice(p, qty);
      totalQty += qty;
      totalCbm += (p.unit_cbm || 0) * qty;
      totalValue += unit * qty;
    });
    return { totalItems: data.snapshot.products.length, totalQty, totalCbm, totalValue };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, selections, surchargePct]);

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

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const handleDownloadPdf = async () => {
    if (!data) return;
    setDownloadingPdf(true);
    try {
      const [{ pdf }, { default: QuotePdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/quote/QuotePdfDocument'),
      ]);
      const productsForPdf = data.snapshot.products.map((p) => ({
        name: p.name,
        sku: p.sku,
        quantity: p.quantity,
        unit_price_usd: p.unit_price_usd,
        unit_cbm: p.unit_cbm,
        photo_url: p.photo_url,
        moq: p.moq,
        width_inch: p.width_inch,
        depth_inch: p.depth_inch,
        height_inch: p.height_inch,
        weight_kg: p.weight_kg,
        box_size: p.box_size,
        is_assembly: p.is_assembly,
        components: p.components,
      }));
      const doc = (
        <QuotePdfDocument
          size={printSize === 'A4' ? 'A4' : 'LETTER'}
          orientation={printOrientation}
          quoteNumber={data.snapshot.quote_number}
          currency={data.snapshot.currency}
          validUntil={data.snapshot.valid_until}
          createdAt={data.snapshot.created_at ?? null}
          status={data.snapshot.status}
          paymentTerms={data.snapshot.payment_terms ?? null}
          notes={data.snapshot.notes ?? null}
          products={productsForPdf}
          selections={selections}
          entity={data.entity}
          customer={data.customer}
          inquiry={data.inquiry}
          totals={{
            totalItems: summary.totalItems,
            totalQty: summary.totalQty,
            totalCbm: summary.totalCbm,
            totalValue: summary.totalValue,
          }}
        />
      );
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const filename = `Quote-${(data.snapshot.quote_number || 'quote').replace(/[^a-z0-9-_]+/gi, '_')}.pdf`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('PDF generation failed', err);
      toast.error('Failed to generate PDF. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-slate-500" />
          <p className="text-sm text-slate-500">Loading your quote…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-lg p-8 text-center space-y-3 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertCircle className="h-7 w-7 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Quote Not Found</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            {error || 'This quote link may have expired or is invalid. Please contact us for assistance.'}
          </p>
        </div>
      </div>
    );
  }

  const { snapshot, entity, customer, inquiry } = data;
  const isExpired = snapshot.valid_until ? new Date(snapshot.valid_until) < new Date() : false;
  const statusKey = isExpired ? 'expired' : (snapshot.status ?? 'draft');
  const STATUS_PILL: Record<string, { label: string; cls: string }> = {
    draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
    sent: { label: 'Active', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    viewed: { label: 'Active', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    approved: { label: 'Approved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    expired: { label: 'Expired', cls: 'bg-red-50 text-red-700 border-red-200' },
  };
  const pill = STATUS_PILL[statusKey] ?? STATUS_PILL.draft;

  const addressLines = [
    entity?.address_line1,
    entity?.address_line2,
    [entity?.city, entity?.state, entity?.postal_code].filter(Boolean).join(', '),
    entity?.country,
  ].filter(Boolean) as string[];

  const isUS = (entity?.country ?? '').toLowerCase().includes('united states') || (entity?.country ?? '').toLowerCase() === 'usa' || (entity?.country ?? '').toLowerCase() === 'us';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 print:bg-white">
      {/* Minimal print stylesheet — PDF download is the canonical export */}
      <style>{`
        @media print {
          @page { size: ${printSize} ${printOrientation}; margin: 10mm; }
          html, body { background: #ffffff !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {(() => {
        const sameOriginReferrer = typeof document !== 'undefined' && document.referrer && (() => {
          try { return new URL(document.referrer).origin === window.location.origin; } catch { return false; }
        })();
        const canGoBack = typeof window !== 'undefined' && (window.history.length > 1 && sameOriginReferrer);
        return (
          <div className="no-print sticky top-0 z-30 bg-slate-50/90 backdrop-blur border-b border-slate-200">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-3 flex-wrap">
              {canGoBack ? (
                <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="h-8 -ml-2">
                  ← Back to app
                </Button>
              ) : <span />}
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="hidden sm:inline text-slate-500">PDF:</span>
                <div className="inline-flex rounded-md border border-slate-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPrintSize('A4')}
                    className={`px-2 py-1 ${printSize === 'A4' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                    aria-pressed={printSize === 'A4'}
                  >A4</button>
                  <button
                    type="button"
                    onClick={() => setPrintSize('Letter')}
                    className={`px-2 py-1 border-l border-slate-200 ${printSize === 'Letter' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                    aria-pressed={printSize === 'Letter'}
                  >Letter</button>
                </div>
                <div className="inline-flex rounded-md border border-slate-200 bg-white overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setPrintOrientation('portrait')}
                    className={`px-2 py-1 ${printOrientation === 'portrait' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                    aria-pressed={printOrientation === 'portrait'}
                  >Portrait</button>
                  <button
                    type="button"
                    onClick={() => setPrintOrientation('landscape')}
                    className={`px-2 py-1 border-l border-slate-200 ${printOrientation === 'landscape' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
                    aria-pressed={printOrientation === 'landscape'}
                  >Landscape</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 print:py-0 print:px-0 print-fit">

        {/* ============ HEADER BAND ============ */}
        <header className="bg-white border border-slate-200 rounded-t-lg p-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 print-shadow-none print-border-light">
          <div className="flex items-start gap-4 min-w-0">
            {entity?.logo_url ? (
              <img src={entity.logo_url} alt={entity.name ?? ''} className="h-14 w-auto object-contain flex-shrink-0" />
            ) : (
              <div className="h-14 w-14 rounded-md bg-slate-100 flex items-center justify-center flex-shrink-0">
                <Building2 className="h-6 w-6 text-slate-400" />
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-slate-900 leading-tight truncate">{entity?.name || 'Quotation'}</h1>
              {entity?.legal_name && entity.legal_name !== entity.name && (
                <p className="text-sm text-slate-500 mt-0.5 truncate">{entity.legal_name}</p>
              )}
              {entity?.entity_type && (
                <p className="text-xs text-slate-400 mt-0.5 uppercase tracking-wide">{entity.entity_type}</p>
              )}
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-2 flex-shrink-0">
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${pill.cls}`}>
              {pill.label}
            </span>
            <div className="text-sm">
              <div className="font-mono text-slate-900 font-semibold">{snapshot.quote_number ?? '—'}</div>
              <div className="text-xs text-slate-500 mt-1">Issued: {formatDate(snapshot.created_at)}</div>
              <div className={`text-xs mt-0.5 ${isExpired ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
                Valid until: {formatDate(snapshot.valid_until)}
                {isExpired && ' (expired)'}
              </div>
            </div>
          </div>
        </header>

        {snapshot.payment_terms && (
          <section className="bg-amber-50 border-x border-b border-amber-200 px-6 py-3 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-baseline gap-x-3 gap-y-1 print-border-light">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 shrink-0">Payment Terms</span>
            <span className="whitespace-pre-wrap">{snapshot.payment_terms}</span>
          </section>
        )}

        {/* ============ ENTITY INFO + BANK DETAILS ============ */}
        {entity ? (
          <section className="bg-white border-x border-b border-slate-200 p-6 grid grid-cols-1 md:grid-cols-2 gap-6 print-border-light print-grid-1">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> Contact &amp; Address
              </h3>
              <div className="space-y-1 text-sm text-slate-700">
                {addressLines.map((l, i) => <div key={i}>{l}</div>)}
                {entity.phone && (
                  <div className="flex items-center gap-2 pt-1.5 text-slate-600">
                    <Phone className="h-3.5 w-3.5 text-slate-400" /> {entity.phone}
                  </div>
                )}
                {entity.email && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Mail className="h-3.5 w-3.5 text-slate-400" />
                    <a href={`mailto:${entity.email}`} className="hover:underline">{entity.email}</a>
                  </div>
                )}
                {entity.website && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Globe className="h-3.5 w-3.5 text-slate-400" />
                    <a href={entity.website} target="_blank" rel="noopener noreferrer" className="hover:underline">{entity.website}</a>
                  </div>
                )}
                {entity.gst_number && (
                  <div className="text-xs text-slate-500 pt-1">GST: <span className="font-mono">{entity.gst_number}</span></div>
                )}
                {entity.ein_number && (
                  <div className="text-xs text-slate-500">EIN: <span className="font-mono">{entity.ein_number}</span></div>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                <Landmark className="h-3.5 w-3.5" /> Banking Details
              </h3>
              {entity.bank_name || entity.account_number ? (
                <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 gap-x-3 text-sm text-slate-700">
                  {entity.bank_name && (<><dt className="text-slate-500">Bank</dt><dd>{entity.bank_name}</dd></>)}
                  {entity.bank_branch && (<><dt className="text-slate-500">Branch</dt><dd>{entity.bank_branch}</dd></>)}
                  {entity.account_name && (<><dt className="text-slate-500">Account name</dt><dd>{entity.account_name}</dd></>)}
                  {entity.account_number && (<><dt className="text-slate-500">Account #</dt><dd className="font-mono">{entity.account_number}</dd></>)}
                  {!isUS && entity.ifsc_code && (<><dt className="text-slate-500">IFSC</dt><dd className="font-mono">{entity.ifsc_code}</dd></>)}
                  {isUS && entity.routing_number && (<><dt className="text-slate-500">Routing #</dt><dd className="font-mono">{entity.routing_number}</dd></>)}
                  {entity.swift_code && (<><dt className="text-slate-500">SWIFT</dt><dd className="font-mono">{entity.swift_code}</dd></>)}
                </dl>
              ) : (
                <p className="text-sm text-slate-400 italic">Bank details available on request.</p>
              )}
            </div>
          </section>
        ) : (
          <section className="bg-white border-x border-b border-slate-200 p-4 text-center text-sm text-slate-400">
            No entity details
          </section>
        )}

        {/* ============ CUSTOMER CARD ============ */}
        <section className="bg-white border-x border-b border-slate-200 p-6 print-border-light">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Prepared for</h3>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-slate-900">
                {customer?.name || data.project?.customer_name || 'Customer'}
              </p>
              {customer?.company && <p className="text-sm text-slate-600">{customer.company}</p>}
              {customer?.email && (
                <p className="text-sm text-slate-500 mt-0.5">
                  <a href={`mailto:${customer.email}`} className="hover:underline">{customer.email}</a>
                </p>
              )}
            </div>
            {(inquiry?.rfq_number || inquiry?.title) && (
              <div className="text-right">
                <div className="text-xs text-slate-400 uppercase tracking-wide">Reference</div>
                {inquiry.rfq_number && <div className="text-sm font-mono text-slate-700">{inquiry.rfq_number}</div>}
                {inquiry.title && <div className="text-sm text-slate-600">{inquiry.title}</div>}
              </div>
            )}
          </div>
        </section>

        {/* ============ CONFIRMED BANNER ============ */}
        {confirmed && (
          <div className="bg-emerald-50 border-x border-b border-emerald-200 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <Check className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <p className="font-semibold text-emerald-900 text-sm">Order Confirmed</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                Thank you for your order — our team will be in touch shortly with next steps.
              </p>
            </div>
          </div>
        )}

        {/* ============ MAIN: PRODUCTS + SIDEBAR ============ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6 print-grid-1">
          {/* Products */}
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">
              Products ({snapshot.products.length})
            </h3>
            {snapshot.products.map((product, idx) => {
              const qty = selections[idx]?.quantity ?? product.quantity;
              const lineTotal = (product.unit_price_usd || 0) * qty;
              return (
                <div key={idx} className="bg-white border border-slate-200 rounded-lg overflow-hidden print-shadow-none print-border-light">
                  <div className="flex flex-col sm:flex-row">
                    <div className="sm:w-40 h-40 sm:h-auto bg-slate-100 flex-shrink-0 overflow-hidden">
                      {product.photo_url ? (
                        <img src={product.photo_url} alt={product.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center min-h-[140px]">
                          <Package className="h-9 w-9 text-slate-300" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 p-4 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="min-w-0">
                            <h4 className="text-base font-semibold text-slate-900 leading-snug">{product.name}</h4>
                            {product.sku && <p className="italic text-[11px] text-slate-400 mt-0.5">{product.sku}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-lg font-semibold text-slate-900 tabular-nums">
                              {symbol}{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                              {symbol}{(product.unit_price_usd || 0).toFixed(2)} / unit
                            </p>
                          </div>
                        </div>
                        {(product.width_inch || product.weight_kg || product.unit_cbm > 0 || product.box_size) && (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                            {product.width_inch && <span>{product.width_inch}" × {product.depth_inch}" × {product.height_inch}"</span>}
                            {product.weight_kg && <span>{product.weight_kg} kg</span>}
                            {product.unit_cbm > 0 && <span>{product.unit_cbm.toFixed(4)} CBM</span>}
                            {product.box_size && !product.is_assembly && <span className="text-slate-400">Box: {product.box_size}</span>}
                          </div>
                        )}
                        {product.is_assembly && product.components && product.components.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-100">
                            <p className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
                              Includes ({product.components.length} components)
                            </p>
                            <div className="space-y-2">
                              {product.components.map((c, ci) => (
                                <div key={ci} className="flex items-start gap-2 text-xs">
                                  <div className="w-10 h-10 rounded bg-slate-100 flex-shrink-0 overflow-hidden">
                                    {c.photo_url ? (
                                      <img src={c.photo_url} alt={c.name} className="w-full h-full object-cover" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center">
                                        <Package className="h-4 w-4 text-slate-300" />
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2">
                                      <span className="font-medium text-slate-700 truncate">{c.name}</span>
                                      <span className="text-slate-400 tabular-nums shrink-0">×{c.quantity_per_assembly}</span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 mt-0.5">
                                      {c.width_inch && <span className="mr-2">{c.width_inch}" × {c.depth_inch}" × {c.height_inch}"</span>}
                                      {c.box_size && <span className="text-slate-400">Box: {c.box_size}</span>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 pt-3 mt-3 border-t border-slate-100">
                        <Label className="text-xs text-slate-500 font-medium">Qty</Label>
                        <div className="flex items-center border border-slate-200 rounded-md overflow-hidden no-print">
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none hover:bg-slate-50"
                            onClick={() => updateQuantity(idx, -10)} disabled={confirmed || isExpired}>
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <Input className="h-8 w-20 text-center text-sm font-medium border-0 border-x border-slate-200 rounded-none focus-visible:ring-0"
                            type="number" value={qty}
                            onChange={e => setQuantity(idx, parseInt(e.target.value) || 0)}
                            disabled={confirmed || isExpired} min={product.moq || 1} />
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-none hover:bg-slate-50"
                            onClick={() => updateQuantity(idx, 10)} disabled={confirmed || isExpired}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <span className="hidden print:inline text-sm tabular-nums">{qty}</span>
                        {product.moq && product.moq > 1 && (
                          <span className="text-[11px] text-slate-400">MOQ: {product.moq}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-5 sticky top-6 print-sticky-static print-shadow-none print-border-light">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Order Summary</h3>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Products</span><span className="font-medium text-slate-900 tabular-nums">{summary.totalItems}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Total quantity</span><span className="font-medium text-slate-900 tabular-nums">{summary.totalQty.toLocaleString()}</span></div>
                {summary.totalCbm > 0 && (
                  <div className="flex justify-between"><span className="text-slate-500">Total volume</span><span className="font-medium text-slate-900 tabular-nums">{summary.totalCbm.toFixed(2)} CBM</span></div>
                )}
                <div className="border-t border-slate-100 my-2" />
                <div className="flex justify-between items-baseline">
                  <span className="font-semibold text-slate-900">Total</span>
                  <span className="text-xl font-bold text-slate-900 tabular-nums">
                    {symbol}{summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Container fill forecast */}
              {summary.totalCbm > 0 && (
                <div className="mt-5 pt-5 border-t border-slate-100">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                    <Ship className="h-3.5 w-3.5" /> Container Forecast
                  </h4>
                  <div className="space-y-3">
                    {CONTAINERS.map(c => {
                      const f = containerFill(summary.totalCbm, c.cbm);
                      const slotsToShow = Math.min(f.containerCount, 4);
                      const overflow = f.containerCount - slotsToShow;
                      const headline = f.containerCount === 0
                        ? '—'
                        : f.containerCount === 1
                          ? `${f.lastContainerPct.toFixed(0)}% of one ${c.name}`
                          : f.fullContainers === f.containerCount
                            ? `Fills ${f.fullContainers} × ${c.name}`
                            : `${f.fullContainers} full + ${f.lastContainerPct.toFixed(0)}% of #${f.containerCount}`;
                      return (
                        <div key={c.key}>
                          <div className="flex justify-between items-baseline text-xs mb-1.5">
                            <span className="font-medium text-slate-700">{c.name}</span>
                            <span className="tabular-nums text-slate-500">{f.containerCount} ctr</span>
                          </div>
                          <div className="flex gap-1 mb-1">
                            {Array.from({ length: slotsToShow }).map((_, i) => {
                              const isLast = i === slotsToShow - 1 && overflow === 0;
                              const pct = isLast ? f.lastContainerPct : 100;
                              const color = pct >= 100
                                ? 'bg-emerald-500'
                                : (isLast && pct < 40 ? 'bg-amber-500' : 'bg-blue-500');
                              return (
                                <div key={i} className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(pct, 4)}%` }} />
                                </div>
                              );
                            })}
                            {overflow > 0 && (
                              <span className="text-[10px] text-slate-500 self-center px-1">+{overflow} more</span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-500 tabular-nums leading-tight">{headline} · {summary.totalCbm.toFixed(1)} / {c.cbm} CBM each</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="mt-5 pt-5 border-t border-slate-100 space-y-2 no-print">
                <Button variant="outline" className="w-full h-10 gap-2 border-slate-300" onClick={handleDownloadPdf} disabled={downloadingPdf}>
                  {downloadingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloadingPdf ? 'Generating PDF…' : 'Download PDF'}
                </Button>
                {!confirmed && !isExpired && (
                  <Button
                    className="w-full h-11 text-sm font-semibold gap-2 bg-slate-900 text-white hover:bg-slate-800"
                    onClick={() => setConfirmOpen(true)}
                  >
                    <Check className="h-4 w-4" /> Confirm Order
                  </Button>
                )}
                {isExpired && (
                  <p className="text-xs text-red-600 text-center font-medium">This quote has expired.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ============ FOOTER ============ */}
        <footer className="mt-10 pt-6 border-t border-slate-200 text-center text-xs text-slate-500 space-y-1">
          <p>All prices are subject to final confirmation.</p>
          <p>{entity?.name ?? ''}{entity?.name && snapshot.quote_number ? ' · ' : ''}{snapshot.quote_number ?? ''}</p>
        </footer>
      </div>

      {/* ============ CONFIRM DIALOG ============ */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-lg bg-white">
          <DialogHeader>
            <DialogTitle className="text-lg text-slate-900">Confirm Your Order</DialogTitle>
            <DialogDescription className="text-slate-500">Review your selections and provide your details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
              {data.snapshot.products.map((p, i) => {
                const qty = selections[i]?.quantity ?? p.quantity;
                const lineTotal = (p.unit_price_usd || 0) * qty;
                return (
                  <div key={i} className="flex justify-between items-center">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="truncate text-slate-700">{p.name}</span>
                      <span className="text-slate-400 flex-shrink-0">× {qty}</span>
                    </div>
                    <span className="font-semibold text-slate-900 tabular-nums">
                      {symbol}{lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                );
              })}
              <div className="border-t border-slate-200 pt-2 mt-2 flex justify-between font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{symbol}{summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Your name</Label>
                <Input className="h-10" value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Full name" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Email</Label>
                <Input className="h-10" type="email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="email@example.com" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirm} disabled={submitting || !customerName} className="gap-2 bg-slate-900 text-white hover:bg-slate-800">
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
