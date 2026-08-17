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
  rolesLoaded: boolean;
  assigneeCode: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, roles: [], loading: true,
  isAdmin: false, isTeam: false, isAdminOrTeam: false, isGuest: false,
  rolesLoaded: false,
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
  const [rolesLoaded, setRolesLoaded] = useState(false);

  const fetchRoles = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    if (data) {
      setRoles(data.map((r: any) => r.role as AppRole));
    }
    setRolesLoaded(true);
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
    let cancelled = false;

    // IMPORTANT: never await Supabase calls inside onAuthStateChange — the auth
    // client holds a lock during the callback and awaiting a request there can
    // deadlock the app (infinite loading spinner). Defer them instead.
    const loadUserData = (userId: string) => {
      setTimeout(() => {
        if (cancelled) return;
        void fetchRoles(userId);
        void fetchProfile(userId);
      }, 0);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          loadUserData(session.user.id);
        } else {
          setRoles([]);
          setAssigneeCode(null);
          setRolesLoaded(true);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadUserData(session.user.id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));

    // Safety net: never leave the app stuck on the loading spinner.
    const failsafe = setTimeout(() => { setLoading(false); setRolesLoaded(true); }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(failsafe);
      subscription.unsubscribe();
    };
  }, []);


  const signOut = async () => {
    await supabase.auth.signOut();
    setRoles([]);
    setAssigneeCode(null);
    setRolesLoaded(false);
  };

  const isAdmin = roles.includes('admin');
  const isTeam = roles.includes('team');
  const isAdminOrTeam = isAdmin || isTeam;
  const isGuest = roles.includes('guest');

  return (
    <AuthContext.Provider value={{
      user, session, roles, loading,
      isAdmin, isTeam, isAdminOrTeam, isGuest, rolesLoaded,
      assigneeCode,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
