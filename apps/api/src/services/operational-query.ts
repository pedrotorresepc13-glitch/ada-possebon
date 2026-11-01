import {findUnitPath,unitPredicate,isProtectedTable} from './unit-path.ts';
import {processArea} from './process-map.ts';
import { z } from 'zod';
import { businessColumnLabel, businessValue } from '@ada/domain';
import type { AuthContext } from '@ada/contracts';
import type { ReadonlyPostgresConnector } from './readonly-postgres.ts';
import { forbidden } from '../errors.ts';
import type { OperationalAccess } from './operational-access.ts';
import {dictionaryKey} from './business-dictionary.ts';

/**
 * Linguagem declarativa de consultas do POSSEBON.
 * O modelo NUNCA envia SQL: somente identificadores verificados no catálogo
 * vivo de pg_catalog. O executor impõe unidade, exclusões, SELECT e limites.
 */
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const field = z.string().regex(/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/);
const scalar = z.union([z.string().max(300), z.number().finite(), z.boolean()]);
// Para FKs ambiguas, a IA pode declarar explicitamente o campo de origem.
const joinSpec = z.union([identifier, z.object({table:identifier,via:identifier}).strict()]);
export const OperationalPlan = z.object({
  from: identifier,
  unitScope: z.enum(['current','all']).default('current'),
  joins: z.array(joinSpec).max(3).default([]),
  select: z.array(z.object({
    field, as: identifier.optional(),
    aggregate: z.enum(['count','sum','avg','min','max']).optional()
  }).strict()).min(1).max(12),
  where: z.array(z.object({
    field, op: z.enum(['eq','neq','gt','gte','lt','lte','contains','in','is_null','not_null']),
    value: z.union([scalar, z.array(scalar).min(1).max(40)]).optional()
  }).strict()).max(12).default([]),
  search: z.object({ fields: z.array(field).min(1).max(5), text: z.string().min(1).max(120) }).strict().optional(),
  groupBy: z.array(field).max(4).default([]),
  orderBy: z.array(z.object({ field, direction: z.enum(['asc','desc']).default('asc') }).strict()).max(4).default([]),
  limit: z.number().int().min(1).max(200).default(50)
}).strict();
export type OperationalPlanType = z.input<typeof OperationalPlan>;
export const LiveBoardSpec = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  panels: z.array(z.object({
    title: z.string().min(1).max(120),
    type: z.enum(['table','kpi','bar','line','pie']),
    plan: OperationalPlan
  }).strict()).min(1).max(12)
}).strict();

interface Column { table_name: string; column_name: string; data_type: string }
interface ForeignKey { from_table: string; from_col: string; to_table: string; to_col: string }
type Schema = { columns: Map<string,Map<string,string>>; foreignKeys: ForeignKey[] };
type Read = Pick<ReadonlyPostgresConnector,'executeRead'>;

const BLOCKED = /(^|_)(senha|pass|pwd|passwd|credential|password|secret|token|hash|salt|cpf|cnpj|documento|rg|pis|pasep|nascimento|telefone|celular|email|endereco|cep|bairro|rua|complemento|salario|remuneracao|bancaria|conta|agencia|pix|chave|biometria|foto|imagem|anexo|arquivo|conteudo|observacao|obs|login|ip|cookie|jwt|autenticacao)(_|$)/i;
const BLOCKED_TABLE = {test:isProtectedTable};
const quote = (s:string) => '"' + s.replaceAll('"','""') + '"';
const protect = (name:string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('Identificador não permitido');
  return quote(name);
};
const isSafeColumn = (name:string) => !BLOCKED.test(name);
const deny = (detail:string):never => {throw forbidden('Consulta POSSEBON não autorizada: '+detail);};

export class OperationalQueryService {
  private readonly schemaCache=new Map<number,{data:Schema;until:number}>();
  constructor(private readonly source: (unitId:number) => Promise<Read>,
    private readonly access?: (ctx:AuthContext)=>Promise<OperationalAccess>,
    private readonly definitions?: (ctx:AuthContext)=>Promise<{table:string;column:string;code:string;label:string;documentId:string;checksum:string}[]>) {}

