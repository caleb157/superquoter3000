import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdminOrTeam?: boolean;
  requireAdmin?: boolean;
}

export const ProtectedRoute = ({ children, requireAdminOrTeam, requireAdmin }: ProtectedRouteProps) => {
  const { user, loading, isAdmin, isAdminOrTeam } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (requireAdmin && !isAdmin) return <Navigate to="/" replace />;
  if (requireAdminOrTeam && !isAdminOrTeam) return <Navigate to="/" replace />;

  return <>{children}</>;
};
