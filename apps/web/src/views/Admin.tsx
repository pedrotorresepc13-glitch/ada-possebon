import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatDateTime } from '@ada/domain/format';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';

const TABS = [
  ['saude', 'Saúde'],
  ['conhecimento', 'Fontes de conhecimento'],
  ['conectores', 'Conectores'],
  ['email', 'E-mail'],
  ['ia', 'IA e custos'],
  ['politicas', 'Políticas'],
  ['auditoria', 'Auditoria']
] as const;

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => {
    api<T>(path).then(setData).catch((e) => setErr((e as Error).message));
  }, [path]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, err, reload, setErr };
}

function Status({ s }: { s: string }) {
  const cls = ['ativo', 'indexado', 'ok', 'demonstracao'].includes(s) ? 'good' : ['erro', 'rejeitado'].includes(s) ? 'crit' : ['degradado', 'revisando', 'configurado_nao_validado'].includes(s) ? 'warn' : '';
  return <span className={`badge ${cls}`}>{s.replace(/_/g, ' ')}</span>;
}

function Kv({ obj }: { obj: Record<string, unknown> }) {
  return (
    <table className="data"><tbody>
      {Object.entries(obj).map(([k, v]) => (
        <tr key={k}><th scope="row" style={{ width: '40%' }}>{k.replace(/_/g, ' ')}</th><td>{typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? '—')}</td></tr>
      ))}
    </tbody></table>
  );
}

function Health() {
  const { data, err, reload } = useLoad<Record<string, Record<string, unknown> | boolean | string>>('/admin/health');
  if (err) return <div className="error-box">{err}</div>;
  if (!data) return <div className="skeleton" style={{ height: 160 }} />;
  const worker = data.worker as { alive: boolean; instances: { worker_id: string; last_beat_at: string }[] };
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
      <section className="card"><h3>Banco</h3><Kv obj={data.database as Record<string, unknown>} /></section>
      <section className="card">
        <h3>Worker {worker.alive ? <span className="badge good">ativo</span> : <span className="badge crit">sem batimento recente</span>}</h3>
        {worker.instances.length === 0 ? <p className="muted">Nenhum worker registrado. Inicie apps/worker.</p> : worker.instances.map((w) => <div key={w.worker_id} className="small">{w.worker_id} — último batimento {formatDateTime(w.last_beat_at)}</div>)}
      </section>
      <section className="card"><h3>Filas</h3><Kv obj={data.queues as Record<string, unknown>} /></section>
      <section className="card"><h3>Acompanhamentos</h3><Kv obj={data.monitors as Record<string, unknown>} /></section>
      <section className="card"><h3>IA (24 h)</h3><Kv obj={data.ai as Record<string, unknown>} /></section>
      <section className="card"><h3>Identidade POSSEBON</h3><Kv obj={data.identity as Record<string, unknown>} /><p className="small muted">Ambiente: {String(data.environment)} · dados sintéticos: {data.demoData ? 'sim' : 'não'}</p></section>
      <div><button className="btn sm" onClick={reload}>↻ Atualizar</button></div>
    </div>
  );
}

interface Doc { id: string; title: string; source_name: string; status: string; scope: string; unit_id: number | null; sensitivity: string; injection_flags: string[]; error: string | null; chunks: number; created_at: string; checksum: string }

