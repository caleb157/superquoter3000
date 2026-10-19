// Cost lines copied from one SKU, waiting to be pasted onto others (the panel's Copy lines,
// pasted from another SKU's panel or the selection bar). Lives for the browser tab only.
import { useSyncExternalStore } from 'react';

export type CopiedLines = { from: string; lines: any[] };

let copied: CopiedLines | null = null;
const listeners = new Set<() => void>();

export function copyLines(from: string, lines: any[]) {
  copied = lines.length ? { from, lines } : null;
  listeners.forEach(l => l());
}

export function useCopiedLines(): CopiedLines | null {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => copied,
  );
}
