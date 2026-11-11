import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { api, apiUrl, onUnauthenticated, reconnectPossebon, setCsrf, setSessionContext, type Me } from './api.ts';
import { Ctx, useRoute } from './app-context.ts';
import { ChatView } from './views/Chat.tsx';
import { EmbeddedDashboard } from './views/EmbeddedDashboard.tsx';
import { CompactChat } from './views/CompactChat.tsx';
import { ConversationsView } from './views/Conversations.tsx';
import { DashboardsView, DashboardView } from './views/Dashboards.tsx';
import { MonitorsView } from './views/Monitors.tsx';
import { NotificationsView } from './views/Notifications.tsx';
import { MemoryView } from './views/Memory.tsx';
import { StudyView } from './views/Study.tsx';
import { PersonalExperience } from './views/PersonalExperience.tsx';
import { LiveBoardsList, LiveBoardDetail } from './views/LiveBoards.tsx';
import { WorkspaceView } from './views/Workspace.tsx';
import { CompactAssistant } from './components/CompactAssistant.tsx';
import { Icon } from './components/Icon.tsx';

import { BrandingProvider, useBranding } from './branding.tsx';

const AdminView = lazy(() => import('./views/Admin.tsx'));

interface SessionInfo {
  authenticated: boolean;
  me?: Me;
  devLogin?: boolean;
  ssoConfigured?: boolean;
}

