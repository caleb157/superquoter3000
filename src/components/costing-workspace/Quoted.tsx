// The last price quoted to the customer for a SKU, and the one-click "make it the target".
// Shown as a grid cell (Margin step) and as a line in the product panel's summary.
import { Link } from 'react-router-dom';
import { Check, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { targetFromQuoted, targetIsQuoted, type Apply, type RowQuoted, type WorkspaceRow } from '@/lib/costing-workspace';
import { inr, money, pct } from './cells';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Nov", or "3 Nov 2025" for another year. */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** "sent 3 Nov" or "draft 3 Nov". */
export const quotedWhen = (q: RowQuoted) => `${q.sent ? 'sent' : 'draft'} ${shortDate(q.at)}`.trim();

/** Today's price against the quoted one, in words: higher in red (the quote is now too low), lower in green. */
function Drift({ row, q }: { row: WorkspaceRow; q: RowQuoted }) {
  const d = row.price - q.price;
  if (Math.abs(d) < 0.005) return <span className="text-muted-foreground">today’s price is the same</span>;
  return (
    <span className={cn('tabular-nums', d > 0 ? 'text-destructive' : 'text-primary')}>
      today’s price is {money(Math.abs(d), row.cur)} ({pct(Math.abs(d) / q.price)}) {d > 0 ? 'higher' : 'lower'}
    </span>
  );
}

/** What the unit cost was when quoted and what it is now. */
function CostThenNow({ row, q }: { row: WorkspaceRow; q: RowQuoted }) {
  if (q.costInrThen == null) return null;
  const d = row.costInr - q.costInrThen;
  return (
    <span className="tabular-nums">
      cost {inr(q.costInrThen)} then, {inr(row.costInr)} now
      {Math.abs(d) >= 0.5 && <span className={d > 0 ? 'text-destructive' : 'text-primary'}> ({d > 0 ? '+' : '−'}{pct(Math.abs(d) / q.costInrThen)})</span>}
    </span>
  );
}

/** Grid cell: quoted price over when it was quoted, with a button that makes it the target. */
export function QuotedCell({ row, apply }: { row: WorkspaceRow; apply?: Apply }) {
  const q = row.quoted;
  if (!q) return <span className="text-muted-foreground/50">—</span>;
  const isTarget = targetIsQuoted(row);
  return (
    <div className="flex w-full items-center justify-end gap-1.5">
      {apply && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button tabIndex={-1} disabled={isTarget} aria-label={isTarget ? 'Quoted price is the target' : 'Make the quoted price the target'}
              onClick={() => apply(b => targetFromQuoted(b, [row], [row.p.id]))}
              className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md border',
                isTarget ? 'border-transparent text-primary' : 'border-border text-muted-foreground hover:border-primary hover:text-primary')}>
              {isTarget ? <Check className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isTarget ? 'The target is this quoted price' : `Make ${money(q.price, row.cur)} the target`}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="min-w-0 cursor-default text-right leading-tight">
            <div className="font-medium tabular-nums">{money(q.price, row.cur)}</div>
            <div className="truncate text-[11px] text-muted-foreground">{quotedWhen(q)}</div>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-0.5 text-xs">
          <div className="font-medium">{q.quoteNumber || 'Quote'} · {quotedWhen(q)}{q.quantity ? ` · ${q.quantity.toLocaleString()} pcs` : ''}</div>
          <div><Drift row={row} q={q} /></div>
          <div><CostThenNow row={row} q={q} /></div>
          {!q.sent && <div className="text-muted-foreground">Not sent to the customer yet.</div>}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Panel line: the last quote in words, today's price against it, and the target button. */
export function QuotedLine({ row, apply }: { row: WorkspaceRow; apply: Apply }) {
  const q = row.quoted;
  if (!q) return null;
  const isTarget = targetIsQuoted(row);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">Last quoted</span>
      <b className="text-base tabular-nums">{money(q.price, row.cur)}</b>
      <Link to={`/quotes/${q.quoteId}`} className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
        {q.quoteNumber || 'Quote'} · {quotedWhen(q)}
      </Link>
      <span className="text-xs"><Drift row={row} q={q} /></span>
      {q.costInrThen != null && <span className="text-xs text-muted-foreground"><CostThenNow row={row} q={q} /></span>}
      <span className="ml-auto">
        {isTarget ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3.5 w-3.5" /> This is the target</span>
        ) : (
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => apply(b => targetFromQuoted(b, [row], [row.p.id]))}>
            <Target className="h-3.5 w-3.5" /> Set as target
          </Button>
        )}
      </span>
    </div>
  );
}
