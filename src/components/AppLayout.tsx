import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Settings, Search, LogOut, Package, ShoppingCart, FileText, Users, ClipboardList, ClipboardCheck, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

export const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, isAdmin, isAdminOrTeam, signOut } = useAuth();
  const location = useLocation();

  const navItems = [
    { to: '/', label: 'Projects', icon: LayoutDashboard, show: isAdminOrTeam },
    { to: '/customers', label: 'Customers', icon: Users, show: isAdminOrTeam },
    { to: '/products', label: 'Products', icon: ShoppingCart, show: isAdminOrTeam },
    { to: '/rfqs', label: 'RFQs', icon: ClipboardList, show: isAdminOrTeam },
    { to: '/quotes', label: 'Quotes', icon: FileText, show: isAdminOrTeam },
    { to: '/qc', label: 'QC', icon: ClipboardCheck, show: isAdminOrTeam },
    { to: '/settings', label: 'Settings', icon: Settings, show: isAdmin },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav bar */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex h-12 items-center px-4 gap-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-sm tracking-tight">
            <Package className="h-5 w-5 text-primary" />
            <span>DKT Costing</span>
          </Link>

          <nav className="flex items-center gap-1 ml-6">
            {navItems.filter(n => n.show).map(item => (
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
            <span className="text-xs text-muted-foreground">{user?.email}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={signOut}>
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="p-4">
        {children}
      </main>
    </div>
  );
};
