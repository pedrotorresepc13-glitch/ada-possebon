import {expect,it} from 'vitest';
import {setup} from './helpers.ts';
it('estuda trecho longo com acentos sem pular conteúdo e retoma do deslocamento salvo',async()=>{
 const h=await setup({ai:{name:'test',model:'test',configured:true,async run(input){expect(Buffer.byteLength(input.instructions+input.input[0]!.content)).toBeLessThanOrEqual(5000);return {text:'{"facts":[]}',usage:{input:100,output:10},toolCalls:[],steps:1};}}});
 try{
 const c=await h.login('admin.demo');const me=(await c.get('/me')).json;const ctx=await h.d.sessions.resolveContext(me.user.systemUserId,1,'test');
 const content=Array.from({length:500},(_,i)=>'Trecho '+i+' ação 🚀. ').join('');
 const source=await h.d.db.query<{id:string}>("INSERT INTO ada.knowledge_source(kind,name,scope,unit_id,created_by) VALUES('manual','Longo','unidade',1,9001) RETURNING id");
 const doc=await h.d.db.query<{id:string}>("INSERT INTO ada.knowledge_document(source_id,title,mime_type,checksum,status,scope,unit_id,extracted_text,created_by) VALUES($1,'Contrato longo','text/plain','long-v1','indexado','unidade',1,$2,9001) RETURNING id",[source.rows[0]!.id,content]);
 await h.d.db.query('INSERT INTO ada.knowledge_chunk(document_id,ordinal,content) VALUES($1,0,$2)',[doc.rows[0]!.id,content]);
 let characters=0;let complete=false;let batches=0;
 while(!complete&&batches<20){const result=await h.d.corporateMemory.studyBatch(ctx);expect(result.processed).toBe(true);characters+=result.characters??0;complete=result.complete??false;batches++;
   const progress=await h.d.db.query<{next_char_offset:number;next_ordinal:number}>('SELECT next_char_offset,next_ordinal FROM ada.corporate_study_progress WHERE document_id=$1',[doc.rows[0]!.id]);
   if(batches===1){expect(progress.rows[0]!.next_char_offset).toBeGreaterThan(0);expect(progress.rows[0]!.next_ordinal).toBe(0);}
 }
 expect(complete).toBe(true);expect(characters).toBe(content.length);expect(batches).toBeGreaterThan(1);
 }finally{await h.close();}
});
