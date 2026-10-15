// Small inline-edit fields for DKT Cash Flow. Each keeps what's typed locally and saves on blur
// (or Enter), so a half-typed number never reaches the forecast or the database.
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Month } from '@/lib/dkt-cashflow';

export const fieldCls =
  'h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring disabled:opacity-60';

export const usd = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
export const usdK = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k` : `$${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
};

type NumProps = {
  value: number | null;
  onSave: (n: number | null) => void;
  label: string;
  className?: string;
  /** Show and type as a percent while storing a 0..1 fraction. */
  percent?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  integer?: boolean;
};

const shown = (v: number | null, percent?: boolean) =>
  v == null || !Number.isFinite(v) ? '' : String(percent ? Math.round(v * 10000) / 100 : Math.round(v * 100) / 100);

export function NumField({ value, onSave, label, className, percent, allowEmpty, placeholder, integer }: NumProps) {
  const [text, setText] = useState(shown(value, percent));
  useEffect(() => setText(shown(value, percent)), [value, percent]);
  const commit = () => {
    const t = text.replace(/[$,%\s]/g, '');
    if (t === '') {
      if (allowEmpty) { if (value != null) onSave(null); } else setText(shown(value, percent));
      return;
    }
    let n = Number(t);
    if (!Number.isFinite(n)) { setText(shown(value, percent)); return; }
    if (integer) n = Math.round(n);
    const next = percent ? n / 100 : n;
    if (value == null || Math.abs(next - value) > 1e-9) onSave(next);
  };
  return (
    <div className={cn('relative', className)}>
      <input
        aria-label={label}
        inputMode="decimal"
        placeholder={placeholder}
        className={cn(fieldCls, 'w-full tabular-nums text-right', percent && 'pr-6')}
        value={text}
        onFocus={e => e.target.select()}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {percent && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>}
    </div>
  );
}

export function TextField({ value, onSave, label, className, placeholder }: {
  value: string | null; onSave: (s: string) => void; label: string; className?: string; placeholder?: string;
}) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      className={cn(fieldCls, 'w-full', className)}
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text !== (value ?? '')) onSave(text); }}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

export function MonthField({ value, onSave, label, className, allowEmpty }: {
  value: Month | null; onSave: (m: Month | null) => void; label: string; className?: string; allowEmpty?: boolean;
}) {
  return (
    <input
      type="month"
      aria-label={label}
      className={cn(fieldCls, 'w-[8.5rem]', className)}
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value || null;
        if (!v && !allowEmpty) return;
        if (v !== value) onSave(v);
      }}
    />
  );
}

export function SelectField<T extends string>({ value, options, onSave, label, className }: {
  value: T; options: { value: T; label: string }[]; onSave: (v: T) => void; label: string; className?: string;
}) {
  return (
    <select aria-label={label} className={cn(fieldCls, 'pr-6', className)} value={value} onChange={e => onSave(e.target.value as T)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'success' | 'warning' | 'destructive' }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('text-base font-semibold tabular-nums truncate', tone === 'success' && 'text-success', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}
