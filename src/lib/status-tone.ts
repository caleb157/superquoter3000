// Single source of truth for the app's four semantic status tones.
// Every completion-style badge/pill should go through here so light + dark
// stay consistent with the Graphite & Emerald palette.
//
//   complete  → emerald  (success)
//   progress  → amber    (warning / in flight)
//   issue     → red      (destructive / needs review)
//   idle      → graphite (muted / not started)

export type StatusTone = 'complete' | 'progress' | 'issue' | 'idle';

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  complete:
    'bg-emerald-100 text-emerald-700 border-emerald-200 ' +
    'dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/20',
  progress:
    'bg-amber-100 text-amber-800 border-amber-200 ' +
    'dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/20',
  issue:
    'bg-red-100 text-red-700 border-red-200 ' +
    'dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/20',
  idle:
    'bg-muted text-muted-foreground border-border',
};

export function statusToneClass(tone: StatusTone): string {
  return STATUS_TONE_CLASS[tone];
}

// Dot / swatch variant (used inside indicators, timelines).
export const STATUS_TONE_DOT: Record<StatusTone, string> = {
  complete: 'bg-emerald-500',
  progress: 'bg-amber-500',
  issue: 'bg-red-500',
  idle: 'bg-muted-foreground/30',
};