function Knowledge() {
  const { me } = useApp();
  const sources = useLoad<{ id: string; name: string; kind: string; scope: string; unit_id: number | null; documents: number }[]>('/admin/knowledge/sources');
  const docs = useLoad<Doc[]>('/admin/knowledge/documents');
  const cov = useLoad<{ byStatus: { status: string; n: number }[] }>('/admin/knowledge/coverage');
  const [sel, setSel] = useState('');
  const [msg, setMsg] = useState('');
  const [review, setReview] = useState<Record<string, unknown> | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (review) dlg.current?.showModal(); }, [review]);
  const refresh = () => (sources.reload(), docs.reload(), cov.reload());
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg(ok); refresh(); } catch (e) { setMsg('Erro: ' + (e as Error).message); }
  };

  return (
    <div className="grid">
      {msg && <div className="note-box" role="status">{msg}</div>}
      <section className="card">
        <h3>Nova fonte</h3>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const scope = String(f.get('scope'));
          void run(() => api('/admin/knowledge/sources', { body: {
            kind: String(f.get('kind')), name: String(f.get('name')), scope, sensitivity: String(f.get('sens')),
            ...(scope === 'unidade' ? { unit_id: me.activeUnit.id } : {}), ...(scope === 'dominio' ? { domain: String(f.get('domain') || 'geral') } : {})
          } }), 'Fonte criada.');
          e.currentTarget.reset();
        }}>
          <input name="name" className="input" style={{ maxWidth: 260 }} placeholder="Nome (ex.: Políticas de RH)" required />
          <select name="kind" className="select" style={{ maxWidth: 150 }}><option value="upload">Documentos</option><option value="url">Site / URL</option><option value="manual">Manual</option></select>
          <select name="scope" className="select" style={{ maxWidth: 210 }}><option value="global">Corporativo (global)</option><option value="unidade">Somente {me.activeUnit.name}</option><option value="dominio">Domínio/módulo</option></select>
          <input name="domain" className="input" style={{ maxWidth: 150 }} placeholder="domínio (ex.: rh)" />
          <select name="sens" className="select" style={{ maxWidth: 150 }}><option value="interno">Interno</option><option value="publico">Público</option><option value="restrito">Restrito</option></select>
          <button className="btn primary">Criar</button>
        </form>
      </section>
      <section className="card">
        <h3>Enviar documentos ou importar URL</h3>
        <div className="row">
          <select className="select" style={{ maxWidth: 320 }} value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Fonte de destino">
            <option value="">Escolha a fonte…</option>
            {sources.data?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.scope}{s.unit_id ? ` ${s.unit_id}` : ''}) — {s.documents} doc.</option>)}
          </select>
          <input type="file" multiple accept=".txt,.md,.csv,.json,.html,.htm,.pdf,.docx,.xlsx" disabled={!sel} aria-label="Arquivos"
            onChange={(e) => {
              const files = e.target.files;
              if (!files?.length) return;
              const form = new FormData();
              for (const f of Array.from(files)) form.append('file', f, f.name);
              void run(() => api(`/admin/knowledge/sources/${sel}/upload`, { form }), `${files.length} arquivo(s) enviados para a fila de estudo.`);
              e.target.value = '';
            }} />
        </div>
        <form className="row" style={{ marginTop: 10 }} onSubmit={(e) => {
          e.preventDefault();
          const url = String(new FormData(e.currentTarget).get('url'));
          void run(() => api(`/admin/knowledge/sources/${sel}/url`, { body: { url } }), 'URL na fila. A coleta respeita robots.txt e bloqueia endereços internos.');
        }}>
          <input name="url" type="url" className="input grow" placeholder="https://www.site-institucional.com.br/pagina" disabled={!sel} required />
          <button className="btn" disabled={!sel}>Importar URL</button>
        </form>
        <p className="muted small">Formatos estudados hoje: TXT, MD, CSV, JSON, HTML. PDF/DOCX/XLSX/OCR entram na fila e ficam em erro explícito até o extrator ser instalado. Conteúdo de documentos é tratado como dado, nunca como instrução para a IA POSSEBON.</p>
      </section>
      <section className="card">
        <div className="row"><h3 className="grow">Fila de estudo</h3>{cov.data?.byStatus.map((s) => <span key={s.status} className="small">{s.status}: <strong>{s.n}</strong></span>)}<button className="btn sm" onClick={refresh}>↻</button></div>
        {!docs.data ? <div className="skeleton" style={{ height: 60 }} /> : docs.data.length === 0 ? <p className="muted">Nenhum documento.</p> : (
          <div style={{ overflow: 'auto' }}>
            <table className="data">
              <thead><tr><th>Documento</th><th>Fonte</th><th>Status</th><th>Escopo</th><th>Trechos</th><th>Alertas</th><th /></tr></thead>
              <tbody>
                {docs.data.map((d) => (
                  <tr key={d.id}>
                    <td>{d.title}<div className="muted small">{formatDateTime(d.created_at)} · {d.checksum.slice(0, 10)}…</div></td>
                    <td>{d.source_name}</td>
                    <td><Status s={d.status} />{d.error && <div className="small" style={{ color: 'var(--critical)' }}>{d.error}</div>}</td>
                    <td>{d.scope}{d.unit_id ? ` (${d.unit_id})` : ''} · {d.sensitivity}</td>
                    <td className="num">{d.chunks}</td>
                    <td>{d.injection_flags.length ? <span className="badge warn" title={d.injection_flags.join(', ')}>⚠ possível instrução embutida</span> : '—'}</td>
                    <td className="row">
                      {d.status === 'revisando' && <button className="btn sm" onClick={async () => setReview(await api(`/admin/knowledge/documents/${d.id}`))}>Revisar</button>}
                      {['erro', 'rejeitado', 'indexado'].includes(d.status) && <button className="btn ghost sm" onClick={() => void run(() => api(`/admin/knowledge/documents/${d.id}/reprocess`, { body: {} }), 'Reprocessamento agendado.')}>Reprocessar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <dialog ref={dlg} onClose={() => setReview(null)} aria-labelledby="rev-title">
        {review && (
          <div className="dialog-body">
            <h2 id="rev-title" style={{ margin: 0, fontSize: 16 }}>Revisar: {String(review.title)}</h2>
            {(review.injection_flags as string[]).length > 0 && <div className="error-box">Sinais de instrução embutida: {(review.injection_flags as string[]).join('; ')}. O conteúdo será usado só como dado citável; avalie se deve ser aprovado.</div>}
            <pre className="code">{String(review.extracted_preview ?? '')}</pre>
            <div className="row">
              <button className="btn primary" onClick={() => void run(() => api(`/admin/knowledge/documents/${review.id}/review`, { body: { decision: 'aprovar' } }), 'Documento aprovado e indexado.').then(() => dlg.current?.close())}>Aprovar e indexar</button>
              <button className="btn danger" onClick={() => void run(() => api(`/admin/knowledge/documents/${review.id}/review`, { body: { decision: 'rejeitar', note: window.prompt('Motivo da rejeição:') ?? undefined } }), 'Documento rejeitado.').then(() => dlg.current?.close())}>Rejeitar</button>
              <button className="btn" onClick={() => dlg.current?.close()}>Fechar</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function Connectors() {
  const { data, err, reload } = useLoad<{ id: string; label: string; kind: string; status: string; last_check_at: string | null; last_error: string | null; allowed_operations: string[] }[]>('/admin/connectors');
  const [msg, setMsg] = useState('');
  if (err) return <div className="error-box">{err}</div>;
  return (
    <section className="card">
      <p className="muted small">Um conector só fornece dados quando está “ativo” (validado) ou “demonstração” (sintético, fora de produção). Integrações sem credencial aparecem como “não configurado” — a IA POSSEBON não finge conexões.</p>
      {msg && <div className="note-box" role="status">{msg}</div>}
      <table className="data">
        <thead><tr><th>Conector</th><th>Status</th><th>Operações permitidas</th><th>Última verificação</th><th /></tr></thead>
        <tbody>
          {data?.map((c) => (
            <tr key={c.id}>
              <td>{c.label}<div className="muted small">{c.id} · {c.kind}</div></td>
              <td><Status s={c.status} />{c.last_error && <div className="small" style={{ color: 'var(--warning)' }}>{c.last_error}</div>}</td>
              <td className="small">{c.allowed_operations.join(', ') || '—'}</td>
              <td className="small">{c.last_check_at ? formatDateTime(c.last_check_at) : '—'}</td>
              <td className="row">
                <button className="btn sm" onClick={async () => { const r = await api<{ ok: boolean; message: string }>(`/admin/connectors/${c.id}/test`, { body: {} }); setMsg(`${c.id}: ${r.message}`); reload(); }}>Testar</button>
                {c.status === 'demonstracao' && <button className="btn ghost sm" onClick={async () => { await api(`/admin/connectors/${c.id}/status`, { body: { status: 'desabilitado' } }); reload(); }}>Desabilitar</button>}
                {c.status === 'desabilitado' && c.id.startsWith('demo.') && <button className="btn ghost sm" onClick={async () => { await api(`/admin/connectors/${c.id}/status`, { body: { status: 'demonstracao' } }); reload(); }}>Reabilitar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Email() {
  const { me } = useApp();
  const { data, reload } = useLoad<{ id: string; label: string; kind: string; status: string; hasSecret: boolean; unitId: number; lastTestResult: string | null; sync: string; sending: string; allowedUserIds: number[] }[]>('/admin/email/accounts');
  const [msg, setMsg] = useState('');
  return (
    <div className="grid">
      {msg && <div className="note-box" role="status">{msg}</div>}
      <section className="card">
        <h3>Nova conta</h3>
        <form className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api('/admin/email/accounts', { body: {
              kind: String(f.get('kind')), label: String(f.get('label')), unit_id: me.activeUnit.id,
              allowed_user_ids: String(f.get('users') || '').split(/[,\s]+/).filter(Boolean).map(Number),
              config: { host: String(f.get('host') || '') || undefined, port: Number(f.get('port') || 993), username: String(f.get('username') || '') || undefined },
              ...(f.get('secret') ? { secret: String(f.get('secret')) } : {})
            } });
            setMsg('Conta registrada. A senha foi cifrada e não será exibida novamente.');
            e.currentTarget.reset();
            reload();
          } catch (er) { setMsg('Erro: ' + (er as Error).message); }
        }}>
          <label className="field">Tipo<select name="kind" className="select"><option value="email_imap">IMAP (senha de app)</option><option value="email_gmail">Gmail (OAuth)</option><option value="email_graph">Microsoft 365 (Graph/OAuth)</option></select></label>
          <label className="field">Nome<input name="label" className="input" required placeholder="Caixa de compras" /></label>
          <label className="field">Servidor IMAP<input name="host" className="input" placeholder="imap.provedor.com.br" /></label>
          <label className="field">Porta<input name="port" type="number" className="input" defaultValue={993} /></label>
          <label className="field">Usuário<input name="username" className="input" autoComplete="off" /></label>
          <label className="field">Senha de app<input name="secret" type="password" className="input" autoComplete="new-password" /></label>
          <label className="field">IDs de usuários autorizados (POSSEBON)<input name="users" className="input" placeholder="ex.: 123, 456" /></label>
          <div style={{ alignSelf: 'end' }}><button className="btn primary">Registrar</button></div>
        </form>
        <p className="muted small">Recepção/indexação: contrato e armazenamento prontos; sincronização ainda não implementada. Envio externo bloqueado nesta versão (exigirá rascunho e confirmação). Uma conta configurada aqui não dá acesso a todos: só aos usuários/grupos autorizados da unidade.</p>
      </section>
      <section className="card">
        <h3>Contas</h3>
        {!data?.length ? <p className="muted">Nenhuma conta configurada.</p> : (
          <table className="data">
            <thead><tr><th>Conta</th><th>Status</th><th>Último teste</th><th /></tr></thead>
            <tbody>{data.map((a) => (
              <tr key={a.id}>
                <td>{a.label}<div className="muted small">{a.kind} · unidade {a.unitId} · credencial {a.hasSecret ? 'armazenada (cifrada)' : 'ausente'} · autorizados: {a.allowedUserIds.join(', ') || 'ninguém'}</div></td>
                <td><Status s={a.status} /></td>
                <td className="small">{a.lastTestResult ?? '—'}</td>
                <td className="row">
                  <button className="btn sm" onClick={async () => { const r = await api<{ message: string }>(`/admin/email/accounts/${a.id}/test`, { body: {} }); setMsg(r.message); reload(); }}>Testar conexão</button>
                  <button className="btn ghost sm danger" onClick={async () => { if (window.confirm('Remover conta e apagar credencial?')) { await api(`/admin/email/accounts/${a.id}`, { method: 'DELETE' }); reload(); } }}>Remover</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

interface AiConfigView {
  provider: string;
  configured: boolean;
  model: string;
  apiKeyPresent: boolean;
  keySource: string;
  secureKeyStorage: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  dailyRequestsPerUser: number;
  chatPerMinute: number;
  endpoint: string;
  lastUpdatedAt: string | null;
  note: string;
}

function Ai() {
  const s = useLoad<AiConfigView>('/admin/ai');
  const u = useLoad<Record<string, unknown>[]>('/admin/ai/usage');
  const [model, setModel] = useState('gpt-5-mini');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(45000);
  const [maxOutputTokens, setMaxOutputTokens] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!s.data) return;
    setModel(s.data.model);
    setTimeoutMs(s.data.timeoutMs);
    setMaxOutputTokens(s.data.maxOutputTokens);
    setApiKey('');
  }, [s.data]);

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setApiKey('');
      setMessage(success);
      s.reload();
    } catch (e) {
      setMessage('Erro: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid">
      <section className="card">
        <h3>Provedor de inteligência artificial</h3>
        <p className="muted small">Chave configurada no servidor e cifrada antes de ser salva no banco da IA POSSEBON. Somente administradores autorizados pelo POSSEBON podem alterar esta configuração.</p>
        {s.err && <div className="error-box">{s.err}</div>}
        {s.data && (
          <div className="row" style={{ marginBottom: 12 }}>
            <span className={'badge ' + (s.data.configured ? 'good' : 'warn')}>{s.data.configured ? 'IA configurada' : 'IA não configurada'}</span>
            <span className="small muted">Credencial: {s.data.apiKeyPresent ? 'presente (' + s.data.keySource + ')' : 'ausente'} · Endpoint: {s.data.endpoint}</span>
          </div>
        )}
        {s.data && !s.data.secureKeyStorage && <div className="error-box">Antes de cadastrar uma chave real, configure ADA_ENCRYPTION_KEY no servidor da ADA. Sem essa chave exclusiva, o armazenamento seguro de credenciais não estará habilitado.</div>}
        {message && <div className="note-box" role="status">{message}</div>}
        <form className="grid" onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => api('/admin/ai/settings', { method: 'PUT', body: {
              provider: 'openai', model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
              timeoutMs, maxOutputTokens
            } }),
            'Configuração salva. A IA já pode ser usada em novas mensagens.'
          );
        }}>
          <label className="small" htmlFor="ai-provider">Provedor</label>
          <input className="input" id="ai-provider" value="OpenAI — Responses API" disabled />
          <label className="small" htmlFor="ai-model">Modelo</label>
          <input className="input" id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}
            maxLength={100} placeholder="Ex.: gpt-5-mini" required autoComplete="off" />
          <label className="small" htmlFor="ai-key">Chave da API (secreta)</label>
          <input className="input" id="ai-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            maxLength={400} minLength={20} placeholder={s.data?.apiKeyPresent ? 'Deixe vazio para manter a chave atual' : 'Cole sua chave da OpenAI'} autoComplete="new-password" />
          <span className="muted small">A chave nunca será exibida novamente e não ficará guardada no navegador.</span>
          <div className="row">
            <div className="grow">
              <label className="small" htmlFor="ai-timeout">Tempo limite (ms)</label>
              <input className="input" id="ai-timeout" type="number" min={5000} max={120000} step={1000} required
                value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} />
            </div>
            <div className="grow">
              <label className="small" htmlFor="ai-tokens">Máximo de tokens de saída</label>
              <input className="input" id="ai-tokens" type="number" min={64} max={16000} step={1} required
                value={maxOutputTokens} onChange={(e) => setMaxOutputTokens(Number(e.target.value))} />
            </div>
          </div>
          <div className="row">
            <button className="btn primary" disabled={busy || !s.data}>Salvar configurações</button>
            <button className="btn" type="button" disabled={busy || !s.data?.configured}
              onClick={() => void (async () => {
                setBusy(true); setMessage('');
                try {
                  const r = await api<{ ok: boolean; message: string }>('/admin/ai/test', { body: {} });
                  setMessage((r.ok ? 'OK: ' : 'Falha: ') + r.message);
                } catch (e) { setMessage('Erro: ' + (e as Error).message); }
                finally { setBusy(false); }
              })()}>
              Testar conexão
            </button>
            <button className="btn danger" type="button" disabled={busy || !s.data?.lastUpdatedAt}
              onClick={() => {
                if (!window.confirm('Remover a configuração de IA salva na IA POSSEBON? Uma eventual chave do ambiente continuará sendo utilizada.')) return;
                void run(() => api('/admin/ai/settings', { method: 'DELETE' }), 'Configuração do cofre removida.');
              }}>
              Remover configuração
            </button>
          </div>
        </form>
        <p className="muted small" style={{ marginTop: 12 }}>{s.data?.note ?? 'Carregando…'} O envio de conversas ao provedor obedece às regras de privacidade e permissões da IA POSSEBON.</p>
      </section>
      <section className="card">
        <h3>Consumo e limites</h3>
        {s.data && <Kv obj={{ dailyRequestsPerUser: s.data.dailyRequestsPerUser, chatPerMinute: s.data.chatPerMinute, lastUpdatedAt: s.data.lastUpdatedAt ?? '—' }} />}
      </section>
      <section className="card">
        <h3>Uso nos últimos 30 dias</h3>
        {!u.data?.length ? <p className="muted">Sem chamadas registradas.</p> : (
          <table className="data"><thead><tr><th>Dia</th><th>Provedor/modelo</th><th>Chamadas</th><th>Tokens entrada</th><th>Tokens saída</th><th>Falhas</th></tr></thead>
            <tbody>{u.data.map((r, i) => <tr key={i}><td>{formatDateTime(String(r.dia)).slice(0, 10)}</td><td>{String(r.provider)} / {String(r.model)}</td><td className="num">{String(r.chamadas)}</td><td className="num">{String(r.entrada)}</td><td className="num">{String(r.saida)}</td><td className="num">{String(r.falhas)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Policies() {
  const { data } = useLoad<Record<string, unknown>>('/admin/policies');
  if (!data) return <div className="skeleton" style={{ height: 120 }} />;
  const { myEffectiveContext, ...rest } = data;
  return (
    <div className="grid">
      <section className="card"><h3>Regras</h3><Kv obj={rest} /></section>
      <section className="card"><h3>Seu contexto efetivo (vindo do POSSEBON)</h3><pre className="code">{JSON.stringify(myEffectiveContext, null, 2)}</pre></section>
    </div>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const { data, reload } = useLoad<{ id: number; occurred_at: string; actor_user_id: number | null; unit_id: number | null; action: string; target_type: string | null; target_id: string | null; outcome: string; details: unknown }[]>(`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ''}`);
  return (
    <section className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" style={{ maxWidth: 300 }} placeholder="Filtrar ação (ex.: monitor., sso.)" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filtrar por ação" />
        <button className="btn sm" onClick={reload}>↻</button>
        <span className="muted small">Trilha imutável. Não contém texto de conversas nem segredos.</span>
      </div>
      <div style={{ overflow: 'auto' }}>
        <table className="data">
          <thead><tr><th>Quando</th><th>Ator</th><th>Unidade</th><th>Ação</th><th>Alvo</th><th>Resultado</th><th>Detalhes</th></tr></thead>
          <tbody>{data?.map((e) => (
            <tr key={e.id}><td className="small">{formatDateTime(e.occurred_at)}</td><td>{e.actor_user_id ?? 'sistema'}</td><td>{e.unit_id ?? '—'}</td><td>{e.action}</td><td className="small">{e.target_type ? `${e.target_type} ${e.target_id ?? ''}` : '—'}</td><td><Status s={e.outcome} /></td><td className="small">{JSON.stringify(e.details)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function AdminView() {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('saude');
  const panels: Record<string, ReactNode> = { saude: <Health />, conhecimento: <Knowledge />, conectores: <Connectors />, email: <Email />, ia: <Ai />, politicas: <Policies />, auditoria: <Audit /> };
  return (
    <>
      <header className="topbar"><h1 className="grow" style={{ paddingLeft: 36 }}>Administração da IA POSSEBON</h1><span className="badge">Acesso restrito</span></header>
      <div className="content">
        <div className="tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className="tab" onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>{panels[tab]}</div>
      </div>
    </>
  );
}
