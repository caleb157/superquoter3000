import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Initial theme application before React mounts to avoid flash of wrong theme.
(() => {
  try {
    const stored = localStorage.getItem('dkt-theme');
    const sysDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const isDark = stored === 'dark' || ((stored === 'system' || !stored) && sysDark);
    document.documentElement.classList.toggle('dark', isDark);
  } catch {
    /* noop */
  }
})();

createRoot(document.getElementById("root")!).render(<App />);
