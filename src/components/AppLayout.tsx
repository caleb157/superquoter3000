import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { LayoutDashboard, Settings, LogOut, Package, ShoppingCart, FileText, ClipboardList, GitBranch, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { QuickAddTask } from '@/components/QuickAddTask';
import { TaskOverdueBanner } from '@/components/TaskOverdueBanner';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, isAdminOrTeam, signOut } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { to: '/', label: 'Projects', icon: LayoutDashboard, show: isAdminOrTeam },
    { to: '/pipeline', label: 'Pipeline', icon: GitBranch, show: isAdminOrTeam },
    { to: '/products', label: 'Products', icon: ShoppingCart, show: isAdminOrTeam },
    { to: '/rfqs', label: 'RFQs', icon: ClipboardList, show: isAdminOrTeam },
    { to: '/quotes', label: 'Quotes', icon: FileText, show: isAdminOrTeam },
    { to: '/settings', label: 'Settings', icon: Settings, show: isAdmin },
  ];

  const visibleItems = navItems.filter(n => n.show);

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav bar */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex h-12 items-center px-4 gap-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-sm tracking-tight">
            <Package className="h-5 w-5 text-primary" />
            <span className="hidden sm:inline">DKT Costing</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1 ml-6">
            {visibleItems.map(item => (
              <Link key={item.to} to={item.to}>
                <Button
                  variant={location.pathname === item.to ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-8 text-xs gap-1.5',
                    location.pathname === item.to && 'bg-secondary'
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <QuickAddTask />
            <span className="text-xs text-muted-foreground hidden sm:inline">{user?.email}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={signOut}>
              <LogOut className="h-3.5 w-3.5" />
            </Button>

            {/* Mobile hamburger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-56 p-4">
                <nav className="flex flex-col gap-1 mt-4">
                  {visibleItems.map(item => (
                    <Link key={item.to} to={item.to} onClick={() => setMobileOpen(false)}>
                      <Button
                        variant={location.pathname === item.to ? 'secondary' : 'ghost'}
                        className={cn('w-full justify-start gap-2 h-9 text-sm',
                          location.pathname === item.to && 'bg-secondary'
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </Button>
                    </Link>
                  ))}
                </nav>
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <TaskOverdueBanner />

      <main className="p-4">
        {children}
      </main>
    </div>
  );
};
