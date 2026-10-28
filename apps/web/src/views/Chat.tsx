import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardSpec, RuleDefinition, WidgetData } from '@ada/contracts';
import { formatDateTime } from '@ada/domain/format';
import { api, ApiError } from '../api.ts';
import { useApp } from '../app-context.ts';
import { DashboardCanvas } from '../components/DashboardCanvas.tsx';

interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system_note';
  content: string;
  metadata?: {
    mode?: string;
    notes?: string[];
    dashboardDraft?: DashboardSpec;
    savedDashboardId?: string;
    monitorProposal?: { definition: RuleDefinition; preview: { summary: string[]; warnings: string[] } };
    knowledge?: { title: string; source: string; excerpt: string; observedAt: string; uri: string | null }[];
  };
  createdAt?: string;
}

const SUGGESTIONS = [
  'cria efetivo por equipe nos últimos seis meses',
  'mostra os por status nos últimos seis meses',
  'cria solicitações de compra por categoria nos últimos seis meses',
  'monitore a OS 123 e me avise quando mudarem o prazo ou quando ficar 48h sem avanço',
  'ajuda'
];

function MonitorProposal({ m }: { m: NonNullable<NonNullable<Msg['metadata']>['monitorProposal']> }) {
  const { navigate } = useApp();
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'discarded'>('idle');
  const [err, setErr] = useState('');
  if (state === 'discarded') return <div className="msg-meta">Proposta descartada.</div>;
  return (
    <div className="proposal" aria-label="Proposta de acompanhamento">
      <strong>Acompanhamento proposto — {m.definition.name}</strong>
      <ul>{m.preview.summary.map((s) => <li key={s}>{s}</li>)}</ul>
      {m.preview.warnings.map((w) => <div key={w} className="small">⚠ {w}</div>)}
      {state === 'done' ? (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="badge good">✓ Ativado</span>
          <button className="btn sm" onClick={() => navigate('/acompanhamentos')}>Ver acompanhamentos</button>
        </div>
      ) : (
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn primary sm"
            disabled={state === 'saving'}
            onClick={async () => {
              setState('saving');
              try {
                await api('/monitors', { body: { definition: m.definition, activate: true } });
                setState('done');
              } catch (e) {
                setErr((e as Error).message);
                setState('idle');
              }
            }}
          >
            Confirmar e ativar
          </button>
          <button className="btn ghost sm" onClick={() => setState('discarded')}>Descartar</button>
        </div>
      )}
      {err && <div className="error-box small" role="alert">{err}</div>}
    </div>
  );
}

