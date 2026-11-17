import { useBranding } from '../branding.tsx';

/** Identidade institucional: não permitir renomear o POSSO por engano. */
export function BrandingSettings() {
  const { name } = useBranding();
  return <section className="card">
    <h2>Identidade do POSSO</h2>
    <p><strong>{name}</strong> — assistente virtual da POSSEBON.</p>
    <p className="muted">O nome homenageia o fundador da POSSEBON: POSSO era seu apelido. A identidade oficial é única para todas as unidades e para todas as formas de atendimento, incluindo o chat e a voz.</p>
    <p className="muted small">Os nomes técnicos de arquivos, tabelas e rotas antigos continuam preservados para compatibilidade. Eles não definem como a IA se apresenta.</p>
  </section>;
}
