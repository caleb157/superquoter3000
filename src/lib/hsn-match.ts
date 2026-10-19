// Final-product HSN lookup by product name, against the standard hsn_codes list (seeded from Odoo).
// No AI here: AI suggestions are a separate, manual button (supabase/functions/suggest-hsn).
// Score = match words found in the name (phrases count more) + name words shared with the
// code's example product names, weighted so words common to every code (acacia, wood…) count little.

export type HsnCode = { code: string; description: string; keywords: string[]; examples: string[]; gst_rate?: number | null };
export type HsnMatch = { code: string; description: string; score: number };

const STOP = new Set(['and', 'with', 'the', 'for', 'set', 'inch', 'inches', 'cm', 'mm', 'piece', 'pieces', 'of', 'in', 'x']);

export const isHsn8 = (s: string) => /^\d{8}$/.test((s || '').trim());

export function nameTokens(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s/-]+/)
    .map(w => w.replace(/s$/, ''))
    .filter(w => w.length >= 3 && !STOP.has(w));
}

export function matchHsn(name: string, codes: HsnCode[], limit = 3): HsnMatch[] {
  const lower = ` ${(name || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `;
  const words = new Set(nameTokens(name));
  if (!words.size) return [];
  // How many codes each word appears for: rarer words are stronger evidence.
  const df = new Map<string, number>();
  const codeWords = codes.map(c => {
    const set = new Set(c.examples.flatMap(nameTokens));
    for (const w of set) df.set(w, (df.get(w) ?? 0) + 1);
    return set;
  });
  const n = Math.max(codes.length, 1);
  const out = codes.map((c, i) => {
    let score = 0;
    for (const k of c.keywords) {
      const kw = k.toLowerCase().trim();
      if (!kw) continue;
      const hit = kw.includes(' ') ? lower.includes(` ${kw} `) || lower.includes(` ${kw}s `) : words.has(kw.replace(/s$/, ''));
      if (hit) score += kw.includes(' ') ? 3 : 2;
    }
    for (const w of words) if (codeWords[i].has(w)) score += Math.log((n + 1) / (df.get(w) ?? 1));
    return { code: c.code, description: c.description, score: Math.round(score * 100) / 100 };
  });
  return out.filter(m => m.score > 0).sort((a, b) => b.score - a.score || a.code.localeCompare(b.code)).slice(0, limit);
}

/** The match to fill in on its own: a clear winner only. */
export function confidentHsn(matches: HsnMatch[]): HsnMatch | null {
  const [a, b] = matches;
  if (!a || a.score < 2) return null;
  return !b || a.score - b.score >= 1 ? a : null;
}
