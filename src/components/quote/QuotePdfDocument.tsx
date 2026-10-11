import { Document, Page, Text, View, StyleSheet, Image, Font } from '@react-pdf/renderer';
import { customerPrimary, customerSecondary } from '@/lib/customer-name';

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
  terms?: { key: string; title: string; text: string }[] | null;
  incoterm?: string | null;
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
    discountPercent?: number | null;
    freight?: { mode: 'sea' | 'air'; rate: number; amount: number; total_cbm?: number; total_chargeable_kg?: number; dim_divisor?: number } | null;
  };
}

// ---- Styling: compact, borderless sections so a typical quote fits one page ----
const C = {
  text: '#0f172a',
  muted: '#64748b',
  light: '#94a3b8',
  border: '#e2e8f0',
  bg: '#f1f5f9',
  white: '#ffffff',
};

const CONTAINERS: { key: string; name: string; cbm: number }[] = [
  { key: '20ft', name: '20ft', cbm: 28 },
  { key: '40ft', name: '40ft', cbm: 56 },
  { key: '40fthc', name: '40ft HC', cbm: 68 },
];

function containerFill(totalCbm: number, containerCbm: number) {
  if (totalCbm <= 0) return { containerCount: 0, fullContainers: 0, lastContainerPct: 0 };
  const containerCount = Math.ceil(totalCbm / containerCbm);
  const fullContainers = Math.floor(totalCbm / containerCbm);
  const remainder = Math.max(0, totalCbm - fullContainers * containerCbm);
  const lastContainerPct = remainder > 0 ? (remainder / containerCbm) * 100 : 100;
  return { containerCount, fullContainers, lastContainerPct };
}

const s = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 40,
    paddingHorizontal: 32,
    fontSize: 8.5,
    color: C.text,
    fontFamily: 'Helvetica',
    backgroundColor: C.white,
  },
  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 10, borderBottomWidth: 1.5, borderColor: C.text },
  headerLeft: { flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 1 },
  logo: { width: 38, height: 38, objectFit: 'contain' },
  entityName: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.text },
  entityLegal: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end' },
  docLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.light, letterSpacing: 1.2, textTransform: 'uppercase' },
  quoteNumber: { fontSize: 12, fontFamily: 'Courier-Bold', color: C.text, marginTop: 1 },
  metaLine: { fontSize: 8, color: C.muted, marginTop: 2 },
  metaLineExpired: { fontSize: 8, color: '#dc2626', fontFamily: 'Helvetica-Bold', marginTop: 2 },

  // Three-column info band
  infoBand: { flexDirection: 'row', gap: 18, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: C.border },
  infoCol: { flex: 1 },
  label: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.light, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  line: { fontSize: 8, lineHeight: 1.35 },
  lineMuted: { fontSize: 8, lineHeight: 1.35, color: C.muted },
  dlRow: { flexDirection: 'row' },
  dt: { width: 52, color: C.muted, fontSize: 7.5, lineHeight: 1.35 },
  dd: { flex: 1, fontSize: 8, lineHeight: 1.35 },

  // Key terms strip
  strip: { flexDirection: 'row', gap: 16, paddingVertical: 6, borderBottomWidth: 0.5, borderColor: C.border },

  // Products table
  tableHeader: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg,
    paddingVertical: 4, paddingHorizontal: 6, marginTop: 10,
    fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  productRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderColor: C.border },
  thumb: { width: 38, height: 38, objectFit: 'cover', borderRadius: 2, backgroundColor: C.bg },
  thumbFallback: { width: 38, height: 38, backgroundColor: C.bg, borderRadius: 2 },
  pName: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.text },
  pSku: { fontSize: 7, color: C.light, marginTop: 1 },
  pSpecs: { fontSize: 7, color: C.muted, marginTop: 2, lineHeight: 1.3 },
  pQty: { fontSize: 9, color: C.text, textAlign: 'center' },
  pUnit: { fontSize: 9, color: C.text, textAlign: 'right' },
  pTotal: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.text, textAlign: 'right' },

  // Totals
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 8, gap: 20 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  sumLabel: { color: C.muted, fontSize: 8.5 },
  sumValue: { color: C.text, fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  totalLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 4, marginTop: 3, borderTopWidth: 1, borderColor: C.text },
  totalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.text },
  totalValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.text },

  // Terms
  termsHeading: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 5, paddingBottom: 3, borderBottomWidth: 0.5, borderColor: C.border },
  termsCols: { flexDirection: 'row', gap: 18 },
  clause: { fontSize: 7, lineHeight: 1.35, marginBottom: 3.5, color: '#1e293b' },

  footer: { position: 'absolute', left: 32, right: 32, bottom: 16, fontSize: 7, color: C.light, textAlign: 'center' },
  pageNum: { position: 'absolute', bottom: 16, right: 32, fontSize: 7, color: C.light },
});

