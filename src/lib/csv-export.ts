// Lightweight CSV builder + download helper for analytics exports.

function escapeCell(v: any): string {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export type CsvSection = {
  title: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
};

export function buildCsv(sections: CsvSection[]): string {
  const lines: string[] = [];
  sections.forEach((s, idx) => {
    if (idx > 0) lines.push('');
    lines.push(`# ${s.title}`);
    lines.push(s.headers.map(escapeCell).join(','));
    s.rows.forEach(r => lines.push(r.map(escapeCell).join(',')));
  });
  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function rangeStamp(from: Date, to: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(from)}_to_${fmt(to)}`;
}
