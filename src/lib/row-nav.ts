import type { MouseEvent } from 'react';
import type { NavigateFunction } from 'react-router-dom';

/**
 * Returns onClick / onAuxClick handlers for a non-anchor "row" that should
 * behave like a link: plain click navigates in-app, but cmd/ctrl/shift click
 * and middle-click open the destination in a new tab — matching browser
 * conventions for `<a>` elements.
 *
 * Pass `state` to attach React Router location state (used e.g. for back/
 * breadcrumb origin tracking). Note: state is NOT carried to new tabs —
 * cmd-click recipients always start from a fresh location.
 */
export function rowNavHandlers(
  navigate: NavigateFunction,
  path: string,
  state?: unknown,
) {
  const openNewTab = () => window.open(path, '_blank', 'noopener,noreferrer');
  return {
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        e.preventDefault();
        openNewTab();
        return;
      }
      navigate(path, state !== undefined ? { state } : undefined);
    },
    onAuxClick: (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        openNewTab();
      }
    },
  };
}

export type BreadcrumbOrigin = { label: string; path: string };

/** Common location-state shape attached when navigating from a list. */
export type RowNavState = { from?: BreadcrumbOrigin };