const STATUS_PILL: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: '#475569' },
  sent: { label: 'Active', color: '#1d4ed8' },
  viewed: { label: 'Active', color: '#1d4ed8' },
  approved: { label: 'Approved', color: '#047857' },
  expired: { label: 'Expired', color: '#b91c1c' },
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const QuotePdfDocument = ({
  size = 'A4',
  orientation = 'portrait',
  quoteNumber,
  currency,
  validUntil,
  createdAt,
  status,
  paymentTerms,
  terms,
  incoterm,
  notes,
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
    USD: '$', EUR: '€', GBP: '£', JPY: '¥',
    AUD: 'A$', CAD: 'C$', NZD: 'NZ$', SGD: 'S$', HKD: 'HK$',
  };
  const symbol = PDF_SAFE_SYMBOLS[currency] ?? `${currency} `;
  const isExpired = validUntil ? new Date(validUntil) < new Date() : false;
  const statusKey = isExpired ? 'expired' : (status || 'draft');
  const pill = STATUS_PILL[statusKey] ?? STATUS_PILL.draft;

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

  const discountPct = Number(totals.discountPercent || 0);
  const net = totals.totalValue - (totals.totalValue * discountPct) / 100;

  // Terms in two balanced columns; the payment clause follows this quote's own payment terms.
  const clauses = (terms ?? []).map((c, i) => ({
    ...c,
    n: i + 1,
    text: c.key === 'payment' && paymentTerms ? paymentTerms : c.text,
  }));
  const half = Math.ceil(clauses.length / 2);
  const termCols = [clauses.slice(0, half), clauses.slice(half)];

  const containerLine = totals.totalCbm > 0
    ? CONTAINERS.map((c) => {
        const f = containerFill(totals.totalCbm, c.cbm);
        const util = f.fullContainers === f.containerCount
          ? `${f.containerCount} full`
          : f.containerCount === 1 ? `${f.lastContainerPct.toFixed(0)}% of 1` : `${f.fullContainers} full + ${f.lastContainerPct.toFixed(0)}%`;
        return `${c.name}: ${util}`;
      }).join('   ·   ')
    : null;

  return (
    <Document
      title={`Quote ${quoteNumber}`}
      author={entity?.name || 'Quotation'}
      subject={`Quote ${quoteNumber} for ${customerPrimary(customer, 'Customer')}`}
    >
      <Page size={size} orientation={orientation} style={s.page} wrap>
        {/* Header */}
        <View style={s.headerRow} wrap={false}>
          <View style={s.headerLeft}>
            {entity?.logo_url ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={entity.logo_url} style={s.logo} />
            ) : null}
            <View style={{ flexShrink: 1 }}>
              <Text style={s.entityName}>{entity?.name || 'Quotation'}</Text>
              {entity?.legal_name && entity.legal_name !== entity.name && (
                <Text style={s.entityLegal}>{entity.legal_name}</Text>
              )}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docLabel}>Quotation  <Text style={{ color: pill.color }}>{'·'} {pill.label}</Text></Text>
            <Text style={s.quoteNumber}>{quoteNumber || '—'}</Text>
            <Text style={s.metaLine}>Issued {formatDate(createdAt)}</Text>
            <Text style={isExpired ? s.metaLineExpired : s.metaLine}>
              Valid until {formatDate(validUntil)}{isExpired ? ' (expired)' : ''}
            </Text>
          </View>
        </View>

        {/* From / Prepared for / Pay to */}
        <View style={s.infoBand} wrap={false}>
          <View style={s.infoCol}>
            <Text style={s.label}>From</Text>
            {addressLines.map((l, i) => (<Text key={i} style={s.line}>{l}</Text>))}
            {entity?.phone ? <Text style={s.lineMuted}>{entity.phone}</Text> : null}
            {entity?.email ? <Text style={s.lineMuted}>{entity.email}</Text> : null}
            {entity?.website ? <Text style={s.lineMuted}>{entity.website}</Text> : null}
            {entity?.gst_number ? <Text style={s.lineMuted}>GST {entity.gst_number}</Text> : null}
            {entity?.ein_number ? <Text style={s.lineMuted}>EIN {entity.ein_number}</Text> : null}
          </View>
          <View style={s.infoCol}>
            <Text style={s.label}>Prepared for</Text>
            <Text style={[s.line, { fontFamily: 'Helvetica-Bold', fontSize: 9.5 }]}>{customerPrimary(customer, 'Customer')}</Text>
            {customerSecondary(customer) ? <Text style={s.line}>{customerSecondary(customer)}</Text> : null}
            {customer?.email ? <Text style={s.lineMuted}>{customer.email}</Text> : null}
            {(inquiry?.rfq_number || inquiry?.title) ? (
              <Text style={[s.lineMuted, { marginTop: 4 }]}>
                Ref {inquiry?.rfq_number ? <Text style={{ fontFamily: 'Courier', color: C.text }}>{inquiry.rfq_number}</Text> : null}
                {inquiry?.title ? `  ${inquiry.title}` : ''}
              </Text>
            ) : null}
          </View>
          <View style={s.infoCol}>
            <Text style={s.label}>Pay to</Text>
            {entity && (entity.bank_name || entity.account_number) ? (
              <View>
                {entity.bank_name ? <View style={s.dlRow}><Text style={s.dt}>Bank</Text><Text style={s.dd}>{entity.bank_name}</Text></View> : null}
                {entity.bank_branch ? <View style={s.dlRow}><Text style={s.dt}>Branch</Text><Text style={s.dd}>{entity.bank_branch}</Text></View> : null}
                {entity.account_name ? <View style={s.dlRow}><Text style={s.dt}>Account</Text><Text style={s.dd}>{entity.account_name}</Text></View> : null}
                {entity.account_number ? <View style={s.dlRow}><Text style={s.dt}>Account #</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.account_number}</Text></View> : null}
                {!isUS && entity.ifsc_code ? <View style={s.dlRow}><Text style={s.dt}>IFSC</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.ifsc_code}</Text></View> : null}
                {isUS && entity.routing_number ? <View style={s.dlRow}><Text style={s.dt}>Routing #</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.routing_number}</Text></View> : null}
                {entity.swift_code ? <View style={s.dlRow}><Text style={s.dt}>SWIFT</Text><Text style={[s.dd, { fontFamily: 'Courier' }]}>{entity.swift_code}</Text></View> : null}
              </View>
            ) : (
              <Text style={[s.lineMuted, { fontStyle: 'italic' }]}>Bank details available on request.</Text>
            )}
          </View>
        </View>

        {/* Incoterm and payment terms */}
        {(incoterm || paymentTerms) ? (
          <View style={s.strip} wrap={false}>
            {incoterm ? <Text style={s.line}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Incoterm  </Text>{incoterm}</Text> : null}
            {paymentTerms ? <Text style={[s.line, { flex: 1 }]}><Text style={{ fontFamily: 'Helvetica-Bold' }}>Payment  </Text>{paymentTerms}</Text> : null}
          </View>
        ) : null}

        {/* Products */}
        <View style={s.tableHeader} fixed>
          <Text style={{ width: 44 }}>Item</Text>
          <Text style={{ flex: 1, paddingLeft: 6 }}>Description</Text>
          <Text style={{ width: 36, textAlign: 'center' }}>Qty</Text>
          <Text style={{ width: 56, textAlign: 'right' }}>Unit</Text>
          <Text style={{ width: 66, textAlign: 'right' }}>Total</Text>
        </View>

        {products.map((p, idx) => {
          const qty = selections[idx]?.quantity ?? p.quantity;
          const lineTotal = (p.unit_price_usd || 0) * qty;
          const dims = (p.width_inch && p.depth_inch && p.height_inch)
            ? `${p.width_inch}" x ${p.depth_inch}" x ${p.height_inch}"` : null;
          return (
            <View key={idx} style={s.productRow} wrap={false}>
              <View style={{ width: 44 }}>
                {p.photo_url ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image src={p.photo_url} style={s.thumb} />
                ) : (
                  <View style={s.thumbFallback} />
                )}
              </View>
              <View style={{ flex: 1, paddingLeft: 6, paddingRight: 6 }}>
                <Text style={s.pName}>{p.name}{p.is_assembly ? ' (Kit)' : ''}</Text>
                {p.sku ? <Text style={s.pSku}>{p.sku}</Text> : null}
                {p.quote_notes ? <Text style={s.pSpecs}>{p.quote_notes}</Text> : null}
                <Text style={s.pSpecs}>
                  {[
                    dims,
                    p.weight_kg ? `${p.weight_kg} kg` : null,
                    p.unit_cbm > 0 ? `${p.unit_cbm.toFixed(4)} CBM` : null,
                    !p.is_assembly && p.box_size ? `Box: ${p.box_size}` : null,
                    p.moq && p.moq > 1 ? `MOQ ${p.moq}` : null,
                  ].filter(Boolean).join('  ·  ')}
                </Text>
                {p.is_assembly && p.components && p.components.length > 0 ? (
                  <View style={{ marginTop: 3 }}>
                    <Text style={[s.label, { marginBottom: 1 }]}>Includes</Text>
                    {p.components.map((c, ci) => (
                      <Text key={ci} style={s.pSpecs}>
                        {`• ${c.name} ×${c.quantity_per_assembly}`}
                        {c.width_inch && c.depth_inch && c.height_inch ? `  ·  ${c.width_inch}" x ${c.depth_inch}" x ${c.height_inch}"` : ''}
                        {c.box_size ? `  ·  Box: ${c.box_size}` : ''}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={{ width: 36 }}><Text style={s.pQty}>{qty}</Text></View>
              <View style={{ width: 56 }}><Text style={s.pUnit}>{symbol}{fmt(p.unit_price_usd || 0)}</Text></View>
              <View style={{ width: 66 }}><Text style={s.pTotal}>{symbol}{fmt(lineTotal)}</Text></View>
            </View>
          );
        })}

        {/* Totals: shipment facts on the left, money on the right */}
        <View style={s.totalsRow} wrap={false}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Shipment</Text>
            <Text style={s.lineMuted}>
              {totals.totalItems} product{totals.totalItems === 1 ? '' : 's'}  {'·'}  {totals.totalQty.toLocaleString()} pcs
              {totals.totalCbm > 0 ? `  ·  ${totals.totalCbm.toFixed(2)} CBM` : ''}
            </Text>
            {containerLine ? <Text style={[s.lineMuted, { marginTop: 2 }]}>{containerLine}</Text> : null}
            {totals.freight?.total_chargeable_kg ? (
              <Text style={[s.lineMuted, { marginTop: 2 }]}>
                Chargeable weight {Math.round(totals.freight.total_chargeable_kg).toLocaleString()} kg
              </Text>
            ) : null}
            <Text style={[s.lineMuted, { marginTop: 2, fontSize: 6.5, color: C.light }]}>
              Container fill is an estimate from total CBM; it ignores stacking and loading limits.
            </Text>
          </View>
          <View style={{ width: 200 }}>
            {discountPct > 0 ? (
              <>
                <View style={s.sumRow}><Text style={s.sumLabel}>Subtotal</Text><Text style={s.sumValue}>{symbol}{fmt(totals.totalValue)}</Text></View>
                <View style={s.sumRow}><Text style={s.sumLabel}>Discount ({discountPct}%)</Text><Text style={s.sumValue}>-{symbol}{fmt((totals.totalValue * discountPct) / 100)}</Text></View>
              </>
            ) : null}
            <View style={s.totalLine}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalValue}>{symbol}{fmt(net)}</Text>
            </View>
            {totals.freight && totals.freight.amount > 0 ? (
              <View style={[s.sumRow, { marginTop: 3 }]}>
                <Text style={s.sumLabel}>Freight estimate ({totals.freight.mode === 'air' ? 'air' : 'sea'}, rough)</Text>
                <Text style={s.sumValue}>{symbol}{fmt(totals.freight.amount)}</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Quote notes (saved on the quote; previously never printed) */}
        {notes ? (
          <View style={{ marginTop: 8 }} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text style={s.line}>{notes}</Text>
          </View>
        ) : null}

        {/* Terms and policies: two columns, flowing straight after the totals */}
        {clauses.length > 0 ? (
          <View>
            <Text style={s.termsHeading} minPresenceAhead={60}>Terms and Policies</Text>
            <View style={s.termsCols}>
              {termCols.map((col, ci) => (
                <View key={ci} style={{ flex: 1 }}>
                  {col.map((c) => (
                    <Text key={c.key} style={s.clause} wrap={false}>
                      <Text style={{ fontFamily: 'Helvetica-Bold' }}>{c.n}. {c.title}. </Text>{c.text}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </View>
        ) : null}

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