  /** Autoridade de uso: administração POSSEBON validada na sessão, nunca papel autoatribuído. */
  assertAllowed(ctx:AuthContext) {
    if (ctx.identitySource !== 'possebon' || (!this.access && (!ctx.roles.includes('admin') || !ctx.programs.AdaAdministracao))) {
      deny('motor corporativo liberado inicialmente somente para AdaAdministracao com identidade real');
    }
    if (!ctx.allowedUnitIds.includes(ctx.activeUnitId)) deny('unidade não autorizada');
  }

  private async schema(source:Read,unitId:number):Promise<Schema> {
    const cached=this.schemaCache.get(unitId);
    if (cached && cached.until>Date.now()) return cached.data;
    const [columns, keys] = await Promise.all([
      source.executeRead<Column>(
        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position"),
      source.executeRead<ForeignKey>(String.raw`
        SELECT a.relname AS from_table, aa.attname AS from_col,
               b.relname AS to_table, bb.attname AS to_col
        FROM pg_constraint c
        JOIN pg_class a ON a.oid=c.conrelid
        JOIN pg_namespace na ON na.oid=a.relnamespace
        JOIN pg_class b ON b.oid=c.confrelid
        JOIN pg_namespace nb ON nb.oid=b.relnamespace
        JOIN LATERAL unnest(c.conkey,c.confkey) AS cols(from_att,to_att) ON true
        JOIN pg_attribute aa ON aa.attrelid=a.oid AND aa.attnum=cols.from_att
        JOIN pg_attribute bb ON bb.attrelid=b.oid AND bb.attnum=cols.to_att
        WHERE c.contype='f' AND na.nspname='public' AND nb.nspname='public'
      `)
    ]);
    const map=new Map<string,Map<string,string>>();
    for (const c of columns.rows) {
      if (BLOCKED_TABLE.test(c.table_name) || !/^[a-z][a-z0-9_]*$/.test(c.table_name)) continue;
      if (!map.has(c.table_name)) map.set(c.table_name,new Map());
      map.get(c.table_name)!.set(c.column_name,c.data_type);
    }
    const data={columns:map,foreignKeys:keys.rows};
    this.schemaCache.set(unitId,{data,until:Date.now()+60_000});
    return data;
  }

  async explore(ctx:AuthContext, term='', table='') {
    this.assertAllowed(ctx);
    const source=await this.source(ctx.activeUnitId);
    const policy=await this.policy(ctx);
    const s=this.scoped(await this.schema(source,ctx.activeUnitId),policy);
    const search=term.toLowerCase().trim().slice(0,80);
    const accessible=[...s.columns.entries()];
    const matching=accessible.filter(([name,cols])=>
      name.includes(search)||[...cols.keys()].some(k=>k.includes(search)));
    const matched=table ? accessible.filter(([name])=>name===table) :
      (matching.length?matching:accessible).slice(0,60);
    return {
      totalTabelasComUnidade:accessible.length,
      correspondencias:matching.length,
      tabelas:matched.map(([name,cols])=>({
        nome:name,
        colunas:[...cols].filter(([c])=>isSafeColumn(c)).map(([nome,tipo])=>({nome,tipo})).slice(0,65),
        relacionamentos:s.foreignKeys.filter(k=>k.from_table===name && s.columns.has(k.to_table))
          .map(k=>({campo:k.from_col,tabelaRelacionada:k.to_table,campoRelacionado:k.to_col,
            colunasRelacionadas:[...s.columns.get(k.to_table)!].filter(([col])=>isSafeColumn(col)).map(([col])=>col).slice(0,40)})).slice(0,30)
      })),
      nota:policy.admin?'Administração POSSEBON confirmada: permite consulta de negócio de todas as unidades desta conexão, inclusive tabelas sem unit_id. Por padrão usa unidade atual quando há vínculo verificável; unitScope=all amplia explicitamente. Sem vínculo, resultados não comprovam pertencer à unidade atual. JOINs exigem FK real. Colunas pessoais e credenciais são omitidas.':'Tabelas sem unit_id exigem caminho único de FK até uma tabela com unidade; tabelas relacionadas entram somente por FK real. Colunas pessoais e credenciais são omitidas. Resultado limitado ao escopo da unidade na execução.'
    };
  }

  async diagnoseTable(ctx:AuthContext,name:string){
    this.assertAllowed(ctx);identifier.parse(name);const policy=await this.policy(ctx);
    if(!policy.admin&&!Object.hasOwn(policy.tables,name))deny('tabela não autorizada para este usuário');
    const source=await this.source(ctx.activeUnitId);
    const result=await source.executeRead<{table_name:string;can_read:boolean;has_unit:boolean}>(`SELECT c.relname AS table_name,has_table_privilege(current_user,c.oid,'SELECT') AS can_read,
      EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='unit_id' AND NOT a.attisdropped) AS has_unit
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND c.relkind IN ('r','p','v','m')`,[name]);
    const row=result.rows[0];return row?{exists:true,...row,scope:policy.admin?'all_units':'unit',note:policy.admin?'Administração confirmada: ausência de unit_id não bloqueia consulta de negócio. A credencial PostgreSQL ainda precisa de SELECT.':'Diagnóstico da credencial real; falta de SELECT exige autorização no PostgreSQL. Falta de unit_id exige vínculo por FK ou mapeamento.'}:{exists:false,table_name:name,note:'Nome não encontrado no schema public desta conexão.'};
  }
  async processMap(ctx:AuthContext){
    this.assertAllowed(ctx);const source=await this.source(ctx.activeUnitId);const policy=await this.policy(ctx);
    const schema=this.scoped(await this.schema(source,ctx.activeUnitId),policy);
    const tables=[...schema.columns].map(([nome,cols])=>({nome,unidadeVerificavel:findUnitPath(nome,schema.columns,schema.foreignKeys)!==null,consultavel:policy.admin||findUnitPath(nome,schema.columns,schema.foreignKeys)!==null,area:processArea(nome),colunas:[...cols].filter(([c])=>isSafeColumn(c)).map(([nome,tipo])=>({nome,tipo}))}));
    return {unitId:ctx.activeUnitId,scope:policy.admin?'all_units':'unit',tables,areas:[...new Set(tables.map(t=>t.area))],note:policy.admin?'Administração confirmada: todas as unidades e tabelas de negócio desta conexão, sem exigir vínculo de unidade. Constarem no mapa não comprova SELECT.':'Mapa de estrutura autorizada. Nomes classificados são pistas; dados e regras exigem consulta. Tabelas sem caminho único de unidade exigem mapeamento; constar no mapa não comprova permissão SELECT.'};
  }
  /** Compila após introspecção; nenhum SQL gerado pelo modelo é aceito. */
  private compile(planInput:unknown,s:Schema,unitId:number,access:OperationalAccess) {
    const p=OperationalPlan.parse(planInput);
    const tables=[p.from,...p.joins.map(j=>typeof j==='string'?j:j.table)];
    if (new Set(tables).size!==tables.length) deny('tabela repetida');
    const base=s.columns.get(p.from);
    if (!base) deny('tabela base inexistente ou sem metadados acessíveis');
    if(p.unitScope==='all'&&!access.admin)deny('consulta entre unidades exige administração confirmada');
    const path=findUnitPath(p.from,s.columns,s.foreignKeys);
    if(!access.admin&&path===null)deny('tabela sem vínculo único de unidade; requer mapeamento: '+p.from);
    const filterUnit=p.unitScope==='current'&&path!==null;
    const scope=filterUnit?'unit':p.unitScope==='all'?'all_units':'unit_unverified';
    if (BLOCKED_TABLE.test(p.from)) deny('tabela protegida');
    const aliases=new Map<string,string>([[p.from,'t0']]);
    const joins:string[]=[];
    for(let i=0;i<p.joins.length;i++){
      const join=p.joins[i]!;
      const name=typeof join==='string'?join:join.table;
      const via=typeof join==='string'?undefined:join.via;
      const cols=s.columns.get(name);
      if (!cols || BLOCKED_TABLE.test(name)) deny('tabela relacionada inexistente ou restrita');
      const candidates=s.foreignKeys.filter(f=>f.from_table===p.from && f.to_table===name &&
        base!.has(f.from_col) && cols!.has(f.to_col));
      // colaborador possui pessoa_id E empresa_id referenciando pessoa: nunca escolher
      // a primeira FK retornada pelo PostgreSQL (ordem nao garantida).
      let relation:ForeignKey|undefined;
      if(via){
        relation=candidates.find(f=>f.from_col===via);
        if(!relation) deny('JOIN via campo sem FK confirmada: '+name+'.'+via);
      }else{
        const conventional=candidates.filter(f=>f.from_col===name+'_id');
        relation=conventional.length===1?conventional[0]:
          candidates.length===1?candidates[0]:undefined;
        if(candidates.length>1 && !relation) deny('JOIN ambiguo para '+name+'; informe via explicitamente');
      }
      if (!relation) deny('JOIN sem FK confirmada da tabela base');
      const alias='t'+(i+1);
      aliases.set(name,alias);
      const clause=[alias+'.'+protect(relation!.to_col)+' = t0.'+protect(relation!.from_col)];
      if(filterUnit&&cols!.has('unit_id')) clause.push(alias+'.unit_id = $1');
      if(cols!.has('deletado_em')) clause.push(alias+'.deletado_em IS NULL');
      if(cols!.has('deleted_at')) clause.push(alias+'.deleted_at IS NULL');
      joins.push('LEFT JOIN public.'+protect(name)+' '+alias+' ON '+clause.join(' AND '));
    }
    const resolve=(name:string) => {
      const [table,col]=name.split('.');
      const columns=s.columns.get(table??'');
      const alias=aliases.get(table??'');
      if (!columns?.has(col??'') || !alias || !isSafeColumn(col??'')) deny('campo fora do escopo: '+name);
      return {expression:alias+'.'+protect(col!),type:columns!.get(col!)!,table:table!,column:col!};
    };
    const group=p.groupBy.map(x=>resolve(x).expression);
    const used=new Set<string>();
    const labels:Record<string,string>={};
    const sources:Record<string,{table:string;column:string;aggregate?:string}>={};
    const projection=p.select.map((item,index)=>{
      const f=resolve(item.field);
      if(item.aggregate && !['count','sum','avg','min','max'].includes(item.aggregate)) deny('agregação inválida');
      if((item.aggregate==='sum'||item.aggregate==='avg') && !/integer|numeric|double precision|real|bigint|smallint|decimal/.test(f.type)) deny('soma/média exige campo numérico');
      if(!item.aggregate && p.select.some(x=>x.aggregate) && !group.includes(f.expression)) deny('campo não agregado precisa estar em groupBy');
      const alias=item.as ?? ('c'+index);
      if(used.has(alias)) deny('alias duplicado');used.add(alias);
      labels[alias]=businessColumnLabel(f.table,f.column,alias,item.aggregate);
      sources[alias]={table:f.table,column:f.column,aggregate:item.aggregate};
      const e=item.aggregate ? item.aggregate.toUpperCase()+'('+f.expression+')' : f.expression;
      return e+' AS '+protect(alias);
    });
    const params:unknown[]=filterUnit?[unitId]:[];
    const where=filterUnit?[unitPredicate(p.from,'t0',s.columns,s.foreignKeys,protect,'$1')]:['TRUE'];
    if(!access.admin) for(const table of tables) {
      const grant=access.tables[table] ?? deny('módulo não liberado para este usuário');
      if(grant.scopeColumn && grant.scopeValues) {
        params.push(grant.scopeValues.map(String));
        where.push(aliases.get(table)+'.'+protect(grant.scopeColumn)+'::text = ANY($'+params.length+'::text[])');
      }
    }
    if(base!.has('deletado_em')) where.push('t0.deletado_em IS NULL');
    if(base!.has('deleted_at')) where.push('t0.deleted_at IS NULL');
    for(const cond of p.where){
      const f=resolve(cond.field).expression;
      if(cond.op==='is_null'||cond.op==='not_null') {where.push(f+(cond.op==='is_null'?' IS NULL':' IS NOT NULL'));continue;}
      if(cond.value===undefined) deny('filtro sem valor');
      if(cond.op==='in'){
        if(!Array.isArray(cond.value)) deny('in exige lista');
        params.push((cond.value as (string|number|boolean)[]).map(String));
        where.push(f+'::text = ANY($'+params.length+'::text[])');
      }else if(cond.op==='contains'){
        if(Array.isArray(cond.value)) deny('busca textual exige valor único');
        params.push('%'+String(cond.value).replace(/[\\%_]/g,'\\$&')+'%');
        where.push(f+'::text ILIKE $'+params.length+" ESCAPE '\\'");
      }else{
        if(Array.isArray(cond.value)) deny('comparação exige valor único');
        params.push(cond.value);
        const op:{[k:string]:string}={eq:'=',neq:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='};
        where.push(f+' '+op[cond.op]+' $'+params.length);
      }
    }
    if(p.search){
      params.push('%'+p.search.text.replace(/[\\%_]/g,'\\$&')+'%');
      where.push('('+p.search.fields.map(x=>resolve(x).expression+'::text ILIKE $'+params.length+" ESCAPE '\\'").join(' OR ')+')');
    }
    const order=p.orderBy.map(x=>resolve(x.field).expression+' '+x.direction.toUpperCase());
    params.push(p.limit);
    const sql='SELECT '+projection.join(', ')+' FROM public.'+protect(p.from)+' t0 '+joins.join(' ')
      +' WHERE '+where.join(' AND ')+(group.length?' GROUP BY '+group.join(', '):'')
      +(order.length?' ORDER BY '+order.join(', '):'')
      +' LIMIT $'+params.length;
    return {sql,params,columns:[...used],labels,sources,scope};
  }

  async query(ctx:AuthContext,raw:unknown) {
    this.assertAllowed(ctx);
    const source=await this.source(ctx.activeUnitId);
    const policy=await this.policy(ctx);
    const compiled=this.compile(raw,this.scoped(await this.schema(source,ctx.activeUnitId),policy),ctx.activeUnitId,policy);
    const result=await source.executeRead<Record<string,unknown>>(compiled.sql,compiled.params);
    const definitions=this.definitions?await this.definitions(ctx):[];
    const dictionary=new Map(definitions.map(d=>[dictionaryKey(d.table,d.column,d.code),d]));
    const codes=new Map<string,unknown>();
    return {
      rows:result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>{
        const source=compiled.sources[key];
        if(!source||source.aggregate||value==null)return [key,value];
        const definition=dictionary.get(dictionaryKey(source.table,source.column,String(value)));
        const displayed=definition?.label??businessValue(source.table,source.column,value);
        if(typeof value==='string'&&/(^|_)(status|situacao|situation|state)(_|$)/i.test(source.column)){
          const unknown=displayed===value||String(displayed).startsWith('Situação sem descrição');
          codes.set(dictionaryKey(source.table,source.column,value),{table:source.table,column:source.column,code:value,label:unknown?null:displayed,verified:Boolean(definition)||!unknown,documentId:definition?.documentId,checksum:definition?.checksum});
        }
        return [key,displayed];
      }))),
      columns:compiled.columns, labels:compiled.labels, rowCount:result.rows.length,
      codeDefinitions:[...codes.values()].slice(0,40),codeDefinitionsTruncated:codes.size>40,
      provenance:{source:'POSSEBON PostgreSQL, transação READ ONLY',unitId:compiled.scope==='unit'?ctx.activeUnitId:null,requestedUnitId:ctx.activeUnitId,scope:compiled.scope,
        note:compiled.scope==='unit_unverified'?'Busca administrativa permitida, mas o vínculo destes registros com a unidade solicitada NÃO está confirmado. Verifique empresa, contrato, projeto ou outro vínculo real antes de atribuir à unidade solicitada.':undefined,
        queriedAt:new Date().toISOString(),maxRows:200,synthetic:false}
    };
  }

  private async policy(ctx:AuthContext):Promise<OperationalAccess> {
    return this.access ? this.access(ctx) : {admin:true,tables:{}};
  }
  private scoped(schema:Schema,policy:OperationalAccess):Schema {
    if(policy.admin) return schema;
    const columns=new Map<string,Map<string,string>>();
    for(const [table,grant] of Object.entries(policy.tables)) {
      const actual=schema.columns.get(table);
      if(!actual || (grant.scopeColumn && !actual.has(grant.scopeColumn))) continue;
      columns.set(table,new Map([...actual].filter(([c])=>c==='unit_id'||grant.columns.includes(c))));
    }
    return {columns,foreignKeys:schema.foreignKeys.filter(k=>columns.has(k.from_table)&&columns.has(k.to_table))};
  }
}
