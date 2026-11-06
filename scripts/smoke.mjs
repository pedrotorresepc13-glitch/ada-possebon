// Smoke test HTTP contra uma instância em execução (desenvolvimento, usuários sintéticos).
// Uso: node scripts/smoke.mjs [http://127.0.0.1:4800/ada]
const base = process.argv[2] ?? 'http://127.0.0.1:4800/ada';
let cookie = '';
let csrf = '';
const results = [];

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  const sc = res.headers.get('set-cookie');
  if (sc?.startsWith('ada_sid=')) cookie = sc.split(';')[0];
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, json, text };
}

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}

const health = await call('GET', '/healthz');
check('healthz', health.status === 200);
const index = await call('GET', '/');
check('SPA servida com CSP frame-ancestors', index.status === 200 && /<div id="root">/.test(index.text) && /frame-ancestors/.test(index.headers.get('content-security-policy') ?? ''));
check('sem X-Frame-Options', !index.headers.get('x-frame-options'));
const anon = await call('GET', '/api/ada/me');
check('sem sessão → 401', anon.status === 401);
const login = await call('POST', '/api/ada/dev/login', { login: 'gerente.a' });
csrf = login.json?.me?.csrfToken ?? '';
check('login sintético de desenvolvimento', login.status === 200 && !!csrf, login.json?.me?.user?.displayName);
const c1 = await call('POST', '/api/ada/chat', { message: 'cria efetivo por equipe nos últimos seis meses' });
const conv = c1.json?.conversationId;
check('chat cria rascunho de dashboard', !!c1.json?.message?.metadata?.dashboardDraft);
const c2 = await call('POST', '/api/ada/chat', { conversationId: conv, message: 'compara com o previsto' });
check('refino por conversa (patch)', c2.json?.message?.metadata?.dashboardDraft?.widgets?.[0]?.compareMetric === 'demo.efetivo.previsto');
const c3 = await call('POST', '/api/ada/chat', { conversationId: conv, message: 'salva como Efetivo EPC13 (smoke)' });
const dashId = c3.json?.message?.metadata?.savedDashboardId;
check('salvar dashboard', !!dashId);
const data = await call('GET', `/api/ada/dashboards/${dashId}/data?refresh=1`);
check('reabrir com dados atuais e proveniência', data.json?.data?.[0]?.status === 'ok' && data.json.data[0].provenance.synthetic === true, `${data.json?.data?.[0]?.points?.length} pontos`);
const m = await call('POST', '/api/ada/chat', { message: 'monitore a OS 123 e me avise quando mudarem o prazo ou quando ficar 48h sem avanço' });
const def = m.json?.message?.metadata?.monitorProposal?.definition;
check('proposta de monitor inativa', def?.enabled === false);
const created = await call('POST', '/api/ada/monitors', { definition: def, activate: true });
check('monitor confirmado e ativado', created.status === 201 && created.json.monitor.status === 'active');
console.log('… aguardando um ciclo do worker (até 20 s)');
let ran = false;
for (let i = 0; i < 10 && !ran; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const h = await call('GET', `/api/ada/monitors/${created.json.monitor.id}/history`);
  ran = (h.json?.runs ?? []).some((r) => r.status === 'sem_mudancas' && r.ai_calls === 0);
}
check('worker executou a regra sem IA (linha de base)', ran);
const adminDenied = await call('GET', '/api/ada/admin/health');
check('gerente não acessa administração', adminDenied.status === 403);
await call('POST', '/api/ada/session/logout', {});
const after = await call('GET', '/api/ada/me');
check('logout invalida sessão', after.status === 401);
await call('POST', '/api/ada/dev/login', { login: 'admin.demo' }).then((r) => (csrf = r.json?.me?.csrfToken));
const ah = await call('GET', '/api/ada/admin/health');
check('admin vê saúde; worker vivo', ah.status === 200 && ah.json.worker.alive === true);

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificações OK`);
process.exit(failed ? 1 : 0);
