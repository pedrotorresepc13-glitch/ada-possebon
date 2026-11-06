import {expect,it} from 'vitest';
import {createPglite} from '../apps/api/src/db.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import {OperationalAccessService} from '../apps/api/src/services/operational-access.ts';
import type {AuthContext} from '@ada/contracts';
import type {Deps} from '../apps/api/src/core.ts';
import {setup} from './helpers.ts';

const ctx:AuthContext={sessionId:'test',systemUserId:230,login:'pedro',displayName:'Pedro',activeUnitId:3,allowedUnitIds:[3],units:[{id:3,name:'EPC13'}],groups:[],programs:{AdaAdministracao:[]},roles:['admin'],managerUnitIds:[],crossUnit:false,permissionsVersion:'1',resolvedAt:new Date().toISOString(),identitySource:'possebon'};
it('a regra administrativa vale para qualquer tabela de negócio, inclusive caminhos de unidade ambíguos',async()=>{
 const db=await createPglite();try{
  await db.exec(`CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer);
  INSERT INTO projeto VALUES(1,3),(2,4);`);
  for(const table of ['medicao','rdo','contrato']){
   await db.exec(`CREATE TABLE public.${table}(id integer PRIMARY KEY,descricao text,origem_id integer REFERENCES projeto(id),destino_id integer REFERENCES projeto(id));
   INSERT INTO public.${table} VALUES(1,'Registro encontrado',1,2);`);
  }
  const source=async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>db.query<T>(sql,params)});
  const admin=new OperationalQueryService(source);
  for(const table of ['medicao','rdo','contrato']){
   const result=await admin.query(ctx,{from:table,select:[{field:table+'.id',as:'registro'}],search:{fields:[table+'.descricao'],text:'encontrado'}});
   expect(result.rows).toEqual([{registro:1}]);
   expect(result.provenance.scope).toBe('unit_unverified');
   expect((await admin.processMap(ctx)).tables.find(t=>t.nome===table)?.consultavel).toBe(true);
  }
 }finally{await db.close();}
});

it('prévia não grava e o bloqueio confirmado vale para consulta direta e por JOIN', async () => {
 const h = await setup();
 try {
  const unitId = 3;
  const message = 'Bloqueie a tabela projeto para usuários';
  const policy = h.d.operationalAccess;
  expect(await policy.conversationCommand(ctx, { message, unitId })).toMatchObject({confirmable:true});
  expect((await policy.conversationRules(unitId)).blockedTables).toEqual([]);
  const user: AuthContext = {...ctx, roles:['user'], programs:{Compras:[]}};
  await expect(policy.conversationCommand(user, {message, unitId, confirm:true})).rejects.toThrow();
  await expect(policy.conversationCommand(ctx, {message, unitId:4, confirm:true})).rejects.toThrow('unidade mudou');
  await policy.conversationCommand(ctx, {message, unitId, confirm:true});
  await policy.conversationCommand(ctx, {message:'Responda assim: use frases curtas', unitId, confirm:true});
  expect(await policy.conversationRules(unitId)).toEqual({blockedTables:['projeto'],style:'use frases curtas'});
  expect((await policy.conversationRules(4)).blockedTables).toEqual([]);
  await h.d.db.exec(`CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer);
    CREATE TABLE public.pedido(id integer PRIMARY KEY,unit_id integer,projeto_id integer REFERENCES projeto(id));
    INSERT INTO projeto VALUES(1,3); INSERT INTO pedido VALUES(1,3,1);`);
  const source = async () => ({executeRead:<T>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)});
  const operations = new OperationalQueryService(source, async c => c.roles.includes('admin')
    ? policy.policy(c) : {admin:false,businessRead:true,blockedTables:(await policy.conversationRules(c.activeUnitId)).blockedTables,tables:{}});
  const direct = {from:'projeto',select:[{field:'projeto.id',as:'registro'}]};
  const join = {from:'pedido',joins:['projeto'],select:[{field:'projeto.id',as:'registro'}]};
  await expect(operations.query(user,direct)).rejects.toThrow('bloqueada');
  await expect(operations.query(user,join)).rejects.toThrow('bloqueada');
  expect((await operations.query(ctx,direct)).rows).toEqual([{registro:1}]);
  await policy.conversationCommand(ctx,{message:'Desbloqueie a tabela projeto',unitId,confirm:true});
  expect((await operations.query(user,direct)).rows).toEqual([{registro:1}]);
 } finally { await h.close(); }
});
it('admin busca procurement sem unidade, mantém EPC13 como contexto e informa quando a unidade não foi comprovada',async()=>{
 const db=await createPglite();try{
  await db.exec(`CREATE TABLE public.procurement(id integer PRIMARY KEY,descricao text,contrato text);
  CREATE TABLE public.projeto(id integer PRIMARY KEY,unit_id integer);
  CREATE TABLE public.pedido(id integer PRIMARY KEY,projeto_id integer REFERENCES projeto(id),descricao text);
  INSERT INTO procurement VALUES(10,'Notebook TI','Contrato EPC13'),(20,'Notebook externo','Outro contrato');
  INSERT INTO projeto VALUES(1,3),(2,4);
  INSERT INTO pedido VALUES(1,1,'Notebook EPC13'),(2,2,'Notebook externo');`);
  const source=async()=>({executeRead:<T>(sql:string,params:unknown[]=[])=>db.query<T>(sql,params)});
  const policy=new OperationalAccessService({} as Deps);
  const admin=new OperationalQueryService(source,c=>policy.policy(c));
  const plan={from:'procurement',select:[{field:'procurement.id',as:'sc'},{field:'procurement.contrato',as:'contrato'}],search:{fields:['procurement.descricao'],text:'notebook'}};
  const found=await admin.query(ctx,plan);
  expect(found.rows).toHaveLength(2);
  expect(found.provenance).toMatchObject({scope:'unit_unverified',unitId:null,requestedUnitId:3});
  expect((await admin.processMap(ctx)).tables.find(t=>t.nome==='procurement')?.consultavel).toBe(true);
  const localPlan={from:'pedido',joins:['projeto'],select:[{field:'pedido.id',as:'sc'}]};
  expect((await admin.query(ctx,localPlan)).rows).toEqual([{sc:1}]);
  expect((await admin.query(ctx,{...localPlan,unitScope:'all'})).rows).toEqual([{sc:1},{sc:2}]);
  const restricted=new OperationalQueryService(source,async()=>({admin:false,tables:{procurement:{columns:['id','descricao','contrato']},pedido:{columns:['id','projeto_id','descricao']},projeto:{columns:['id','unit_id']}}}));
  const user:AuthContext={...ctx,roles:['user'],programs:{Compras:[]}};
  await expect(restricted.query(user,plan)).rejects.toThrow(/vínculo único/);
  await expect(restricted.query(user,{...localPlan,unitScope:'all'})).rejects.toThrow(/administração/);
  expect((await restricted.query(user,localPlan)).rows).toEqual([{sc:1}]);
  await expect(admin.query({...ctx,identitySource:'dev_synthetic'},plan)).rejects.toThrow();
 }finally{await db.close();}
});
