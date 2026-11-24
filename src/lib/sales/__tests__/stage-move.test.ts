import { describe, expect, it } from 'vitest';
import { canMoveStage, stageMovePatch } from '../sales-core';

describe('canMoveStage (Pipeline drag and drop)', () => {
  it('allows a normal move and treats the same column as nothing to do', () => {
    expect(canMoveStage({ sales_stage: 'responded' }, 'in_conversation').allowed).toBe(true);
    expect(canMoveStage({ sales_stage: 'responded' }, 'responded')).toMatchObject({ allowed: false, noop: true });
  });
  it('never puts a do not contact account back into outreach', () => {
    for (const to of ['queued', 'in_outreach']) {
      expect(canMoveStage({ sales_stage: 'responded', dnc: true }, to).allowed).toBe(false);
      expect(canMoveStage({ sales_stage: 'dnc' }, to).allowed).toBe(false);
    }
    expect(canMoveStage({ sales_stage: 'responded', dnc: true }, 'customer').allowed).toBe(true);
  });
  it('leaves do not contact, Not now and unknown stages to their own controls', () => {
    expect(canMoveStage({ sales_stage: 'queued' }, 'dnc').allowed).toBe(false);
    expect(canMoveStage({ sales_stage: 'queued' }, 'not_now').allowed).toBe(false);
    expect(canMoveStage({ sales_stage: 'queued' }, 'lost').allowed).toBe(false);
  });
});

describe('stageMovePatch (shared with set_sales_stage)', () => {
  it('clears Not now and never writes lead status (the database sets it from the stage)', () => {
    expect(stageMovePatch({ lead_status: 'prospect' }, 'inquiry')).toEqual({ sales_stage: 'inquiry', not_now_until: null });
    expect(stageMovePatch({ lead_status: 'prospect' }, 'customer')).toEqual({ sales_stage: 'customer', not_now_until: null });
    expect(stageMovePatch({ lead_status: 'active' }, 'customer')).toEqual({ sales_stage: 'customer', not_now_until: null });
    expect(stageMovePatch({}, 'not_now', '2027-05-01')).toEqual({ sales_stage: 'not_now', not_now_until: '2027-05-01' });
  });
});
