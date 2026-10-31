import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createPglite, type Db } from '../apps/api/src/db.ts';
import { OperationalQueryService } from '../apps/api/src/services/operational-query.ts';
import type { AuthContext } from '@ada/contracts';

const ctx:AuthContext={
  sessionId:'test',systemUserId:230,login:'test',displayName:'Test',
  activeUnitId:3,allowedUnitIds:[3],units:[{id:3,name:'EPC13'}],
  groups:[],programs:{AdaAdministracao:[]},roles:['admin'],managerUnitIds:[],
  crossUnit:false,permissionsVersion:'1',resolvedAt:new Date().toISOString(),
  identitySource:'possebon'
};
describe('consultas operacionais declarativas e telas vivas',()=>{
  let db:Db;
  let service:OperationalQueryService;
  beforeAll(async()=>{
    db=await createPglite();
    await db.exec(`
      CREATE TABLE public.pessoa(id integer PRIMARY KEY,nome text,documento text);
      CREATE TABLE public.funcao(id integer PRIMARY KEY,nome text);
      CREATE TABLE public.equipe(id integer PRIMARY KEY,unit_id integer,nome text,deletado_em timestamp);
      CREATE TABLE public.colaborador(
        id integer PRIMARY KEY,unit_id integer,pessoa_id integer REFERENCES pessoa(id),
        empresa_id integer REFERENCES pessoa(id),funcao_id integer REFERENCES funcao(id),equipe_id integer REFERENCES equipe(id),
        status text,deletado_em timestamp
      );
      INSERT INTO pessoa VALUES(1,'Pessoa TI','11111111111'),(2,'Pessoa Obra','22222222222'),(3,'Outra Unidade','33333333333'),(10,'Empresa Teste','44444444000100');
      INSERT INTO funcao VALUES(1,'Analista de TI'),(2,'Pedreiro');
      INSERT INTO equipe VALUES(1,3,'Tecnologia',NULL),(2,3,'Obra',NULL),(3,4,'TI Externa',NULL);
      INSERT INTO colaborador VALUES(1,3,1,10,1,1,'A',NULL),(2,3,2,10,2,2,'A',NULL),(3,4,3,10,1,3,'A',NULL);
    `);
    const source={executeRead:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>
      db.query<T>(sql,params)};
    service=new OperationalQueryService(async()=>source);
  });
  afterAll(async()=>db.close());
  it('descobre relacionamentos verificados, sem revelar colunas pessoais',async()=>{
    const e=await service.explore(ctx,'colaborador','colaborador');
    expect(e.tabelas[0]?.relacionamentos).toEqual(expect.arrayContaining([
      expect.objectContaining({campo:'pessoa_id',tabelaRelacionada:'pessoa'}),
      expect.objectContaining({campo:'equipe_id',tabelaRelacionada:'equipe'})
    ]));
    expect(JSON.stringify(e)).not.toContain('documento');
  });
  it('responde quem trabalha na TI usando dados atuais e unit_id',async()=>{
    const plan={
      from:'colaborador',joins:['pessoa','equipe','funcao'],
      select:[{field:'pessoa.nome',as:'nome'},{field:'funcao.nome',as:'funcao'},{field:'equipe.nome',as:'equipe'}],
      where:[{field:'colaborador.status',op:'eq',value:'A'}],
      search:{fields:['equipe.nome','funcao.nome'],text:'TI'},limit:50
    };
    const a=await service.query(ctx,plan);
    expect(a.rows).toEqual([{nome:'Pessoa TI',funcao:'Analista de TI',equipe:'Tecnologia'}]);
    await db.query("INSERT INTO pessoa VALUES(4,'Pessoa Nova','44444444444')");
    await db.query("INSERT INTO colaborador VALUES(4,3,4,10,1,1,'A',NULL)");
    const b=await service.query(ctx,plan);
    expect(b.rows).toHaveLength(2);
  });
  it('distingue pessoa_id de empresa_id em duas FKs reais para pessoa',async()=>{
    const colaborador=await service.query(ctx,{
      from:'colaborador',joins:['pessoa'],
      select:[{field:'pessoa.nome',as:'nome'}],
      where:[{field:'colaborador.id',op:'eq',value:1}]
    });
    expect(colaborador.rows).toEqual([{nome:'Pessoa TI'}]);
    const empresa=await service.query(ctx,{
      from:'colaborador',joins:[{table:'pessoa',via:'empresa_id'}],
      select:[{field:'pessoa.nome',as:'empresa'}],
      where:[{field:'colaborador.id',op:'eq',value:1}]
    });
    expect(empresa.rows).toEqual([{empresa:'Empresa Teste'}]);
    await expect(service.query(ctx,{
      from:'colaborador',joins:[{table:'pessoa',via:'inexistente_id'}],
      select:[{field:'pessoa.nome'}]
    })).rejects.toThrow();
  });
  it('bloqueia usuário não administrativo, vazamentos e joins inventados',async()=>{
    await expect(service.query({...ctx,roles:['user']},{from:'colaborador',select:[{field:'colaborador.id'}]})).rejects.toThrow();
    await expect(service.query(ctx,{from:'colaborador',joins:['pessoa'],
      select:[{field:'pessoa.documento'}]})).rejects.toThrow();
    await expect(service.query(ctx,{from:'pessoa',select:[{field:'pessoa.nome'}]})).rejects.toThrow();
    await expect(service.query(ctx,{from:'equipe',joins:['pessoa'],
      select:[{field:'pessoa.nome'}]})).rejects.toThrow();
  });
});
