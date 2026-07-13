import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, X, CheckCircle2, Copy } from 'lucide-react';
import { STAGE_OPTIONS, STAGE_LABEL, type StageTrack } from '@/components/ProductStagePills';

type Props = {
  selectedIds: string[];
  onClear: () => void;
  onSetStage: (track: StageTrack, stage: string | null) => Promise<void> | void;
  onGenerateQuote: () => void;
  onGenerateSamples: () => void;
  onBulkCosting?: () => void;
  onBulkQuantity?: () => void;
  onBulkSetNpm?: () => void;
  onBulkTargetPrice?: () => void;
  onBulkChemicals?: () => void;
  onBulkSetSource?: () => void;
  onBulkSetType?: () => void;
  onLogRfq?: () => void;
  onLogRfs?: () => void;
  onCopyToInquiry?: () => void;
  onBulkDeleteCogs?: () => void;
};

export function BulkStageActions({
  selectedIds,
  onClear,
  onSetStage,
  onGenerateQuote,
  onGenerateSamples,
  onBulkCosting,
  onBulkQuantity,
  onBulkSetNpm,
  onBulkTargetPrice,
  onBulkChemicals,
  onBulkSetSource,
  onBulkSetType,
  onLogRfq,
  onLogRfs,
  onCopyToInquiry,
  onBulkDeleteCogs,
}: Props) {
  const sampleLabel = selectedIds.length === 1 ? 'Generate Sample' : 'Generate Samples';
  if (selectedIds.length === 0) return null;

  const hasAnyBulkEdit = !!(onBulkQuantity || onBulkCosting || onBulkSetNpm || onBulkTargetPrice || onBulkChemicals || onBulkSetSource || onBulkSetType || onBulkDeleteCogs);
  const hasAnyLog = !!(onLogRfq || onLogRfs);

  const stageSub = (track: StageTrack, label: string) => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {STAGE_OPTIONS[track].map(s => (
          <DropdownMenuItem key={s} onClick={() => onSetStage(track, s)}>
            {STAGE_LABEL[s]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onSetStage(track, null)} className="text-muted-foreground">
          Clear
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  return (
    <div className="sticky top-12 z-20 flex flex-wrap items-center gap-2 bg-card border rounded-md px-3 py-2 shadow-sm">
      <span className="text-sm font-medium">{selectedIds.length} selected</span>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear}>
        <X className="h-3.5 w-3.5" />
      </Button>
      <span className="h-4 w-px bg-border mx-1" />

      {/* Set stage */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
            Set stage <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem onClick={() => onSetStage('sample', 'sampled')}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-2" /> Mark Sampled
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {stageSub('design', 'Design')}
          {stageSub('quote', 'Quote')}
          {stageSub('sample', 'Sample')}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Bulk edit */}
      {hasAnyBulkEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
              Bulk edit <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {onBulkQuantity && <DropdownMenuItem onClick={onBulkQuantity}>Quantity</DropdownMenuItem>}
            {onBulkCosting && <DropdownMenuItem onClick={onBulkCosting}>Costing</DropdownMenuItem>}
            {onBulkSetNpm && <DropdownMenuItem onClick={onBulkSetNpm}>Net profit margin</DropdownMenuItem>}
            {onBulkTargetPrice && <DropdownMenuItem onClick={onBulkTargetPrice}>Target price</DropdownMenuItem>}
            {onBulkChemicals && <DropdownMenuItem onClick={onBulkChemicals}>Finishing chemicals</DropdownMenuItem>}
            {onBulkSetSource && <DropdownMenuItem onClick={onBulkSetSource}>Source location</DropdownMenuItem>}
            {onBulkSetType && <DropdownMenuItem onClick={onBulkSetType}>Product type</DropdownMenuItem>}
            {onBulkDeleteCogs && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onBulkDeleteCogs} className="text-destructive focus:text-destructive">
                  Delete COGS rows…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Log */}
      {hasAnyLog && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
              Log <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {onLogRfq && <DropdownMenuItem onClick={onLogRfq}>RFQ received</DropdownMenuItem>}
            {onLogRfs && <DropdownMenuItem onClick={onLogRfs}>RFS received</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {onCopyToInquiry && (
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onCopyToInquiry}>
          <Copy className="h-3.5 w-3.5" /> Copy to inquiry
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" className="h-8 text-xs" onClick={onGenerateQuote}>Generate Quote</Button>
        <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={onGenerateSamples}>{sampleLabel}</Button>
      </div>
    </div>
  );
}
