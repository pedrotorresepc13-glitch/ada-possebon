import { useEffect, useState } from 'react';
import { Ctx, useApp } from '../app-context.ts';
import { ChatView } from './Chat.tsx';
import { DashboardView } from './Dashboards.tsx';
import { PersonalDashboard } from './EmbeddedDashboard.tsx';
import { LiveBoardDetail } from './LiveBoards.tsx';
import { MonitorsView } from './Monitors.tsx';
import { NotificationsView } from './Notifications.tsx';

export function CompactChat() {
  const app = useApp();
  const [panel, setPanel] = useState<string | null>(null);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'possebon:show-panel') return;
      const next = event.data.panel;
      if (next === 'chat') { setPanel(null); return; }
      if (next === 'dashboard' && window.parent !== window) {
        setPanel(null);
        window.parent.postMessage({type:'possebon:open-dashboard',path:''}, location.origin);
        return;
      }
      if (next === 'monitors' || next === 'notifications' || next === 'dashboard') {
        setPanel(current => current === next ? null : next);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const navigate = (path: string) => {
    if (path === '/acompanhamentos') setPanel('monitors');
    else if (path === '/notificacoes') setPanel('notifications');
    else if (path === '/dashboards' || path === '/telas' || /^\/(?:telas|dashboards)\/[0-9a-f-]{36}$/.test(path)) {
      if (window.parent !== window) window.parent.postMessage({type:'possebon:open-dashboard',path:path === '/dashboards' ? '' : path}, location.origin);
      else setPanel(path === '/dashboards' ? 'dashboard' : path);
    }
  };

  let content;
  if (panel === 'monitors') content = <MonitorsView />;
  else if (panel === 'notifications') content = <NotificationsView />;
  else if (panel === 'dashboard') content = <PersonalDashboard />;
  else if (panel?.startsWith('/telas/')) content = <LiveBoardDetail id={panel.slice('/telas/'.length)} />;
  else if (panel?.startsWith('/dashboards/')) content = <DashboardView id={panel.slice('/dashboards/'.length)} />;

  return <Ctx.Provider value={{ ...app, navigate }}>
    <div className="compact-app personal-experience">
      {content && <section className="personal-side-panel" aria-label="Ferramentas da conversa">
        {content}
      </section>}
      <ChatView compact composerOnly={!!content} onConversation={() => setPanel(null)} />
    </div>
  </Ctx.Provider>;
}
