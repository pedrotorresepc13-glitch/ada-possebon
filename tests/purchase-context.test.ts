import {expect,it} from 'vitest';
import {setup} from './helpers.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import type {AuthContext} from '@ada/contracts';
it('descobre compras além das primeiras 60 tabelas e consulta o notebook sem métrica cadastrada',async()=>{
 let context='';let result:unknown;
 const h=await setup({ai:{name:'test',model:'test',configured:true,async run(input){context=input.instructions;
   result=await input.execute('consultar_banco',{from:'procurement_order',select:[{field:'procurement_order.id',as:'oc'},{field:'procurement_order.situacao',as:'situacao'}],where:[{field:'procurement_order.descricao',op:'contains',value:'notebook'}]});
   return {text:'Consulta concluída.',usage:{input:1,output:1},toolCalls:[],steps:1};}}});
 try{
   await h.d.db.exec(Array.from({length:65},(_,i)=>`CREATE TABLE public.a_tabela_${i}(id integer,unit_id integer);`).join('\n')+`CREATE TABLE procurement_order(id integer,unit_id integer,descricao text,situacao text);
    INSERT INTO procurement_order VALUES(10,1,'Notebook para TI','Aprovada'),(20,2,'Notebook externo','Pendente');`);
   h.d.operational=new OperationalQueryService(async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)}));
   const c=await h.login('admin.demo');const me=(await c.get('/me')).json;
   const original=await h.d.sessions.resolveContext(me.user.systemUserId,me.activeUnit.id,'test');
   const ctx:AuthContext={...original,identitySource:'possebon'};
   await h.d.chat.handle(ctx,{message:'Preciso saber sobre a OC do notebook'});
   expect(context).toContain('MAPA OPERACIONAL VERIFICADO');expect(context).toContain('procurement_order');
   expect(result).toMatchObject({rows:[{oc:10,situacao:'Aprovada'}]});
 }finally{await h.close();}
});
