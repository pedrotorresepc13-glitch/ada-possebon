import { useEffect, useState } from 'react';
import { formatDateTime } from '@ada/domain/format';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';

interface Conv {
  id: string;
  title: string;
  updated_at: string;
  dashboard_id: string | null;
}

export function ConversationsView() {
  const { navigate } = useApp();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Conv[] | null>(null);
  const [err, setErr] = useState('');

  const load = (search = q) =>
    api<Conv[]>(`/conversations${search ? `?q=${encodeURIComponent(search)}` : ''}`)
      .then(setItems)
      .catch((e) => setErr((e as Error).message));

  useEffect(() => {
    void load('');
  }, []);

  return (
    <>
      <header className="topbar">
        <h1 className="grow" style={{ paddingLeft: 36 }}>Minhas conversas</h1>
        <button className="btn primary sm" onClick={() => navigate('/?nova=' + Date.now())}>Nova conversa</button>
      </header>
      <div className="content">
        <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => (e.preventDefault(), void load())} role="search">
          <label htmlFor="busca-conv" className="sr-only">Buscar conversas</label>
          <input id="busca-conv" className="input grow" placeholder="Buscar pelo título…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">Buscar</button>
        </form>
        <p className="muted small">Suas conversas são privadas: nem gestores nem administradores têm acesso a elas pela IA POSSEBON.</p>
        {err && <div className="error-box" role="alert">{err}</div>}
        {!items ? (
          <div className="list">{[1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 54 }} />)}</div>
        ) : items.length === 0 ? (
          <div className="empty"><strong>Nenhuma conversa</strong>Comece uma nova conversa pelo menu.</div>
        ) : (
          <ul className="list" style={{ listStyle: 'none', padding: 0 }}>
            {items.map((c) => (
              <li key={c.id} className="list-item">
                <div className="grow">
                  <a href="#" onClick={(e) => (e.preventDefault(), navigate(`/?c=${c.id}`))}><strong>{c.title}</strong></a>
                  <div className="muted small">Atualizada em {formatDateTime(c.updated_at)}{c.dashboard_id ? ' · com dashboard salvo' : ''}</div>
                </div>
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    const t = window.prompt('Novo título:', c.title);
                    if (t?.trim()) {
                      await api(`/conversations/${c.id}`, { method: 'PATCH', body: { title: t.trim() } });
                      void load();
                    }
                  }}
                >
                  Renomear
                </button>
                <button
                  className="btn ghost sm danger"
                  onClick={async () => {
                    if (window.confirm('Excluir esta conversa e todas as mensagens? Esta ação não pode ser desfeita.')) {
                      await api(`/conversations/${c.id}`, { method: 'DELETE' });
                      void load();
                    }
                  }}
                >
                  Excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
