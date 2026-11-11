import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';

interface Watch {
  id: string;
  name: string;
  state: string;
  interval_minutes: number;
  last_checked_at: string | null;
  last_changed_at: string | null;
  last_change_summary: string | null;
  last_error: string | null;
}
interface WatchDetail {
  id: string;
  queriedAt: string;
  fields: { field: string; label: string; value: string }[];
  lastChange: {
    summary: string;
    observedAt: string;
    changes: { field: string; label: string; before: string; after: string }[];
  } | null;
}
const date = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function RecordWatches({ onCountChange }: { onCountChange?: (count: number) => void } = {}) {
  const [items, setItems] = useState<Watch[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<WatchDetail | null>(null);
  const load = useCallback(async () => {
    try {
      const watches = await api<Watch[]>('/watches');
      setItems(watches);
      onCountChange?.(watches.length);
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, [onCountChange]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function check(watch: Watch) {
    setBusy(watch.id);
    setError('');
    try {
      const result = await api<Omit<WatchDetail, 'id'>>('/watches/' + watch.id + '/current');
      setDetail({ id: watch.id, ...result });
    } catch (cause) {
      setError((cause as Error).message);
      setDetail(null);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(watch: Watch) {
    setBusy(watch.id);
    setError('');
    try {
      await api('/watches/' + watch.id + '/state', {
        method: 'PUT', body: { state: watch.state === 'active' ? 'paused' : 'active' }
      });
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return <section className="watch-list" aria-label="Registros acompanhados">
    {error && <div className="error-box" role="alert">{error}</div>}
    {items.map(watch => <article className="card watch-card" key={watch.id}>
      <div>
        <h3>{watch.name} <span className={'badge ' + (watch.state === 'active' ? 'good' : watch.state === 'error' ? 'crit' : '')}>
          {watch.state === 'active' ? 'Ativo' : watch.state === 'paused' ? 'Pausado' : 'Requer atenção'}
        </span></h3>
        <div className="muted">Verificação a cada {watch.interval_minutes} min · {watch.last_checked_at ? 'Última verificação: ' + date(watch.last_checked_at) : 'Aguardando primeira verificação'}</div>
        {watch.last_changed_at && <div className="muted">Última mudança: {date(watch.last_changed_at)}</div>}
        {watch.last_change_summary && <p className="watch-summary">{watch.last_change_summary}</p>}
        {watch.last_error && <p role="alert">{watch.last_error}</p>}
      </div>
      <div className="row">
        <button className="btn sm" disabled={busy === watch.id} onClick={() => void check(watch)}>Consultar agora</button>
        <button className="btn sm" disabled={busy === watch.id} onClick={() => void toggle(watch)}>{watch.state === 'active' ? 'Pausar' : 'Retomar'}</button>
      </div>
      {detail?.id === watch.id && <div className="watch-details">
        <h4>O que aconteceu</h4>
        {detail.lastChange ? <p>{detail.lastChange.summary}</p>
          : <p>Não há histórico detalhado de alterações registrado até agora.</p>}
        <h4>Situação atual</h4>
        <dl>{detail.fields.map(field => <div key={field.field}>
          <dt>{field.label}</dt><dd>{field.value}</dd>
        </div>)}</dl>
        <p className="small muted">Informações verificadas em {date(detail.queriedAt)}</p>
      </div>}
    </article>)}
  </section>;
}
