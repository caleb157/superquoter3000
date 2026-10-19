import { joinSku, splitSku, type FinishedDraft } from './odoo-bom';

/** Blank bulk fields leave the existing value unchanged. */
export function applyOdooBulkFields(finished: FinishedDraft, prefix: string, hsn: string, taxId: number | null): FinishedDraft {
  const cleanPrefix = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    ...finished,
    ...(cleanPrefix ? { sku: joinSku({ ...splitSku(finished.sku), prefix: cleanPrefix }) } : {}),
    ...(hsn.trim() ? { hsn: hsn.trim() } : {}),
    ...(taxId !== null ? { taxIds: [taxId] } : {}),
  };
}