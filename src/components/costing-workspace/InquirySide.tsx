// What sits beside the costing sheet on the inquiry page: the customer quotes (with a
// requote prompt when today's prices have moved off the last quote), the projection at a
// glance, and where the order goes next. The cards only read; edits open the existing
// Quotes and Projection screens in a side sheet, so every field keeps one home.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, FileText, Loader2, PanelRightClose, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { formatMoney, type QuoteCur } from '@/lib/quote-currency';
import { effectiveCertainty, getProjectionDefaults } from '@/lib/projections';
import { loadProjectionDefaults } from '@/lib/projection-defaults';
import { pipelineKind } from '@/lib/master-analytics';
import { roundQuotePrice } from '@/lib/quote-rough';
import type { WorkspaceRow } from '@/lib/costing-workspace';
import { pct } from './cells';

export type SideQuote = { id: string; quote_number: string; status: string | null; totals: any; currency: string | null; created_at: string; sent_at: string | null };
export type SideData = { quotes: SideQuote[]; projection: any | null; status: string };

/** The inquiry's quotes and projection row, for the cards beside the sheet. */
export function useInquirySide(inquiryId: string | undefined) {
  const [data, setData] = useState<SideData | null>(null);
  const load = useCallback(async () => {
    if (!inquiryId) return;
    try {
      const [q, p, i] = await Promise.all([
        (supabase as any).from('quote_snapshots').select('id, quote_number, status, totals, currency, created_at, sent_at')
          .eq('customer_rfq_id', inquiryId).order('created_at', { ascending: false }).limit(20),
        (supabase as any).from('inquiry_projections').select('*').eq('inquiry_id', inquiryId).maybeSingle(),
        (supabase as any).from('customer_rfqs').select('status').eq('id', inquiryId).maybeSingle(),
        loadProjectionDefaults().catch(() => null),
      ]);
      setData({ quotes: q?.data || [], projection: p?.data || null, status: i?.data?.status || 'active' });
    } catch (e) {
      console.error('inquiry side', e);
    }
  }, [inquiryId]);
  useEffect(() => { void load(); }, [load]);
  return { data, reload: load };
}

/** SKUs that would go onto a new quote at a different price from the customer's last one.
 *  Quotes round the price (whole rupees / 5 cents), so today's price is compared after rounding too. */
export const movedSinceQuote = (rows: WorkspaceRow[]) => rows.filter(r => r.quoted && r.price > 0
  && Math.abs(r.price - r.quoted.price) >= 0.005 && Math.abs(roundQuotePrice(r.price, r.cur) - r.quoted.price) >= 0.005);

const day = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const month = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '—');

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="px-3.5 py-3">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        <div className="ml-auto flex items-center gap-1">{action}</div>
      </header>
      {children}
    </section>
  );
}
const Line = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-[3px] text-[13px]">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right font-medium tabular-nums">{children}</span>
  </div>
);

