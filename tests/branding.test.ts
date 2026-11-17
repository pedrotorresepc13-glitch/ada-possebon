import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

describe('Identidade oficial POSSO', () => {
  it('retorna nome único e oficial no endpoint público, sem metadados internos', async () => {
    const result = await h.app.inject({ method: 'GET', url: `${API}/branding` });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ name: 'POSSO' });
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('protege gravação com sessão administrativa e CSRF', async () => {
    const user = await h.login('colab.a');
    expect((await user.put('/admin/branding', { name: 'POSSO' })).status).toBe(403);
    const admin = await h.login('admin.demo');
    const guest = await h.app.inject({ method: 'PUT', url: `${API}/admin/branding`, payload: { name: 'POSSO' } });
    expect(guest.statusCode).toBe(401);
    const noCsrf = await h.app.inject({
      method: 'PUT', url: `${API}/admin/branding`, headers: { cookie: admin.cookie }, payload: { name: 'POSSO' }
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('bloqueia renomeação e ignora preferências antigas sem excluir seu histórico', async () => {
    const admin = await h.login('admin.demo');
    expect((await admin.put('/admin/branding', { name: 'Ada POSSEBON' })).status).toBe(400);
    expect((await admin.put('/admin/branding', { name: 'Outro Nome' })).status).toBe(400);
    const saved = await admin.put('/admin/branding', { name: 'posso' });
    expect(saved.status).toBe(200);
    expect(saved.json).toEqual({ name: 'POSSO' });
    expect((await h.login('admin.demo',2).then(u => u.get('/branding'))).json).toEqual({ name: 'POSSO' });
    await h.d.db.query(
      `UPDATE ada.app_setting SET value=$2 WHERE key=$1`,
      ['assistant_branding',{name:'Ada POSSEBON'}]
    );
    expect(await new BrandingService(h.d).read()).toEqual({ name: 'POSSO' });
    const stored = await h.d.db.query<{value:{name:string}}>(
      `SELECT value FROM ada.app_setting WHERE key='assistant_branding'`
    );
    expect(stored.rows[0]?.value.name).toBe('Ada POSSEBON');
    const audits=await h.d.db.query<{details:{name:string}}>(
      "SELECT details FROM ada.audit_event WHERE action='assistente.nome_atualizado'");
    expect(audits.rows).toEqual([{details:{name:'POSSO'}}]);
  });

  it('rejeita marcação, controles e campos inesperados', async () => {
    const admin=await h.login('admin.demo');
    for(const name of ['', '  ', '<script>alert(1)</script>','POSSO\nOutro','Nome\u202eOutro', 'x'.repeat(61)]){
      expect((await admin.put('/admin/branding', { name })).status).toBe(400);
    }
    expect((await admin.put('/admin/branding', { name:'POSSO', role:'admin' })).status).toBe(400);
  });

  it('instrui o chat e a voz a se identificarem como POSSO, não ADA', async () => {
    const admin=await h.login('admin.demo');
    const result=await admin.post('/chat',{message:'Quem é você?'});
    expect(result.status).toBe(200);
    expect(seen.at(-1)).toContain('Você é POSSO');
    expect(seen.at(-1)).toContain('fundador');
    const api=readFileSync(new URL('../apps/api/src/app.ts',import.meta.url),'utf8');
    expect(api).toContain("voice: 'tempo'");
    expect(api).toContain('Você é POSSO, o assistente virtual oficial da POSSEBON');
    expect(api).not.toContain('voz feminina');
    expect(api).not.toContain('DELEGUE ao backend Ada');
    const messages=await h.d.db.query<{content_enc:string}>(
      "SELECT content_enc FROM ada.message WHERE role='assistant' ORDER BY created_at");
    expect(messages.rows.map(row=>h.d.cipher.decrypt(row.content_enc))).toContain('Resposta preservada.');
  });
});