function Login({ info, onLogged }: { info: SessionInfo; onLogged: (m: Me) => void }) {
  const { name } = useBranding();
  const [err, setErr] = useState('');
  const [connecting, setConnecting] = useState(false);
  const canReconnect = info.ssoConfigured && window.parent === window;
  const reconnect = async () => {
    setConnecting(true);
    setErr('');
    try { onLogged(await reconnectPossebon()); }
    catch (error) { setErr((error as Error).message); }
    finally { setConnecting(false); }
  };
  const users = [
    ['admin.demo', 'Administração (2 unidades)'],
    ['gerente.a', 'Gerente A — Unidade Norte'],
    ['gerente.b', 'Gerente B — Unidade Sul'],
    ['colab.a', 'Colaborador A — Unidade Norte'],
    ['colab.b', 'Colaborador B — Unidade Sul']
  ];
  return (
    <div className="login-wrap">
      <main className="card login-card">
        <div className="brand" style={{ padding: 0, marginBottom: 12 }}>
          <div className="brand-mark" aria-hidden="true">IA</div>
          <div>
            <strong>{name} - IA Possebon</strong>
            <small>Inteligência empresarial</small>
          </div>
        </div>
        <p>{name} usa a sessão e as permissões do <strong>POSSEBON Web</strong>.</p>
        {canReconnect && <button className="btn primary" disabled={connecting} onClick={() => void reconnect()}>
          {connecting ? 'Conectando…' : 'Entrar com POSSEBON Web'}
        </button>}
        {!info.ssoConfigured && <p className="note-box small">O SSO com o POSSEBON ainda não está configurado neste ambiente.</p>}
        {info.devLogin && (
          <section style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 14 }}>Ambiente de desenvolvimento — usuários SINTÉTICOS</h2>
            <p className="muted small">Identidades fictícias para testar perfis e isolamento. Indisponível em produção.</p>
            <div className="list">
              {users.map(([login, label]) => (
                <button
                  key={login}
                  className="btn"
                  onClick={async () => {
                    try {
                      const r = await api<{ me: Me }>('/dev/login', { body: { login } });
                      onLogged(r.me);
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}
        {err && <p className="error-box" role="alert">{err}</p>}
      </main>
    </div>
  );
}

const NAV = [
  ['/inicio', 'Meu ambiente', 'home'],
  ['/', 'Nova conversa', 'plus'],
  ['/conversas', 'Minhas conversas', 'chat'],
  ['/dashboards', 'Meus dashboards', 'grid'],
  ['/telas', 'Telas vivas', 'chart'],
  ['/acompanhamentos', 'Acompanhamentos', 'clock'],
  ['/notificacoes', 'Notificações', 'bell'],
  ['/memoria', 'Memória e preferências', 'settings'],
  ['/estudo', 'O que a IA aprendeu', 'brain']
] as const;

function AppContent() {
  const { name } = useBranding();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [me, setMeState] = useState<Me | null>(null);
  const [theme, setThemeState] = useState('light');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [path, navigate] = useRoute();

  const setMe = useCallback((m: Me) => {
    setCsrf(m.csrfToken);
    setSessionContext(m);
    setMeState(m);
  }, []);

  useEffect(() => {
    api<SessionInfo>('/session')
      .then((s) => {
        setInfo(s);
        if (s.me) setMe(s.me);
      })
      .catch(() => setInfo({ authenticated: false }));
    return onUnauthenticated(() => {
      setSessionContext(null);
      if (window.parent !== window && window.location.pathname.endsWith('/compacto')) {
        window.parent.postMessage({ type: 'possebon:session-expired' }, window.location.origin);
      }
      setMeState(null);
      setInfo((i) => ({ ...(i ?? { authenticated: false }), authenticated: false }));
    });
  }, [setMe]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!me) return;
    api<{ theme?: string }>('/preferences').then((p) => p.theme && setThemeState(p.theme)).catch(() => undefined);
  }, [me]);

  const refreshUnread = useCallback(() => {
    api<{ unread: number }>('/notifications/count').then((r) => setUnread(r.unread)).catch(() => undefined);
  }, []);

  // Tempo real por SSE (fonte da verdade no banco); fallback por consulta periódica.
  useEffect(() => {
    if (!me) return;
    refreshUnread();
    let es: EventSource | null = null;
    let timer: number | undefined;
    try {
      es = new EventSource(apiUrl('/notifications/stream'));
      es.addEventListener('notificacoes', (e) => setUnread(JSON.parse((e as MessageEvent).data).unread));
      es.onerror = () => {
        es?.close();
        timer = window.setInterval(refreshUnread, 60_000);
      };
    } catch {
      timer = window.setInterval(refreshUnread, 60_000);
    }
    return () => {
      es?.close();
      if (timer) window.clearInterval(timer);
    };
  }, [me, refreshUnread]);

  const setTheme = (t: string) => {
    setThemeState(t);
    api('/preferences', { method: 'PUT', body: { theme: t } }).catch(() => undefined);
  };

  if (!info) return <div className="login-wrap"><div className="skeleton" style={{ width: 320, height: 120 }} aria-label="Carregando" /></div>;
  if (!me) return <Login info={info} onLogged={setMe} />;

  const go = (p: string) => {
    navigate(p);
    setMenuOpen(false);
  };
  let view;
  const dashMatch = /^\/dashboards\/([0-9a-f-]{36})$/.exec(path);
  const liveMatch = /^\/telas\/([0-9a-f-]{36})$/.exec(path);
  const compact=path==='/compacto';
  const embeddedDashboard=path==='/painel-pessoal';
  const hasConversation=new URLSearchParams(window.location.search).has('c')||new URLSearchParams(window.location.search).has('nova')||new URLSearchParams(window.location.search).has('dashboard');
  if(compact)view=<CompactChat key={me.user.systemUserId+':'+me.activeUnit.id}/>;
  else if(path==='/inicio'||((path==='/'||path==='')&&!hasConversation))view=<WorkspaceView key={me.user.systemUserId+':'+me.activeUnit.id}/>;
  else if (path === '/' || path === '') view = <ChatView key={window.location.search+me.activeUnit.id} />;
  else if (path === '/conversas') view = <ConversationsView />;
  else if (dashMatch) view = <DashboardView id={dashMatch[1]!} />;
  else if (path === '/dashboards') view = <DashboardsView />;
  else if (liveMatch) view = <LiveBoardDetail id={liveMatch[1]!} />;
  else if (path === '/telas') view = <LiveBoardsList key={me.activeUnit.id}/>;
  else if (path === '/acompanhamentos') view = <MonitorsView />;
  else if (path === '/notificacoes') view = <NotificationsView />;
  else if (path === '/memoria') view = <MemoryView />;
  else if (path === '/estudo') view = <StudyView />;
  else if (path.startsWith('/admin') && me.isAdmin) view = <Suspense fallback={<div className="content"><div className="skeleton" style={{ height: 200 }} /></div>}><AdminView /></Suspense>;
  else view = <div className="content"><div className="empty"><strong>Página não encontrada</strong>Verifique o endereço ou use o menu.</div></div>;

  return (
    <Ctx.Provider value={{ me, theme, setTheme, navigate: go, unread, refreshUnread, setMe }}>
      {!me.isAdmin && !me.demoData ? <PersonalExperience key={me.user.systemUserId+':'+me.activeUnit.id} compact={compact}/> : embeddedDashboard?<EmbeddedDashboard />:compact?view:<>
      <div className="app">
        <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Navegação principal">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">PB</div>
            <div>
              <strong>{name}</strong>
              <small>POSSEBON · inteligência empresarial</small>
            </div>
          </div>
          {NAV.map(([p, label, icon]) => (
            <a
              key={p}
              href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${p}`}
              className="nav-item"
              aria-current={(p === '/' ? path === '/'&&hasConversation : p==='/inicio' ? path==='/inicio'||path==='/'&&!hasConversation : path.startsWith(p)) ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(p === '/' ? '/?nova=' + Date.now() : p);
              }}
            >
              <Icon name={icon}/>
              {label}
              {p === '/notificacoes' && unread > 0 && <span className="count" aria-label={`${unread} não lidas`}>{unread}</span>}
            </a>
          ))}
          {me.isAdmin && (
            <>
              <div className="nav-sep" />
              <a href="#" className="nav-item" aria-current={path.startsWith('/admin') ? 'page' : undefined} onClick={(e) => (e.preventDefault(), go('/admin'))}>
                <Icon name="shield"/>Administração
              </a>
            </>
          )}
          <div className="sidebar-footer">
            {me.units.length > 1 ? (
              <label className="field">
                Unidade ativa
                <select
                  className="select"
                  value={me.activeUnit.id}
                  onChange={async (e) => {
                    const m = await api<Me>('/session/unit', { body: { unitId: Number(e.target.value) } });
                    setMe(m);
                    go('/');
                  }}
                >
                  {me.units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="small muted">Unidade: <strong style={{ color: 'var(--ink)' }}>{me.activeUnit.name}</strong></div>
            )}
            <div className="small">{me.user.displayName}</div>
            <div className="row">
              {me.demoData && <span className="badge synthetic" title="Este ambiente usa dados fictícios">DEMONSTRAÇÃO</span>}
              <span className="badge" title={me.ai.configured ? 'IA generativa configurada no servidor' : 'Sem IA generativa: interpretador determinístico'}>
                {me.ai.configured ? 'IA ativa' : 'Sem IA generativa'}
              </span>
            </div>
            <button
              className="btn ghost sm"
              onClick={async () => {
                await api('/session/logout', { body: {} }).catch(() => undefined);
                setMeState(null);
                setInfo({ ...info, authenticated: false });
              }}
            >
              Sair de {name}
            </button>
          </div>
        </nav>
        <div className="main">
          <button className="btn ghost menu-toggle" style={{ position: 'fixed', top: 8, left: 8, zIndex: 30 }} aria-label="Abrir menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            ☰
          </button>
          {view}
        </div>
      </div>
      <CompactAssistant key={me.user.systemUserId+':'+me.activeUnit.id}/>
      </>}
    </Ctx.Provider>
  );
}

export function App() {
  return <BrandingProvider><AppContent /></BrandingProvider>;
}
