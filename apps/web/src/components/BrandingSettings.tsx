import { useState, type FormEvent } from 'react';
import { api } from '../api.ts';
import { useBranding } from '../branding.tsx';

export function BrandingSettings() {
  const { name, setName } = useBranding();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? name;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const saved = await api<{ name: string }>('/admin/branding', { method: 'PUT', body: { name: value } });
      setName(saved.name); setDraft(null);
      setMessage('Nome atualizado para todos. Outras sessões abertas recebem a mudança em até 30 segundos ou ao voltar à janela.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="card">
    <h2>Identidade da assistente</h2>
    <p className="muted small">Nome atual: {name}. Esta configuração vale para todos os usuários e unidades, na interface e nas novas respostas. Conversas antigas são preservadas.</p>
    <form onSubmit={event => { void save(event); }}>
      <label className="field" htmlFor="assistant-name">Nome da assistente
        <input id="assistant-name" className="input" value={value} onChange={event => setDraft(event.target.value)}
          required maxLength={60} disabled={busy} autoComplete="off" aria-describedby="assistant-name-help" />
      </label>
      <p id="assistant-name-help" className="muted small">Até 60 caracteres. Use letras, números, espaços ou pontuação simples.</p>
      <button className="btn primary" disabled={busy || !value.trim() || value.trim() === name}>
        {busy ? 'Salvando…' : 'Salvar nome'}
      </button>
    </form>
    {error && <p className="error-box" role="alert">{error}</p>}
    {message && <p className="note-box" role="status">{message}</p>}
  </section>;
}
