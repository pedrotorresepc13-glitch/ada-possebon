/**
 * IA POSSEBON — importação LOCAL de anexos contratuais EPC13.
 *
 * Execute com a API/worker parados (PGlite só admite um processo).
 * Ex.: npm run knowledge:import-epc13 -- "C:\\...\\IA_POSSEBON_EPC13_CONHECIMENTO.jsonl.gz" 230
 * O arquivo fornecido pelo usuário nunca é transmitido para Github ou OpenAI
 * durante esta importação.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadConfig } from '../config.ts';
import { createDeps } from '../core.ts';
import { prepare } from '../boot.ts';
import { importEpc13Corpus } from '../services/epc13-corpus.ts';

const EXPECTED_CORPUS_SHA256 = 'f2add6b6013e3b9f8b151278ee9b63d35b34f7b740139659638170a16f07f8b0';
const fileName = process.argv[2] ? path.resolve(process.argv[2]) : null;
const operatorId = Number(process.argv[3]);
if (!fileName || !Number.isInteger(operatorId) || operatorId < 1) {
  throw new Error('Uso: npm run knowledge:import-epc13 -- "CAMINHO_DO_PACOTE.jsonl.gz" 230');
}
const config = loadConfig();
if (config.db.driver !== 'pglite' || config.devLogin || config.demoData) {
  throw new Error('Importação local exige PGlite e ADA_DEV_LOGIN=0 e ADA_DEMO_DATA=0');
}
const info = await stat(fileName);
if (info.size > 35_000_000 || info.size < 1000) throw new Error('Tamanho do pacote inesperado');
const h = createHash('sha256');
for await (const piece of createReadStream(fileName)) h.update(piece);
if (h.digest('hex') !== EXPECTED_CORPUS_SHA256) {
  throw new Error('SHA-256 do pacote diferente do corpus preparado; não importar.');
}
const deps = await createDeps(config);
try {
  await prepare(deps,config);
  const r = await importEpc13Corpus(deps, fileName, operatorId, {
    progress: (n) => process.stdout.write(`Importação local: ${n} partes verificadas\n`)
  });
  console.log(JSON.stringify({ success: true, unit: 3, classification: 'restrito',
    documents: r.processed, newDocuments: r.inserted, updated: r.updated, unchanged: r.unchanged,
    searchableChunks: r.chunks, acl: 'AdaAdministracao' }, null, 2));
} finally {
  await deps.db.close();
}