export function ChatView() {
  const { me, theme } = useApp();
  const params = new URLSearchParams(window.location.search);
  const [conversationId, setConversationId] = useState<string | undefined>(params.get('c') ?? undefined);
  const [pendingDashboardId, setPendingDashboardId] = useState<string | undefined>(params.get('dashboard') ?? undefined);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState<DashboardSpec | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();
  const [data, setData] = useState<WidgetData[] | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataErr, setDataErr] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (spec: DashboardSpec, refresh = false) => {
    setDataLoading(true);
    setDataErr('');
    try {
      const r = await api<{ data: WidgetData[] }>('/dashboards/preview', { body: { spec, refresh } });
      setData(r.data);
    } catch (e) {
      setDataErr((e as Error).message);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      api<{ messages: Msg[]; draft: { spec: DashboardSpec; savedDashboardId?: string } | null }>(`/conversations/${conversationId}`)
        .then((r) => {
          setMessages(r.messages);
          if (r.draft) {
            setDraft(r.draft.spec);
            setSavedId(r.draft.savedDashboardId);
            void loadData(r.draft.spec);
          }
        })
        .catch((e) => setErr(e instanceof ApiError && e.status === 404 ? 'Conversa não encontrada.' : (e as Error).message));
    } else if (pendingDashboardId) {
      api<{ spec: DashboardSpec; id: string }>(`/dashboards/${pendingDashboardId}`)
        .then((d) => {
          setDraft(d.spec);
          setSavedId(d.id);
          void loadData(d.spec);
        })
        .catch((e) => setErr((e as Error).message));
    }
    // carregamento inicial apenas
  }, []);

  // Corpo em bloco: em navegadores recentes scrollIntoView() retorna Promise, que não pode virar "cleanup" do efeito.
  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setErr('');
    setInput('');
    const tmp: Msg = { id: 'tmp-' + Date.now(), role: 'user', content: message };
    setMessages((m) => [...m, tmp]);
    try {
      const r = await api<{ conversationId: string; message: Msg }>('/chat', { body: { message, conversationId, dashboardId: conversationId ? undefined : pendingDashboardId } });
      if (!conversationId) {
        setConversationId(r.conversationId);
        window.history.replaceState(null, '', `${window.location.pathname}?c=${r.conversationId}`);
      }
      setPendingDashboardId(undefined);
      setMessages((m) => [...m, r.message]);
      const meta = r.message.metadata ?? {};
      if (meta.savedDashboardId) setSavedId(meta.savedDashboardId);
      if (meta.dashboardDraft && JSON.stringify(meta.dashboardDraft) !== JSON.stringify(draft)) {
        setDraft(meta.dashboardDraft);
        void loadData(meta.dashboardDraft);
      }
    } catch (e) {
      setErr((e as Error).message);
      setMessages((m) => m.filter((x) => x.id !== tmp.id));
      setInput(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <h1 className="grow" style={{ paddingLeft: 36 }}>Conversa com a ADA</h1>
        <span className="badge">{me.ai.configured ? `IA: ${me.ai.provider}` : 'Interpretador determinístico (sem IA)'}</span>
      </header>
      <div className={`chat-layout ${draft ? '' : 'no-canvas'}`} style={{ flex: 1, minHeight: 0 }}>
        <section className="chat-pane" aria-label="Conversa">
          <div className="messages" role="log" aria-live="polite" aria-busy={busy}>
            {messages.length === 0 && !err && (
              <div className="empty" style={{ marginTop: 20 }}>
                <strong>Olá, {me.user.displayName.split(' ')[0]}.</strong>
                Pergunte sobre indicadores, peça dashboards ou crie acompanhamentos. Uso somente dados que você tem permissão para ver na unidade{' '}
                <strong style={{ display: 'inline' }}>{me.activeUnit.name}</strong>.
                {me.demoData && <p className="small">Este ambiente usa DADOS SINTÉTICOS de demonstração.</p>}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
                {m.content}
                {m.metadata?.monitorProposal && <MonitorProposal m={m.metadata.monitorProposal} />}
                {m.metadata?.knowledge && m.metadata.knowledge.length > 0 && (
                  <ol className="citations" aria-label="Fontes consultadas">
                    {m.metadata.knowledge.slice(0, 5).map((k, i) => (
                      <li key={i}>
                        {k.uri ? <a href={k.uri} target="_blank" rel="noopener noreferrer">{k.title}</a> : k.title} — {k.source} · observado em {formatDateTime(k.observedAt)}
                      </li>
                    ))}
                  </ol>
                )}
                {m.role === 'assistant' && (
                  <div className="msg-meta">
                    <span>{m.metadata?.mode === 'openai' ? 'IA' : 'Interpretador determinístico'}</span>
                    {m.createdAt && <span>{formatDateTime(m.createdAt)}</span>}
                    {m.metadata?.notes?.filter((n) => n.length > 25 && !m.content.includes(n)).map((n) => <span key={n}>· {n}</span>)}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="msg assistant" aria-label="ADA está respondendo"><span className="skeleton" style={{ display: 'inline-block', width: 120, height: 12 }} /></div>}
            {err && <div className="error-box" role="alert">{err}</div>}
            <div ref={endRef} />
          </div>
          {messages.length === 0 && (
            <div className="suggestions" aria-label="Sugestões">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="chat-input" className="sr-only">Mensagem para a ADA</label>
            <textarea
              id="chat-input"
              className="textarea"
              rows={2}
              value={input}
              maxLength={4000}
              placeholder={draft ? 'Refine: "muda para linhas", "compara com o previsto", "salva como …"' : 'Pergunte ou peça um dashboard…'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <button className="btn primary" disabled={busy || !input.trim()} aria-label="Enviar mensagem">Enviar</button>
          </form>
        </section>
        {draft && (
          <section className="canvas-pane" aria-label="Dashboard em edição">
            <div className="dash-head">
              <div className="grow">
                <h2>{draft.title}</h2>
                <div className="muted small">{savedId ? 'Salvo — alterações nesta conversa geram nova revisão ao salvar novamente' : 'Rascunho (não salvo)'}</div>
              </div>
              <button className="btn sm" onClick={() => void loadData(draft, true)} disabled={dataLoading}>↻ Atualizar</button>
              {conversationId && (
                <button
                  className="btn sm"
                  onClick={async () => {
                    try {
                      const r = await api<{ draft: { spec: DashboardSpec } }>(`/conversations/${conversationId}/undo`, { body: {} });
                      setDraft(r.draft.spec);
                      void loadData(r.draft.spec);
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                >
                  ↶ Desfazer
                </button>
              )}
              <button
                className="btn primary sm"
                onClick={() => {
                  const title = window.prompt('Salvar dashboard como:', draft.title);
                  if (title?.trim()) void send(`salva como ${title.trim()}`);
                }}
              >
                Salvar
              </button>
            </div>
            {dataErr && <div className="error-box" role="alert">{dataErr}</div>}
            <DashboardCanvas spec={draft} data={data} theme={theme} loading={dataLoading && !data} />
          </section>
        )}
      </div>
    </>
  );
}
