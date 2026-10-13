// One-click quote from a set of products, shared by the inquiry Products tab and the
// Costing Workspace: inquiry defaults (entity, currency, last Incoterm), lines priced through
// quote-rough, a hardware-library check when needed, then a draft quote opened to edit.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { HardwareSyncDialog } from '@/components/HardwareSyncDialog';
import { getHardwareSyncPlan, applyHardwareSync, type HardwareSyncPlan, type HardwareConflict, type ConflictResolution } from '@/lib/hardware-sync';
import { priceProductLines, resolveQuoteDefaults, type PriceableProduct } from '@/lib/quote-rough';
import type { QuoteProductInput } from '@/lib/quote-creation';

type Pending = { entity: { id: string; name: string }; currency: string; incoterm: string | null; lines: QuoteProductInput[]; plan: HardwareSyncPlan };

export function useGenerateQuote(inquiryId: string | undefined, onCreated?: () => void) {
  const navigate = useNavigate();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const finalize = async (p: Pending, resolved: Array<HardwareConflict & { resolution: ConflictResolution }>) => {
    if (p.plan.newItems.length || resolved.some(r => r.resolution === 'update')) {
      const sync = await applyHardwareSync(p.plan.newItems, resolved);
      if (sync.error) { toast.error('Hardware sync failed: ' + sync.error); return; }
      if (sync.added || sync.updated) toast.success(`Hardware library: +${sync.added} added, ${sync.updated} updated`);
    }
    const { createQuoteSnapshot, defaultValidUntil } = await import('@/lib/quote-creation');
    const result = await createQuoteSnapshot({
      inquiryId: inquiryId!, selectedProducts: p.lines, entityId: p.entity.id,
      validUntil: defaultValidUntil(), currency: p.currency, incoterm: p.incoterm,
    });
    setPending(null);
    if (result.error) { toast.error(result.error); return; }
    toast.success(`Quote draft created with ${p.entity.name} (${p.currency})`);
    onCreated?.();
    if (result.id) navigate(`/quotes/${result.id}`);
  };

  /** Builds a draft quote from these products at their reference prices, sorted by name. */
  const generate = async (products: PriceableProduct[]) => {
    if (!inquiryId || products.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { entity, currency, incoterm } = await resolveQuoteDefaults(inquiryId);
      if (!entity) { toast.error('Set up a Company Entity in Settings before generating quotes.'); return; }
      const lines = await priceProductLines(products, currency);
      const plan = await getHardwareSyncPlan(Array.from(new Set(lines.map(l => l.id))));
      const next = { entity, currency, incoterm, lines, plan };
      // Hardware library conflicts need a decision; the quote is created right after.
      if (plan.newItems.length === 0 && plan.conflicts.length === 0) await finalize(next, []);
      else setPending(next);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const dialog = (
    <HardwareSyncDialog
      open={!!pending}
      plan={pending?.plan ?? null}
      onCancel={() => setPending(null)}
      onConfirm={(resolved) => { if (pending) void finalize(pending, resolved); }}
    />
  );

  return { generate, busy, dialog };
}
