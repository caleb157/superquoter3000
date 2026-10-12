import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import { formatDay } from '@/lib/vendor-rfq-sheet';

export interface VendorRfqPdfLine {
  name: string;
  sku?: string | null;
  photo_url?: string | null;
  dimensions?: string | null;
  finish?: string | null;
  description?: string | null;
  notes?: string | null;
  quantity: number;
  units?: string | null;
  target_price?: number | null;
}

export interface VendorRfqPdfEntity {
  name?: string | null;
  legal_name?: string | null;
  logo_url?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  gst_number?: string | null;
}

export interface VendorRfqPdfProps {
  rfqNumber: string;
  date: string | null;
  replyBy: string | null;
  vendor: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null };
  entity: VendorRfqPdfEntity | null;
  contactName?: string | null;
  inquiryLabel?: string | null;
  notes?: string | null;
  showTarget: boolean;
  lines: VendorRfqPdfLine[];
}

const C = { text: '#0f172a', muted: '#64748b', light: '#94a3b8', border: '#e2e8f0', bg: '#f1f5f9', white: '#ffffff' };

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 40, paddingHorizontal: 32, fontSize: 8.5, color: C.text, fontFamily: 'Helvetica', backgroundColor: C.white },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 10, borderBottomWidth: 1.5, borderColor: C.text },
  headerLeft: { flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 1 },
  logo: { width: 38, height: 38, objectFit: 'contain' },
  entityName: { fontSize: 15, fontFamily: 'Helvetica-Bold' },
  entityLegal: { fontSize: 8, color: C.muted, marginTop: 1 },
  headerRight: { alignItems: 'flex-end' },
  docLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.light, letterSpacing: 1.2, textTransform: 'uppercase' },
  number: { fontSize: 12, fontFamily: 'Courier-Bold', marginTop: 1 },
  meta: { fontSize: 8, color: C.muted, marginTop: 2 },
  replyBy: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 3 },
  band: { flexDirection: 'row', gap: 18, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: C.border },
  col: { flex: 1 },
  label: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.light, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  line: { fontSize: 8, lineHeight: 1.35 },
  lineMuted: { fontSize: 8, lineHeight: 1.35, color: C.muted },
  ask: { fontSize: 8.5, marginTop: 10, lineHeight: 1.4 },
  th: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg, paddingVertical: 4, paddingHorizontal: 6, marginTop: 8, fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderColor: C.border },
  thumb: { width: 54, height: 54, objectFit: 'cover', borderRadius: 2 },
  thumbFallback: { width: 54, height: 54, backgroundColor: C.bg, borderRadius: 2 },
  pName: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  pSub: { fontSize: 7, color: C.muted, marginTop: 2, lineHeight: 1.3 },
  num: { fontSize: 9, textAlign: 'right' },
  blank: { height: 18, borderBottomWidth: 0.75, borderColor: C.light, marginLeft: 6 },
  notesHeading: { fontSize: 9, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 4 },
  footer: { position: 'absolute', left: 32, right: 32, bottom: 16, fontSize: 7, color: C.light, textAlign: 'center' },
  pageNum: { position: 'absolute', bottom: 16, right: 32, fontSize: 7, color: C.light },
});

