/**
 * Le SOMENTE o inventario tecnico sanitizado (NAO o ZIP original).
 * Arquitetura interna: acessivel apenas a AdaAdministracao.
 * Parar a API local antes de executar no banco PGlite.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { chunkText, scanForInjection } from '@ada/domain';
import { loadConfig } from '../config.ts';
import { createDeps } from '../core.ts';
import { prepare } from '../boot.ts';

const Name = z.string().min(1).max(300);
const Inventory = z.object({
  format: z.literal('ADA-tech-inventory-v1'),
  snapshot: z.string().datetime({ offset: true }),
  classification: z.literal('interno-restrito'),
  excludes: z.array(z.string()),
  models: z.array(z.object({ model: Name, table: Name, fields: z.array(Name), source: Name })).min(1),
  screens_by_area: z.record(z.string(), z.array(Name)),
  rest_route_declarations_unresolved_prefix: z.array(z.object({ method: Name, relative_path: Name, handler: Name })),
  custom_php_modules: z.array(Name),
  known_knowledge_and_integration_modules: z.array(Name)
}).passthrough();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Informe o caminho de ADA_BRAIN_METADADOS_INTERNOS.json');
  const snapshot = Inventory.parse(JSON.parse(await readFile(path.resolve(filename), 'utf8')));
  const expected = ['file contents','credential values','passwords','tokens','private keys','user records','employee data','database rows'];
  for (const item of expected) {
    if (!snapshot.excludes.includes(item)) throw new Error('Inventario sem exclusao de ' + item);
  }
  const header = 'POSSEBON Web — inventario tecnico INTERNO/RESTRITO. Data: ' +
    snapshot.snapshot + '. Estrutura declarada, nao dados operacionais atuais.';
  const documents = [
    {
      title: 'Arquitetura: modelos e tabelas POSSEBON',
      domain: 'modelo',
      content: header + '\n\n' + snapshot.models.map((m) =>
        'Modelo ' + m.model + '; tabela ' + m.table + '; campos: ' + m.fields.join(', ') +
        '; origem: ' + m.source).join('\n\n')
    },
    {
      title: 'Arquitetura: telas e modulos por departamento',
      domain: 'tela',
      content: header + '\n\n' + Object.entries(snapshot.screens_by_area).map(([area, screens]) =>
        'Area ' + area + '; telas: ' + screens.join(', ')).join('\n\n')
    },
    {
      title: 'Arquitetura: declaracoes REST do POSSEBON',
      domain: 'rota',
      content: header + '\nPrefixos de rotas nao resolvidos; nao presumir que estejam publicas.\n\n' +
        snapshot.rest_route_declarations_unresolved_prefix.map((r) =>
          r.method + ' ' + r.relative_path + ' => ' + r.handler).join('\n\n')
    },
    {
      title: 'Arquitetura: servicos e conectores customizados',
      domain: 'arquitetura',
      content: header + '\n\nModulos PHP: ' + snapshot.custom_php_modules.join(', ') +
        '\n\nConhecimento e integracoes: ' + snapshot.known_knowledge_and_integration_modules.join(', ')
    }
  ];
  for (const doc of documents) {
    if (scanForInjection(doc.content).suspicious || /sk-[A-Za-z0-9_-]{16,}/.test(doc.content) ||
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(doc.content)) {
      throw new Error('Conteudo suspeito recusado: ' + doc.title);
    }
  }
  const cfg = loadConfig();
  const d = await createDeps(cfg);
  try {
    await prepare(d, cfg);
    const key = 'ada.internal.possebon.inventory.v1';
    const found = await d.db.query<{id:string}>(
      "SELECT id FROM ada.knowledge_source WHERE config->>'bootstrap_key'=$1 LIMIT 1", [key]
    );
    let sourceId = found.rows[0]?.id;
    if (!sourceId) {
      const sql = [
        'INSERT INTO ada.knowledge_source',
        '(kind,name,uri,scope,domain,sensitivity,required_programs,config,created_by)',
        "VALUES ('manual','POSSEBON Web - inventario tecnico',NULL,'global','arquitetura','restrito',",
        "ARRAY['AdaAdministracao']::text[], $1::jsonb, 0) RETURNING id"
      ].join(' ');
      const created = await d.db.query<{id:string}>(sql,
        [JSON.stringify({bootstrap_key:key,snapshot:snapshot.snapshot})]);
      sourceId = created.rows[0]!.id;
    }
    let inserted = 0, updated = 0, unchanged = 0;
    for (const doc of documents) {
      const checksum = sha(doc.content);
      const old = await d.db.query<{id:string;checksum:string}>(
        'SELECT id,checksum FROM ada.knowledge_document WHERE source_id=$1 AND title=$2 LIMIT 1',
        [sourceId, doc.title]
      );
      if (old.rows[0]?.checksum === checksum) { unchanged++; continue; }
      await d.db.tx(async (q) => {
        let id: string;
        const args = [
          doc.title, checksum, Buffer.from(doc.content,'utf8'), Buffer.byteLength(doc.content),
          doc.content, doc.domain, new Date(snapshot.snapshot)
        ];
        if (old.rows[0]) {
          id = old.rows[0].id;
          await q.query([
            'UPDATE ada.knowledge_document SET checksum=$2,version=version+1,',
            'raw_content=$3,size_bytes=$4,extracted_text=$5,domain=$6,',
            "status='indexado',sensitivity='restrito',",
            "required_programs=ARRAY['AdaAdministracao']::text[],",
            'observed_at=$7,reviewed_by=0,reviewed_at=now(),updated_at=now() WHERE id=$1'
          ].join(' '), [id, ...args.slice(1)]);
          await q.query('DELETE FROM ada.knowledge_chunk WHERE document_id=$1',[id]);
          updated++;
        } else {
          const created = await q.query<{id:string}>([
            'INSERT INTO ada.knowledge_document',
            '(source_id,title,mime_type,original_name,size_bytes,checksum,status,scope,unit_id,domain,',
            'sensitivity,required_programs,raw_content,extracted_text,created_by,reviewed_by,reviewed_at,observed_at)',
            "VALUES ($1,$2,'text/plain','inventario interno',$3,$4,'indexado','global',NULL,$5,",
            "'restrito',ARRAY['AdaAdministracao']::text[],$6,$7,0,0,now(),$8) RETURNING id"
          ].join(' '), [sourceId,doc.title,Buffer.byteLength(doc.content),checksum,doc.domain,
            Buffer.from(doc.content,'utf8'),doc.content,new Date(snapshot.snapshot)]);
          id = created.rows[0]!.id;
          inserted++;
        }
        for (const chunk of chunkText(doc.content)) {
          await q.query('INSERT INTO ada.knowledge_chunk(document_id,ordinal,content) VALUES($1,$2,$3)',
            [id,chunk.ordinal,chunk.content]);
        }
      });
    }
    await d.db.query("UPDATE ada.knowledge_source SET status='ativo',last_sync_at=now(),updated_at=now() WHERE id=$1",[sourceId]);
    console.log(JSON.stringify({
      ok:true,classification:'interno-restrito',requiredProgram:'AdaAdministracao',
      snapshot:snapshot.snapshot,documents:documents.length,inserted,updated,unchanged,
      modelCount:snapshot.models.length,containsPrivateRecords:false
    },null,2));
  } finally { await d.db.close(); }
}
await main();
