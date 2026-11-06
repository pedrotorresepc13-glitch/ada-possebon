import {expect,it,vi} from 'vitest';
import {setup} from './helpers.ts';
import type {AiRunResult} from '../apps/api/src/ai/provider.ts';
const text='A POSSEBON integra o consórcio EPC13, contratado pela Petrobras para serviços de engenharia.';
it('mantém a preparação pendente até validar o contexto, cifra a síntese e reutiliza a chamada',async()=>{
 let finish!:(value:AiRunResult)=>void;let calls=0;
 const h=await setup({ai:{name:'test',model:'test',configured:true,async run(args){calls++;expect(args.maxOutputTokens).toBe(1600);expect(Buffer.byteLength(args.instructions+args.input[0]!.content)).toBeLessThan(6500);return new Promise(resolve=>{finish=resolve;});}}});
 try{
 const source=await h.d.db.query<{id:string}>("INSERT INTO ada.knowledge_source(kind,name,scope,unit_id,domain,created_by) VALUES('manual','Contrato','unidade',1,'contrato',9001) RETURNING id");
 const doc=await h.d.db.query<{id:string}>("INSERT INTO ada.knowledge_document(source_id,title,mime_type,checksum,status,scope,unit_id,domain,extracted_text,created_by) VALUES($1,'Contrato EPC13','text/plain','brief-v1','indexado','unidade',1,'contrato',$2,9001) RETURNING id",[source.rows[0]!.id,text]);
 await h.d.db.query('INSERT INTO ada.knowledge_chunk(document_id,ordinal,content) VALUES($1,0,$2)',[doc.rows[0]!.id,text]);
 const c=await h.login('admin.demo');const me=(await c.get('/me')).json;const original=await h.d.sessions.resolveContext(me.user.systemUserId,1,'test');const ctx={...original,identitySource:'possebon' as const};
 vi.spyOn(h.d.sessions,'resolveContext').mockResolvedValue(ctx);
 const pending=h.d.workspace.run(ctx);await vi.waitFor(()=>expect(calls).toBe(1));
 expect((await h.d.db.query<{state:string;conversation_id:string|null}>('SELECT state,conversation_id FROM ada.personal_workspace')).rows[0]).toEqual({state:'running',conversation_id:null});
 finish({text:JSON.stringify({summary:'A POSSEBON integra o consórcio EPC13 e possui relação contratual com a Petrobras conforme a fonte.',evidence:[{source:0,quote:text}]}),usage:{input:300,output:100},toolCalls:[],steps:1});await pending;
 expect((await h.d.workspace.status(ctx)).state).toBe('ready');
 expect(await h.d.workspaceBrief.prepare(ctx)).toMatchObject({input:300,output:100});expect(calls).toBe(1);
 const board=await h.d.db.query<{id:string}>("INSERT INTO ada.operational_board(owner_user_id,unit_id,title,spec) VALUES(9001,1,'Em preparação',$1) RETURNING id",[{title:'Em preparação',panels:[]}]);
 await h.d.db.query("UPDATE ada.personal_workspace SET state='running',conversation_id=NULL,live_board_id=$1 WHERE owner_user_id=9001 AND unit_id=1",[board.rows[0]!.id]);
 expect((await h.d.liveBoards.list(ctx)).some(b=>b.id===board.rows[0]!.id)).toBe(false);
 await expect(h.d.liveBoards.get(ctx,board.rows[0]!.id)).rejects.toThrow();
 expect(await h.d.dashboards.list(ctx)).toHaveLength(0);
 await h.d.db.query("UPDATE ada.personal_workspace SET state='ready' WHERE owner_user_id=9001 AND unit_id=1");
 expect(await h.d.workspaceBrief.status({...ctx,programs:{},activeUnitId:2,allowedUnitIds:[2]})).toBeNull();
 const saved=await h.d.db.query<{value:{ciphertext:string}}>("SELECT value FROM ada.app_setting WHERE key='workspace_brief:9001:1'");expect(saved.rows[0]?.value.ciphertext).toMatch(/^v1:/);expect(saved.rows[0]?.value.ciphertext).not.toContain('Petrobras');
 }finally{vi.restoreAllMocks();await h.close();}
});
