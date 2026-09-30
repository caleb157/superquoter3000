import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

const TABS = [
  { to: '/freight-quotes', label: 'Quotes', end: true },
  { to: '/freight-quotes/new', label: 'New quote' },
  { to: '/freight-quotes/dashboard', label: 'Dashboard' },
  { to: '/freight-quotes/settings', label: 'Settings' },
];

export function FqHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="space-y-2 mb-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className="flex gap-2 flex-wrap">{actions}</div>
      </div>
      <nav className="flex gap-1 border-b text-xs">
        {TABS.map(t => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => cn('px-3 py-1.5 -mb-px border-b-2', isActive ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
