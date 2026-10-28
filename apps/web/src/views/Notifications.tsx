import { useCallback, useEffect, useState } from 'react';
import type { NotificationDto } from '@ada/contracts';
import { formatDateTime } from '@ada/domain/format';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';

const SEV: Record<string, [string, string]> = { info: ['ℹ', 'Informação'], aviso: ['▲', 'Aviso'], critico: ['⬣', 'Crítico'] };

export function NotificationsView() {
  const { navigate, refreshUnread, unread } = useApp();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [severity, setSeverity] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (onlyUnread) q.set('unread', '1');
    if (severity) q.set('severity', severity);
    api<NotificationDto[]>(`/notifications?${q}`).then(setItems).catch((e) => setErr((e as Error).message));
  }, [onlyUnread, severity]);

  useEffect(() => {
    load();
  }, [load, unread]);

  const mark = async (n: NotificationDto, what: 'read' | 'ack') => {
    await api(`/notifications/${n.id}/${what}`, { body: {} });
    refreshUnread();
    load();
  };

  return (
    <>
      <header className="topbar">
        <h1 className="grow" style={{ paddingLeft: 36 }}>Notificações</h1>
        <button className="btn sm" onClick={async () => (await api('/notifications/read-all', { body: {} }), refreshUnread(), load())}>Marcar todas como lidas</button>
      </header>
      <div className="content">
        <div className="filters" role="group" aria-label="Filtros">
          <label className="field" style={{ minWidth: 160 }}>
            Severidade
            <select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">Todas</option>
              <option value="info">Informação</option>
              <option value="aviso">Aviso</option>
              <option value="critico">Crítico</option>
            </select>
          </label>
          <label className="row small"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Somente não lidas</label>
        </div>
        {err && <div className="error-box" role="alert">{err}</div>}
        {!items ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : items.length === 0 ? (
          <div className="empty"><strong>Nada por aqui</strong>Alertas dos seus acompanhamentos aparecerão nesta central.</div>
        ) : (
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {items.map((n) => {
              const [icon, label] = SEV[n.severity] ?? ['•', n.severity];
              const ev = (n.evidence ?? {}) as { synthetic?: boolean };
              return (
                <li key={n.id} className={`list-item ${n.readAt ? '' : 'unread'}`}>
                  <span className={`sev ${n.severity}`} aria-label={label}><span aria-hidden="true">{icon}</span>{label}</span>
                  <div className="grow">
                    <strong>{n.title}</strong>
                    <div>{n.body}</div>
                    <div className="muted small">
                      {formatDateTime(n.createdAt)} {n.source ? `· fonte ${n.source}` : ''} {ev.synthetic ? '· DADOS SINTÉTICOS' : ''}
                      {n.acknowledgedAt ? ` · confirmada em ${formatDateTime(n.acknowledgedAt)}` : ''}
                    </div>
                    <div className="row" style={{ marginTop: 6 }}>
                      {n.monitorId && <button className="btn ghost sm" onClick={() => navigate('/acompanhamentos')}>Ver acompanhamento</button>}
                      {n.dashboardId && <button className="btn ghost sm" onClick={() => navigate(`/dashboards/${n.dashboardId}`)}>Abrir dashboard</button>}
                    </div>
                  </div>
                  <div className="row">
                    {!n.readAt && <button className="btn sm" onClick={() => void mark(n, 'read')}>Marcar lida</button>}
                    {!n.acknowledgedAt && <button className="btn sm" onClick={() => void mark(n, 'ack')}>Confirmar</button>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
