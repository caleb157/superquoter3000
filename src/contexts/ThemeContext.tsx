import React, { createContext, useContext, useEffect, useState } from 'react';

// 'dialup' and 'vaporwave' are the Dial-Up design system's two themes
// (Desktop and Vaporwave). They sit on top of light / dark: vaporwave also
// sets `dark`, so anything that only knows light vs dark still behaves.
// 'work' and 'work-dark' are the hq-ui Work theme (the DKT Worksheet look) in
// its light and dark modes. Like vaporwave, 'work-dark' also sets `dark`.
export type Theme = 'light' | 'dark' | 'system' | 'dialup' | 'vaporwave' | 'work' | 'work-dark';
type Resolved = 'light' | 'dark';

export const THEMES: Theme[] = ['light', 'dark', 'system', 'dialup', 'vaporwave', 'work', 'work-dark'];
export const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  /** True while a Dial-Up theme (Desktop or Vaporwave) is on. */
  dialup: boolean;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolved: 'light',
  dialup: false,
  setTheme: () => {},
});

const STORAGE_KEY = 'dkt-theme';

const getSystem = (): Resolved =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

// Some routes (customer-facing quote pages) must always render light,
// regardless of the app/system theme. They register here so that any later
// theme application (provider mount, OS scheme change) can't re-add `dark`.
let forceLightCount = 0;
let lastResolved: Resolved = 'light';
let lastDialup = false;
let lastWork = false;

const isDialup = (t: Theme) => t === 'dialup' || t === 'vaporwave';
const isWork = (t: Theme) => t === 'work' || t === 'work-dark';
const resolve = (t: Theme): Resolved =>
  t === 'system' ? getSystem() : t === 'dark' || t === 'vaporwave' || t === 'work-dark' ? 'dark' : 'light';

// Dial-Up's display and pixel faces load only once someone turns the theme on.
const DIALUP_FONTS = 'https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=VT323&display=swap';
const loadDialupFonts = () => {
  if (document.getElementById('dialup-fonts')) return;
  const link = document.createElement('link');
  link.id = 'dialup-fonts';
  link.rel = 'stylesheet';
  link.href = DIALUP_FONTS;
  document.head.appendChild(link);
};

// Work's page-title serif and figure mono load only once the theme is on.
// Inter is already bundled with the app.
const WORK_FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400&display=swap';
const loadWorkFonts = () => {
  if (document.getElementById('work-fonts')) return;
  const link = document.createElement('link');
  link.id = 'work-fonts';
  link.rel = 'stylesheet';
  link.href = WORK_FONTS;
  document.head.appendChild(link);
};

const apply = (resolved: Resolved, dialup = lastDialup, work = lastWork) => {
  lastResolved = resolved;
  lastDialup = dialup;
  lastWork = work;
  const forced = forceLightCount > 0;
  const effective: Resolved = forced ? 'light' : resolved;
  const du = dialup && !forced;
  const root = document.documentElement;
  root.classList.toggle('dark', effective === 'dark');
  root.classList.toggle('dialup', du);
  if (du) loadDialupFonts();
  // hq-ui reads data-theme and data-mode from the same element. The mode
  // follows the same light / dark answer as the `dark` class.
  const wk = work && !forced;
  if (wk) {
    root.dataset.theme = 'work';
    root.dataset.mode = effective;
    loadWorkFonts();
  } else {
    delete root.dataset.theme;
    delete root.dataset.mode;
  }
  // For mobile browser UI / status bar
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = du
    ? (effective === 'dark' ? '#140a2e' : '#3bc4c4')
    : wk
      ? (effective === 'dark' ? '#1F150D' : '#F4EBDC')
      : effective === 'dark' ? '#10131a' : '#ffffff';
  if (meta) meta.setAttribute('content', color);
};

/** Force light theme while the calling component is mounted. */
export const useForceLightTheme = (enabled = true) => {
  useEffect(() => {
    if (!enabled) return;
    forceLightCount += 1;
    apply(lastResolved);
    return () => {
      forceLightCount = Math.max(0, forceLightCount - 1);
      apply(lastResolved);
    };
  }, []);
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  });
  const [resolved, setResolved] = useState<Resolved>(() =>
    typeof window !== 'undefined' ? resolve(theme) : 'light');

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    apply(r, isDialup(theme), isWork(theme));
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const r = getSystem();
      setResolved(r);
      apply(r);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, resolved, dialup: isDialup(theme), setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