export function InquirySide({ inquiryId, rows, cur, fob, margin, manHours, data, selectedCount, quoting, onGenerate, onRequote, onHold, onAllQuotes, onEditProjection, onCollapse }: {
  inquiryId: string; rows: WorkspaceRow[]; cur: QuoteCur; fob: number; margin: number; manHours: number;
  data: SideData | null; selectedCount: number; quoting?: boolean;
  /** Quote the ticked SKUs, or every SKU when none is ticked. */
  onGenerate: () => void;
  /** New quote for the SKUs that were quoted before, at today's prices. */
  onRequote: (ids: string[]) => void;
  /** Put the moved SKUs back on their quoted price and hold them there. */
  onHold: (ids: string[]) => void;
  onAllQuotes: () => void; onEditProjection: () => void; onCollapse: () => void;
}) {
  const moved = movedSinceQuote(rows);
  const quotedIds = rows.filter(r => r.quoted).map(r => r.p.id);
  const up = moved.filter(r => r.price > r.quoted!.price).length;
  const proj = data?.projection;
  const status = data?.status || 'active';
  const certainty = effectiveCertainty(proj, [], status);
  const kind = pipelineKind(proj?.order_kind, manHours);
  const dflt = getProjectionDefaults();

  return (
    <aside className="flex max-h-full min-h-0 w-[300px] shrink-0 flex-col divide-y divide-border/60 self-start overflow-y-auto rounded-lg border border-border/70 bg-card shadow-sm">
      <Card title="Quotes" action={<>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2.5" disabled={quoting || rows.length === 0} onClick={onGenerate}>
          {quoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          {selectedCount > 0 ? `Quote ${selectedCount} ticked` : 'Generate quote'}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={onCollapse} aria-label="Hide the side cards"><PanelRightClose className="h-4 w-4" /></Button>
      </>}>
        {!data ? <div className="py-2 text-xs text-muted-foreground">Loading…</div>
          : data.quotes.length === 0 ? <div className="py-1 text-sm text-muted-foreground">No quotes yet. Generate one from the prices in the sheet.</div>
          : data.quotes.slice(0, 3).map(q => (
            <Link key={q.id} to={`/quotes/${q.id}`} className="flex items-baseline justify-between gap-2 rounded py-0.5 text-sm hover:text-primary">
              <span className="truncate">{q.quote_number} <span className="text-muted-foreground">· {q.sent_at ? `sent ${day(q.sent_at)}` : `draft ${day(q.created_at)}`}</span></span>
              <span className="shrink-0 font-medium tabular-nums">{typeof q.totals?.grand_total === 'number' ? formatMoney(q.totals.grand_total, (q.currency || 'USD') as QuoteCur, 0) : ''}</span>
            </Link>
          ))}
        {moved.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <div>
              {moved.length} SKU{moved.length === 1 ? '' : 's'} now price{moved.length === 1 ? 's' : ''} differently from the last quote
              {up === moved.length ? ' (all higher)' : up === 0 ? ' (all lower)' : ` (${up} higher, ${moved.length - up} lower)`}.
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 bg-background px-2 text-xs" disabled={quoting} onClick={() => onRequote(quotedIds)}>Requote</Button>
              <Button size="sm" variant="outline" className="h-7 bg-background px-2 text-xs" onClick={() => onHold(moved.map(r => r.p.id))}>Hold quoted prices</Button>
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <button className="inline-flex items-center text-muted-foreground hover:text-foreground" onClick={onAllQuotes}>All quotes <ChevronRight className="h-3 w-3" /></button>
          <Link className="inline-flex items-center text-muted-foreground hover:text-foreground" to={`/inquiry/${inquiryId}?tab=quotes`}>Vendor RFQ sheets <ChevronRight className="h-3 w-3" /></Link>
        </div>
      </Card>

      <Card title="Projection" action={
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-muted-foreground" onClick={onEditProjection}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
      }>
        <Line label="FOB · NPM today">{formatMoney(fob, cur, 0)} · <span className={cn(margin < 0.05 && 'text-destructive')}>{pct(margin)}</span></Line>
        <Line label="Certainty">{pct(certainty, 0)}{proj?.certainty_override == null && <span className="font-normal text-muted-foreground"> auto</span>}</Line>
        <Line label="Weighted">{formatMoney(fob * certainty, cur, 0)}</Line>
        <Line label="Deposit · ships">{month(proj?.cust_deposit_month)} · {month(proj?.shipping_month)}</Line>
        <Line label="Customer deposit">{pct(Number(proj?.cust_deposit_pct ?? dflt.custDeposit), 0)}</Line>
        <Line label="Kind">{kind.kind === 'manufacturing' ? 'Manufacturing' : 'Trading'}{kind.kind_auto && <span className="font-normal text-muted-foreground"> auto</span>}</Line>
      </Card>

      <Card title="After the order">
        {[
          ['Odoo: products, BOM, sales order', `/inquiry/${inquiryId}/odoo`],
          ['Container plan', `/inquiry/${inquiryId}/container-plan`],
          ['Product development view', `/inquiry/${inquiryId}/pd`],
        ].map(([label, to]) => (
          <Link key={to} to={to} className="flex items-center justify-between py-0.5 text-sm text-muted-foreground hover:text-foreground">
            {label} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ))}
      </Card>
    </aside>
  );
}
