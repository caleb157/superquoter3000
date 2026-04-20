import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StageTrack = 'design' | 'quote' | 'sample';

export const STAGE_OPTIONS: Record<StageTrack, string[]> = {
  design: ['need_design', 'designed'],
  quote: ['quoting', 'ready_for_quote', 'quoted'],
  sample: ['sampling', 'sample_sent'],
};

export const STAGE_LABEL: Record<string, string> = {
  need_design: 'Need Design',
  designed: 'Designed',
  quoting: 'Quoting',
  ready_for_quote: 'Ready for Quote',
  quoted: 'Quoted',
  sampling: 'Sampling',
  sample_sent: 'Sample Sent',
};

const TERMINAL = new Set(['designed', 'quoted', 'sample_sent']);
const INTERMEDIATE = new Set(['need_design', 'quoting', 'ready_for_quote', 'sampling']);

function stageClass(stage: string | null | undefined): string {
  if (!stage) return 'border border-dashed text-muted-foreground bg-transparent';
  if (TERMINAL.has(stage)) return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
  if (INTERMEDIATE.has(stage)) return 'bg-amber-100 text-amber-700 border border-amber-200';
  return 'bg-muted text-muted-foreground';
}

type PillProps = {
  track: StageTrack;
  value: string | null | undefined;
  onChange: (newStage: string | null) => void;
};

function Pill({ track, value, onChange }: PillProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition hover:opacity-80',
            stageClass(value),
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <span>{value ? STAGE_LABEL[value] ?? value : '—'}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {STAGE_OPTIONS[track].map(s => (
          <DropdownMenuItem key={s} onClick={() => onChange(s)}>
            {STAGE_LABEL[s]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={() => onChange(null)} className="text-muted-foreground">
          Clear
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Props = {
  product: { design_stage?: string | null; quote_stage?: string | null; sample_stage?: string | null };
  onChange: (track: StageTrack, newStage: string | null) => void;
};

export function ProductStagePills({ product, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <Pill track="design" value={product.design_stage} onChange={(s) => onChange('design', s)} />
      <Pill track="quote" value={product.quote_stage} onChange={(s) => onChange('quote', s)} />
      <Pill track="sample" value={product.sample_stage} onChange={(s) => onChange('sample', s)} />
    </div>
  );
}

export function SingleStagePill({ track, value, onChange }: PillProps) {
  return <Pill track={track} value={value} onChange={onChange} />;
}
