import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

type AppRole = 'admin' | 'team' | 'guest';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  isAdmin: boolean;
  isTeam: boolean;
  isAdminOrTeam: boolean;
  isGuest: boolean;
  assigneeCode: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, roles: [], loading: true,
  isAdmin: false, isTeam: false, isAdminOrTeam: false, isGuest: false,
  assigneeCode: null,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [assigneeCode, setAssigneeCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRoles = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    if (data) {
      setRoles(data.map((r: any) => r.role as AppRole));
    }
  };

  const fetchProfile = async (userId: string) => {
    const { data } = await (supabase as any)
      .from('profiles')
      .select('assignee_code')
      .eq('user_id', userId)
      .maybeSingle();
    setAssigneeCode((data?.assignee_code as string | null) ?? null);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => { fetchRoles(session.user.id); fetchProfile(session.user.id); }, 0);
        } else {
          setRoles([]);
          setAssigneeCode(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRoles(session.user.id);
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
    setAssigneeCode(null);
  };

  const isAdmin = roles.includes('admin');
  const isTeam = roles.includes('team');
  const isAdminOrTeam = isAdmin || isTeam;
  const isGuest = roles.includes('guest');

  return (
    <AuthContext.Provider value={{
      user, session, roles, loading,
      isAdmin, isTeam, isAdminOrTeam, isGuest,
      assigneeCode,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
