import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Settings, LogOut, ShoppingCart, FileText, ClipboardList, Menu, ChevronDown,
  Users, Inbox, Package2, CheckSquare, BarChart3, Shield, MoreHorizontal, ScrollText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlobalTaskQuickAdd } from '@/components/GlobalTaskQuickAdd';
import { ThemeToggle } from '@/components/ThemeToggle';
import hqLogo from '@/assets/dkt-logo.png';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, isAdminOrTeam, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { to: '/', label: 'Inquiries', icon: Inbox, show: isAdminOrTeam },
    { to: '/customers', label: 'Customers', icon: Users, show: isAdminOrTeam },
    { to: '/products', label: 'Products', icon: ShoppingCart, show: isAdminOrTeam },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare, show: isAdminOrTeam },
    { to: '/analytics', label: 'Analytics', icon: BarChart3, show: isAdminOrTeam },
    { to: '/vendor-rfqs', label: 'Vendor RFQs', icon: ClipboardList, show: isAdminOrTeam },
    { to: '/quotes', label: 'Quotes', icon: FileText, show: isAdminOrTeam },
    { to: '/samples', label: 'Samples', icon: Package2, show: isAdminOrTeam },
    { to: '/team', label: 'Team', icon: Shield, show: isAdmin },
    { to: '/settings', label: 'Settings', icon: Settings, show: isAdmin },
  ];

  const visibleItems = navItems.filter(n => n.show);

  // Desktop primary nav order: Inquiries, Customers, Products, Logs (dropdown), Tasks
  const primaryDesktop: Array<{ to: string; label: string; icon: typeof Inbox }> = [
    { to: '/', label: 'Inquiries', icon: Inbox },
    { to: '/customers', label: 'Customers', icon: Users },
    { to: '/products', label: 'Products', icon: ShoppingCart },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  ].filter(i => visibleItems.find(v => v.to === i.to));

  const logsItems = [
    { to: '/quotes', label: 'Quotes', icon: FileText },
    { to: '/samples', label: 'Samples', icon: Package2 },
  ].filter(i => visibleItems.find(v => v.to === i.to));

  const logsActive = logsItems.some(i => location.pathname === i.to || location.pathname.startsWith(i.to + '/'));
  const showSettings = !!visibleItems.find(v => v.to === '/settings');

  // Bottom-nav primary set on mobile (4 most-used + More)
  const bottomNav = [
    { to: '/', label: 'Inquiries', icon: Inbox },
    { to: '/customers', label: 'Customers', icon: Users },
    { to: '/products', label: 'Products', icon: ShoppingCart },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
  ].filter(i => visibleItems.find(v => v.to === i.to));

  const isActive = (to: string) => {
    if (to === '/') return location.pathname === '/' || location.pathname === '/inquiries';
    return location.pathname === to || location.pathname.startsWith(to + '/');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav */}
      <header
        className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-12 items-center px-3 sm:px-4 gap-2 sm:gap-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-sm tracking-tight shrink-0">
            <span className="h-8 w-8 rounded-lg bg-white dark:bg-white/10 flex items-center justify-center overflow-hidden ring-1 ring-border">
              <img src={hqLogo} alt="Product HQ" className="h-6 w-6 object-contain" />
            </span>
            <span className="hidden sm:inline">Product HQ</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 ml-4 flex-1 min-w-0 overflow-x-auto">
            {primaryDesktop.slice(0, 3).map(item => (
              <Link key={item.to} to={item.to}>
                <Button
                  variant={isActive(item.to) ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-8 text-xs gap-1.5', isActive(item.to) && 'bg-secondary')}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Button>
              </Link>
            ))}

            {logsItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={logsActive ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn('h-8 text-xs gap-1.5 group', logsActive && 'bg-secondary')}
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                    Logs
                    <ChevronDown className="h-3 w-3 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  {logsItems.map(item => (
                    <DropdownMenuItem key={item.to} asChild>
                      <Link to={item.to} className="cursor-pointer gap-2">
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {primaryDesktop.slice(3).map(item => (
              <Link key={item.to} to={item.to}>
                <Button
                  variant={isActive(item.to) ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-8 text-xs gap-1.5', isActive(item.to) && 'bg-secondary')}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Button>
              </Link>
            ))}

            {visibleItems.find(v => v.to === '/analytics') && (
              <Link to="/analytics">
                <Button
                  variant={isActive('/analytics') ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-8 text-xs gap-1.5', isActive('/analytics') && 'bg-secondary')}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                  Analytics
                </Button>
              </Link>
            )}
            {visibleItems.find(v => v.to === '/team') && (
              <Link to="/team">
                <Button
                  variant={isActive('/team') ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-8 text-xs gap-1.5', isActive('/team') && 'bg-secondary')}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Team
                </Button>
              </Link>
            )}

            {/* Spacer pushes settings to the far right */}
            <div className="flex-1" />

            {showSettings && (
              <Link to="/settings" className="hidden md:inline-flex">
                <Button
                  variant={isActive('/settings') ? 'secondary' : 'ghost'}
                  size="icon"
                  className={cn('h-8 w-8', isActive('/settings') && 'bg-secondary')}
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </nav>

          {/* Mobile current-page label */}
          <div className="md:hidden text-sm font-semibold truncate flex-1 min-w-0">
            {visibleItems.find(i => isActive(i.to))?.label ?? 'Product HQ'}
          </div>

          <div className="ml-auto flex items-center gap-1">
            <GlobalTaskQuickAdd />
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hidden md:inline-flex"
              onClick={signOut}
              aria-label="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>

            {/* Mobile hamburger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 md:hidden" aria-label="Menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 p-4 flex flex-col">
                <div className="flex items-center gap-2 mb-4 mt-2">
                  <span className="h-8 w-8 rounded-lg bg-white dark:bg-white/10 flex items-center justify-center overflow-hidden ring-1 ring-border">
                    <img src={hqLogo} alt="Product HQ" className="h-6 w-6 object-contain" />
                  </span>
                  <span className="font-bold">Product HQ</span>
                </div>
                <nav className="flex flex-col gap-1 flex-1 overflow-y-auto">
                  {visibleItems.map(item => (
                    <Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)}>
                      <Button
                        variant={isActive(item.to) ? 'secondary' : 'ghost'}
                        className={cn(
                          'w-full justify-start gap-3 h-11 text-sm',
                          isActive(item.to) && 'bg-secondary',
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Button>
                    </Link>
                  ))}
                </nav>
                <div className="pt-4 border-t mt-2 space-y-2">
                  <p className="text-xs text-muted-foreground truncate px-2">{user?.email}</p>
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
          </div>
        </div>
      </header>

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
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>
    </div>
  );
};
