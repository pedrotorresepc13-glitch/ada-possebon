import {expect,it} from 'vitest';
import {createPglite} from '../apps/api/src/db.ts';
import {OperationalQueryService} from '../apps/api/src/services/operational-query.ts';
import {OperationalAccessService} from '../apps/api/src/services/operational-access.ts';
import type {AuthContext} from '@ada/contracts';
import type {Deps} from '../apps/api/src/core.ts';

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
