import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { clearSnapshots } from '@/lib/page-snapshot';
import { invalidateLiveCosts } from '@/lib/live-cost-cache';

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

// Roles and assignee code as last read, kept in this browser so a reload does not wait
// for them before showing the page. Cleared on sign-out.
const KNOWN_USER_KEY = 'pdhq-known-user';
type KnownUser = { userId: string; roles: AppRole[]; assigneeCode: string | null };

function readKnownUser(userId: string): KnownUser | null {
  try {
    const v = JSON.parse(localStorage.getItem(KNOWN_USER_KEY) || 'null');
    if (v?.userId !== userId || !Array.isArray(v.roles) || v.roles.length === 0) return null;
    return { userId, roles: v.roles, assigneeCode: v.assigneeCode ?? null };
  } catch { return null; }
}
function writeKnownUser(v: KnownUser): void {
  try { localStorage.setItem(KNOWN_USER_KEY, JSON.stringify(v)); } catch { /* storage blocked */ }
}
function clearKnownUser(): void {
  try { localStorage.removeItem(KNOWN_USER_KEY); } catch { /* storage blocked */ }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [assigneeCode, setAssigneeCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesLoaded, setRolesLoaded] = useState(false);

  // What was last learned about this person (roles, assignee code).
  const known = useRef<{ userId: string; roles: AppRole[]; assigneeCode: string | null } | null>(null);
  const remember = (userId: string, patch: { roles?: AppRole[]; assigneeCode?: string | null }) => {
    const prev = known.current?.userId === userId ? known.current : { userId, roles: [] as AppRole[], assigneeCode: null };
    known.current = { ...prev, ...patch };
    writeKnownUser(known.current);
  };

  const fetchRoles = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    if (data) {
      const next = data.map((r: any) => r.role as AppRole);
      setRoles(next);
      remember(userId, { roles: next });
    }
    setRolesLoaded(true);
  };

  const fetchProfile = async (userId: string) => {
    const { data, error } = await (supabase as any)
      .from('profiles')
      .select('assignee_code')
      .eq('user_id', userId)
      .maybeSingle();
    const code = (data?.assignee_code as string | null) ?? null;
    setAssigneeCode(code);
    if (!error) remember(userId, { assigneeCode: code });
  };

  useEffect(() => {
    let cancelled = false;
    let lastLoad = { userId: '', at: 0 };

    // IMPORTANT: never await Supabase calls inside onAuthStateChange — the auth
    // client holds a lock during the callback and awaiting a request there can
    // deadlock the app (infinite loading spinner). Defer them instead.
    const loadUserData = (userId: string) => {
      // The roles this browser saw last time open the app at once; the fresh read below
      // then corrects them. (The database enforces access; roles only shape the screen.)
      if (known.current?.userId !== userId) {
        const saved = readKnownUser(userId);
        if (saved) {
          known.current = saved;
          setRoles(saved.roles);
          setAssigneeCode(saved.assigneeCode);
          setRolesLoaded(true);
        }
      }
      // Start-up and tab-focus events arrive in bursts; one read covers them.
      if (lastLoad.userId === userId && Date.now() - lastLoad.at < 10_000) return;
      lastLoad = { userId, at: Date.now() };
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
          known.current = null;
          lastLoad = { userId: '', at: 0 };
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
      } else {
        setRolesLoaded(true);
      }
      setLoading(false);
    }).catch(() => { setLoading(false); setRolesLoaded(true); });


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
    known.current = null;
    clearKnownUser();
    clearSnapshots();
    invalidateLiveCosts();
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
