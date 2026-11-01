import {z} from 'zod';
import {assertAdmin,businessValue} from '@ada/domain';
import type {AuthContext} from '@ada/contracts';
import type {Deps} from '../core.ts';
import {audit} from '../audit.ts';
const identifier=z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const DefinitionInput=z.object({table:identifier,column:identifier,code:z.string().trim().min(1).max(50),label:z.string().trim().min(2).max(120).refine(v=>[...v].every(c=>c.charCodeAt(0)>=32)),documentId:z.uuid(),quote:z.string().min(12).max(700)}).strict();
type Definition=z.infer<typeof DefinitionInput>&{checksum:string;approvedBy:number;approvedAt:string};
export const dictionaryKey=(table:string,column:string,code:string)=>JSON.stringify([table,column,code.trim()]);
/** Aprendizagem sem inferir letras: aprovação administrativa + evidência documental vigente. */
export class BusinessDictionaryService{
 constructor(private readonly d:Deps){}
 private async valid(ctx:AuthContext,items:Definition[]){
  if(!items.length)return [];
  const docs=await this.d.db.query<{id:string;checksum:string;quote:string}>(`SELECT d.id,d.checksum,i.quote FROM jsonb_to_recordset($1::jsonb) AS i("documentId" uuid,checksum text,quote text)
   JOIN ada.knowledge_document d ON d.id=i."documentId" AND d.checksum=i.checksum JOIN ada.knowledge_source s ON s.id=d.source_id
   WHERE position(i.quote in d.extracted_text)>0 AND d.status='indexado' AND s.status='ativo'
   AND (d.valid_until IS NULL OR d.valid_until>=current_date) AND (d.unit_id IS NULL OR d.unit_id=$2)
   AND (d.scope<>'unidade' OR d.unit_id=$2) AND d.required_programs <@ $3::text[]
   AND (s.unit_id IS NULL OR s.unit_id=$2) AND (s.scope<>'unidade' OR s.unit_id=$2)
   AND s.required_programs <@ $3::text[] AND (s.sensitivity<>'confidencial' OR cardinality(s.required_programs)>0)
   AND (d.sensitivity<>'confidencial' OR cardinality(d.required_programs)>0)`,[JSON.stringify(items.map(i=>({documentId:i.documentId,checksum:i.checksum,quote:i.quote}))),ctx.activeUnitId,Object.keys(ctx.programs)]);
  return items.filter(i=>docs.rows.some(d=>d.id===i.documentId&&d.checksum===i.checksum&&d.quote===i.quote));
 }
 async read(ctx:AuthContext){
  const r=await this.d.db.query<{value:{ciphertext:string}}>('SELECT value FROM ada.app_setting WHERE key=$1',['business_dictionary:'+ctx.activeUnitId]);
  const items=r.rows[0]?JSON.parse(this.d.cipher.decrypt(r.rows[0].value.ciphertext)) as Definition[]:[];
  return this.valid(ctx,items);
 }
 async resolve(ctx:AuthContext,table:string,column:string,code:string){
  const definition=(await this.read(ctx)).find(d=>dictionaryKey(d.table,d.column,d.code)===dictionaryKey(table,column,code));
  const builtin=businessValue(table,column,code);
  if(!definition&&builtin!==code&&!String(builtin).startsWith('Situação sem descrição'))return {known:true,definition:{table,column,code,label:builtin,source:'Dicionário versionado do projeto: packages/domain/src/business-labels.ts'}};
  return definition?{known:true,definition}:{known:false,table,column,code,note:'Código sem definição documental aprovada para este campo. Consulte tabela de domínio relacionada por FK, model/Designer ou documento vigente. Não inferir pelo caractere nem usar significado de outro módulo.'};
 }
 async save(ctx:AuthContext,raw:unknown){
  assertAdmin(ctx);if(this.d.config.isProduction&&ctx.identitySource!=='possebon')throw new Error('Aprovação exige identidade POSSEBON real.');
  const input=DefinitionInput.parse(raw);
  if(!input.quote.includes(input.code)||!input.quote.toLocaleLowerCase('pt-BR').includes(input.label.toLocaleLowerCase('pt-BR')))throw new Error('A evidência precisa conter o código e sua descrição.');
  const doc=await this.d.db.query<{checksum:string}>('SELECT checksum FROM ada.knowledge_document WHERE id=$1',[input.documentId]);
  const item:Definition={...input,checksum:doc.rows[0]?.checksum??'',approvedBy:ctx.systemUserId,approvedAt:this.d.now().toISOString()};
  if(!(await this.valid(ctx,[item])).length)throw new Error('Evidência não encontrada em documento vigente e autorizado.');
  const key='business_dictionary:'+ctx.activeUnitId;
  await this.d.db.tx(async q=>{
   await q.query('INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[key,{ciphertext:this.d.cipher.encrypt('[]')},ctx.systemUserId]);
   const r=await q.query<{value:{ciphertext:string}}>('SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE',[key]);
   const items=JSON.parse(this.d.cipher.decrypt(r.rows[0]!.value.ciphertext)) as Definition[];
   const filtered=items.filter(i=>dictionaryKey(i.table,i.column,i.code)!==dictionaryKey(item.table,item.column,item.code));
   if(filtered.length>=1000)throw new Error('Limite de definições atingido. Revise o dicionário antes de acrescentar novas entradas.');
   await q.query('UPDATE ada.app_setting SET value=$2,updated_by=$3,updated_at=now() WHERE key=$1',[key,{ciphertext:this.d.cipher.encrypt(JSON.stringify([...filtered,item]))},ctx.systemUserId]);
   await audit(q,{actor:ctx.systemUserId,unit:ctx.activeUnitId,action:'dicionario.definicao_aprovada',outcome:'ok',details:{table:item.table,column:item.column,code:item.code,documentId:item.documentId,checksum:item.checksum}});
  });return {saved:true,definition:item};
 }
}
