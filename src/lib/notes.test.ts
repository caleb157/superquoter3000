import { describe, expect, it } from 'vitest';
import { addHrWorker, hrWorkers } from './notes';

describe('HR workers', () => {
  it('retains multiple workers on one note', () => {
    const workers = addHrWorker([{ id: 1, name: 'Worker A' }], { id: 2, name: 'Worker B' });
    expect(hrWorkers({ employees: workers, employee_odoo_id: 1, employee_name: 'Worker A' })).toEqual([{ id: 1, name: 'Worker A' }, { id: 2, name: 'Worker B' }]);
  });
  it('does not add the same worker twice', () => {
    expect(addHrWorker([{ id: 1, name: 'Worker A' }], { id: 1, name: 'Worker A' })).toHaveLength(1);
  });
  it('preserves legacy single-worker notes', () => {
    expect(hrWorkers({ employee_odoo_id: 3, employee_name: 'Worker C' })).toEqual([{ id: 3, name: 'Worker C' }]);
  });
});