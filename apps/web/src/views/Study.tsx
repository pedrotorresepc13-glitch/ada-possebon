import { useEffect, useState } from 'react';
import { api } from '../api.ts';

interface StudyStatus {
  state: 'running' | 'ready' | 'partial' | 'error';
  started: boolean;
  updatedAt: string | null;
  user: { name: string; id: number };
  unit: { id: number; name: string };
  authorizedPrograms: string[];
  brainState: string;
  brainSources: { id: string; namespace: string; title: string; sourceType: string; observedAt: string | null }[];
  indexedDocuments: number;
  operationalMetrics: number;
  limitations: string[];
  error: string | null;
}

const description: Record<string, string> = {
  running: 'Estudando seu contexto autorizado...',
  ready: 'Levantamento concluído para as fontes disponíveis.',
  partial: 'Levantamento parcial: há integrações ainda pendentes.',
  error: 'Não foi possível concluir. Você pode tentar novamente.'
};

export function StudyView() {
  const [data, setData] = useState<StudyStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await api<StudyStatus>('/study/status');
        if (active) { setData(result); setError(''); }
      } catch (e) { if (active) setError((e as Error).message); }
    };
    void load();
    const timer = window.setInterval(() => { if (active) void load(); }, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const refresh = async () => {
    setBusy(true);
    try {
      await api('/study/refresh', { body: {} });
      setData((old) => old ? { ...old, state: 'running' } : old);
      setError('');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <header className="topbar"><h1 className="grow" style={{ paddingLeft: 36 }}>O que a ADA aprendeu</h1></header>
      <div className="content grid" style={{ maxWidth: 1000 }}>
        <section className="card">
          <div className="row">
            <div className="grow">
              <h2>Estudo inicial da sua área de trabalho</h2>
              <p className="muted small">Ao entrar, a ADA reconhece sua identidade, unidade e programas autorizados. Consulta o Brain apenas com as permissões da sua sessão. O levantamento é privado e fica cifrado no banco da ADA.</p>
            </div>
            <button className="btn" disabled={busy} onClick={() => void refresh()}>Atualizar meu estudo</button>
          </div>
          {error && <div className="error-box" role="alert">{error}</div>}
          {!data ? <div className="skeleton" style={{ height: 100 }} /> : (
            <>
              <p><strong>{data.user.name}</strong> · usuário {data.user.id} · {data.unit.name} (unidade {data.unit.id})</p>
              <p className="note-box" role="status">{description[data.state] ?? data.state}</p>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
                <div className="card"><strong>{data.authorizedPrograms.length}</strong><p className="muted small">Programas identificados</p></div>
                <div className="card"><strong>{data.brainSources.length}</strong><p className="muted small">Referências do Brain</p></div>
                <div className="card"><strong>{data.indexedDocuments}</strong><p className="muted small">Documentos indexados</p></div>
                <div className="card"><strong>{data.operationalMetrics}</strong><p className="muted small">Indicadores operacionais disponíveis</p></div>
              </div>
              {data.updatedAt && <p className="muted small">Último levantamento: {new Date(data.updatedAt).toLocaleString('pt-BR')}</p>}
              {data.error && <div className="error-box">{data.error}</div>}
            </>
          )}
        </section>

        {data && <section className="card">
          <h2>Programas autorizados no POSSEBON</h2>
          <p className="muted small">Esses nomes são permissões reais, não comprovam que os dados operacionais de cada módulo já estejam conectados.</p>
          {data.authorizedPrograms.length
            ? <div className="row" style={{ flexWrap: 'wrap' }}>{data.authorizedPrograms.map((p) => <span className="badge" key={p}>{p}</span>)}</div>
            : <p className="muted">Aguardando o levantamento.</p>}
        </section>}

        {data && <section className="card">
          <h2>Conhecimento do POSSEBON Brain</h2>
          <p className="muted small">Estado: {data.brainState}. A ADA usa apenas trechos autorizados da unidade, como dados de referência, nunca como instruções de sistema.</p>
          {!data.brainSources.length ? <p className="muted">Nenhuma referência confirmada neste levantamento.</p>
            : <ul className="list">{data.brainSources.map((s) => (
              <li className="list-item" key={s.namespace + ':' + s.id}>
                <div><strong>{s.title}</strong><div className="muted small">{s.namespace} · {s.sourceType} · {s.observedAt || 'sem data de atualização'}</div></div>
              </li>
            ))}</ul>}
        </section>}

        {data && <section className="card">
          <h2>O que falta integrar</h2>
          <p className="muted small">A ADA não afirmará ter estudado registros de RH, financeiros ou operacionais enquanto os respectivos conectores autorizados não forem implementados e validados.</p>
          {data.limitations.length ? <ul>{data.limitations.map((x) => <li key={x}>{x}</li>)}</ul>
            : <p>Nenhuma limitação encontrada entre as fontes atualmente cadastradas.</p>}
        </section>}
      </div>
    </>
  );
}
