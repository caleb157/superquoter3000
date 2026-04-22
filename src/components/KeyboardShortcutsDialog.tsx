import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const SECTIONS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: 'Global',
    items: [
      { keys: ['⌘', 'K'], desc: 'Open global search' },
      { keys: ['Ctrl', 'K'], desc: 'Open global search (Windows/Linux)' },
      { keys: ['?'], desc: 'Show this dialog' },
      { keys: ['Esc'], desc: 'Close dialog or menu' },
    ],
  },
  {
    title: 'Navigation (press G then…)',
    items: [
      { keys: ['G', 'I'], desc: 'Inquiries' },
      { keys: ['G', 'C'], desc: 'Customers' },
      { keys: ['G', 'P'], desc: 'Products' },
      { keys: ['G', 'T'], desc: 'Tasks' },
      { keys: ['G', 'Q'], desc: 'Quotes' },
      { keys: ['G', 'S'], desc: 'Samples' },
      { keys: ['G', 'V'], desc: 'Vendors' },
    ],
  },
  {
    title: 'In lists / tables',
    items: [
      { keys: ['↑', '↓'], desc: 'Move between rows' },
      { keys: ['Home'], desc: 'First row' },
      { keys: ['End'], desc: 'Last row' },
      { keys: ['Enter'], desc: 'Open focused row' },
      { keys: ['Tab'], desc: 'Cycle row actions' },
    ],
  },
  {
    title: 'Pages',
    items: [
      { keys: ['N'], desc: 'New item (where supported)' },
    ],
  },
];

export function KeyboardShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Power-user moves. Press <Kbd>?</Kbd> any time to view.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {SECTIONS.map(s => (
            <div key={s.title}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {s.title}
              </div>
              <ul className="space-y-1.5">
                {s.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between text-sm gap-3">
                    <span className="text-foreground/90">{it.desc}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {it.keys.map((k, ki) => (
                        <Kbd key={ki}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 text-[11px] font-mono font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}
