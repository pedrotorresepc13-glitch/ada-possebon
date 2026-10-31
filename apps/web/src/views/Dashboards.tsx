import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { DashboardFilter, DashboardSpec, WidgetData } from '@ada/contracts';
import { formatDateTime } from '@ada/domain/format';
import { api, apiUrl, ApiError } from '../api.ts';
import { useApp } from '../app-context.ts';
import { DashboardCanvas } from '../components/DashboardCanvas.tsx';

const Holo3D = lazy(() => import('../components/Holo3D.tsx'));

interface DashRow {
  id: string;
  title: string;
  description: string;
  updated_at: string;
  share_policy: string;
  access: 'owner' | 'shared';
  metrics: string[];
}

export function DashboardsView() {
  const { navigate } = useApp();
  const [items, setItems] = useState<DashRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api<DashRow[]>('/dashboards').then(setItems).catch((e) => setErr((e as Error).message));
  }, []);
  return (
    <>
      <header className="topbar">
        <h1 className="grow" style={{ paddingLeft: 36 }}>Meus dashboards</h1>
        <button className="btn primary sm" onClick={() => navigate('/?nova=' + Date.now())}>Criar pela conversa</button>
      </header>
      <div className="content">
        <p className="muted small">Cada dashboard guarda apenas a definição (métricas, filtros e visual). Ao abrir, os valores são consultados novamente com as suas permissões atuais.</p>
        {err && <div className="error-box" role="alert">{err}</div>}
        {!items ? (
          <div className="list">{[1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}</div>
        ) : items.length === 0 ? (
          <div className="empty"><strong>Nenhum dashboard salvo</strong>Peça na conversa, por exemplo: “cria efetivo por equipe nos últimos seis meses” e depois “salva como …”.</div>
        ) : (
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {items.map((d) => (
              <li key={d.id} className="list-item">
                <div className="grow">
                  <a href="#" onClick={(e) => (e.preventDefault(), navigate(`/dashboards/${d.id}`))}><strong>{d.title}</strong></a>
                  <div className="muted small">
                    Atualizado em {formatDateTime(d.updated_at)} · {d.access === 'owner' ? (d.share_policy === 'compartilhado' ? 'Seu · compartilhado' : 'Seu · privado') : 'Compartilhado com você'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

interface DashDetail {
  id: string;
  title: string;
  description: string;
  spec: DashboardSpec;
  access: 'owner' | 'shared';
  current_revision: number;
  share_policy: string;
  last_refreshed_at: string | null;
}

export function DashboardView({ id }: { id: string }) {
  const { theme, navigate, me } = useApp();
  const [dash, setDash] = useState<DashDetail | null>(null);
  const [data, setData] = useState<WidgetData[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [holo, setHolo] = useState(false);
  const [revisions, setRevisions] = useState<{ revision: number; change_summary: string; created_at: string }[] | null>(null);

  const load = useCallback(
    async (refresh = false, f = filters) => {
      setLoading(true);
      setErr('');
      try {
        const active: DashboardFilter[] = Object.entries(f)
          .filter(([, v]) => v)
          .map(([dimension, v]) => ({ dimension, op: 'eq', values: [v] }));
        const q = new URLSearchParams();
        if (refresh) q.set('refresh', '1');
        if (active.length) q.set('filters', JSON.stringify(active));
        const r = await api<{ data: WidgetData[]; generatedAt: string }>(`/dashboards/${id}/data?${q}`);
        setData(r.data);
        setGeneratedAt(r.generatedAt);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [id, filters]
  );

  useEffect(() => {
    api<DashDetail>(`/dashboards/${id}`)
      .then((d) => {
        setDash(d);
        for (const dim of d.spec.filterControls) {
          api<string[]>(`/dashboards/${id}/filter-values?dimension=${dim}`)
            .then((vals) => setOptions((o) => ({ ...o, [dim]: vals })))
            .catch(() => undefined);
        }
      })
      .catch((e) => setErr(e instanceof ApiError && e.status === 404 ? 'Dashboard não encontrado ou sem acesso.' : (e as Error).message));
    void load(false, {});
  }, [id]); // carregamento por id

  // Atualiza os dados diretamente pelo backend, SEM chamada à IA.
  // O servidor revalida permissões e consulta a fonte; refresh=1 ignora o cache.
  // Polling de segurança: funciona mesmo sem triggers/outbox do POSSEBON Web.
  useEffect(() => {
    let busy = false;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || busy) return;
      busy = true;
      void load(true).finally(() => { busy = false; });
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  if (err && !dash) return <div className="content"><div className="error-box" role="alert">{err}</div></div>;
  if (!dash) return <div className="content"><div className="skeleton" style={{ height: 300 }} /></div>;
  const dimLabel: Record<string, string> = { gerencia: 'Gerência', equipe: 'Equipe', status: 'Status', categoria: 'Categoria' };

  return (
    <>
      <header className="topbar">
        <div className="grow" style={{ paddingLeft: 36 }}>
          <h1>{dash.title}</h1>
          <div className="muted small">{dash.access === 'shared' ? 'Compartilhado com você · somente leitura' : `Revisão ${dash.current_revision}`}{generatedAt ? ` · valores gerados em ${formatDateTime(generatedAt)}` : ''}</div>
        </div>
        <span className="muted small" aria-label="Atualização automática a cada 30 segundos">⟳ Automático · 30 s</span>
        <button className="btn sm" onClick={() => void load(true)} disabled={loading} aria-label="Atualizar valores na fonte">↻ Atualizar</button>
        <a className="btn sm" href={apiUrl(`/dashboards/${id}/export.csv`)} download>Exportar CSV</a>
        <button className="btn sm" onClick={() => setHolo((v) => !v)} aria-pressed={holo}>Modo HOLO 3D</button>
        {dash.access === 'owner' && <button className="btn sm" onClick={() => navigate(`/?dashboard=${id}`)}>Editar pela conversa</button>}
      </header>
      <div className="content">
        {err && <div className="error-box" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
        {dash.spec.filterControls.length > 0 && (
          <div className="filters" role="group" aria-label="Filtros">
            {dash.spec.filterControls.map((dim) => (
              <label key={dim} className="field">
                {dimLabel[dim] ?? dim}
                <select
                  className="select"
                  value={filters[dim] ?? ''}
                  onChange={(e) => {
                    const f = { ...filters, [dim]: e.target.value };
                    setFilters(f);
                    void load(false, f);
                  }}
                >
                  <option value="">Todas</option>
                  {(options[dim] ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
        {holo && data && (
          <div style={{ marginBottom: 14 }}>
            <Suspense fallback={<div className="skeleton" style={{ height: 420 }} />}>
              <Holo3D spec={dash.spec} data={data} onClose={() => setHolo(false)} />
            </Suspense>
          </div>
        )}
        <DashboardCanvas spec={dash.spec} data={data} theme={theme} loading={loading && !data} />
        {dash.access === 'owner' && (
          <section className="card" style={{ marginTop: 16 }}>
            <h2>Gestão</h2>
            <div className="row">
              <button
                className="btn sm"
                onClick={async () => setRevisions(await api(`/dashboards/${id}/revisions`))}
              >
                Histórico de revisões
              </button>
              {(me.roles.includes('manager') || me.isAdmin) && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    if (!window.confirm(`Publicar para a unidade ${me.activeUnit.name}? Quem abrir só verá os indicadores que tiver permissão para ver.`)) return;
                    try {
                      await api(`/dashboards/${id}/share`, { body: { targetType: 'unit', targetId: me.activeUnit.id } });
                      setDash({ ...dash, share_policy: 'compartilhado' });
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  Publicar na unidade
                </button>
              )}
              {dash.share_policy === 'compartilhado' && (
                <button className="btn sm" onClick={async () => (await api(`/dashboards/${id}/share`, { method: 'DELETE' }), setDash({ ...dash, share_policy: 'privado' }))}>
                  Tornar privado
                </button>
              )}
              <button
                className="btn sm danger"
                onClick={async () => {
                  if (window.confirm('Excluir este dashboard?')) {
                    await api(`/dashboards/${id}`, { method: 'DELETE' });
                    navigate('/dashboards');
                  }
                }}
              >
                Excluir
              </button>
            </div>
            {revisions && (
              <table className="data" style={{ marginTop: 12 }}>
                <thead><tr><th>Revisão</th><th>Alteração</th><th>Data</th><th /></tr></thead>
                <tbody>
                  {revisions.map((r) => (
                    <tr key={r.revision}>
                      <td>{r.revision}</td>
                      <td>{r.change_summary}</td>
                      <td>{formatDateTime(r.created_at)}</td>
                      <td>
                        {r.revision !== dash.current_revision && (
                          <button className="btn ghost sm" onClick={async () => {
                            const d = await api<DashDetail>(`/dashboards/${id}/revert`, { body: { revision: r.revision } });
                            setDash({ ...dash, ...d, access: 'owner' });
                            setRevisions(null);
                            void load(true);
                          }}>Restaurar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </>
  );
}
