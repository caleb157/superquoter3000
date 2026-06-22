import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Returns a function that navigates back in browser history when there is
 * in-app history to pop, and otherwise navigates to the provided fallback path.
 *
 * React Router v6 stores an `idx` on `window.history.state` that increments
 * with each in-app navigation. When idx > 0 we can safely go back without
 * leaving the app; otherwise we route to a sensible default.
 */
export function useSmartBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback);
    }
  }, [navigate, fallback]);
}
