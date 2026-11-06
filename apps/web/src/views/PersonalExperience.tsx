import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Ctx, useApp } from '../app-context.ts';
import { ChatView } from './Chat.tsx';
import { LiveBoardDetail } from './LiveBoards.tsx';
import { MonitorsView } from './Monitors.tsx';
import { NotificationsView } from './Notifications.tsx';

type Panel = 'monitors' | 'notifications';
interface PersonalAssets {
  state: string;
  liveBoardId: string | null;
  conversationId: string | null;
}

export function PersonalExperience({ compact }: { compact: boolean }) {
  const app = useApp();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [assets, setAssets] = useState<PersonalAssets | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (window.parent === window) return;
    if (!compact) {
      window.parent.postMessage({ type: 'possebon:personal-dashboard-ready' }, location.origin);
      return;
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'possebon:show-panel') return;
      const next = event.data.panel;
      if (next === 'monitors' || next === 'notifications') setPanel(current => current === next ? null : next);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'possebon:ready', personal: true }, window.location.origin);
    return () => window.removeEventListener('message', receive);
  }, [compact]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api<PersonalAssets>('/workspace');
        if (!active) return;
        setAssets(data);
        setError('');
        if (data.state === 'pending' || data.state === 'running') timer = setTimeout(load, 2000);
      } catch (err) {
        if (active) setError((err as Error).message);
      }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  const navigate = (path: string) => {
    if (path.startsWith('/telas') || path.startsWith('/dashboards')) {
      if (window.parent !== window) window.parent.postMessage({ type: 'possebon:open-dashboard' }, location.origin);
    } else if (path === '/acompanhamentos') setPanel('monitors');
    else if (path === '/notificacoes') setPanel('notifications');
  };

  return <Ctx.Provider value={{ ...app, navigate }}>
    <div className="compact-app personal-experience">
      {error && <div className="error-box" role="alert">{error}</div>}
      {compact && panel && <section className="personal-side-panel" aria-label={panel === 'monitors' ? 'Acompanhamentos' : 'Notificações'}>
        <button className="btn sm personal-panel-close" onClick={() => setPanel(null)}>Fechar</button>
        {panel === 'monitors' ? <MonitorsView /> : <NotificationsView />}
      </section>}
      {compact ? (assets?.conversationId
        ? <ChatView compact initialConversationId={assets.conversationId} />
        : <div className="empty" role="status">Preparando sua conversa.</div>)
        : (assets?.liveBoardId
          ? <LiveBoardDetail id={assets.liveBoardId} personal />
          : <div className="empty" role="status">Preparando seu Dashboard.</div>)}
    </div>
  </Ctx.Provider>;
}
