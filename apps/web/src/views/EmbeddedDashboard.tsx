import { useState } from 'react';
import { Ctx, useApp } from '../app-context.ts';
import { DashboardView, DashboardsView } from './Dashboards.tsx';
import { LiveBoardDetail } from './LiveBoards.tsx';

export function EmbeddedDashboard() {
  const app = useApp();
  const [path, setPath] = useState(new URLSearchParams(location.search).get('view') || '/dashboards');
  const match = /^\/(telas|dashboards)\/([0-9a-f-]{36})$/.exec(path);
  return <Ctx.Provider value={{...app,navigate:setPath}}>
    <main className="embedded-dashboard">
      {match ? <><button className="btn sm" onClick={() => setPath('/dashboards')}>Meus dashboards</button>
        {match[1] === 'telas' ? <LiveBoardDetail id={match[2]!} /> : <DashboardView id={match[2]!} />}</> : <DashboardsView />}
    </main>
  </Ctx.Provider>;
}
