import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await setup({ env: { ADA_DEMO_DATA: '0' } }); });
afterAll(async () => h.close());

async function waitForStudy(client: Awaited<ReturnType<Harness['login']>>) {
  let result = await client.get('/study/status');
  for (let i = 0; i < 35 && result.json.state === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    result = await client.get('/study/status');
  }
  return result;
}

describe('estudo inicial privado no login e por unidade', () => {
  it('inicia automaticamente, retorna permissões da sessão e não finge conexão operacional', async () => {
    const admin = await h.login('admin.demo');
    const response = await waitForStudy(admin);
    expect(response.status).toBe(200);
    expect(response.json.state).toBe('partial');
    expect(response.json.user.id).toBe(9001);
    expect(response.json.unit.id).toBe(1);
    expect(response.json.authorizedPrograms).toContain('AdaAdministracao');
    expect(response.json.brainState).toBe('not_configured');
    expect(response.json.operationalMetrics).toBe(0);
    expect(response.json.limitations).toEqual(expect.arrayContaining([expect.stringMatching(/não estão integrados/)]));
    const data = await h.d.db.query<{ report_enc: string }>('SELECT report_enc FROM ada.user_initial_study WHERE system_user_id = 9001 AND unit_id = 1');
    expect(data.rows[0]?.report_enc).toMatch(/^v1:/);
    expect(data.rows[0]?.report_enc).not.toContain('AdaAdministracao');
  });

  it('mantém contexto separado de usuários e unidades', async () => {
    const manager = await h.login('gerente.b', 2);
    const m = await waitForStudy(manager);
    expect(m.status).toBe(200);
    expect(m.json.user.id).toBe(9003);
    expect(m.json.unit.id).toBe(2);
    expect(m.json.authorizedPrograms).not.toContain('AdaAdministracao');
    const admin = await h.login('admin.demo', 1);
    const a = await admin.get('/study/status');
    expect(a.json.unit.id).toBe(1);
    expect(a.json.user.id).toBe(9001);
    const wrong = await h.d.db.query('SELECT * FROM ada.user_initial_study WHERE system_user_id = 9003 AND unit_id = 1');
    expect(wrong.rows).toHaveLength(0);
  });

  it('permite atualizar apenas o próprio estudo, com CSRF', async () => {
    const user = await h.login('colab.a');
    const response = await user.post('/study/refresh');
    expect(response.status).toBe(200);
    expect(response.json.userId).toBe(9004);
    expect(response.json.unitId).toBe(1);
    const unauth = await h.app.inject({ method: 'GET', url: '/ada/api/ada/study/status' });
    expect(unauth.statusCode).toBe(401);
    const noCsrf = await h.app.inject({ method: 'POST', url: '/ada/api/ada/study/refresh', headers: { cookie: user.cookie } });
    expect(noCsrf.statusCode).toBe(403);
    await waitForStudy(user);
  });
});
