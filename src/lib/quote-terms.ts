export type QuoteClause = { key: string; title: string; text: string };

// Built-in terms and policies (from the agreed "Quote terms draft"; clauses cut there are omitted).
// A selling entity can override the whole list through company_entities.default_terms.
// Payment is filled from the quote's own payment terms because it varies by customer.
export const DEFAULT_QUOTE_CLAUSES: QuoteClause[] = [
  { key: 'validity', title: 'Validity', text: 'Prices are valid for 30 days from the quote date. After that we re-quote, because raw material costs change.' },
  { key: 'incoterm', title: 'Currency and Incoterm', text: 'Prices are in US dollars, FOB Nhava Sheva (Mumbai), unless stated otherwise. EXW, CIF or DDU/DAP can be quoted on request.' },
  { key: 'payment', title: 'Payment', text: '30% deposit to start production; 70% balance on shipment from our factory.' },
  { key: 'lead_time', title: 'Lead time', text: '60 days, counted from the later of deposit received and final sample approved.' },
  { key: 'rush', title: 'Rush orders', text: 'Lead times under 40 days are rush orders and carry a 5% premium.' },
  { key: 'sample_first', title: 'Approved sample first', text: 'Mass production starts only after you approve a final physical sample, including on rush orders.' },
  { key: 'samples', title: 'Samples', text: 'We make at least 2 samples: one for you and one kept at our factory as the production reference. Samples are charged at 2× the bulk price, and the premium is credited against your bulk order. Allow up to 2 weeks.' },
  { key: 'moq', title: 'Minimum order', text: 'Quoted MOQs apply. A first order below MOQ is possible with a 10–15% surcharge, depending on the item.' },
  { key: 'spec', title: 'Specification', text: 'This quote, plus any changes agreed in writing, is the specification we build to. Please check sizes, finishes and quantities before you order.' },
  { key: 'changes', title: 'Changes after approval', text: 'Changes to design, size or finish after sample approval can change price and lead time. Work already done to the earlier specification is charged.' },
  { key: 'added_items', title: 'Added items', text: 'Items added after your PO are a new order with their own deposit and lead time. We will try to ship them together.' },
  { key: 'colour', title: 'Colour matching', text: 'Send colour targets as a physical swatch or a Pantone code. Screen and photo colours are not reliable references.' },
  { key: 'delays', title: 'Delays', text: 'Finishing slows in monsoon humidity, and supplier delays can move dates. We will tell you as soon as a date is at risk.' },
  { key: 'packaging', title: 'Packaging', text: 'Standard export cartons are included. Retail boxes, custom printing and crating are quoted separately.' },
  { key: 'shipping', title: 'Shipping', text: 'FCL and LCL usually take 45–60 days from our warehouse. Door-to-door management is available for $200 (FCL), $100 (LCL) or $50 (air). Samples and small shipments can go on our DHL and UPS accounts.' },
  { key: 'risk', title: 'Risk and insurance', text: 'Risk passes to you at the agreed Incoterm point (on board at Nhava Sheva for FOB). We recommend cargo insurance.' },
  { key: 'duties', title: 'Duties and taxes', text: 'Import duties, tariffs and destination taxes are paid by the buyer.' },
  { key: 'inspection', title: 'Inspection', text: 'You are welcome to inspect before shipment. We can suggest independent QC agencies or run a live video walk-through.' },
  { key: 'claims', title: 'Claims', text: 'Report damage or defects within [14] days of delivery, with photos and carton marks. Agreed claims are settled by replacement or credit on your next order.' },
  { key: 'ip', title: 'Designs and IP', text: 'Your designs stay yours and confidential, and we will sign an NDA on request. Designs we originate remain ours and may be offered to other buyers.' },
  { key: 'approvals', title: 'Approvals', text: 'Approvals by email or WhatsApp are binding. Please name one person to approve specifications and samples.' },
  { key: 'ship_details', title: 'Shipping details', text: 'Send consignee, buyer and notify-party details before shipment, so documents are not delayed.' },
];

/** Clauses to snapshot onto a new quote: the entity template if set, else the defaults,
 *  with the payment clause replaced by this PI's payment terms when given. */
export function buildQuoteClauses(entityTemplate: unknown, paymentTerms?: string | null): QuoteClause[] {
  const base: QuoteClause[] = Array.isArray(entityTemplate) && entityTemplate.length > 0
    ? (entityTemplate as QuoteClause[])
    : DEFAULT_QUOTE_CLAUSES;
  const pay = paymentTerms?.trim();
  return base.map(c => (c.key === 'payment' && pay ? { ...c, text: pay } : { ...c }));
}

type ProjectionTerms = { cust_deposit_pct?: number | null; cust_other_pct?: number | null; cust_final_pct?: number | null };

/** Readable payment terms from an inquiry projection's customer split (fractions, 0.3 = 30%),
 *  e.g. "30% deposit, 70% before shipment". Final defaults to whatever deposit and other leave. */
export function paymentTermsFromProjection(p: ProjectionTerms | null | undefined): string | null {
  if (!p) return null;
  const pct = (n: number) => Math.round(n * 100);
  const deposit = Math.max(0, Number(p.cust_deposit_pct) || 0);
  const other = Math.max(0, Number(p.cust_other_pct) || 0);
  const final = p.cust_final_pct != null ? Math.max(0, Number(p.cust_final_pct) || 0) : Math.max(0, 1 - deposit - other);
  if (pct(deposit) >= 100 && pct(other) === 0 && pct(final) === 0) return '100% in advance';
  const parts: string[] = [];
  if (pct(deposit) > 0) parts.push(`${pct(deposit)}% deposit`);
  if (pct(other) > 0) parts.push(`${pct(other)}% during production`);
  if (pct(final) > 0) parts.push(`${pct(final)}% before shipment`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** The list a quote would use for an entity: its own if set, else the built-in defaults. */
export function effectiveQuoteClauses(entityTemplate: unknown): QuoteClause[] {
  return Array.isArray(entityTemplate) && entityTemplate.length > 0 ? (entityTemplate as QuoteClause[]) : DEFAULT_QUOTE_CLAUSES;
}

/** Plain-words changelog lines between two terms lists, matched by clause key,
 *  e.g. 'Added "Warranty"', 'Changed the text of "Lead time"'. Empty when nothing changed. */
export function diffQuoteTerms(before: QuoteClause[], after: QuoteClause[]): string[] {
  const lines: string[] = [];
  const prev = new Map(before.map(c => [c.key, c]));
  const next = new Map(after.map(c => [c.key, c]));
  const name = (c: QuoteClause) => `"${c.title.trim() || 'Untitled'}"`;
  for (const c of after) if (!prev.has(c.key)) lines.push(`Added ${name(c)}`);
  for (const c of before) if (!next.has(c.key)) lines.push(`Removed ${name(c)}`);
  for (const c of after) {
    const old = prev.get(c.key);
    if (!old) continue;
    if (old.title.trim() !== c.title.trim()) lines.push(`Renamed ${name(old)} to ${name(c)}`);
    if (old.text.trim() !== c.text.trim()) lines.push(`Changed the text of ${name(c)}`);
  }
  const kept = (list: QuoteClause[], other: Map<string, QuoteClause>) => list.filter(c => other.has(c.key)).map(c => c.key).join('|');
  if (kept(before, next) !== kept(after, prev)) lines.push('Changed the order');
  return lines;
}
