// Late Report math. Sign-in = first Odoo check-in per employee per IST day.
// Late window [late_start, late_end) -> penalty (after grace_count forgiven).
// Very late (>= very_late_start) -> warnings only; every very-late beyond the limit is one warning.
// An arrival can be both late and very late when the windows overlap; each count stands on its own.

export interface LateSettings {
  late_start: string; late_end: string; very_late_start: string;
  very_late_limit: number; grace_count: number; penalty_inr: number; hr_tag: string;
}
export interface AttendanceEntry { employee_id: number; employee_name: string; check_in: string }
export interface Arrival { date: string; time: string; late: boolean; veryLate: boolean }
export interface Warning { number: number; date: string; time: string; key: string }
export interface EmployeeLateRow {
  employeeId: number; employeeName: string; arrivals: Arrival[];
  lateCount: number; chargeableLate: number; penaltyInr: number;
  veryLateCount: number; warnings: Warning[];
}

const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };

/** IST calendar date + HH:MM for a UTC ISO timestamp. */
export function toIst(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + 330 * 60000).toISOString();
  return { date: d.slice(0, 10), time: d.slice(11, 16) };
}

export function buildLateReport(entries: AttendanceEntry[], s: LateSettings, from: string, to: string): EmployeeLateRow[] {
  const first = new Map<string, { e: AttendanceEntry; date: string; time: string }>();
  for (const e of entries) {
    const { date, time } = toIst(e.check_in);
    const k = `${e.employee_id}|${date}`;
    const cur = first.get(k);
    if (!cur || time < cur.time) first.set(k, { e, date, time });
  }
  const byEmp = new Map<number, EmployeeLateRow>();
  const ls = mins(s.late_start), le = mins(s.late_end), vs = mins(s.very_late_start);
  for (const { e, date, time } of [...first.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = mins(time);
    const late = t >= ls && t < le;
    const veryLate = t >= vs;
    let row = byEmp.get(e.employee_id);
    if (!row) {
      row = { employeeId: e.employee_id, employeeName: e.employee_name, arrivals: [], lateCount: 0, chargeableLate: 0, penaltyInr: 0, veryLateCount: 0, warnings: [] };
      byEmp.set(e.employee_id, row);
    }
    if (!late && !veryLate) continue;
    row.arrivals.push({ date, time, late, veryLate });
    if (late) row.lateCount++;
    if (veryLate) {
      row.veryLateCount++;
      if (row.veryLateCount > s.very_late_limit) {
        const n = row.veryLateCount - s.very_late_limit;
        row.warnings.push({ number: n, date, time, key: `late-report:${e.employee_id}:${date}:${from}:${to}` });
      }
    }
  }
  for (const r of byEmp.values()) {
    r.chargeableLate = Math.max(0, r.lateCount - Math.max(0, s.grace_count));
    r.penaltyInr = r.chargeableLate * s.penalty_inr;
  }
  return [...byEmp.values()].filter(r => r.arrivals.length > 0).sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
