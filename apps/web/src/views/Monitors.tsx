import { useEffect, useRef, useState } from 'react';
import type { RuleDefinition } from '@ada/contracts';
import { formatDateTime } from '@ada/domain/format';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';

interface MonitorRow {
  id: string;
  name: string;
  source_id: string;
  status: 'draft' | 'active' | 'paused' | 'degraded';
  health: 'ok' | 'degradado' | 'erro';
  last_error: string | null;
  check_every_minutes: number;
  last_run_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  definition: RuleDefinition;
  current_revision: number;
}

const STATUS: Record<string, [string, string]> = {
  draft: ['Rascunho (inativo)', ''],
  active: ['● Ativo', 'good'],
  paused: ['❚❚ Pausado', ''],
  degraded: ['▲ Degradado', 'warn']
};

interface History {
  runs: { id: string; trigger_kind: string; started_at: string; status: string; records_checked: number; events_created: number; ai_calls: number; error: string | null }[];
  events: { id: string; title: string; body: string; status: string; occurred_at: string }[];
  revisions: { revision: number; change_summary: string; created_at: string }[];
}

export function MonitorsView() {
  const { navigate } = useApp();
  const [items, setItems] = useState<MonitorRow[] | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [history, setHistory] = useState<{ m: MonitorRow; h: History } | null>(null);
  const [editing, setEditing] = useState<MonitorRow | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const editDlg = useRef<HTMLDialogElement>(null);

  const load = () => api<MonitorRow[]>('/monitors').then(setItems).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (history) dlg.current?.showModal();
  }, [history]);
  useEffect(() => {
    if (editing) editDlg.current?.showModal();
  }, [editing]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setErr('');
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <header className="topbar">
        <h1 className="grow" style={{ paddingLeft: 36 }}>Acompanhamentos</h1>
        <button className="btn primary sm" onClick={() => navigate('/?nova=' + Date.now())}>Criar pela conversa</button>
      </header>
      <div className="content">
        <p className="muted small">A IA apenas ajuda a escrever a regra. As verificações são feitas por um motor determinístico, sem IA, e os alertas chegam somente para você.</p>
        {msg && <div className="note-box" role="status" style={{ marginBottom: 10 }}>{msg}</div>}
        {err && <div className="error-box" role="alert" style={{ marginBottom: 10 }}>{err}</div>}
        {!items ? (
          <div className="skeleton" style={{ height: 80 }} />
        ) : items.length === 0 ? (
          <div className="empty"><strong>Nenhum acompanhamento</strong>Diga na conversa, por exemplo: “monitore a OS 123 e me avise se o prazo mudar ou ficar 48h sem avanço”.</div>
        ) : (
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {items.map((m) => {
              const [label, cls] = STATUS[m.status] ?? [m.status, ''];
              return (
                <li key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 240 }}>
                    <div className="row">
                      <strong>{m.name}</strong>
                      <span className={`badge ${cls}`}>{label}</span>
                      {m.health !== 'ok' && <span className={`badge ${m.health === 'erro' ? 'crit' : 'warn'}`}>Saúde: {m.health}</span>}
                    </div>
                    <div className="muted small">
                      Fonte {m.source_id} · a cada {m.check_every_minutes} min · revisão {m.current_revision}
                      {m.last_success_at ? ` · última verificação bem-sucedida ${formatDateTime(m.last_success_at)}` : ' · ainda sem verificação concluída'}
                      {m.status === 'active' && m.next_run_at ? ` · próxima ${formatDateTime(m.next_run_at)}` : ''}
                    </div>
                    {m.last_error && <div className="small" style={{ color: 'var(--warning)' }}>⚠ {m.last_error}</div>}
                  </div>
                  <div className="row">
                    {m.status === 'active' || m.status === 'degraded' ? (
                      <button className="btn sm" onClick={() => act(() => api(`/monitors/${m.id}/pause`, { body: {} }), 'Acompanhamento pausado.')}>Pausar</button>
                    ) : (
                      <button className="btn sm" onClick={() => act(() => api(`/monitors/${m.id}/resume`, { body: {} }), 'Acompanhamento ativado.')}>{m.status === 'draft' ? 'Ativar' : 'Retomar'}</button>
                    )}
                    <button
                      className="btn sm"
                      onClick={() =>
                        act(async () => {
                          const p = await api<{ valid: boolean; errors: string[]; simulation?: { recordsMatched: number; wouldTriggerNow: { title: string }[] } }>(`/monitors/${m.id}/test`, { body: {} });
                          if (!p.valid) throw new Error('Teste: ' + p.errors.join(' '));
                          setMsg(`Teste (simulação, sem notificar): ${p.simulation?.recordsMatched ?? 0} registro(s) encontrado(s); dispararia agora: ${p.simulation?.wouldTriggerNow.map((x) => x.title).join('; ') || 'nada'}.`);
                        }, '')
                      }
                    >
                      Testar
                    </button>
                    <button className="btn sm" onClick={async () => setHistory({ m, h: await api<History>(`/monitors/${m.id}/history`) })}>Histórico</button>
                    <button className="btn sm" onClick={() => setEditing(m)}>Editar</button>
                    <button
                      className="btn sm danger"
                      onClick={() => window.confirm(`Excluir "${m.name}"? As verificações param imediatamente.`) && act(() => api(`/monitors/${m.id}`, { method: 'DELETE' }), 'Acompanhamento excluído.')}
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <dialog ref={dlg} onClose={() => setHistory(null)} aria-labelledby="hist-title">
        {history && (
          <div className="dialog-body">
            <div className="row"><h2 id="hist-title" className="grow" style={{ margin: 0, fontSize: 16 }}>Histórico — {history.m.name}</h2><button className="btn sm" onClick={() => dlg.current?.close()}>Fechar</button></div>
            <h3 style={{ margin: 0, fontSize: 14 }}>Ocorrências</h3>
            {history.h.events.length === 0 ? <p className="muted">Nenhuma ocorrência registrada.</p> : (
              <table className="data"><tbody>{history.h.events.map((e) => <tr key={e.id}><td>{formatDateTime(e.occurred_at)}</td><td>{e.title}<div className="muted small">{e.body}</div></td><td>{e.status}</td></tr>)}</tbody></table>
            )}
            <h3 style={{ margin: 0, fontSize: 14 }}>Execuções</h3>
            <table className="data">
              <thead><tr><th>Início</th><th>Tipo</th><th>Resultado</th><th>Registros</th><th>Eventos</th><th>Chamadas de IA</th></tr></thead>
              <tbody>{history.h.runs.map((r) => <tr key={r.id}><td>{formatDateTime(r.started_at)}</td><td>{r.trigger_kind}</td><td>{r.status}{r.error ? ` — ${r.error}` : ''}</td><td className="num">{r.records_checked}</td><td className="num">{r.events_created}</td><td className="num">{r.ai_calls}</td></tr>)}</tbody>
            </table>
            <h3 style={{ margin: 0, fontSize: 14 }}>Revisões</h3>
            <ul>{history.h.revisions.map((r) => <li key={r.revision}>Revisão {r.revision} — {r.change_summary} — {formatDateTime(r.created_at)}</li>)}</ul>
          </div>
        )}
      </dialog>

      <dialog ref={editDlg} onClose={() => setEditing(null)} aria-labelledby="edit-title">
        {editing && (
          <form
            className="dialog-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const def = { ...editing.definition, name: String(f.get('name')), cooldown_minutes: Number(f.get('cooldown')), check_every_minutes: Number(f.get('every')) };
              await act(() => api(`/monitors/${editing.id}`, { method: 'PUT', body: { definition: def } }), 'Regra atualizada (nova revisão; histórico preservado).');
              editDlg.current?.close();
            }}
          >
            <h2 id="edit-title" style={{ margin: 0, fontSize: 16 }}>Editar acompanhamento</h2>
            <label className="field">Nome<input name="name" className="input" defaultValue={editing.name} maxLength={120} required /></label>
            <label className="field">Verificar a cada (minutos)<input name="every" type="number" min={5} max={1440} className="input" defaultValue={editing.check_every_minutes} /></label>
            <label className="field">Intervalo mínimo entre alertas iguais (minutos)<input name="cooldown" type="number" min={0} max={10080} className="input" defaultValue={editing.definition.cooldown_minutes} /></label>
            <p className="muted small">Para mudar gatilhos, descreva a mudança na conversa — a ADA propõe uma nova regra para você confirmar.</p>
            <div className="row"><button className="btn primary">Salvar</button><button type="button" className="btn" onClick={() => editDlg.current?.close()}>Cancelar</button></div>
          </form>
        )}
      </dialog>
    </>
  );
}
