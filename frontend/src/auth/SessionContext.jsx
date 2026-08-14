/* eslint-disable react-refresh/only-export-components -- provider and matching hook form one public module */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { can } from './capabilities.js';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.session.me()
      .then((session) => active && setUser(session?.user || session || null))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    async login(credentials) {
      const session = await api.session.login(credentials);
      const nextUser = session?.user || session;
      setUser(nextUser);
      return nextUser;
    },
    async logout() {
      await api.session.logout();
      setUser(null);
    },
  }), [loading, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession должен использоваться внутри SessionProvider');
  return context;
}

export function ProtectedRoute({ children }) {
  const { user, loading } = useSession();
  const location = useLocation();
  if (loading) return <div className="pb-app-loading" role="status">Загрузка сеанса…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export function CapabilityRoute({ capability, children }) {
  const { user, loading } = useSession();
  if (loading) return <div className="pb-app-loading" role="status">Загрузка сеанса…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!can(user, capability)) {
    return <main className="pb-fatal-state"><h1>Доступ запрещён</h1><p>Ваша роль не позволяет открыть этот раздел.</p></main>;
  }
  return children;
}
