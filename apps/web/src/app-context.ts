import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BASE, type Me } from './api.ts';

export interface AppCtx {
  me: Me;
  theme: string;
  setTheme: (t: string) => void;
  navigate: (path: string) => void;
  unread: number;
  refreshUnread: () => void;
  setMe: (m: Me) => void;
}

export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('Contexto da aplicação ausente');
  return c;
}

/** Rota relativa ao caminho base (/ada). */
export function useRoute(): [string, (p: string) => void] {
  const read = () => window.location.pathname.slice(BASE.length) || '/';
  const [path, setPath] = useState(read);
  useEffect(() => {
    const on = () => setPath(read());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((p: string) => {
    window.history.pushState(null, '', BASE + p);
    setPath(p.split('?')[0]!);
    window.scrollTo(0, 0);
  }, []);
  return [path, navigate];
}
