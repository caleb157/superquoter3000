import { useState, useCallback, useMemo } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

interface UseSortOptions {
  storageKey?: string;
  defaultColumn?: string;
  defaultDirection?: SortDirection;
}

export function useTableSort<T>(opts?: UseSortOptions) {
  const storageKey = opts?.storageKey;
  const defaultColumn = opts?.defaultColumn ?? null;
  const defaultDirection = opts?.defaultDirection ?? null;

  const [sortColumn, setSortColumn] = useState<string | null>(() => {
    if (storageKey) {
      return localStorage.getItem(`${storageKey}-column`) || defaultColumn;
    }
    return defaultColumn;
  });

  const [sortDirection, setSortDirection] = useState<SortDirection>(() => {
    if (storageKey) {
      const d = localStorage.getItem(`${storageKey}-direction`);
      return d === 'asc' || d === 'desc' ? d : defaultDirection;
    }
    return defaultDirection;
  });

  const toggleSort = useCallback((column: string) => {
    setSortColumn(prev => {
      let newCol: string | null;
      let newDir: SortDirection;

      if (prev !== column) {
        newCol = column;
        newDir = 'asc';
      } else if (sortDirection === 'asc') {
        newCol = column;
        newDir = 'desc';
      } else {
        newCol = null;
        newDir = null;
      }

      setSortDirection(newDir);
      if (storageKey) {
        if (newCol && newDir) {
          localStorage.setItem(`${storageKey}-column`, newCol);
          localStorage.setItem(`${storageKey}-direction`, newDir);
        } else {
          localStorage.removeItem(`${storageKey}-column`);
          localStorage.removeItem(`${storageKey}-direction`);
        }
      }
      return newCol;
    });
  }, [sortDirection, storageKey]);

  const sortItems = useCallback((
    data: T[],
    getters: Record<string, (item: T) => string | number>
  ): T[] => {
    if (!sortColumn || !sortDirection || !getters[sortColumn]) return data;

    const getter = getters[sortColumn];
    return [...data].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      let cmp: number;
      if (typeof va === 'string' && typeof vb === 'string') {
        cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' });
      } else {
        cmp = (va as number) - (vb as number);
      }
      return sortDirection === 'desc' ? -cmp : cmp;
    });
  }, [sortColumn, sortDirection]);

  return { sortColumn, sortDirection, toggleSort, sortItems };
}
