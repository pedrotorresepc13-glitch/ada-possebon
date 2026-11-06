import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness, API } from './helpers.ts';

let h: Harness;
beforeAll(async () => { h = await setup(); });
afterAll(async () => h.close());

const API_KEY = 'sk-test-' + 'x'.repeat(40);
const payload = {
  provider: 'openai',
  model: 'gpt-5-mini',
  timeoutMs: 30000,
  maxOutputTokens: 1024,
  apiKey: API_KEY
};

describe('Painel administrativo de IA (sem acesso ao provedor externo)', () => {
  it('recusa leitura e escrita por usuários não administradores', async () => {
    const user = await h.login('gerente.a');
    expect((await user.get('/admin/ai')).status).toBe(403);
    expect((await user.put('/admin/ai/settings', payload)).status).toBe(403);
    expect((await user.post('/admin/ai/test')).status).toBe(403);
    expect((await user.del('/admin/ai/settings')).status).toBe(403);
  });

  it('cifra a credencial, não a devolve e ativa o modelo sem reiniciar', async () => {
    const admin = await h.login('admin.demo');
    const before = await admin.get('/admin/ai');
    expect(before.status).toBe(200);
    expect(before.json.configured).toBe(false);
    const saved = await admin.put('/admin/ai/settings', payload);
    expect(saved.status).toBe(200);
    expect(saved.json.configured).toBe(true);
    expect(saved.json.model).toBe('gpt-5-mini');
    expect(saved.json.apiKeyPresent).toBe(true);
    expect(saved.json.keySource).toBe('cofre');
    expect(JSON.stringify(saved.json)).not.toContain(API_KEY);
    const db = await h.d.db.query<{ api_key_enc: string }>('SELECT api_key_enc FROM ada.ai_provider_settings WHERE id = 1');
    expect(db.rows[0]!.api_key_enc).toMatch(/^v1:/);
    expect(db.rows[0]!.api_key_enc).not.toContain(API_KEY);
    expect(h.d.cipher.decrypt(db.rows[0]!.api_key_enc)).toBe(API_KEY);
    expect(h.d.ai.configured).toBe(true);
    expect(h.d.ai.model).toBe('gpt-5-mini');

    const change = await admin.put('/admin/ai/settings', { ...payload, apiKey: undefined, model: 'gpt-4.1-mini' });
    expect(change.status).toBe(200);
    expect(change.json.model).toBe('gpt-4.1-mini');
    expect((await h.d.db.query<{ api_key_enc: string }>('SELECT api_key_enc FROM ada.ai_provider_settings WHERE id = 1')).rows[0]!.api_key_enc).toBe(db.rows[0]!.api_key_enc);

    const exposed = JSON.stringify((await admin.get('/admin/ai')).json);
    expect(exposed).not.toContain(API_KEY);
    expect(exposed).not.toContain(db.rows[0]!.api_key_enc);

    const cleared = await admin.del('/admin/ai/settings');
    expect(cleared.status).toBe(200);
    expect(cleared.json.configured).toBe(false);
    expect(h.d.ai.configured).toBe(false);
    expect((await h.d.db.query('SELECT 1 FROM ada.ai_provider_settings WHERE id = 1')).rowCount).toBe(0);
  });

  it('recusa payloads inesperados e alteração sem CSRF', async () => {
    const admin = await h.login('admin.demo');
    expect((await admin.put('/admin/ai/settings', { ...payload, override: true })).status).toBe(400);
    const r = await h.app.inject({
      method: 'PUT',
      url: `${API}/admin/ai/settings`,
      headers: { cookie: admin.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify(payload)
    });
    expect(r.statusCode).toBe(403);
  });
});
