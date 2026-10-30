import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { setup, type Harness } from './helpers.ts';
import { importEpc13Corpus } from '../apps/api/src/services/epc13-corpus.ts';
import { buildAuthContext } from '../apps/api/src/identity.ts';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
let h: Harness;
let folder: string;
let corpus: string;
beforeAll(async () => {
  h = await setup({ env: { ADA_DEMO_DATA: '0' } });
  h.identity.update(9001, { units: [{ id: 3, name: 'EPC13 - teste' }] });
  folder = await mkdtemp(path.join(tmpdir(), 'ia-epc13-test-'));
  corpus = path.join(folder, 'teste.jsonl.gz');
  const content = 'Diretriz de qualidade: atividades de inspeção contratual e controle EPC13.';
  const obj = {
    version: 'ia-possebon-epc13-knowledge-v1',
    classification: 'restrito',
    unit_id: 3,
    required_programs: ['AdaAdministracao'],
    source_file: '04.0_ANEXO IV - DIRETRIZ DE QUALIDADE.pdf',
    source_sha256: 'a'.repeat(64),
    source_type: 'pdf',
    page_start: 1,
    page_end: 2,
    section: 1,
    content,
    content_sha256: sha(content)
  };
  await writeFile(corpus, gzipSync(JSON.stringify(obj) + '\n'));
});
afterAll(async () => {
  await h.close();
  await rm(folder, { recursive: true, force: true });
});

describe('importação local sigilosa EPC13', () => {
  it('rejeita identidade sem a unidade 3 ou permissão administrativa', async () => {
    await expect(importEpc13Corpus(h.d, corpus, 9002)).rejects.toThrow(/autorização administrativa/);
    await expect(importEpc13Corpus(h.d, corpus, 9004)).rejects.toThrow(/autorização administrativa/);
  });

  it('importa com origem e ACL restrita, nunca torna o contrato global', async () => {
    const first = await importEpc13Corpus(h.d, corpus, 9001);
    expect(first.inserted).toBe(1);
    expect(first.chunks).toBeGreaterThan(0);
    const rows = await h.d.db.query<{ scope: string; unit_id: number; required_programs: string[]; sensitivity: string }>(
      "SELECT scope,unit_id,required_programs,sensitivity FROM ada.knowledge_document WHERE title LIKE '%DIRETRIZ DE QUALIDADE%'"
    );
    expect(rows.rows[0]).toMatchObject({ scope: 'unidade', unit_id: 3, required_programs: ['AdaAdministracao'], sensitivity: 'restrito' });
    const id = (await h.identity.resolve(9001))!;
    const admin = buildAuthContext(id,3,'test-admin',h.d.config.programs,'dev_synthetic');
    const hits = await h.d.knowledge.search(admin, 'inspeção contratual EPC13');
    expect(hits.length).toBeGreaterThan(0);
    const second = await importEpc13Corpus(h.d, corpus, 9001);
    expect(second.inserted).toBe(0);
    expect(second.unchanged).toBe(1);
  });

  it('rejeita partes adulteradas e não importa conteúdo fora do EPC13', async () => {
    const bad = path.join(folder, 'bad.jsonl.gz');
    const content = 'texto alterado';
    await writeFile(bad, gzipSync(JSON.stringify({
      version: 'ia-possebon-epc13-knowledge-v1',
      classification: 'restrito', unit_id: 5, required_programs: ['AdaAdministracao'],
      source_file: 'contrato.pdf', source_sha256: 'a'.repeat(64),
      source_type: 'pdf', page_start: 1, page_end: 1, section: 1,
      content, content_sha256: sha(content)
    }) + '\n'));
    await expect(importEpc13Corpus(h.d,bad,9001)).rejects.toThrow();
  });
});
