import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';

// ---- Types (kept loose to mirror CustomerQuote.tsx) ----
export interface QuotePdfComponent {
  name: string;
  sku?: string | null;
  quantity_per_assembly: number;
  width_inch?: number | null;
  depth_inch?: number | null;
  height_inch?: number | null;
  box_size?: string | null;
}

export interface QuotePdfProduct {
  name: string;
  sku?: string | null;
  quantity: number;
  unit_price_usd: number;
  unit_cbm: number;
  photo_url?: string | null;
  moq?: number | null;
  width_inch?: number | null;
  depth_inch?: number | null;
  height_inch?: number | null;
  weight_kg?: number | null;
  box_size?: string | null;
  quote_notes?: string | null;
  is_assembly?: boolean;
  components?: QuotePdfComponent[];
}

export interface QuotePdfEntity {
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

export interface QuotePdfCustomer {
  name?: string;
  company?: string | null;
  email?: string | null;
}

export interface QuotePdfInquiry {
  rfq_number?: string | null;
  title?: string | null;
}

export interface QuotePdfProps {
  size?: 'A4' | 'LETTER';
  orientation?: 'portrait' | 'landscape';
  quoteNumber: string;
  currency: string;
  validUntil: string | null;
  createdAt: string | null;
  status: string;
  paymentTerms?: string | null;
  notes?: string | null;
  products: QuotePdfProduct[];
  selections: Record<number, { quantity: number }>;
  entity: QuotePdfEntity | null;
  customer: QuotePdfCustomer | null;
  inquiry: QuotePdfInquiry | null;
  totals: {
    totalItems: number;
    totalQty: number;
    totalCbm: number;
    totalValue: number;
    freight?: { mode: 'sea' | 'air'; rate: number; amount: number; total_cbm?: number; total_chargeable_kg?: number; dim_divisor?: number } | null;
  };
}

// ---- Styling (slate palette, mirrors web view) ----
const C = {
  text: '#0f172a',
  muted: '#64748b',
  light: '#94a3b8',
  border: '#e2e8f0',
  bg: '#f8fafc',
  white: '#ffffff',
  amberBg: '#fffbeb',
  amberBorder: '#fde68a',
  amberText: '#78350f',
  amberLabel: '#b45309',
};

const s = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 28,
    fontSize: 9,
    color: C.text,
    fontFamily: 'Helvetica',
    backgroundColor: C.white,
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    padding: 12,
  },
  headerLeft: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', flexShrink: 1 },
  logo: { width: 44, height: 44, objectFit: 'contain' },
  logoFallback: {
    width: 44, height: 44, backgroundColor: C.bg, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  entityName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.text },
  entityLegal: { fontSize: 8, color: C.muted, marginTop: 2 },
  entityType: { fontSize: 7, color: C.light, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerRight: { alignItems: 'flex-end', gap: 4 },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, fontSize: 7, fontFamily: 'Helvetica-Bold', borderWidth: 1 },
  quoteNumber: { fontSize: 11, fontFamily: 'Courier-Bold', color: C.text },
  metaLine: { fontSize: 8, color: C.muted, marginTop: 2 },
  metaLineExpired: { fontSize: 8, color: '#dc2626', fontFamily: 'Helvetica-Bold', marginTop: 2 },

  // Sections
  section: {
    borderWidth: 1, borderColor: C.border, borderRadius: 6,
    padding: 12, marginTop: 8,
  },
  sectionLabel: {
    fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.light,
    textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6,
  },
  twoCol: { flexDirection: 'row', gap: 16 },
  col: { flex: 1 },

  // Payment terms band
  termsBand: {
    backgroundColor: C.amberBg, borderColor: C.amberBorder, borderWidth: 1,
    borderRadius: 6, padding: 10, marginTop: 8, flexDirection: 'row', gap: 8,
  },
  termsLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.amberLabel, textTransform: 'uppercase', letterSpacing: 0.6 },
  termsText: { fontSize: 9, color: C.amberText, flex: 1 },

  row: { flexDirection: 'row' },
  spaceBetween: { flexDirection: 'row', justifyContent: 'space-between' },

  // Bank dl
  dl: { gap: 3 },
  dlRow: { flexDirection: 'row', gap: 8 },
  dt: { width: 70, color: C.muted, fontSize: 8 },
  dd: { flex: 1, fontSize: 9, color: C.text },

  // Customer card
  custName: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.text },
  custCompany: { fontSize: 9, color: C.text, marginTop: 2 },
  custEmail: { fontSize: 8, color: C.muted, marginTop: 2 },

  // Products table
  productsHeader: {
    flexDirection: 'row',
    backgroundColor: C.bg,
    borderTopLeftRadius: 4, borderTopRightRadius: 4,
    paddingVertical: 6, paddingHorizontal: 8,
    fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.muted,
    textTransform: 'uppercase', letterSpacing: 0.5,
    borderWidth: 1, borderColor: C.border,
  },
  productRow: {
    flexDirection: 'row',
    borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderColor: C.border,
    paddingVertical: 8, paddingHorizontal: 8,
    alignItems: 'flex-start',
  },
  thumb: { width: 56, height: 56, objectFit: 'cover', borderRadius: 3, backgroundColor: C.bg },
  thumbFallback: {
    width: 56, height: 56, backgroundColor: C.bg, borderRadius: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  pName: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.text },
  pSku: { fontSize: 7, color: C.light, fontStyle: 'italic', marginTop: 2 },
  pSpecs: { fontSize: 7, color: C.muted, marginTop: 4 },
  pQty: { fontSize: 10, color: C.text, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  pUnit: { fontSize: 9, color: C.text, textAlign: 'right' },
  pTotal: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.text, textAlign: 'right' },
  pMoq: { fontSize: 7, color: C.light, marginTop: 2 },

  // Summary card
  summaryCard: {
    borderWidth: 1, borderColor: C.border, borderRadius: 6,
    padding: 12, marginTop: 12,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  sumLabel: { color: C.muted, fontSize: 9 },
  sumValue: { color: C.text, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 6 },
  totalLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.text },
  totalValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.text },

  footer: {
    position: 'absolute',
    left: 28, right: 28, bottom: 14,
    fontSize: 7, color: C.light, textAlign: 'center',
  },
  pageNum: {
    position: 'absolute',
    bottom: 14, right: 28,
    fontSize: 7, color: C.light,
  },
});