// Helvetica is WinAnsi-only, so ₹ would print as a box; prices print as "Rs".
const rs = (n: number) => `Rs ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const W = { n: 18, photo: 62, item: 0, size: 82, qty: 46, target: 58, price: 66, lead: 56 };

const VendorRfqPdfDocument = ({ rfqNumber, date, replyBy, vendor, entity, contactName, inquiryLabel, notes, showTarget, lines }: VendorRfqPdfProps) => {
  const address = [
    entity?.address_line1, entity?.address_line2,
    [entity?.city, entity?.state, entity?.postal_code].filter(Boolean).join(', '), entity?.country,
  ].filter(Boolean) as string[];

  return (
    <Document title={`RFQ ${rfqNumber}`}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            {entity?.logo_url ? <Image src={entity.logo_url} style={s.logo} /> : null}
            <View>
              <Text style={s.entityName}>{entity?.name || 'Request for quotation'}</Text>
              {entity?.legal_name && entity.legal_name !== entity.name ? <Text style={s.entityLegal}>{entity.legal_name}</Text> : null}
            </View>
          </View>
          <View style={s.headerRight}>
            <Text style={s.docLabel}>Request for quotation</Text>
            <Text style={s.number}>{rfqNumber}</Text>
            {date ? <Text style={s.meta}>Date {formatDay(date)}</Text> : null}
            {replyBy ? <Text style={s.replyBy}>Please reply by {formatDay(replyBy)}</Text> : null}
          </View>
        </View>

        <View style={s.band}>
          <View style={s.col}>
            <Text style={s.label}>To</Text>
            <Text style={[s.line, { fontFamily: 'Helvetica-Bold' }]}>{vendor.name || 'Vendor'}</Text>
            {vendor.address ? <Text style={s.lineMuted}>{vendor.address}</Text> : null}
            {vendor.phone ? <Text style={s.lineMuted}>{vendor.phone}</Text> : null}
            {vendor.email ? <Text style={s.lineMuted}>{vendor.email}</Text> : null}
          </View>
          <View style={s.col}>
            <Text style={s.label}>From</Text>
            {contactName ? <Text style={[s.line, { fontFamily: 'Helvetica-Bold' }]}>{contactName}</Text> : null}
            {address.map((a, i) => <Text key={i} style={s.lineMuted}>{a}</Text>)}
            {entity?.gst_number ? <Text style={s.lineMuted}>GSTIN {entity.gst_number}</Text> : null}
          </View>
          <View style={s.col}>
            <Text style={s.label}>Reply to</Text>
            {entity?.phone ? <Text style={s.line}>{entity.phone}</Text> : null}
            {entity?.email ? <Text style={s.line}>{entity.email}</Text> : null}
            {inquiryLabel ? <Text style={[s.lineMuted, { marginTop: 4 }]}>Ref. {inquiryLabel}</Text> : null}
          </View>
        </View>

        <Text style={s.ask}>
          Please quote your price per piece and lead time for each item below{replyBy ? `, by ${formatDay(replyBy)}` : ''}. Sizes are in inches (W x D x H).
        </Text>

        <View style={s.th} fixed>
          <Text style={{ width: W.n }}>#</Text>
          <Text style={{ width: W.photo }}>Photo</Text>
          <Text style={{ flex: 1 }}>Item</Text>
          <Text style={{ width: W.size }}>Size</Text>
          <Text style={{ width: W.qty, textAlign: 'right' }}>Qty</Text>
          {showTarget ? <Text style={{ width: W.target, textAlign: 'right' }}>Target</Text> : null}
          <Text style={{ width: W.price, textAlign: 'right' }}>Your price</Text>
          <Text style={{ width: W.lead, textAlign: 'right' }}>Lead time</Text>
        </View>
        {lines.map((l, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ width: W.n, fontSize: 8, color: C.muted }}>{i + 1}</Text>
            <View style={{ width: W.photo }}>
              {l.photo_url ? <Image src={l.photo_url} style={s.thumb} /> : <View style={s.thumbFallback} />}
            </View>
            <View style={{ flex: 1, paddingRight: 6 }}>
              <Text style={s.pName}>{l.name}</Text>
              {l.sku ? <Text style={s.pSub}>SKU {l.sku}</Text> : null}
              {l.finish ? <Text style={s.pSub}>Finish: {l.finish}</Text> : null}
              {l.description ? <Text style={s.pSub}>{l.description}</Text> : null}
              {l.notes ? <Text style={s.pSub}>{l.notes}</Text> : null}
            </View>
            <Text style={{ width: W.size, fontSize: 8 }}>{l.dimensions || '—'}</Text>
            <Text style={[s.num, { width: W.qty }]}>{l.quantity.toLocaleString('en-IN')} {l.units && l.units !== 'pc' ? l.units : ''}</Text>
            {showTarget ? <Text style={[s.num, { width: W.target }]}>{l.target_price ? rs(l.target_price) : '—'}</Text> : null}
            <View style={{ width: W.price }}><View style={s.blank} /></View>
            <View style={{ width: W.lead }}><View style={s.blank} /></View>
          </View>
        ))}

        {notes ? (
          <View wrap={false}>
            <Text style={s.notesHeading}>Notes</Text>
            <Text style={s.line}>{notes}</Text>
          </View>
        ) : null}

        <Text style={s.footer} fixed>
          {[entity?.name, entity?.phone, entity?.email].filter(Boolean).join('  ·  ')}
        </Text>
        <Text style={s.pageNum} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} fixed />
      </Page>
    </Document>
  );
};

export default VendorRfqPdfDocument;
