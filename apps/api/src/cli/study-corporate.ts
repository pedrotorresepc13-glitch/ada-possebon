/**
 * Execucao EXPLICITA, com limite de custo, do estudo corporativo baseado
 * nos documentos indexados no banco da Ada. Nunca inicia automaticamente.
 *
 * Producao:
 * node --env-file=/etc/ada/ada.env /opt/ada/current/apps/api/dist/study-corporate.mjs 230 3 3
 * Os parametros sao: ID admin, unidade, lotes (1 a 10).
 */
import { loadConfig } from '../config.ts';
import { createDeps } from '../core.ts';
import { prepare } from '../boot.ts';
import { buildAuthContext } from '../identity.ts';

const operatorId=Number(process.argv[2]);
const unitId=Number(process.argv[3]);
const batches=Number(process.argv[4] ?? 1);
if(!Number.isSafeInteger(operatorId)||operatorId<1||
   !Number.isSafeInteger(unitId)||unitId<1||
   !Number.isSafeInteger(batches)||batches<1||batches>10)
  throw new Error('Uso: study-corporate USER_ID UNIT_ID LOTES(1..10)');
const config=loadConfig();
if(config.demoData || config.devLogin)throw new Error('Estudo real nao permite modo demonstracao.');
const d=await createDeps(config);
try {
  await prepare(d,config);
  const identity=await d.identity.resolve(operatorId);
  if(!identity || !identity.active)
    throw new Error('Administrador inexistente ou inativo no POSSEBON.');
  const ctx=buildAuthContext(identity,unitId,'corporate-study-cli',config.programs,d.identity.kind);
  if(!ctx.programs.AdaAdministracao)
    throw new Error('Programa AdaAdministracao exigido para esta unidade.');
  console.log('Estudo institucional iniciado: lotes maximos '+batches+', unidade '+unitId);
  let total=0,studied=0;
  for(let i=0;i<batches;i++){
    const result=await d.corporateMemory.studyBatch(ctx);
    if(!result.processed)break;
    studied++;
    total+=result.facts ?? 0;
    console.log('Lote '+(i+1)+': '+result.chunks+' trechos; '+result.facts+' afirmacoes; documento completo: '+result.complete);
  }
  console.log('Estudo parcial encerrado; lotes: '+studied+'; afirmacoes extraidas: '+total);
  console.log('ATENCAO: isto NAO confirma que os documentos foram estudados integralmente.');
} finally {await d.db.close();}
