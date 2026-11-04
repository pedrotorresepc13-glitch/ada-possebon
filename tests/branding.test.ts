import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness, API } from './helpers.ts';
import { BrandingService } from '../apps/api/src/services/branding.ts';

let h: Harness;
const seen: string[] = [];
beforeAll(async () => {
  h = await setup({ ai: {
    name: 'roteiro', model: 'roteiro', configured: true,
    async run(args) {
      seen.push(args.instructions);
      return { text: 'Resposta preservada.', usage: { input: 1, output: 1 }, toolCalls: [], steps: 1 };
    }
  } });
});
afterAll(async () => h.close());

describe('Nome global da assistente', () => {
  it('fornece somente o nome público, sem cache nem dados administrativos', async () => {
    const r = await h.app.inject({ method: 'GET', url: `${API}/branding` });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ name: 'IA POSSEBON' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('nega alteração sem sessão, sem administração ou sem CSRF', async () => {
    const user = await h.login('colab.a');
    expect((await user.put('/admin/branding', { name: 'Outro' })).status).toBe(403);
    const admin = await h.login('admin.demo');
    const anonymous = await h.app.inject({ method: 'PUT', url: `${API}/admin/branding`, payload: { name: 'Outro' } });
    expect(anonymous.statusCode).toBe(401);
    const noCsrf = await h.app.inject({ method: 'PUT', url: `${API}/admin/branding`, headers: { cookie: admin.cookie }, payload: { name: 'Outro' } });
    expect(noCsrf.statusCode).toBe(403);
    expect(await h.d.branding.read()).toEqual({ name: 'IA POSSEBON' });
  });

  it('persiste sem chave de IA, vale para outra unidade e outra instância, e audita a mudança', async () => {
    const admin = await h.login('admin.demo');
    const saved = await admin.put('/admin/branding', { name: '  Ágora EPC13  ' });
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ name: 'Ágora EPC13' });
    expect(await new BrandingService(h.d).read()).toEqual(saved.json);
    const otherUnit = await h.login('admin.demo', 2);
    expect((await otherUnit.get('/branding')).json).toEqual(saved.json);
    expect((await h.d.db.query("SELECT 1 FROM ada.ai_provider_settings")).rowCount).toBe(0);
    const audit = await h.d.db.query<{ details: { name: string } }>("SELECT details FROM ada.audit_event WHERE action='assistente.nome_atualizado'");
    expect(audit.rows).toEqual([{ details: { name: 'Ágora EPC13' } }]);
  });

  it('rejeita nomes vazios, longos, marcação, controles e campos inesperados', async () => {
    const admin = await h.login('admin.demo');
    for (const name of ['', '   ', 'x'.repeat(61), '<script>alert(1)</script>', 'Nome\nOutro', 'Nome\u202eOutro']) {
      expect((await admin.put('/admin/branding', { name })).status).toBe(400);
    }
    expect((await admin.put('/admin/branding', { name: 'Nome', role: 'admin' })).status).toBe(400);
    expect(await h.d.branding.read()).toEqual({ name: 'Ágora EPC13' });
  });

  it('usa o nome atual nas próximas chamadas do chat sem reescrever mensagens anteriores', async () => {
    const admin = await h.login('admin.demo');
    const first = await admin.post('/chat', { message: 'Olá' });
    expect(first.status).toBe(200);
    expect(seen.at(-1)).toContain('"Ágora EPC13"');
    expect((await admin.put('/admin/branding', { name: 'Aurora' })).status).toBe(200);
    const second = await admin.post('/chat', { message: 'Olá novamente' });
    expect(second.status).toBe(200);
    expect(seen.at(-1)).toContain('"Aurora"');
    expect(seen.at(-1)).not.toContain('Você é a Ada POSSEBON');
    const previous = await h.d.db.query<{ content_enc: string }>("SELECT content_enc FROM ada.message WHERE role='assistant' ORDER BY created_at");
    expect(previous.rows.map(r => h.d.cipher.decrypt(r.content_enc))).toEqual(['Resposta preservada.', 'Resposta preservada.']);
  });
});
