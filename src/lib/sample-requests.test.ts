import { describe, it, expect } from 'vitest';
import { computeSampleClock } from './sample-requests';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe('computeSampleClock', () => {
  const req = { requested_date: '2026-10-01' };
  it('counts open samples and received lines, ignoring cancelled ones', () => {
    const c = computeSampleClock(req, [{ status: 'completed', completed_at: at(2026, 10, 3).toISOString() }, { status: 'pending' }, { status: 'cancelled' }], at(2026, 10, 6, 0));
    expect(c.state).toBe('open');
    expect(c.label).toBe('Samples requested 5 d 0 h ago, 1 of 2 received');
    expect(c.tone).toBe('neutral');
  });
  it('turns amber at 10 days and red at 14', () => {
    expect(computeSampleClock(req, [{ status: 'pending' }], at(2026, 10, 11, 0)).tone).toBe('amber');
    expect(computeSampleClock(req, [{ status: 'pending' }], at(2026, 10, 15, 0)).tone).toBe('red');
  });
  it('turns red once the required-by date has passed', () => {
    expect(computeSampleClock({ ...req, required_by_date: '2026-10-03' }, [{ status: 'pending' }], at(2026, 10, 5)).tone).toBe('red');
  });
  it('stops when the last sample is received at the factory', () => {
    const c = computeSampleClock(req, [
      { status: 'completed', completed_at: at(2026, 10, 3, 0).toISOString() },
      { status: 'completed', completed_at: new Date(at(2026, 10, 1, 0).getTime() + 4.5 * 86_400_000).toISOString() },
    ], at(2026, 12, 1));
    expect(c.state).toBe('received');
    expect(c.label).toBe('Samples received in 4.5 days');
    expect(c.tone).toBe('done');
  });
});
