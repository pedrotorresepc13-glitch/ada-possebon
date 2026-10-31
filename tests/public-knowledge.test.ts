import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, type Harness } from './helpers.ts';
import { syncPublicKnowledge, VERIFIED_PUBLIC_FACTS } from '../apps/api/src/services/public-knowledge.ts';

let h: Harness;
beforeAll(async () => { h = await setup({ env: { ADA_DEMO_DATA: '0' } }); });
afterAll(async () => h.close());

describe('bootstrap do conhecimento público verificado', () => {
  it('indexa sumários, preserva URL e permite consulta sem liberar dados privados', async () => {
    const result = await syncPublicKnowledge(h.d);
    expect(result.inserted).toBe(VERIFIED_PUBLIC_FACTS.length);
    expect(result.updated).toBe(0);
    const docs = await h.d.db.query<{ original_name: string; status: string; sensitivity: string }>(
      "SELECT original_name,status,sensitivity FROM ada.knowledge_document WHERE sensitivity='publico'"
    );
    expect(docs.rows).toHaveLength(VERIFIED_PUBLIC_FACTS.length);
    for (const d of docs.rows) {
      expect(d.original_name).toMatch(/^https:\/\//);
      expect(d.status).toBe('indexado');
      expect(d.sensitivity).toBe('publico');
    }
    const user = await h.login('colab.a');
    const found = await user.get('/knowledge/search?q=POSSEBON');
    expect(found.status).toBe(200);
    expect(found.json.length).toBeGreaterThan(0);
    expect(found.json.some((x: { uri: string }) => x.uri?.startsWith('https://possebon.com.br'))).toBe(true);
    expect(JSON.stringify(found.json)).not.toContain('ADA_ENCRYPTION_KEY');
  });

  it('sincronização é idempotente e não cria fontes duplicadas', async () => {
    const second = await syncPublicKnowledge(h.d);
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: VERIFIED_PUBLIC_FACTS.length });
    const sourceCount = await h.d.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ada.knowledge_source WHERE config->>'bootstrap_key' = 'ada.public.possebon.curated.v1'"
    );
    expect(sourceCount.rows[0]?.n).toBe(1);
  });

  it('fatos são atribuídos a fontes públicas verificadas', () => {
    expect(VERIFIED_PUBLIC_FACTS.some((d) => d.url.includes('agencia.petrobras.com.br'))).toBe(true);
    expect(VERIFIED_PUBLIC_FACTS.some((d) => d.url.includes('linkedin.com'))).toBe(true);
    expect(VERIFIED_PUBLIC_FACTS.every((d) => d.observed === '2026-10-29')).toBe(true);
    expect(VERIFIED_PUBLIC_FACTS.every((d) => !/password|sk-[A-Za-z0-9]{20}/.test(d.content))).toBe(true);
  });
});
