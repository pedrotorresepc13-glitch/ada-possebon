import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api.ts';

interface Branding { name: string; setName: (name: string) => void }
const Context = createContext<Branding | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [name, setNameState] = useState('Posso');
  const revision = useRef(0);
  const setName = useCallback((value: string) => {
    revision.current++;
    setNameState(value);
  }, []);
  const refresh = useCallback(async () => {
    const requestedRevision = ++revision.current;
    try {
      const result = await api<{ name: string }>('/branding');
      if (requestedRevision === revision.current) setNameState(result.name);
    }
    catch { /* Mantém o último nome conhecido durante uma falha de conexão. */ }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(onVisible, 30_000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);
  useEffect(() => { document.title = `${name} - IA Possebon`; }, [name]);
  const value = useMemo(() => ({ name, setName }), [name, setName]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBranding() {
  const value = useContext(Context);
  if (!value) throw new Error('Identidade da assistente indisponível');
  return value;
}
