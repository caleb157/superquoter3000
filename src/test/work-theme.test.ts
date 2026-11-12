import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tokens from 'hq-ui/tokens.json';

const css = readFileSync('src/index.css', 'utf8');

// The Work theme block in index.css restates hq-ui's colours as HSL channels
// (Tailwind 3 needs them that way). Each line carries the hq-ui role and hex it
// was taken from. This fails when hq-ui changes a colour and the block is stale.

type Palette = Record<string, string>;
const work = (tokens as unknown as { themes: { work: { light: Palette; dark: Palette } } }).themes.work;

const hslToRgb = (h: number, s: number, l: number) => {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return [f(0), f(8), f(4)];
};
const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const block = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('\n}', start));
};
const LINE = /--([\w-]+):\s*([\d.]+) ([\d.]+)% ([\d.]+)%;\s*\/\* ([\w-]+) (#[0-9A-Fa-f]{6}) \*\//g;

describe.each([
  ['light', '[data-theme="work"]'],
  ['dark', '[data-theme="work"][data-mode="dark"]'],
] as const)('Work theme, %s', (mode, selector) => {
  const lines = [...block(selector).matchAll(LINE)];

  it('maps every shadcn and status variable', () => {
    expect(lines.length).toBe(42);
  });

  it.each(lines.map((m) => [m[1], m] as const))('--%s matches hq-ui', (_name, m) => {
    const [, , h, s, l, role, hex] = m;
    expect(work[mode][role]?.toUpperCase(), `hq-ui ${mode} ${role}`).toBe(hex.toUpperCase());
    const got = hslToRgb(+h, +s, +l);
    hexToRgb(hex).forEach((c, i) => expect(Math.abs(c - got[i])).toBeLessThanOrEqual(1));
  });
});
