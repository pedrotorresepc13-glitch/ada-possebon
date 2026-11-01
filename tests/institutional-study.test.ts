import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {setup,type Harness} from './helpers.ts';
import {diverseTables,processArea} from '../apps/api/src/services/process-map.ts';
let h:Harness;
beforeAll(async()=>{h=await setup({ai:{name:'test',model:'test',configured:true,async run(){return {text:'{}',usage:{input:0,output:0},toolCalls:[],steps:1};}}});});
afterAll(async()=>{vi.restoreAllMocks();await h.close();});
it('distribui áreas de compras, execução e pessoas em vez de selecionar só as primeiras tabelas',()=>{
 const list=['colaborador','equipe','funcao','procurement_order','rdo','material','contrato'].map(nome=>({nome}));
 const selected=diverseTables(list,5).map(t=>processArea(t.nome));
 expect(selected).toContain('Compras');expect(selected).toContain('Contratos e documentos');expect(new Set(selected).size).toBe(5);
});
it('preserva o orçamento e não executa o mesmo lote simultaneamente; revogação interrompe o estudo',async()=>{
 const c=await h.login('admin.demo');const me=(await c.get('/me')).json;
 const ctx=await h.d.sessions.resolveContext(me.user.systemUserId,me.activeUnit.id,'test');
 await h.d.institutionalStudy.ensure(ctx);await h.d.institutionalStudy.ensure(ctx);
 let finish!:(value:Awaited<ReturnType<typeof h.d.corporateMemory.studyBatch>>)=>void;
 const batch=vi.spyOn(h.d.corporateMemory,'studyBatch').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const running=h.d.institutionalStudy.runDue();await vi.waitFor(()=>expect(batch).toHaveBeenCalledTimes(1));
 await h.d.institutionalStudy.runDue();expect(batch).toHaveBeenCalledTimes(1);
 finish({processed:true,facts:1,documentId:'test',chunks:1,complete:true});await running;
 expect(await h.d.institutionalStudy.status(ctx)).toMatchObject({state:'running',remaining:19});
 await h.d.db.query("UPDATE ada.app_setting SET value=jsonb_set(value,'{nextAt}','0') WHERE key='institutional_study_job'");
 vi.spyOn(h.d.sessions,'resolveContext').mockResolvedValue({...ctx,roles:['user'],programs:{}});
 await h.d.institutionalStudy.runDue();expect(batch).toHaveBeenCalledTimes(1);
 expect(await h.d.institutionalStudy.status(ctx)).toMatchObject({state:'error',remaining:18});
});
