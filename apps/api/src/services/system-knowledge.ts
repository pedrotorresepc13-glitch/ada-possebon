import {wrapUntrusted} from '@ada/domain';
import type {AuthContext} from '@ada/contracts';
import type {Deps} from '../core.ts';
import {diverseTables} from './process-map.ts';
import {isProtectedTable} from './unit-path.ts';

const normalized=(s:string)=>s.replace(/([a-z0-9])([A-Z])/g,'$1 $2').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/audcomp/g,'audicomp').replace(/[^a-z0-9]+/g,' ').trim();
interface Reference{kind:string;label:string;source_ref:string;snapshot:string|null;table_name:string|null;title:string|null;defaults:string|null;area_name:string|null}
const referenceText=(r:Reference)=>[r.label,r.title??'',r.area_name??''].join(' ');
interface ReadCheck{at:string;scope:string}
const GENERAL_CHECKS=['Finalidade e regra vigentes no formulário/procedimento','Identificador, unidade, contrato/projeto e responsáveis confirmados','Campos, FKs e tabelas de domínio reais; nomes não comprovam vínculos','Entradas, aprovações, transições, saídas e evidências','Prazos, pendências e impactos nos outros processos','Códigos homologados por tabela/campo; não inferir letras','Histórico e data do fato separados de cadastro/atualização','Permissões reais e consultas atuais antes de concluir'];
/** Roteiros de investigação, nunca definições privadas presumidas do sistema. */
export function moduleGuide(name:string){
 const n=normalized(name);const checks=[...GENERAL_CHECKS];
 if(/\brdo\b|diario/.test(n))checks.push('No RDO: verificar data do diário, frente/equipe, atividades, quantidades/unidades, horas, impedimentos e aprovação. Contagem de diários não é avanço físico.');
 if(/audi? ?comp/.test(n))checks.push('AUDCOMP/Audicomp: confirmar finalidade, significado da sigla, formulário, critérios, escalas, participantes, achados e ações na documentação real. Não deduzir expansão da sigla ou regras de pontuação pelo nome.');
 if(/ronda/.test(n))checks.push('Ronda gerencial: verificar roteiro/checklist, local, participantes, observações, achados, responsáveis, vencimentos e evidência de encerramento conforme o formulário vigente. Realizar ronda não significa encerrar as ações.');
 if(/procurement|compra|requisicao|solicitacao/.test(n))checks.push('Compras: distinguir SC, cotação, OC, recebimento e pagamento pela estrutura/tipo documentados. Verificar solicitante, itens, aprovações, fornecedor, datas e recebimento. SC e OC podem compartilhar uma tabela; não presumir o tipo de registro.');
 if(/sms|seguranca|ocorrencia/.test(n))checks.push('SMS: verificar tipo, gravidade, exposição, requisitos, responsáveis e tratamento segundo procedimento vigente. Sem registros não significa ausência de risco; índices precisam de período e denominador.');
 return {type:'roteiro editorial, não regra local homologada',checks};
}
function relevance(name:string,question:string){
 const q=normalized(question),n=normalized(name);let score=(' '+q+' ').includes(' '+n+' ')&&n.length>2?20:0;
 for(const word of q.split(' ').filter(w=>w.length>=3))if(n.includes(word))score+=3;
 if(/\bsc\b|\boc\b|notebook|compra/.test(q)&&/procurement|compra|solicitacao|requisicao/.test(n))score+=8;
 if(/audi? ?comp/.test(q)&&/audi? ?comp/.test(n))score+=8;
 return score;
}
export class SystemKnowledgeService{
 constructor(private readonly d:Deps){}
 async recordRead(ctx:AuthContext,tables:string[],scope:string){
  const key='system_read_checks:'+ctx.systemUserId+':'+ctx.activeUnitId;
  await this.d.db.tx(async q=>{
   await q.query('INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[key,{ciphertext:this.d.cipher.encrypt(JSON.stringify({version:ctx.permissionsVersion,tables:{}}))},ctx.systemUserId]);
   const r=await q.query<{value:{ciphertext:string}}>('SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE',[key]);
   const old=JSON.parse(this.d.cipher.decrypt(r.rows[0]!.value.ciphertext)) as {version:string;tables:Record<string,ReadCheck>};
   const entries=old.version===ctx.permissionsVersion?old.tables:{};
   for(const table of tables)entries[table]={at:this.d.now().toISOString(),scope};
   const bounded=Object.fromEntries(Object.entries(entries).sort((a,b)=>b[1].at.localeCompare(a[1].at)).slice(0,1000));
   await q.query('UPDATE ada.app_setting SET value=$2,updated_at=now() WHERE key=$1',[key,{ciphertext:this.d.cipher.encrypt(JSON.stringify({version:ctx.permissionsVersion,tables:bounded}))}]);
  });
 }
 private async snapshot(ctx:AuthContext){
  let sourceState='available';let scope='unit';let tables:Awaited<ReturnType<Deps['operational']['processMap']>>['tables']=[];
  try{const map=await this.d.operational.processMap(ctx);tables=map.tables;scope=map.scope;}catch{sourceState='unavailable';}
  const [graph,documents,definitions,readChecks]=await Promise.all([
   this.d.db.query<Reference>(`SELECT kind,label,source_ref,attributes->>'snapshot' AS snapshot,attributes->>'table' AS table_name,attributes->>'title' AS title,attributes->>'defaults' AS defaults,attributes->>'area' AS area_name FROM ada.brain_node
    WHERE kind IN ('modelo','tabela','tela','area','modulo') AND (unit_id IS NULL OR unit_id=$1)
    AND required_programs <@ $2::text[] ORDER BY kind,label,id LIMIT 10001`,[ctx.activeUnitId,Object.keys(ctx.programs)]),
   this.d.db.query<{domain:string;documents:number}>(`SELECT COALESCE(d.domain,'geral') AS domain,count(*)::int AS documents
    FROM ada.knowledge_document d JOIN ada.knowledge_source s ON s.id=d.source_id
    WHERE d.status='indexado' AND s.status='ativo' AND (d.valid_until IS NULL OR d.valid_until>=current_date)
    AND (d.unit_id IS NULL OR d.unit_id=$1) AND (d.scope<>'unidade' OR d.unit_id=$1) AND d.required_programs <@ $2::text[]
    AND (s.unit_id IS NULL OR s.unit_id=$1) AND (s.scope<>'unidade' OR s.unit_id=$1) AND s.required_programs <@ $2::text[]
    AND (d.sensitivity<>'confidencial' OR cardinality(d.required_programs)>0) AND (s.sensitivity<>'confidencial' OR cardinality(s.required_programs)>0)
    GROUP BY COALESCE(d.domain,'geral') ORDER BY 1`,[ctx.activeUnitId,Object.keys(ctx.programs)]),
   this.d.businessDictionary.read(ctx),
   this.d.db.query<{value:{ciphertext:string}}>('SELECT value FROM ada.app_setting WHERE key=$1',['system_read_checks:'+ctx.systemUserId+':'+ctx.activeUnitId])
  ]);
  const checks=readChecks.rows[0]?JSON.parse(this.d.cipher.decrypt(readChecks.rows[0].value.ciphertext)) as {version:string;tables:Record<string,ReadCheck>}:null;
  const references=graph.rows.slice(0,10000).filter(r=>r.kind!=='tabela'||!isProtectedTable(r.label));
  return {sourceState,scope,tables,definitions,references,graphTruncated:graph.rows.length>10000,documents:documents.rows,checks:checks?.version===ctx.permissionsVersion?checks.tables:{}};
 }
 async catalog(ctx:AuthContext,term='',page=0){
  const s=await this.snapshot(ctx);const bindings=new Set(s.references.filter(r=>r.table_name&&relevance(referenceText(r),term)>0).map(r=>r.table_name));
  const matching=s.tables.filter(t=>!term||relevance(t.nome,term)>0||bindings.has(t.nome));
  const references=s.references.filter(r=>!term||relevance(referenceText(r),term)>0).sort((a,b)=>relevance(referenceText(b),term)-relevance(referenceText(a),term));
  const tableNames=new Set(s.tables.map(t=>t.nome));
  return {unitId:ctx.activeUnitId,sourceState:s.sourceState,scope:s.scope,modelCalls:0,observedAt:this.d.now().toISOString(),
   totalTables:s.tables.length,matchingTables:matching.length,matchingReferences:references.length,page,hasMore:Math.max(matching.length,references.length)>(page+1)*40,
   tables:matching.slice(page*40,(page+1)*40).map(t=>({name:t.nome,area:t.area,columns:t.colunas.length,queryable:t.consultavel,unitVerified:t.unidadeVerificavel,
    approvedCodeDefinitions:s.definitions.filter(d=>d.table===t.nome).length,lastRead:s.checks[t.nome]??null})),
   programs:Object.keys(ctx.programs).sort(),areas:[...new Set(s.tables.map(t=>t.area))],documentDomains:s.documents,
   referenceCounts:{models:s.references.filter(r=>r.kind==='modelo').length,screens:s.references.filter(r=>r.kind==='tela').length,modules:s.references.filter(r=>r.kind==='modulo').length,declaredTables:s.references.filter(r=>r.kind==='tabela').length},
   references:references.slice(page*40,(page+1)*40),graphTruncated:s.graphTruncated,
   declaredWithoutLiveMetadata:s.references.filter(r=>r.kind==='tabela'&&!tableNames.has(r.label)).length,
   note:'Inventário dinâmico das estruturas autorizadas. Tabela não equivale a módulo e programa não equivale a tabela. Referências do grafo são declarações do inventário, não prova de integração atual. Última leitura registra consulta real naquele instante, não garante disponibilidade futura. Ausência no esquema acessível não prova ausência do módulo no POSSEBON.'};
 }
 async module(ctx:AuthContext,table:string){
  const s=await this.snapshot(ctx);const found=s.tables.find(t=>t.nome===table);
  const references=s.references.filter(r=>r.table_name===table||relevance(r.label,table)>0).sort((a,b)=>{
   const rank=(r:Reference)=>(r.table_name===table?100:0)+(r.kind==='tela'?10:0);
   return rank(b)-rank(a)||a.label.localeCompare(b.label);
  }).slice(0,32);
  const docs=await this.d.knowledge.search(ctx,table.replaceAll('_',' '),3);
  return {table,liveMetadataAvailable:Boolean(found),sourceState:s.sourceState,structure:found??null,
   schema:found?await this.d.operational.explore(ctx,'',table):null,guide:moduleGuide(table),
   references,documents:docs,approvedCodes:s.definitions.filter(d=>d.table===table),lastRead:s.checks[table]??null,
   coverage:{structure:Boolean(found),documentMatches:docs.length,approvedCodes:s.definitions.filter(d=>d.table===table).length,allRulesValidated:false},
   note:'Correspondência de texto é pista de navegação. Confirme finalidade, fórmula, transições e vínculo com o módulo em fonte ou formulário real. O roteiro não é uma declaração de que todos esses campos existem.'};
 }
 async context(ctx:AuthContext,question:string){
  const s=await this.snapshot(ctx);const bindings=new Map<string,number>();
  for(const r of s.references){const score=relevance(referenceText(r),question);if(r.table_name&&score>0)bindings.set(r.table_name,Math.max(bindings.get(r.table_name)??0,score));}
  const ranked=s.tables.map(t=>({t,score:relevance(t.nome,question)+(bindings.get(t.nome)??0)*5})).filter(t=>t.score>0).sort((a,b)=>b.score-a.score||a.t.nome.localeCompare(b.t.nome));
  const selected=ranked.length?ranked.slice(0,8).map(t=>t.t):diverseTables(s.tables,8);
  const references=s.references.filter(r=>relevance(referenceText(r),question)>0).sort((a,b)=>relevance(referenceText(b),question)-relevance(referenceText(a),question)).slice(0,6).map(r=>({kind:r.kind,name:r.label.slice(0,120),title:r.title?.slice(0,120),table:r.table_name,declaredDefaults:r.defaults?.slice(0,500),source:r.source_ref.slice(0,160),snapshot:r.snapshot}));
   const selectedNames=new Set(selected.map(t=>t.nome));
   const mentionedTables=new Set(question.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
   const knownCodes=s.definitions.filter(d=>selectedNames.has(d.table)||mentionedTables.has(d.table)).slice(0,24)
    .map(d=>({table:d.table,column:d.column,code:d.code,label:d.label,documentId:d.documentId,sourceChecksum:d.checksum,liveSchemaVerified:selectedNames.has(d.table)}));
  const data={unitId:ctx.activeUnitId,sourceState:s.sourceState,scope:s.scope,totalTables:s.tables.length,areas:[...new Set(s.tables.map(t=>t.area))],
   selectedTables:selected.map(t=>({name:t.nome,area:t.area,queryable:t.consultavel,unitVerified:t.unidadeVerificavel,columns:t.colunas.slice(0,15).map(c=>c.nome)})),references,
   documentDomains:s.documents.slice(0,20),approvedCodeDefinitions:knownCodes};
  return 'MAPA OPERACIONAL VERIFICADO E INVENTÁRIO DO SISTEMA (zero chamadas de estudo; seleção para esta pergunta, não lista completa): '+wrapUntrusted('Estrutura autorizada',JSON.stringify(data))+
   '\nUse conhecer_sistema para pesquisar TODO o catálogo, inclusive módulos fora das áreas editoriais; não dependa de uma lista fixa nem só de RH. Use explorar_tabelas para campos completos e FKs e consultar_banco para registros atuais. Falha de esquema não prova que o módulo inexiste: consulte referências e documentos. scope=all_units confirma autoridade administrativa, sem exigir unidade em tabela de negócio. Use unitScope=current por padrão; all somente para pedido entre unidades. Se o retorno for unit_unverified, não atribua o registro à unidade atual sem confirmar o vínculo. Falta de métrica legada não significa falta de dados. Confirme SC versus OC no tipo/fluxo documentado. AUDCOMP não tem expansão ou escala presumida. Referências de tela/modelo não provam regras nem privilégios SELECT. Use verificar_acesso_tabela antes de declarar falta de leitura.';
 }
}
