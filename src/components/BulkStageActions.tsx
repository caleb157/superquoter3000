import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
  onLogRfq?: () => void;
  onLogRfs?: () => void;
  onCopyToInquiry?: () => void;
};

function StageDropdown({ track, label, onSet }: { track: StageTrack; label: string; onSet: (track: StageTrack, stage: string | null) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
          {label} <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {STAGE_OPTIONS[track].map(s => (
          <DropdownMenuItem key={s} onClick={() => onSet(track, s)}>{STAGE_LABEL[s]}</DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onSet(track, null)} className="text-muted-foreground">Clear</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BulkStageActions({ selectedIds, onClear, onSetStage, onGenerateQuote, onGenerateSamples, onBulkCosting, onBulkQuantity, onBulkSetNpm, onLogRfq, onLogRfs, onCopyToInquiry }: Props) {
  const sampleLabel = selectedIds.length === 1 ? 'Generate Sample' : 'Generate Samples';
  if (selectedIds.length === 0) return null;
  return (
    <div className="sticky top-12 z-20 flex flex-wrap items-center gap-2 bg-card border rounded-md px-3 py-2 shadow-sm">
      <span className="text-sm font-medium">{selectedIds.length} selected</span>
      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClear}>
        <X className="h-3.5 w-3.5" />
      </Button>
      <span className="h-4 w-px bg-border mx-1" />
      <StageDropdown track="design" label="Set Design" onSet={onSetStage} />
      <StageDropdown track="quote" label="Set Quote" onSet={onSetStage} />
      <StageDropdown track="sample" label="Set Sample" onSet={onSetStage} />
      <span className="h-4 w-px bg-border mx-1" />
      <Button
        size="sm"
        variant="outline"
        className="h-8 text-xs gap-1"
        onClick={() => onSetStage('sample', 'sampled')}
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Mark Sampled
      </Button>
      {onBulkQuantity && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onBulkQuantity}>Bulk set quantity</Button>
      )}
      {onBulkCosting && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onBulkCosting}>Bulk update costing</Button>
      )}
      {onLogRfq && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onLogRfq}>Log RFQ</Button>
      )}
      {onLogRfs && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onLogRfs}>Log RFS</Button>
      )}
      {onCopyToInquiry && (
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={onCopyToInquiry}>
          <Copy className="h-3.5 w-3.5" /> Copy to inquiry
        </Button>
      )}
      <Button size="sm" className="h-8 text-xs" onClick={onGenerateQuote}>Generate Quote</Button>
      <Button size="sm" variant="secondary" className="h-8 text-xs" onClick={onGenerateSamples}>{sampleLabel}</Button>
    </div>
  );
}
