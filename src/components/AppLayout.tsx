import { useEffect, useMemo, useState } from 'react';
import { loadFobRates } from '@/lib/fob-rates';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { TaskDialog } from '@/components/TaskDialog';
import type { TaskContext } from '@/lib/task-types';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { TrendingUp,
  Settings, LogOut, ShoppingCart, FileText,
  Users, Inbox, Package2, CheckSquare, Truck, Search, Menu, FolderOpen, ChevronDown, BarChart3, Wrench, ClipboardCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalTaskQuickAdd } from '@/components/GlobalTaskQuickAdd';
import { MobileTaskFab } from '@/components/MobileTaskFab';
import { ThemeToggle } from '@/components/ThemeToggle';
import { GlobalSearch } from '@/components/GlobalSearch';
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import hqLogo from '@/assets/dkt-logo.png';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, isAdminOrTeam, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  useEffect(() => { if (user) loadFobRates(); }, [user]);

  // Route-derived context so the global "T" shortcut pre-fills the task dialog
  const taskContext = useMemo<TaskContext>(() => {
    const path = location.pathname;
    const inquiryMatch = path.match(/^\/(?:inquiry|inquiries)\/([^/?#]+)/);
    if (inquiryMatch) return { inquiryId: inquiryMatch[1] };
    const productMatch = path.match(/^\/(?:product|products)\/([^/?#]+)/);
    if (productMatch) return { productId: productMatch[1] };
    const customerMatch = path.match(/^\/(?:customer|customers)\/([^/?#]+)/);
    if (customerMatch) return { customerId: customerMatch[1] };
    return {};
  }, [location.pathname]);

  useKeyboardShortcuts({
    onOpenSearch: () => setSearchOpen(true),
    onOpenHelp: () => setHelpOpen(true),
    onNewTask: () => setTaskOpen(true),
  });

  const primaryNav = isAdminOrTeam ? [
    { to: '/', label: 'Inquiries', icon: Inbox },
    { to: '/pd-dashboard', label: 'PD Dashboard', icon: ClipboardCheck },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/analytics', label: 'Kickass Analytics Dashboard', icon: BarChart3 },
    { to: '/profitability', label: 'Profitability', icon: TrendingUp },
    { to: '/tools', label: 'Tools', icon: Wrench },
  ] : [];
  const directoryNav = isAdminOrTeam ? [
    { to: '/customers', label: 'Customers', icon: Users },
    { to: '/products', label: 'Products', icon: ShoppingCart },
    { to: '/quotes', label: 'Quotes', icon: FileText },
    { to: '/samples', label: 'Samples', icon: Package2 },
    { to: '/vendors', label: 'Vendors', icon: Truck },
    { to: '/vendor-rfqs', label: 'Vendor RFQs', icon: FileText },
  ] : [];
  const extraLabels = [
    { to: '/freight-quotes', label: 'Freight Quotes' },
    { to: '/settings', label: 'Settings' },
  ];

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/' || location.pathname === '/inquiries';
    return location.pathname === to || location.pathname.startsWith(to + '/');
  };
  const inDirectories = directoryNav.some(i => isActive(i.to));
  const [dirOpen, setDirOpen] = useState(inDirectories);
  useEffect(() => { if (inDirectories) setDirOpen(true); }, [inDirectories]);
  const currentLabel = [...primaryNav, ...directoryNav, ...extraLabels].find(i => isActive(i.to))?.label ?? 'Product HQ';

  // Bottom-nav primary set on mobile (4 most-used + Menu)
  const bottomNav = isAdminOrTeam ? [
    { to: '/', label: 'Inquiries', icon: Inbox },
    { to: '/customers', label: 'Customers', icon: Users },
    { to: '/products', label: 'Products', icon: ShoppingCart },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  ] : [];

  const NavButton = ({ item, indent }: { item: { to: string; label: string; icon: typeof Inbox }; indent?: boolean }) => (
    <Link to={item.to} onClick={() => setMobileOpen(false)}>
      <Button
        variant={isActive(item.to) ? 'secondary' : 'ghost'}
        className={cn('w-full justify-start gap-3 h-10 text-sm', indent && 'pl-9 h-9', isActive(item.to) && 'bg-secondary')}
      >
        <item.icon className="h-4 w-4" />
        <span className="truncate">{item.label}</span>
      </Button>
    </Link>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav */}
      <header
        className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-12 items-center px-3 sm:px-4 gap-2 sm:gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-4 w-4" />
          </Button>
          <Link to="/" className="flex items-center gap-2 font-serif font-medium text-base tracking-tight shrink-0">
            <span className="h-8 w-8 rounded-lg bg-white dark:bg-white/10 flex items-center justify-center overflow-hidden ring-1 ring-border">
              <img src={hqLogo} alt="Product HQ" className="h-6 w-6 object-contain" />
            </span>
            <span className="hidden sm:inline">Product HQ</span>
          </Link>
          <span className="hidden sm:inline text-muted-foreground">/</span>
          <div className="text-sm font-medium truncate flex-1 min-w-0">{currentLabel}</div>

          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)} aria-label="Search (⌘K)" title="Search (⌘K)">
              <Search className="h-4 w-4" />
            </Button>
            <GlobalTaskQuickAdd />
            {isAdmin && (
              <Link to="/settings">
                <Button
                  variant={isActive('/settings') ? 'secondary' : 'ghost'}
                  size="icon" className="h-8 w-8" aria-label="Settings" title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <ThemeToggle />
            <Button variant="ghost" size="icon" className="h-8 w-8 hidden md:inline-flex" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Left slide-out menu (desktop + mobile) */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-80 p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-4 mt-2">
            <span className="h-8 w-8 rounded-lg bg-white dark:bg-white/10 flex items-center justify-center overflow-hidden ring-1 ring-border">
              <img src={hqLogo} alt="Product HQ" className="h-6 w-6 object-contain" />
            </span>
            <span className="font-serif font-medium text-base">Product HQ</span>
          </div>
          <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
            {primaryNav.map(item => <NavButton key={item.to} item={item} />)}
            {directoryNav.length > 0 && (
              <>
                <Button
                  variant="ghost"
                  className={cn('w-full justify-start gap-3 h-10 text-sm', inDirectories && !dirOpen && 'bg-secondary')}
                  onClick={() => setDirOpen(o => !o)}
                  aria-expanded={dirOpen}
                >
                  <FolderOpen className="h-4 w-4" />
                  <span className="flex-1 text-left">Directories</span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', !dirOpen && '-rotate-90')} />
                </Button>
                {dirOpen && directoryNav.map(item => <NavButton key={item.to} item={item} indent />)}
              </>
            )}
          </nav>
          <div className="pt-4 border-t mt-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 h-10 text-sm text-destructive hover:text-destructive"
              onClick={() => { signOut(); setMobileOpen(false); }}
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <main
        className="flex-1 p-3 sm:p-4 pb-24 md:pb-6"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}
      >
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="grid grid-cols-5 h-14">
          {bottomNav.map(item => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                <item.icon className={cn('h-5 w-5', active && 'scale-110 transition-transform')} />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setMobileOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-muted-foreground"
          >
            <Menu className="h-5 w-5" />
            Menu
          </button>
        </div>
      </nav>

      {/* Global mobile FAB — always opens New Task, contextual to route */}
      <MobileTaskFab />

      {/* Global search + keyboard shortcuts */}
      <GlobalSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onShowHelp={() => setHelpOpen(true)}
      />
      <KeyboardShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
      {taskOpen && (
        <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} context={taskContext} />
      )}
    </div>
  );
};
