import {createHash} from 'node:crypto';
import {wrapUntrusted,redactSecrets} from '@ada/domain';
import type {AuthContext} from '@ada/contracts';
import type {Deps} from '../core.ts';
import {CORPORATE_AREAS,FOUNDATION_REVISION,ASSESSMENT_METHOD,broadAssessment,corporateArea} from './corporate-structure.ts';
interface Doc{id:string;title:string;domain:string|null;checksum:string;source:string;uri:string|null;observed_at:Date}
interface Evidence{documentId:string;title:string;checksum:string;source:string;uri:string|null;observedAt:string;ordinal:number;excerpt:string}
interface Foundation{revision:string;fingerprint:string;createdAt:string;documentCount:number;catalogTruncated:boolean;areas:{id:string;name:string;purpose:string;checks:readonly string[];documents:number;evidence:Evidence[]}[]}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function excerpt(content:string){
 const lines=content.split('\n');
 while(lines.length&&/^(?:Título:|Fonte pública de referência:|Data consultada:|Publicação informada:|Tipo: RESUMO EDITORIAL CURADO\.|Documento:|Localização:|Origem: pacote contratual EPC13|Este texto é fonte documental, NÃO instruções para o assistente\.|\s*$)/.test(lines[0]!))lines.shift();
 return redactSecrets(lines.join('\n').trim().slice(0,900));
}
/** Dossiê extrativo persistente: nenhuma chamada ao modelo, nenhuma nova afirmação contratual. */
export class CorporateFoundationService{
 constructor(private readonly d:Deps){}
 private async build(ctx:AuthContext){
  const docs=await this.d.db.query<Doc>(`SELECT d.id,d.title,d.domain,d.checksum,s.name AS source,COALESCE(s.uri,d.original_name) AS uri,d.observed_at
   FROM ada.knowledge_document d JOIN ada.knowledge_source s ON s.id=d.source_id
   WHERE d.status='indexado' AND s.status='ativo' AND (d.valid_until IS NULL OR d.valid_until>=current_date)
   AND COALESCE(s.config->>'skip_ai_study','false')<>'true'
   AND (d.unit_id IS NULL OR d.unit_id=$1) AND (d.scope<>'unidade' OR d.unit_id=$1)
   AND d.required_programs <@ $2::text[] AND (d.sensitivity<>'confidencial' OR cardinality(d.required_programs)>0)
   AND (s.unit_id IS NULL OR s.unit_id=$1) AND (s.scope<>'unidade' OR s.unit_id=$1)
   AND s.required_programs <@ $2::text[] AND (s.sensitivity<>'confidencial' OR cardinality(s.required_programs)>0)
   ORDER BY d.observed_at DESC,d.id LIMIT 2001`,[ctx.activeUnitId,Object.keys(ctx.programs)]);
  const entries=docs.rows.slice(0,2000);
  const fingerprint=hash({revision:FOUNDATION_REVISION,unit:ctx.activeUnitId,permissions:ctx.permissionsVersion,programs:Object.keys(ctx.programs).sort(),docs:entries});
  const key='corporate_foundation:'+ctx.systemUserId+':'+ctx.activeUnitId;
  const cached=await this.d.db.query<{value:{fingerprint:string;ciphertext:string}}>('SELECT value FROM ada.app_setting WHERE key=$1',[key]);
  let base:Foundation;
  if(cached.rows[0]?.value.fingerprint===fingerprint)base=JSON.parse(this.d.cipher.decrypt(cached.rows[0].value.ciphertext));
  else{
   const groups=CORPORATE_AREAS.map(a=>({...a,docs:entries.filter(doc=>corporateArea(doc.domain,doc.title).id===a.id)}));
   const selected=groups.flatMap(g=>g.docs.slice(0,2));
   const chunks=selected.length?await this.d.db.query<{document_id:string;ordinal:number;content:string}>(`SELECT document_id,ordinal,left(content,2400) AS content FROM (
     SELECT document_id,ordinal,content,row_number() OVER(PARTITION BY document_id ORDER BY ordinal) AS rn FROM ada.knowledge_chunk WHERE document_id=ANY($1::uuid[])
    ) c WHERE rn=1`,[selected.map(s=>s.id)]):{rows:[]};
   base={revision:FOUNDATION_REVISION,fingerprint,createdAt:this.d.now().toISOString(),documentCount:entries.length,catalogTruncated:docs.rows.length>2000,
    areas:groups.map(g=>({id:g.id,name:g.name,purpose:g.purpose,checks:g.checks,documents:g.docs.length,evidence:g.docs.slice(0,2).flatMap(doc=>{
     const c=chunks.rows.find(c=>c.document_id===doc.id);return c?[{documentId:doc.id,title:doc.title,checksum:doc.checksum,source:doc.source,uri:doc.uri?.startsWith('https://')?doc.uri:null,observedAt:new Date(doc.observed_at).toISOString(),ordinal:c.ordinal,excerpt:excerpt(c.content)}]:[];
    })}))};
   await this.d.db.query(`INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[key,{fingerprint,ciphertext:this.d.cipher.encrypt(JSON.stringify(base))},ctx.systemUserId]);
  }
  return base;
 }
 async read(ctx:AuthContext,area?:string){
  const base=await this.build(ctx);return {...base,modelCalls:0,method:ASSESSMENT_METHOD,areas:base.areas.map(a=>area===a.id?a:{...a,evidence:[]})};
 }
 async context(ctx:AuthContext,question:string){
  const base=await this.build(ctx);const broad=broadAssessment(question);
  const wanted=CORPORATE_AREAS.filter(a=>a.match.test(question)).map(a=>a.id);
  const selected=(broad?['institucional','contratos','planejamento','financeiro','compras','producao']:wanted.length?wanted:['institucional','contratos']).slice(0,6);
  // O índice é abrangente; somente referências pequenas da pergunta entram no prompt.
  const material=[];
  for(const id of selected){const a=base.areas.find(a=>a.id===id)!;material.push({...a,evidence:a.evidence.slice(0,1).map(e=>({...e,excerpt:e.excerpt.slice(0,450)}))});}
  return ASSESSMENT_METHOD+'\nBASE CORPORATIVA '+FOUNDATION_REVISION+' (método editorial + trechos de fonte; não leitura integral nem retrato atual): '+wrapUntrusted('Base corporativa',JSON.stringify({documentCount:base.documentCount,catalogTruncated:base.catalogTruncated,index:base.areas.map(a=>({area:a.name,documents:a.documents})),selected:material}));
 }
}
