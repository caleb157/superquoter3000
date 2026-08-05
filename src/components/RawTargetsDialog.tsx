import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { generateRawPieceRfq, type RawTargetMode } from '@/lib/rfq-generation';

type Row = { name: string; qty: number; target: number };

const DISCOUNT = 0.1;

export function RawTargetsDialog({
  open,
  onOpenChange,
  inquiryId,
  productIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inquiryId: string;
  productIds?: string[];
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [mode, setMode] = useState<RawTargetMode>('raw_piece');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    generateRawPieceRfq(inquiryId, productIds && productIds.length ? productIds : undefined, mode)
      .then((res) => {
        if (cancelled) return;
        setRows(
          res.items
            .filter((i) => (i.estimated_cost || 0) > 0)
            .map((i) => ({ name: i.item_name, qty: i.quantity || 0, target: i.estimated_cost || 0 })),
        );
      })
      .catch((e) => toast.error(e.message || 'Could not compute raw targets'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [open, inquiryId, mode, JSON.stringify(productIds || [])]);


  const isFP = mode === 'finishing_packing';
  const discounted = (t: number) => t * (1 - DISCOUNT);


  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  const namesRow = rows.map((r) => r.name).join('\t');
  const targetsRow = rows.map((r) => Math.round(r.target)).join('\t');
  const discountRow = rows.map((r) => Math.round(discounted(r.target))).join('\t');
  const vendorTable = [
    ['Item', 'Price (INR)'].join('\t'),
    ...rows.map((r) => [r.name, Math.round(discounted(r.target))].join('\t')),
  ].join('\n');


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{isFP ? 'Finishing & packing targets' : 'Raw targets'}</DialogTitle>
          <DialogDescription>
            {isFP
              ? `Back-solved budget for the completed product excluding shipping — all COGS, packing materials, finishing/packing labour and indirect overhead. Excludes shipping and margin. Vendor row discounted by ${Math.round(DISCOUNT * 100)}%.`
              : `Back-solved raw piece price needed to hit each product's target price, plus a vendor-facing row discounted by ${Math.round(DISCOUNT * 100)}%.`}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as RawTargetMode)}>
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="raw_piece" className="flex-1 sm:flex-none">Raw piece</TabsTrigger>
            <TabsTrigger value="finishing_packing" className="flex-1 sm:flex-none">Finishing &amp; packing</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Calculating targets…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground text-sm">
            {isFP
              ? 'No targets available. Products need a target price.'
              : 'No raw targets available. Products need a Raw Piece COGS row and a target price.'}
          </div>
        ) : (
          <>
            <div className="w-full min-w-0 max-h-[45vh] overflow-auto border rounded-md">
              <Table className="w-full min-w-[520px] text-xs">

                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">{isFP ? 'F&P target' : 'Raw target'}</TableHead>

                    <TableHead className="text-right">−{Math.round(DISCOUNT * 100)}% (vendor)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium max-w-[240px] truncate">{r.name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{r.qty}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmt.inr(r.target)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-primary">
                        {fmt.inr(discounted(r.target))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 w-full min-w-0">
              <CopyRow label="Product names" value={namesRow} copied={copied} onCopy={copy} />
              <CopyRow label="Raw targets" value={targetsRow} copied={copied} onCopy={copy} />
              <CopyRow
                label={`Vendor prices (−${Math.round(DISCOUNT * 100)}%)`}
                value={discountRow}
                copied={copied}
                onCopy={copy}
              />
            </div>

            <div className="flex justify-end">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy('Vendor table', vendorTable)}>
                <Copy className="h-3.5 w-3.5" /> Copy vendor table
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CopyRow({
  label, value, copied, onCopy,
}: { label: string; value: string; copied: string | null; onCopy: (l: string, v: string) => void }) {
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <span className="text-xs text-muted-foreground w-24 sm:w-40 shrink-0">{label}</span>

      <code className="flex-1 min-w-0 truncate text-xs bg-muted rounded px-2 py-1.5 font-mono">
        {value.replace(/\t/g, '  ')}
      </code>
      <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => onCopy(label, value)}>
        {copied === label ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}
