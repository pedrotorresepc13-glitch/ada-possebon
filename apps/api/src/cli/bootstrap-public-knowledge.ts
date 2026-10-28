/**
 * Carga idempotente de conhecimento publico revisado.
 * Nao faz scraping, nao inventa dados operacionais e nao precisa de conta ficticia.
 *
 * Uso (API local parada se estiver usando PGlite):
 *   npm run knowledge:bootstrap
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { chunkText, redactSecrets, scanForInjection } from '@ada/domain';
import { REPO_ROOT, loadConfig } from '../config.ts';
import { createDeps } from '../core.ts';
import { prepare } from '../boot.ts';

const Entry = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(5).max(200),
  domain: z.string().min(2).max(60),
  sourceUrl: z.string().url(),
  content: z.string().min(30)
}).strict();

const Pack = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  trust: z.literal('public_curated'),
  approvedSourcesOnly: z.literal(true),
  description: z.string(),
  records: z.array(Entry).min(1)
}).strict();

const PACK_PATH = path.join(REPO_ROOT, 'knowledge', 'public', 'possebon-empresa-epc13-petrobras.2026-10-28.json');
const sourceKey = 'ada.public.curated.company.v1';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function main() {
  const pack = Pack.parse(JSON.parse(await readFile(PACK_PATH, 'utf8')));
  const seen = new Set<string>();
  for (const row of pack.records) {
    if (seen.has(row.id)) throw new Error('ID duplicado no pacote: ' + row.id);
    seen.add(row.id);
    const host = new URL(row.sourceUrl).hostname.toLowerCase();
    if (!['possebon.com.br', 'www.possebon.com.br', 'petrobras.com.br', 'www.petrobras.com.br', 'github.com'].includes(host)) {
      throw new Error('Fonte nao autorizada neste pacote: ' + host);
    }
    const scan = scanForInjection(row.content);
    if (scan.suspicious) throw new Error('Conteudo suspeito recusado em ' + row.id + ': ' + scan.findings.join(', '));
  }

  const config = loadConfig();
  const d = await createDeps(config);
  try {
    await prepare(d, config);
    const existing = await d.db.query<{ id: string }>(
      "SELECT id FROM ada.knowledge_source WHERE config->>'bootstrap_key' = $1 LIMIT 1", [sourceKey]
    );
    let sourceId = existing.rows[0]?.id;
    if (!sourceId) {
      const created = await d.db.query<{ id: string }>(
        `INSERT INTO ada.knowledge_source
         (kind, name, uri, scope, domain, sensitivity, required_programs, created_by, config)
         VALUES ('manual', 'ADA - conhecimento publico institucional curado',
                 'https://possebon.com.br/', 'global', NULL, 'publico', ARRAY[]::text[],
                 0, $1::jsonb) RETURNING id`,
        [JSON.stringify({ bootstrap_key: sourceKey, curated: true, revision: pack.revision })]
      );
      sourceId = created.rows[0]!.id;
    }
    let inserted = 0, updated = 0, unchanged = 0;
    for (const row of pack.records) {
      const text = redactSecrets(
        `Titulo: ${row.title}\nFonte: ${row.sourceUrl}\nUltima curadoria: ${pack.revision}\nArea: ${row.domain}\n\n${row.content}`
      );
      const checksum = sha256(text);
      const old = await d.db.query<{ id: string; checksum: string }>(
        'SELECT id, checksum FROM ada.knowledge_document WHERE source_id = $1 AND title = $2 ORDER BY created_at DESC LIMIT 1',
        [sourceId, row.title]
      );
      if (old.rows[0]?.checksum === checksum) {
        unchanged++;
        continue;
      }
      await d.db.tx(async (q) => {
        let docId: string;
        if (old.rows[0]) {
          docId = old.rows[0].id;
          await q.query(
            `UPDATE ada.knowledge_document
             SET checksum=$2, raw_content=$3, size_bytes=$4, version=version+1,
                 scope='global', unit_id=NULL, domain=$5, sensitivity='publico',
                 required_programs=ARRAY[]::text[], original_name=$6,
                 mime_type='text/markdown', valid_until=NULL,
                 status='indexado', error=NULL, reviewed_by=0, reviewed_at=now(),
                 observed_at=now(), updated_at=now(), extracted_text=$7,
                 injection_flags='[]'::jsonb
             WHERE id=$1`,
            [docId, checksum, Buffer.from(text,'utf8'), Buffer.byteLength(text), row.domain, row.sourceUrl, text]
          );
          await q.query('DELETE FROM ada.knowledge_chunk WHERE document_id = $1', [docId]);
          updated++;
        } else {
          const created = await q.query<{ id: string }>(
            `INSERT INTO ada.knowledge_document
             (source_id, title, mime_type, original_name, size_bytes, checksum, status,
              scope, unit_id, domain, sensitivity, required_programs, raw_content,
              extracted_text, created_by, reviewed_by, reviewed_at, observed_at)
             VALUES ($1,$2,'text/markdown',$3,$4,$5,'indexado',
                     'global',NULL,$6,'publico',ARRAY[]::text[],$7,$8,0,0,now(),now())
             RETURNING id`,
            [sourceId, row.title, row.sourceUrl, Buffer.byteLength(text), checksum, row.domain, Buffer.from(text,'utf8'), text]
          );
          docId = created.rows[0]!.id;
          inserted++;
        }
        for (const chunk of chunkText(text)) {
          await q.query(
            'INSERT INTO ada.knowledge_chunk (document_id,ordinal,content) VALUES ($1,$2,$3)',
            [docId, chunk.ordinal, chunk.content]
          );
        }
      });
    }
    await d.db.query(
      "UPDATE ada.knowledge_source SET last_sync_at=now(), status='ativo', updated_at=now(), config=jsonb_set(config,'{revision}',to_jsonb($2::text),true) WHERE id=$1",
      [sourceId, pack.revision]
    );
    const total = await d.db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ada.knowledge_document WHERE source_id=$1 AND status='indexado'", [sourceId]
    );
    console.log(JSON.stringify({
      ok: true,
      source: sourceKey,
      revision: pack.revision,
      inserted, updated, unchanged,
      indexed: total.rows[0]?.n ?? 0,
      note: 'Somente conhecimento publico; dados internos, dashboards e login exigem integracoes reais.'
    }, null, 2));
  } finally {
    await d.db.close();
  }
}
await main();
