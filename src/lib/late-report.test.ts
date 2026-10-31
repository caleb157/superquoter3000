import { describe, it, expect } from 'vitest';
import { buildLateReport, type LateSettings } from './late-report';

const s: LateSettings = { late_start: '09:15', late_end: '09:45', very_late_start: '09:45', very_late_limit: 2, grace_count: 1, penalty_inr: 100, hr_tag: 'Discipline' };
// IST time -> UTC ISO
const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();
const e = (date: string, time: string) => ({ employee_id: 7, employee_name: 'Ravi', check_in: at(date, time) });

describe('late report', () => {
  it('grace forgives a count of late arrivals before the rupee penalty', () => {
    const [r] = buildLateReport([e('2026-10-01', '09:20'), e('2026-10-02', '09:30'), e('2026-10-03', '09:40')], s, '2026-10-01', '2026-10-31');
    expect(r.lateCount).toBe(3);
    expect(r.penaltyInr).toBe(200);
  });
  it('very late arrivals carry no rupee penalty', () => {
    const [r] = buildLateReport([e('2026-10-01', '10:30')], s, '2026-10-01', '2026-10-31');
    expect(r.veryLateCount).toBe(1);
    expect(r.penaltyInr).toBe(0);
  });
  it('each very-late beyond the limit is one warning', () => {
    const days = ['01', '02', '03', '04'].map(d => e(`2026-10-${d}`, '10:00'));
    const [r] = buildLateReport(days, s, '2026-10-01', '2026-10-31');
    expect(r.warnings.map(w => w.date)).toEqual(['2026-10-03', '2026-10-04']);
  });
  it('ignores midnight system check-ins', () => {
    const [r] = buildLateReport([e('2026-10-01', '00:00'), e('2026-10-01', '09:20')], s, '2026-10-01', '2026-10-31');
    expect(r.lateCount).toBe(1);
  });
  it('only the first check-in of the day counts', () => {
    const [r] = buildLateReport([e('2026-10-01', '09:00'), e('2026-10-01', '14:00')], s, '2026-10-01', '2026-10-31') ;
    expect(r).toBeUndefined();
  });
  it('late penalty stands when overlapping very-late window also applies', () => {
    const [r] = buildLateReport([e('2026-10-01', '09:50'), e('2026-10-02', '09:50')], { ...s, late_end: '10:00', grace_count: 0 }, '2026-10-01', '2026-10-31');
    expect(r.penaltyInr).toBe(200);
    expect(r.veryLateCount).toBe(2);
  });
});
