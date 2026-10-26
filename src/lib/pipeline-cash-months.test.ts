import { describe, expect, it } from 'vitest';
import { buildPipeline, pipelineCashItems } from './master-analytics';

const opts = { today: '2026-10-26', pvEntityId: 'pv', defaults: { custDeposit: 0.3, ieDeposit: 0.8 }, live: { a: { fob_usd: 10000, gpm: 0.25, man_hours: 0 } } };
const inquiry = (p: any) => ({ id: 'a', rfq_number: 'RFQ-1', status: 'active', products: [], inquiry_projections: { certainty_override: 1, ...p } });
const months = (p: any) => {
  const items = pipelineCashItems(buildPipeline([inquiry(p)], opts), 90, opts.today);
  const by = (k: string) => items.filter(i => i.kind === k).map(i => i.date.slice(0, 7));
  return { cin: by('pipeline_in'), cout: by('pipeline_out') };
};

describe('pipeline cash months', () => {
  it('pays vendors in the same months the customer pays, even when stored vendor months drifted', () => {
    const m = months({ cust_deposit_month: '2026-12-01', cust_final_month: '2027-03-01', vendor_deposit_month: '2027-01-01', vendor_balance_month: '2027-04-01' });
    expect(m.cin).toEqual(['2026-12', '2027-03']);
    expect(m.cout).toEqual(['2026-12', '2027-03']);
  });
  it('still shows vendor costs when the inquiry has no vendor months or split saved', () => {
    const m = months({ start_month: '2026-11-01', duration_months: 3 });
    expect(m.cout).toEqual(m.cin);
    expect(m.cout.length).toBe(2);
  });
  it('follows the inter-entity schedule when another entity sells', () => {
    const m = months({ selling_entity_id: 'dkt', ie_deposit_month: '2027-01-01', ie_balance_month: '2027-05-01', vendor_deposit_month: '2026-11-01' });
    expect(m.cout).toEqual(['2027-01', '2027-05']);
  });
});
