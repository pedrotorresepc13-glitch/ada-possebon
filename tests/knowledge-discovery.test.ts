import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiProvider, AiTurnInput } from '../apps/api/src/ai/provider.ts';
import { syncPublicKnowledge, VERIFIED_PUBLIC_FACTS } from '../apps/api/src/services/public-knowledge.ts';
import { setup, type Harness } from './helpers.ts';

let h: Harness;
let lastPrompt = '';
let lastOverview: unknown;
let lastGenericSearch: unknown;

const ai: AiProvider = {
  name: 'test-ai', model: 'test-ai', configured: true,
  async run(args: AiTurnInput) {
    lastPrompt = args.instructions;
    lastOverview = await args.execute('listar_conhecimento', {});
    lastGenericSearch = await args.execute('buscar_conhecimento', { consulta: 'como está meu acesso e conhecimento agora' });
    return { text: 'Consultei as fontes autorizadas.', usage: { input: 10, output: 10 }, toolCalls: [], steps: 1 };
  }
};

beforeAll(async () => {
  h = await setup({ ai, env: { ADA_DEMO_DATA: '0' } });
  await syncPublicKnowledge(h.d);
});
afterAll(async () => h.close());

describe('descoberta autorizada de conhecimento', () => {
  it('lista o que já está indexado mesmo para pergunta genérica sem match FTS', async () => {
    const user = await h.login('colab.a');
    const result = await user.post('/chat', { message: 'Como está o seu acesso e conhecimento agora?' });
    expect(result.status).toBe(200);
    expect(lastPrompt).toContain('ÍNDICE AUTORIZADO:');
    expect(lastPrompt).toContain('POSSEBON Engenharia');
    const ov = lastOverview as { totalDocumentosIndexadosAutorizados: number; documentos: { titulo: string; url: string }[] };
    expect(ov.totalDocumentosIndexadosAutorizados).toBe(VERIFIED_PUBLIC_FACTS.length);
    expect(ov.documentos).toHaveLength(VERIFIED_PUBLIC_FACTS.length);
    expect(ov.documentos.some((d) => d.url?.includes('possebon.com.br'))).toBe(true);
    const search = lastGenericSearch as { catalogoSeBuscaNaoEncontrou?: { total: number }; trechos: unknown[] };
    expect(search.trechos.length || search.catalogoSeBuscaNaoEncontrou?.total).toBeGreaterThan(0);
  });

  it('não enumera conteúdo de outra unidade ou documentos ainda não aprovados', async () => {
    const admin = await h.login('admin.demo', 1);
    const source = await admin.post('/admin/knowledge/sources', {
      kind: 'manual', name: 'Fonte privada Norte', scope: 'unidade', unit_id: 1,
      required_programs: ['AdaAdministracao']
    });
    expect(source.status).toBe(201);
    const doc = await h.d.db.query<{ id: string }>(
      `INSERT INTO ada.knowledge_document
       (source_id,title,mime_type,original_name,size_bytes,checksum,status,scope,unit_id,domain,
        sensitivity,required_programs,raw_content,extracted_text,created_by)
       VALUES ($1,'Documento Privado Restrito','text/plain','privado-norte',0,$2,'indexado',
         'unidade',1,'rh','restrito',ARRAY['AdaAdministracao']::text[],NULL,'Conteudo Privado Norte',0)
       RETURNING id`,
      [source.json.id, 'f'.repeat(64)]
    );
    expect(doc.rowCount).toBe(1);
    const adminContext = await h.d.sessions.resolveContext(9001, 1, 'test-admin', { force: true });
    const userContext = await h.d.sessions.resolveContext(9004, 1, 'test-colab', { force: true });
    const unitTwo = await h.d.sessions.resolveContext(9001, 2, 'test-admin-unit-two', { force: true });
    expect((await h.d.knowledge.overview(adminContext)).documents.map((x) => x.title)).toContain('Documento Privado Restrito');
    expect((await h.d.knowledge.overview(userContext)).documents.map((x) => x.title)).not.toContain('Documento Privado Restrito');
    expect((await h.d.knowledge.overview(unitTwo)).documents.map((x) => x.title)).not.toContain('Documento Privado Restrito');
  });
});
