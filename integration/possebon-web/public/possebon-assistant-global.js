/* POSSEBON GLOBAL WIDGET v2. POSSEBON Web: conversa global, sessão obtida do servidor, sem tokens em URLs. */
(() => {
  'use strict';
  if (window.PossebonAssistant || window.parent !== window) return;
  const script = document.currentScript;
  const base = new URL(script.dataset.base || '/ada/', location.origin);
  const bridge = script.dataset.bridge ? new URL(script.dataset.bridge, document.baseURI) : new URL('../ada-assistant.php', base);
  if (base.origin !== location.origin || bridge.origin !== location.origin || !base.pathname.endsWith('/')) return;
  let identity, host, root, frame, launcher, panel, status, retry, title, bell, badge, chatBadge;
  let context = null, opened = false, connecting = false, ready = false;
  let generation = 0, timeout, checking, brandingRevision = 0;

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(12000), ...options });
    if (response.status === 401 || response.status === 403) {
      if (new URL(url).href === bridge.href) dispose();
      throw new Error('Abra novamente o POSSEBON Web com um usuário autorizado.');
    }
    if (!response.ok) throw new Error('Não foi possível conectar. Tente novamente.');
    return response.json();
  }
  function dispose() {
    generation++;
    clearTimeout(timeout);
    host?.remove();
    dashboardView?.remove();
    identity = host = root = frame = launcher = panel = status = retry = title = undefined;
    opened = connecting = ready = false;
    context = null;
  }
  function suppressDuplicate() {
    if (!host) return;
    // O painel completo já contém seu próprio botão. Nosso iframe fica no Shadow DOM.
    const fullPanel = Array.from(document.querySelectorAll('iframe')).some(element => {
      if (element.dataset.possebonPersonal === 'true' || element.closest('[data-possebon-personal-dashboard]')) return false;
      if (element.name === 'ada_frame') return true;
      try { const url = new URL(element.src, location.href); return url.origin === base.origin && url.pathname.startsWith(base.pathname); }
      catch { return false; }
    });
    host.hidden = fullPanel;
    if (fullPanel && opened) close();
  }
  let dashboardView;
  function openDashboard(path = '') {
    const container = document.getElementById('adianti_div_content');
    if (!container) { showError('A área principal do sistema não está disponível nesta página.'); return; }
    if (path && !/^\/(?:telas|dashboards)\/[0-9a-f-]{36}$/.test(path)) return;
    dashboardView?.remove();
    dashboardView = document.createElement('section');
    dashboardView.dataset.possebonPersonalDashboard = 'true';
    const style = document.createElement('style');
    style.textContent = '#adianti_div_content:has(> [data-possebon-personal-dashboard]) > :not([data-possebon-personal-dashboard]){display:none!important}';
    const back = document.createElement('button');
    back.className = 'btn btn-default'; back.textContent = 'Fechar Dashboard';
    back.onclick = () => dashboardView?.remove();
    const dashboard = document.createElement('iframe');
    dashboard.title = 'Dashboard da Posso';
    const url = new URL('painel-pessoal', base);
    if (path) url.searchParams.set('view', path);
    dashboard.src = url.href;
    dashboard.style.cssText = 'display:block;width:100%;height:calc(100vh - 180px);min-height:400px;border:0';
    dashboardView.append(style, back, dashboard); container.prepend(dashboardView);
    close();
  }
  function showPanel(name) {
    if (ready) frame?.contentWindow?.postMessage({type:'possebon:show-panel',panel:name}, location.origin);
  }

  function contextFromPage() {
    // Apenas uma pista do controlador; tabelas e IDs entram por integração explícita.
    const controller = new URL(location.href).searchParams.get('class');
    return controller && /^[A-Za-z][A-Za-z0-9_]{0,119}$/.test(controller) ? { module: controller } : null;
  }
  function sendContext() {
    if (ready) frame?.contentWindow?.postMessage({ type: 'possebon:context', context }, location.origin);
  }
  function updateContext(value) {
    context = value && typeof value.module === 'string' && value.module.length <= 120 ? {
      module: value.module,
      table: typeof value.table === 'string' && /^[a-z][a-z0-9_]{0,62}$/.test(value.table) ? value.table : undefined,
      recordId: Number.isSafeInteger(value.recordId) && value.recordId > 0 ? value.recordId : undefined
    } : null;
    sendContext();
  }
  async function checkAccess() {
    if (checking) return checking;
    checking = (async () => {
      const value = await request(bridge);
      if (!value.allowed || !Number.isSafeInteger(value.userId) || !Number.isSafeInteger(value.unitId) || !/^[a-f0-9]{64}$/.test(value.csrf)) throw new Error('Sessão de integração inválida.');
      if (new URL(value.baseUrl).href !== base.href) throw new Error('Confira o endereço da assistente na integração.');
      if (identity && (identity.userId !== value.userId || identity.unitId !== value.unitId)) dispose();
      identity = value;
      if (!host) mount();
      suppressDuplicate();
      return value;
    })().finally(() => { checking = undefined; });
    return checking;
  }
  async function sessionMatches() {
    try {
      const me = await request(new URL('api/ada/me', base));
      return me.user?.systemUserId === identity?.userId && me.activeUnit?.id === identity?.unitId;
    } catch { return false; }
  }
  async function ensureSession() {
    if (await sessionMatches()) return;
    frame?.remove(); frame = undefined; ready = false;
    const response = await request(bridge, { method: 'POST', headers: { 'X-Possebon-CSRF': identity.csrf } });
    const action = new URL(response.action);
    if (action.href !== new URL('api/ada/session/exchange', base).href || typeof response.ticket !== 'string' || response.ticket.length > 4096) throw new Error('Resposta de integração inválida.');
    await request(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket: response.ticket }) });
    if (!await sessionMatches()) throw new Error('A sessão da assistente não corresponde ao usuário e à unidade atuais.');
  }
  async function notifications() {
    const current = generation, who = identity;
    if (!host || !who || !await sessionMatches()) { if(badge) badge.hidden = true; if(chatBadge) chatBadge.hidden = true; return; }
    try {
      const value = await request(new URL('api/ada/notifications/count', base));
      if (current !== generation || who !== identity || !host) return;
      const unread = Number.isSafeInteger(value.unread) && value.unread >= 0 ? value.unread : 0;
      for (const item of [badge, chatBadge]) { item.textContent = unread > 99 ? '99+' : String(unread); item.hidden = unread === 0; }
      bell.setAttribute('aria-label', 'Notificações: ' + unread + ' não lidas');
    } catch { badge.hidden = true; chatBadge.hidden = true; }
  }
  async function branding() {
    const revision = ++brandingRevision;
    try {
      const value = await request(new URL('api/ada/branding', base));
      if (!host || revision !== brandingRevision || typeof value.name !== 'string') return;
      const name = value.name.slice(0, 80);
      title.textContent = name + ' - IA Possebon';
      launcher.querySelector('span').textContent = name;
      launcher.setAttribute('aria-label', 'Conversar com ' + name);
      panel.setAttribute('aria-label', 'Conversa com ' + name);
      if (frame) frame.title = 'Conversa com ' + name;
    } catch { /* Mantém o nome anterior durante indisponibilidade. */ }
  }
  function showError(message) {
    clearTimeout(timeout);
    connecting = ready = false;
    if (!status) return;
    frame?.remove();
    frame = undefined;
    status.hidden = false;
    status.textContent = message;
    retry.hidden = false;
  }
  async function connect() {
    if (connecting) return;
    connecting = true;
    const current = ++generation;
    clearTimeout(timeout);
    status.hidden = false;
    status.textContent = 'Conectando ao seu ambiente…';
    retry.hidden = true;
    try {
      await ensureSession();
      if (current !== generation || !host) return;
      if (frame && ready) { connecting = false; status.hidden = true; return; }
      frame?.remove(); ready = false;
      frame = document.createElement('iframe');
      frame.name = 'possebon_assistant_chat';
      frame.title = 'Conversa com ' + title.textContent;
      frame.allow = 'microphone; autoplay';
      frame.referrerPolicy = 'same-origin';
      frame.hidden = true;
      frame.src = new URL('compacto', base).href;
      panel.append(frame);
      timeout = setTimeout(() => { if (current === generation && !ready) showError('A conexão demorou mais que o esperado. Tente novamente.'); }, 25000);
    } catch (error) {
      if (current === generation) showError(error.message);
    }
  }
  async function open() {
    if (panel && !host.hidden) { panel.hidden = false; opened = true; launcher.setAttribute('aria-expanded', 'true'); }
    try {
      await checkAccess();
      if (!host || host.hidden) return;
      panel.hidden = false; opened = true;
      launcher.setAttribute('aria-expanded', 'true');
      // Refaz a troca ao reabrir: outra aba pode ter mudado o cookie compartilhado.
      await connect(); void notifications();
    } catch (error) { if (host) showError(error.message); }
  }
  function close() {
    if (!panel) return;
    panel.hidden = true; opened = false;
    launcher.setAttribute('aria-expanded', 'false'); launcher.focus();
  }
  function mount() {
    host = document.createElement('div'); host.id = 'possebon-global-assistant';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{position:fixed;right:20px;bottom:max(20px,env(safe-area-inset-bottom));z-index:1040;font:14px system-ui,sans-serif;color:#0f172a}:host([hidden]){display:none}
      *{box-sizing:border-box}[hidden]{display:none!important}button,a{font:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #93c5fd;outline-offset:3px}
      .launcher{display:flex;align-items:center;gap:12px;max-width:300px;margin-left:auto;background:#204be5;color:#fff;border:0;border-radius:999px;padding:18px 24px;font-weight:700;box-shadow:0 8px 24px #1d4ed833}.launcher span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.launcher svg{flex-shrink:0}
      section.expanded{width:min(900px,calc(100vw - 32px));height:calc(100dvh - 120px)}.badge{background:#dc2626;color:white;border-radius:99px;font-size:11px;padding:2px 5px;min-width:18px;text-align:center}.bell{display:inline-flex;align-items:center;gap:3px}.expand{font-size:20px}section{display:flex;flex-direction:column;width:min(430px,calc(100vw - 32px));height:min(660px,calc(100dvh - 120px));margin-bottom:12px;background:#fff;border:1px solid #dce4f1;border-radius:18px;overflow:hidden;box-shadow:0 12px 40px #0f172a26}
      header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #e2e8f0}strong{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}header button{padding:6px;border:0;border-radius:6px;background:transparent;color:#334155;text-decoration:none}header button:disabled{opacity:.45;cursor:default}iframe{flex:1;width:100%;min-height:0;border:0}p{margin:24px;line-height:1.5}.retry{margin:0 24px 24px;padding:12px;background:#204be5;color:#fff;border:0;border-radius:8px}
      @media(max-width:600px){:host{right:12px;bottom:max(12px,env(safe-area-inset-bottom))}section{width:calc(100vw - 24px);height:calc(100dvh - 110px)}.launcher{padding:14px 20px}}
    </style><section hidden role="dialog" aria-label="Conversa com Posso"><header><strong>Posso - IA Possebon</strong><button type="button" class="bell" disabled aria-label="Notificações" title="Notificações"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="badge" hidden></span></button><button class="expand" type="button" aria-label="Expandir conversa" title="Expandir conversa" aria-pressed="false">⛶</button><button type="button" aria-label="Minimizar conversa" title="Minimizar">✕</button></header><p role="status"></p><button type="button" class="retry" hidden>Tentar novamente</button></section><button type="button" class="launcher" aria-controls="possebon-global-chat" aria-expanded="false" aria-label="Conversar com Posso"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/></svg><span>Posso</span><b class="badge" hidden></b></button>`;
    panel = root.querySelector('section'); panel.id = 'possebon-global-chat';
    launcher = root.querySelector('.launcher'); status = root.querySelector('[role=status]');
    retry = root.querySelector('.retry');
    bell = root.querySelector('.bell');
    badge = bell.querySelector('.badge'); chatBadge = launcher.querySelector('.badge');
    const expand = root.querySelector('.expand');
    const addAction = (label, icon, onClick) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'personal-action';
      button.title = label;
      button.setAttribute('aria-label', label);
      button.disabled = true;
      button.innerHTML = icon;
      button.addEventListener('click', onClick);
      expand.before(button);
    };
    addAction('Acompanhamentos', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', () => showPanel('monitors'));
    addAction('Dashboard', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 16v-3m4 3V8m4 8v-5"/></svg>', () => openDashboard());
    bell.addEventListener('click', () => showPanel('notifications'));
    expand.addEventListener('click', () => { const expanded = panel.classList.toggle('expanded'); expand.setAttribute('aria-pressed', String(expanded)); expand.setAttribute('aria-label', expanded ? 'Reduzir conversa' : 'Expandir conversa'); expand.title = expanded ? 'Reduzir conversa' : 'Expandir conversa'; });
    title = root.querySelector('strong');
    launcher.addEventListener('click', () => { if (opened) close(); else void open(); });
    root.querySelector('header button[aria-label="Minimizar conversa"]').addEventListener('click', close);
    retry.addEventListener('click', () => { void open(); });
    host.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.body.append(host); context = contextFromPage(); void branding();
  }
  window.addEventListener('message', event => {
    if (event.origin !== location.origin) return;
    if (event.data?.type === 'possebon:personal-dashboard-ready') {
      const embedded = Array.from(document.querySelectorAll('iframe[name="ada_frame"]')).find(item => item.contentWindow === event.source);
      if (embedded) { embedded.dataset.possebonPersonal = 'true'; suppressDuplicate(); }
      return;
    }
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'possebon:ready') {
      for (const action of root.querySelectorAll('.bell, .personal-action')) action.disabled = false;
      clearTimeout(timeout); connecting = false; ready = true;
      status.hidden = true; retry.hidden = true; frame.hidden = false;
      sendContext(); if (opened) frame.focus();
    }
    if (event.data?.type === 'possebon:open-dashboard') openDashboard(event.data.path || '');
    if (event.data?.type === 'possebon:session-expired') showError('Sua sessão mudou ou expirou. Conecte novamente para continuar a conversa.');
    if (event.data?.type === 'possebon:close') close();
  });
  function refresh() { void checkAccess().then(() => { void branding(); void notifications(); }).catch(() => undefined); }
  let previousUrl = location.href, observed;
  new MutationObserver(() => {
    clearTimeout(observed);
    observed = setTimeout(() => {
      if (previousUrl !== location.href) { previousUrl = location.href; dashboardView?.remove(); updateContext(contextFromPage()); refresh(); }
      suppressDuplicate();
    }, 150);
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'name'] });
  window.addEventListener('popstate', () => { updateContext(contextFromPage()); refresh(); });
  window.addEventListener('focus', refresh);
  const refreshVisible = () => { if (document.visibilityState !== 'hidden') refresh(); };
  document.addEventListener('visibilitychange', refreshVisible);
  setInterval(refreshVisible, 30000);
  window.PossebonAssistant = { open, close, setContext: updateContext, refresh };
  refresh();
})();
