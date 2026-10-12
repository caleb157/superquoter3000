import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { formatDay, listSheetsForInquiry, type SheetSummary } from '@/lib/vendor-rfq-sheet';

/** The inquiry's vendor RFQ sheets; hidden until the first one is made from the Products tab. */
export function InquiryVendorRfqSheets({ inquiryId, refreshKey }: { inquiryId: string; refreshKey?: number }) {
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listSheetsForInquiry(inquiryId).then(s => { if (!cancelled) setSheets(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [inquiryId, refreshKey]);

  if (sheets.length === 0) return null;
  return (
    <Card className="mt-3">
      <CardContent className="pt-4 space-y-2">
        <h2 className="text-sm font-semibold">Vendor RFQ sheets</h2>
        <div className="divide-y rounded-md border">
          {sheets.map(s => (
            <Link key={s.batchId} to={`/vendor-rfq-sheet/${s.batchId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-muted/50">
              <span className="font-mono text-xs text-muted-foreground">{s.firstNumber}</span>
              <span className="flex-1 min-w-[12rem] truncate">{s.vendors.join(', ')}</span>
              <span className="text-xs text-muted-foreground">
                {s.items} item{s.items === 1 ? '' : 's'} · {s.replied}/{s.vendors.length} replied · {s.picked}/{s.items} picked
                {s.createdAt ? ` · sent ${formatDay(s.createdAt)}` : ''}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
