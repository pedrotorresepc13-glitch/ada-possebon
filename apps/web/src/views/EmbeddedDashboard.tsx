import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';
import { LiveBoardDetail } from './LiveBoards.tsx';

/** O POSSO tem um dashboard pessoal por usuário/unidade, atualizado pela conversa. */
export function PersonalDashboard() {
  const { me } = useApp();
  const [dashboardId, setDashboardId] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    setDashboardId(null);
    setError('');
    void api<{dashboardId:string|null}>('/workspace/personal-dashboard')
      .then(result => {
        if (!mounted) return;
        setDashboardId(result.dashboardId);
        setError(result.dashboardId ? '' : 'Dashboard ainda não disponível.');
      })
      .catch(err => { if (mounted) setError((err as Error).message); });
    return () => { mounted = false; };
  }, [me.user.systemUserId, me.activeUnit.id]);
  if (error) return <div className="content"><div role="alert" className="error-box">{error}</div></div>;
  if (!dashboardId) return <div className="content"><div className="skeleton" style={{height:280}} /></div>;
  return <LiveBoardDetail id={dashboardId} personal />;
}

export function EmbeddedDashboard() {
  return <main className="embedded-dashboard" aria-label="Meu Dashboard"><PersonalDashboard /></main>;
}
