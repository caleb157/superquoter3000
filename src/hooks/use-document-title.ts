import { useEffect } from 'react';

const BASE = 'Product HQ';

/**
 * Sets document.title to `${title} · PDHQ` so browser tabs reflect the
 * current inquiry / product / page. Pass null/undefined while loading to
 * keep the previous title (avoids flashing "Untitled").
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · ${BASE}`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}
