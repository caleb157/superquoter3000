import { supabase } from '@/integrations/supabase/client';
import { loadProjectionDefaults } from '@/lib/projection-defaults';
import { paymentTermsFromProjection } from '@/lib/quote-terms';

/** Payment terms text for a quote on this inquiry, from its Projection tab split;
 *  inquiries without a saved projection use the Settings default deposit, as the tab does. */
export async function loadProjectionPaymentTerms(inquiryId: string): Promise<string | null> {
  const { data } = await (supabase as any).from('inquiry_projections')
    .select('cust_deposit_pct, cust_other_pct, cust_final_pct').eq('inquiry_id', inquiryId).maybeSingle();
  if (data) return paymentTermsFromProjection(data);
  const d = await loadProjectionDefaults();
  return paymentTermsFromProjection({ cust_deposit_pct: d.custDeposit, cust_final_pct: 1 - d.custDeposit });
}
