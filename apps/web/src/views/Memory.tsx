import { useEffect, useState } from 'react';
import { formatDateTime } from '@ada/domain/format';
import { api, apiUrl } from '../api.ts';
import { useApp } from '../app-context.ts';

interface Memory {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
}
interface Prefs {
  theme: string;
  remember_conversations: boolean;
  retention_days: number;
  quiet_hours: { start: string; end: string } | null;
}

export function MemoryView() {
  const { theme, setTheme } = useApp();
  const [mem, setMem] = useState<Memory[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    api<Memory[]>('/memory').then(setMem).catch((e) => setErr((e as Error).message));
    api<Prefs>('/preferences').then(setPrefs).catch(() => undefined);
  };
  useEffect(() => {
    load();
  }, []);

  const savePrefs = async (p: Partial<Prefs>) => {
    try {
      setPrefs(await api<Prefs>('/preferences', { method: 'PUT', body: p }));
      setMsg('Preferências salvas.');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <header className="topbar"><h1 className="grow" style={{ paddingLeft: 36 }}>Memória e preferências</h1></header>
      <div className="content grid" style={{ maxWidth: 900 }}>
        {msg && <div className="note-box" role="status">{msg}</div>}
        {err && <div className="error-box" role="alert">{err}</div>}
        <section className="card">
          <h2>O que a ADA lembra sobre você</h2>
          <p className="muted small">Somente você vê e controla estas memórias. Elas são cifradas e usadas apenas nas suas conversas.</p>
          <form className="row" onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            try {
              await api('/memory', { body: { content: text.trim(), kind: 'preferencia' } });
              setText('');
              load();
            } catch (er) {
              setErr((er as Error).message);
            }
          }}>
            <label htmlFor="mem" className="sr-only">Nova memória</label>
            <input id="mem" className="input grow" maxLength={2000} placeholder="Ex.: prefiro gráficos de linhas para efetivo" value={text} onChange={(e) => setText(e.target.value)} />
            <button className="btn primary">Lembrar</button>
          </form>
          {!mem ? <div className="skeleton" style={{ height: 40, marginTop: 10 }} /> : mem.length === 0 ? <p className="muted">Nada registrado.</p> : (
            <ul className="list" style={{ listStyle: 'none', padding: 0, marginTop: 10 }}>
              {mem.map((m) => (
                <li key={m.id} className="list-item">
                  <div className="grow">{m.content}<div className="muted small">{formatDateTime(m.createdAt)}</div></div>
                  <button className="btn ghost sm danger" onClick={async () => (await api(`/memory/${m.id}`, { method: 'DELETE' }), load())}>Esquecer</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Preferências</h2>
          {prefs && (
            <div className="grid" style={{ gap: 12 }}>
              <label className="field">
                Tema
                <select className="select" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="auto">Automático (sistema)</option>
                  <option value="dark">Escuro</option>
                  <option value="light">Claro</option>
                </select>
              </label>
              <label className="field">
                Reter conversas por (dias)
                <input className="input" type="number" min={7} max={3650} defaultValue={prefs.retention_days} onBlur={(e) => void savePrefs({ retention_days: Number(e.target.value) })} />
              </label>
              <fieldset className="field" style={{ border: 0, padding: 0 }}>
                <legend>Horário silencioso (para futuros canais push/e-mail; a central sempre registra)</legend>
                <div className="row">
                  <input className="input" style={{ width: 120 }} type="time" aria-label="Início" defaultValue={prefs.quiet_hours?.start ?? ''} id="qh-start" />
                  <input className="input" style={{ width: 120 }} type="time" aria-label="Fim" defaultValue={prefs.quiet_hours?.end ?? ''} id="qh-end" />
                  <button className="btn sm" onClick={() => {
                    const s = (document.getElementById('qh-start') as HTMLInputElement).value;
                    const en = (document.getElementById('qh-end') as HTMLInputElement).value;
                    void savePrefs({ quiet_hours: s && en ? { start: s, end: en } : null });
                  }}>Salvar horário</button>
                </div>
              </fieldset>
            </div>
          )}
        </section>
        <section className="card">
          <h2>Seus dados (LGPD)</h2>
          <p className="muted small">Exporte suas conversas, memórias e preferências. Para excluir uma conversa, use “Minhas conversas”.</p>
          <a className="btn" href={apiUrl('/me/export')} download>Exportar meus dados (JSON)</a>
        </section>
      </div>
    </>
  );
}