const STATUS_PILL: Record<string, { label: string; bg: string; border: string; color: string }> = {
  draft: { label: 'Draft', bg: '#f1f5f9', border: '#e2e8f0', color: '#334155' },
  sent: { label: 'Active', bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
  viewed: { label: 'Active', bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
  approved: { label: 'Approved', bg: '#ecfdf5', border: '#a7f3d0', color: '#047857' },
  expired: { label: 'Expired', bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' },
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const Pill = ({ statusKey }: { statusKey: string }) => {
  const p = STATUS_PILL[statusKey] ?? STATUS_PILL.draft;
  return (
    <Text style={[s.pill, { backgroundColor: p.bg, borderColor: p.border, color: p.color }]}>{p.label}</Text>
  );
};

const QuotePdfDocument = ({
  size = 'A4',
  orientation = 'portrait',
  quoteNumber,
  currency,
  validUntil,
  createdAt,
  status,
  paymentTerms,
  products,
  selections,
  entity,
  customer,
  inquiry,
  totals,
}: QuotePdfProps) => {
  // PDF font (Helvetica) is WinAnsi-only, so non-WinAnsi symbols like ₹ render as boxes.
  // Use a whitelist of safe glyphs; fall back to "CODE " prefix for everything else.
  const PDF_SAFE_SYMBOLS: Record<string, string> = {
    USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5',
    AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$',
  };
  const symbol = PDF_SAFE_SYMBOLS[currency] ?? `${currency} `;
  const isExpired = validUntil ? new Date(validUntil) < new Date() : false;
  const statusKey = isExpired ? 'expired' : (status || 'draft');

  const addressLines = [
    entity?.address_line1,
    entity?.address_line2,
    [entity?.city, entity?.state, entity?.postal_code].filter(Boolean).join(', '),
    entity?.country,
  ].filter(Boolean) as string[];

  const country = (entity?.country ?? '').toLowerCase();
  const isUS = country.includes('united states') || country === 'usa' || country === 'us';

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Document
      title={`Quote ${quoteNumber}`}
      author={entity?.name || 'Quotation'}
      subject={`Quote ${quoteNumber} for ${customer?.name || 'Customer'}`}
    >
      <Page size={size} orientation={orientation} style={s.page} wrap>
        {/* Header */}
        <View style={s.headerRow} wrap={false}>
          <View style={s.headerLeft}>
            {entity?.logo_url ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={entity.logo_url} style={s.logo} />
            ) : (
              <View style={s.logoFallback}><Text style={{ color: C.light, fontSize: 14 }}>◼</Text></View>
            )}
            <View style={{ flexShrink: 1 }}>
              <Text style={s.entityName}>{entity?.name || 'Quotation'}</Text>
              {entity?.legal_name && entity.legal_name !== entity.name && (
                <Text style={s.entityLegal}>{entity.legal_name}</Text>
              )}
              {entity?.entity_type && <Text style={s.entityType}>{entity.entity_type}</Text>}
            </View>
          </View>
          <View style={s.headerRight}>
            <Pill statusKey={statusKey} />
            <Text style={s.quoteNumber}>{quoteNumber || '—'}</Text>
            <Text style={s.metaLine}>Issued: {formatDate(createdAt)}</Text>
            <Text style={isExpired ? s.metaLineExpired : s.metaLine}>
              Valid until: {formatDate(validUntil)}{isExpired ? ' (expired)' : ''}
            </Text>
          </View>
        </View>

        {/* Payment terms */}
        {paymentTerms ? (
          <View style={s.termsBand} wrap={false}>
            <Text style={s.termsLabel}>Payment{'\n'}Terms</Text>
            <Text style={s.termsText}>{paymentTerms}</Text>
          </View>
        ) : null}

        {/* Entity address + bank */}
        {entity ? (
          <View style={s.section} wrap={false}>
            <View style={s.twoCol}>
              <View style={s.col}>
                <Text style={s.sectionLabel}>Contact & Address</Text>
                <View style={{ gap: 2 }}>
                  {addressLines.map((l, i) => (<Text key={i} style={{ fontSize: 9 }}>{l}</Text>))}
                  {entity.phone ? <Text style={{ fontSize: 9, color: C.muted, marginTop: 3 }}>Phone: {entity.phone}</Text> : null}
                  {entity.email ? <Text style={{ fontSize: 9, color: C.muted }}>Email: {entity.email}</Text> : null}
                  {entity.website ? <Text style={{ fontSize: 9, color: C.muted }}>{entity.website}</Text> : null}
                  {entity.gst_number ? <Text style={{ fontSize: 8, color: C.muted, marginTop: 3 }}>GST: {entity.gst_number}</Text> : null}
                  {entity.ein_number ? <Text style={{ fontSize: 8, color: C.muted }}>EIN: {entity.ein_number}</Text> : null}
                </View>
              </View>
              <View style={s.col}>
                <Text style={s.sectionLabel}>Banking Details</Text>
                {entity.bank_name || entity.account_number ? (
                  <View style={s.dl}>
                    {entity.bank_name ? <View style={s.dlRow}><Text style={s.dt}>Bank</Text><Text style={s.dd}>{entity.bank_name}</Text></View> : null}
                    {entity.bank_branch ? <View style={s.dlRow}><Text style={s.dt}>Branch</Text><Text style={s.dd}>{entity.bank_branch}</Text></View> : null}
                    {entity.account_name ? <View style={s.dlRow}><Text style={s.dt}>Account name</Text><Text style={s.dd}>{entity.account_name}</Text></View> : null}
                    {entity.account_number ? <View style={s.dlRow}><Text style={s.dt}>Account #</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.account_number}</Text></View> : null}
                    {!isUS && entity.ifsc_code ? <View style={s.dlRow}><Text style={s.dt}>IFSC</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.ifsc_code}</Text></View> : null}
                    {isUS && entity.routing_number ? <View style={s.dlRow}><Text style={s.dt}>Routing #</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.routing_number}</Text></View> : null}
                    {entity.swift_code ? <View style={s.dlRow}><Text style={s.dt}>SWIFT</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.swift_code}</Text></View> : null}
                  </View>
                ) : (
                  <Text style={{ fontSize: 9, color: C.light, fontStyle: 'italic' }}>Bank details available on request.</Text>
                )}
              </View>
            </View>
          </View>
        ) : null}

        {/* Customer */}
        <View style={s.section} wrap={false}>
          <Text style={s.sectionLabel}>Prepared for</Text>
          <View style={s.spaceBetween}>
            <View style={{ flex: 1 }}>
              <Text style={s.custName}>{customer?.name || 'Customer'}</Text>
              {customer?.company ? <Text style={s.custCompany}>{customer.company}</Text> : null}
              {customer?.email ? <Text style={s.custEmail}>{customer.email}</Text> : null}
            </View>
            {(inquiry?.rfq_number || inquiry?.title) ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.sectionLabel, { marginBottom: 2 }]}>Reference</Text>
                {inquiry?.rfq_number ? <Text style={{ fontSize: 9, fontFamily: 'Courier', color: C.text }}>{inquiry.rfq_number}</Text> : null}
                {inquiry?.title ? <Text style={{ fontSize: 9, color: C.muted }}>{inquiry.title}</Text> : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* Products */}
        <View style={{ marginTop: 12 }}>
          <Text style={[s.sectionLabel, { marginBottom: 4 }]}>Products ({products.length})</Text>

          <View style={s.productsHeader} fixed>
            <Text style={{ width: 60 }}>Item</Text>
            <Text style={{ flex: 1, paddingLeft: 8 }}>Description</Text>
            <Text style={{ width: 40, textAlign: 'center' }}>Qty</Text>
            <Text style={{ width: 60, textAlign: 'right' }}>Unit</Text>
            <Text style={{ width: 70, textAlign: 'right' }}>Total</Text>
          </View>

          {products.map((p, idx) => {
            const qty = selections[idx]?.quantity ?? p.quantity;
            const lineTotal = (p.unit_price_usd || 0) * qty;
            const dims = (p.width_inch && p.depth_inch && p.height_inch)
              ? `${p.width_inch}" x ${p.depth_inch}" x ${p.height_inch}"` : null;
            return (
              <View key={idx} style={s.productRow} wrap={false}>
                <View style={{ width: 60 }}>
                  {p.photo_url ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image src={p.photo_url} style={s.thumb} />
                  ) : (
                    <View style={s.thumbFallback}><Text style={{ color: C.light, fontSize: 12 }}>{'\u25A0'}</Text></View>
                  )}
                </View>
                <View style={{ flex: 1, paddingLeft: 8, paddingRight: 6 }}>
                  <Text style={s.pName}>{p.name}{p.is_assembly ? ' (Kit)' : ''}</Text>
                  {p.sku ? <Text style={s.pSku}>{p.sku}</Text> : null}
                  <Text style={s.pSpecs}>
                    {[
                      dims,
                      p.weight_kg ? `${p.weight_kg} kg` : null,
                      p.unit_cbm > 0 ? `${p.unit_cbm.toFixed(4)} CBM` : null,
                      !p.is_assembly && p.box_size ? `Box: ${p.box_size}` : null,
                    ].filter(Boolean).join('  \u00B7  ')}
                  </Text>
                  {p.moq && p.moq > 1 ? <Text style={s.pMoq}>MOQ: {p.moq}</Text> : null}
                  {p.is_assembly && p.components && p.components.length > 0 ? (
                    <View style={{ marginTop: 4, paddingTop: 4, borderTopWidth: 0.5, borderColor: C.border }}>
                      <Text style={{ fontSize: 7, color: C.light, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                        Includes
                      </Text>
                      {p.components.map((c, ci) => (
                        <Text key={ci} style={{ fontSize: 8, color: C.muted, marginTop: 1 }}>
                          {`\u2022 ${c.name} \u00D7${c.quantity_per_assembly}`}
                          {c.width_inch && c.depth_inch && c.height_inch ? `  \u00B7  ${c.width_inch}" x ${c.depth_inch}" x ${c.height_inch}"` : ''}
                          {c.box_size ? `  \u00B7  Box: ${c.box_size}` : ''}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
                <View style={{ width: 40 }}>
                  <Text style={s.pQty}>{qty}</Text>
                </View>
                <View style={{ width: 60 }}>
                  <Text style={s.pUnit}>{symbol}{fmt(p.unit_price_usd || 0)}</Text>
                </View>
                <View style={{ width: 70 }}>
                  <Text style={s.pTotal}>{symbol}{fmt(lineTotal)}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* Summary */}
        <View style={s.summaryCard} wrap={false}>
          <Text style={s.sectionLabel}>Order Summary</Text>
          <View style={s.sumRow}><Text style={s.sumLabel}>Products</Text><Text style={s.sumValue}>{totals.totalItems}</Text></View>
          <View style={s.sumRow}><Text style={s.sumLabel}>Total quantity</Text><Text style={s.sumValue}>{totals.totalQty.toLocaleString()}</Text></View>
          {totals.totalCbm > 0 ? (
            <View style={s.sumRow}><Text style={s.sumLabel}>Total volume</Text><Text style={s.sumValue}>{totals.totalCbm.toFixed(2)} CBM</Text></View>
          ) : null}
          <View style={s.divider} />
          <View style={s.sumRow}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalValue}>{symbol}{fmt(totals.totalValue)}</Text>
          </View>
          {totals.freight && totals.freight.amount > 0 ? (
            <View style={[s.sumRow, { marginTop: 4 }]}>
              <Text style={s.sumLabel}>
                Freight Estimate (Rough) · {totals.freight.mode === 'air' ? 'Air' : 'Sea'}
              </Text>
              <Text style={s.sumValue}>{symbol}{fmt(totals.freight.amount)}</Text>
            </View>
          ) : null}
        </View>

        {/* Footer */}
        <Text style={s.footer} fixed>
          All prices are subject to final confirmation.
          {entity?.name ? `  ·  ${entity.name}` : ''}
          {quoteNumber ? `  ·  ${quoteNumber}` : ''}
        </Text>
        <Text
          style={s.pageNum}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
};

export default QuotePdfDocument;
