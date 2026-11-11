import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('contrato de navegação de dashboards no MAD Builder', () => {
  it('prioriza painel-pessoal antes da experiência simplificada de usuários comuns', () => {
    const app = read('../apps/web/src/App.tsx');
    expect(app).toMatch(/embeddedDashboard\s*\?\s*<EmbeddedDashboard\s*\/>\s*:\s*!me\.isAdmin/);
  });

  it('encaminha a listagem e os detalhes para a área principal, não para a caixinha', () => {
    const widget = read('../integration/possebon-web/public/possebon-assistant-global.js');
    expect(widget).toContain("document.getElementById('adianti_div_content')");
    expect(widget).toContain("if (path && !/^\\/(?:telas|dashboards)(?:\\/[0-9a-f-]{36})?$/.test(path)) return;");
    expect(widget).toContain("if (path && path !== '/dashboards') url.searchParams.set('view', path)");
    expect(widget).toContain("if (event.data?.type === 'possebon:open-dashboard') openDashboard(event.data.path || '')");
    const compact = read('../apps/web/src/views/CompactChat.tsx');
    expect(compact).toContain("window.parent.postMessage({type:'possebon:open-dashboard'");
    const personal = read('../apps/web/src/views/PersonalExperience.tsx');
    expect(personal).toContain("window.parent.postMessage({type:'possebon:open-dashboard'");
  });

  it('mostra apenas a resposta do POSSO sem fontes, metadados e detalhes de consulta', () => {
    const chat = read('../apps/web/src/views/Chat.tsx');
    const live = read('../apps/web/src/views/LiveBoards.tsx');
    expect(chat).not.toContain('Detalhes da consulta');
    expect(chat).not.toContain('Fontes consultadas');
    expect(chat).not.toContain('m.metadata?.notes?.filter');
    expect(live).not.toContain('Fonte: {p.provenance.source}');
  });
  it('abre exclusivamente o Dashboard pessoal da sessão e não mostra botões de lista ou fechamento', () => {
    const embedded = read('../apps/web/src/views/EmbeddedDashboard.tsx');
    const widget = read('../integration/possebon-web/public/possebon-assistant-global.js');
    const app = read('../apps/web/src/App.tsx');
    expect(embedded).toContain("'/workspace/personal-dashboard'");
    expect(embedded).toContain('<LiveBoardDetail id={dashboardId} personal />');
    expect(embedded).not.toContain('DashboardsView');
    expect(embedded).not.toContain('Meus dashboards');
    expect(widget).not.toContain('Fechar Dashboard');
    expect(app).toContain("['/painel-pessoal', 'Meu Dashboard', 'grid']");
    expect(app).not.toContain("['/dashboards', 'Meus dashboards'");
  });
});
