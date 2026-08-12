// Single source of truth for COGS categories (mirrors the `cogs_categories` table).
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Fallback order — matches cogs_categories.sort_order. */
export const COGS_CATEGORY_FALLBACK = [
  'Raw Piece',
  'Wood',
  'Finishing Materials',
  'Inserts + Instructions',
  'Handles + Knobs',
  'Feet/Buffers',
  'Handles/Latches',
  'Other Hardware',
  'Accessories',
  'Subcontracting',
  'Packaging',
  'Components',
  'Other',
];

/** Categories that behave like "hardware" (price library, hardware RFQ, priced-qty defaults). */
export const HARDWARE_COGS_TYPES = [
  'Inserts + Instructions',
  'Handles + Knobs',
  'Feet/Buffers',
  'Handles/Latches',
  'Other Hardware',
  'Accessories',
];

/** Legacy rows may still carry the old single 'Hardware' type. */
export const HARDWARE_COGS_TYPES_WITH_LEGACY = [...HARDWARE_COGS_TYPES, 'Hardware'];

export const isHardwareCogsType = (t?: string | null) =>
  !!t && HARDWARE_COGS_TYPES_WITH_LEGACY.includes(t);

/** Loads category names from the database, falling back to the static list. */
export function useCogsCategories(): string[] {
  const [names, setNames] = useState<string[]>(COGS_CATEGORY_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('cogs_categories')
        .select('name, sort_order')
        .order('sort_order', { ascending: true });
      if (!cancelled && data && data.length > 0) setNames(data.map((r: any) => r.name));
    })();
    return () => { cancelled = true; };
  }, []);
  return names;
}
