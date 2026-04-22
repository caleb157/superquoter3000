import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Returns true if the active element is a form input where typing should not
 * trigger global single-letter shortcuts.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export type ShortcutHandlers = {
  onOpenSearch?: () => void;
  onOpenHelp?: () => void;
  onNewItem?: () => void;
};

/**
 * Global keyboard shortcuts:
 *  - ⌘K / Ctrl+K  → search
 *  - ?            → help dialog
 *  - g then i/c/p/t/q/s/v/h → navigate
 *  - n           → new item (page-specific, optional)
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers = {}) {
  const navigate = useNavigate();
  const goPrefixActive = useRef(false);
  const goTimer = useRef<number | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const clearGo = () => {
      goPrefixActive.current = false;
      if (goTimer.current) {
        window.clearTimeout(goTimer.current);
        goTimer.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K — search (works even in inputs)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handlersRef.current.onOpenSearch?.();
        return;
      }

      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ? — help
      if (e.key === '?') {
        e.preventDefault();
        handlersRef.current.onOpenHelp?.();
        return;
      }

      // n — new (page handler decides)
      if (e.key === 'n' && handlersRef.current.onNewItem) {
        e.preventDefault();
        handlersRef.current.onNewItem();
        return;
      }

      // g-prefix navigation
      if (goPrefixActive.current) {
        const dest: Record<string, string> = {
          i: '/',
          c: '/customers',
          p: '/products',
          t: '/tasks',
          q: '/quotes',
          s: '/samples',
          v: '/vendors',
          h: '/',
        };
        const path = dest[e.key.toLowerCase()];
        if (path) {
          e.preventDefault();
          navigate(path);
        }
        clearGo();
        return;
      }

      if (e.key === 'g') {
        goPrefixActive.current = true;
        goTimer.current = window.setTimeout(clearGo, 1200);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearGo();
    };
  }, [navigate]);
}

/**
 * Returns true if the element is currently visible (laid out) and not disabled.
 * Skips rows that belong to the hidden half of a responsive layout (e.g.
 * `md:hidden` cards on desktop) and any row marked aria-disabled / disabled.
 */
function isRowInteractable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  if (el.getAttribute('data-row-nav') === 'disabled') return false;
  // offsetParent is null for elements with display:none (incl. tailwind `hidden`)
  if (el.offsetParent === null && el.tagName !== 'TR') return false;
  // For table rows, fall back to bounding rect since offsetParent is unreliable
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

/**
 * Adds arrow-key navigation across a list of focusable row elements within a
 * container. Up/Down move focus, Home/End jump, Enter/Space activates.
 *
 * - Disabled or hidden rows (e.g. the responsive layout's inactive half) are
 *   skipped automatically so focus stays inside the visible section.
 * - When focus is currently outside the container, Arrow keys are ignored,
 *   keeping mobile/desktop layouts isolated even though both hooks are mounted.
 */
export function useArrowKeyRowNav(
  containerRef: React.RefObject<HTMLElement>,
  selector = '[data-row-nav]',
) {
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) return;

      // Only act if THIS container is currently visible. Skips desktop hook on
      // mobile and vice-versa, even when both hooks are bound globally.
      const containerRect = node.getBoundingClientRect();
      if (containerRect.width === 0 && containerRect.height === 0) return;

      const all = Array.from(node.querySelectorAll<HTMLElement>(selector));
      const items = all.filter(isRowInteractable);
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const focusInside = !!active && node.contains(active);
      const currentIndex = focusInside && active ? items.indexOf(active) : -1;

      // Arrow keys only react when focus is already inside this container;
      // Home/End can jump in from outside.
      const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
      if (isArrow && !focusInside) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[Math.min(items.length - 1, currentIndex + 1)] ?? items[0];
        next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[Math.max(0, currentIndex - 1)] ?? items[items.length - 1];
        prev.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if ((e.key === 'Enter' || e.key === ' ') && currentIndex >= 0) {
        e.preventDefault();
        items[currentIndex].click();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [containerRef, selector]);
}
