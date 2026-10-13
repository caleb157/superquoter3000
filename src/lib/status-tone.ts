// Single source of truth for the app's four semantic status tones.
// Every completion-style badge/pill should go through here so light + dark
// stay consistent with the Graphite & Emerald palette.
//
//   complete  → success      (emerald)
//   progress  → warning      (amber, in flight)
//   issue     → destructive  (red, needs review)
//   idle      → muted        (graphite, not started)
// The tokens live in index.css with light and dark values, so no dark: overrides here.

export type StatusTone = 'complete' | 'progress' | 'issue' | 'idle';

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  complete:
    'bg-success/15 text-success border-success/30',
  progress:
    'bg-warning/15 text-warning border-warning/30',
  issue:
    'bg-destructive/15 text-destructive border-destructive/30',
  idle:
    'bg-muted text-muted-foreground border-border',
};

export function statusToneClass(tone: StatusTone): string {
  return STATUS_TONE_CLASS[tone];
}
