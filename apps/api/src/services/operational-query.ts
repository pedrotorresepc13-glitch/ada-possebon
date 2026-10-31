import { z } from 'zod';
import type { AuthContext } from '@ada/contracts';
import type { ReadonlyPostgresConnector } from './readonly-postgres.ts';

/**
 * Linguagem declarativa de consultas do POSSEBON.
 * O modelo NUNCA envia SQL: somente identificadores verificados no catálogo
 * vivo de pg_catalog. O executor impõe unidade, exclusões, SELECT e limites.
 */
const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const field = z.string().regex(/^[a-z][a-z0-9_]{0,62}\.[a-z][a-z0-9_]{0,62}$/);
const scalar = z.union([z.string().max(300), z.number().finite(), z.boolean()]);
export const OperationalPlan = z.object({
  from: identifier,
  joins: z.array(identifier).max(3).default([]),
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

const BLOCKED = /(^|_)(senha|password|secret|token|hash|salt|cpf|cnpj|documento|rg|pis|pasep|nascimento|telefone|celular|email|endereco|cep|bairro|rua|complemento|salario|remuneracao|bancaria|conta|agencia|pix|chave|biometria|foto|imagem|anexo|arquivo|conteudo|observacao|obs|login|ip|cookie|jwt|autenticacao)(_|$)/i;
const BLOCKED_TABLE = /^(system_|ada_|log_|audit_|migration|senha|usuario_senha)/i;
const quote = (s:string) => '"' + s.replaceAll('"','""') + '"';
const protect = (name:string) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('Identificador não permitido');
  return quote(name);
};
const isSafeColumn = (name:string) => !BLOCKED.test(name);
const deny = (detail:string):never => {throw new Error('Consulta POSSEBON não autorizada: '+detail);};

export class OperationalQueryService {
  private schemaCache?: {data:Schema;until:number};
  constructor(private readonly source: () => Promise<Read>) {}

  /** Autoridade de uso: administração POSSEBON validada na sessão, nunca papel autoatribuído. */
  assertAllowed(ctx:AuthContext) {
    if (ctx.identitySource !== 'possebon' || !ctx.roles.includes('admin') || !ctx.programs.AdaAdministracao) {
      deny('motor corporativo liberado inicialmente somente para AdaAdministracao com identidade real');
    }
    if (!ctx.allowedUnitIds.includes(ctx.activeUnitId)) deny('unidade não autorizada');
  }

  private async schema(source:Read):Promise<Schema> {
    if (this.schemaCache && this.schemaCache.until>Date.now()) return this.schemaCache.data;
    const [columns, keys] = await Promise.all([
      source.executeRead<Column>(
        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position"),
      source.executeRead<ForeignKey>(String.raw\`
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
      \`)
    ]);
    const map=new Map<string,Map<string,string>>();
    for (const c of columns.rows) {
      if (BLOCKED_TABLE.test(c.table_name) || !/^[a-z][a-z0-9_]*$/.test(c.table_name)) continue;
      if (!map.has(c.table_name)) map.set(c.table_name,new Map());
      map.get(c.table_name)!.set(c.column_name,c.data_type);
    }
    const data={columns:map,foreignKeys:keys.rows};
    this.schemaCache={data,until:Date.now()+60_000};
    return data;
  }

  async explore(ctx:AuthContext, term='', table='') {
    this.assertAllowed(ctx);
    const source=await this.source();
    const s=await this.schema(source);
    const search=term.toLowerCase().trim().slice(0,80);
    const visible=[...s.columns.entries()].filter(([name,cols])=>
      cols.has('unit_id') && (name.includes(search)||[...cols.keys()].some(k=>k.includes(search))));
    const matched=table ? visible.filter(([name])=>name===table) : visible.slice(0,60);
    return {
      totalTabelasComUnidade:visible.length,
      tabelas:matched.map(([name,cols])=>({
        nome:name,
        colunas:[...cols].filter(([c])=>isSafeColumn(c)).map(([nome,tipo])=>({nome,tipo})).slice(0,65),
        relacionamentos:s.foreignKeys.filter(k=>k.from_table===name && s.columns.has(k.to_table))
          .map(k=>({campo:k.from_col,tabelaRelacionada:k.to_table,campoRelacionado:k.to_col})).slice(0,30)
      })),
      nota:'Somente tabelas públicas com unit_id podem iniciar consultas; tabelas relacionadas entram somente por FK real. Colunas pessoais e credenciais são omitidas. Resultado limitado ao escopo da unidade na execução.'
    };
  }

  /** Compila após introspecção; nenhum SQL gerado pelo modelo é aceito. */
  private compile(planInput:unknown,s:Schema,unitId:number) {
    const p=OperationalPlan.parse(planInput);
    const tables=[p.from,...p.joins];
    if (new Set(tables).size!==tables.length) deny('tabela repetida');
    const base=s.columns.get(p.from);
    if (!base?.has('unit_id')) deny('tabela base sem unit_id');
    if (BLOCKED_TABLE.test(p.from)) deny('tabela protegida');
    const aliases=new Map<string,string>([[p.from,'t0']]);
    const joins:string[]=[];
    for(let i=0;i<p.joins.length;i++){
      const name=p.joins[i]!, cols=s.columns.get(name);
      if (!cols || BLOCKED_TABLE.test(name)) deny('tabela relacionada inexistente ou restrita');
      const relation=s.foreignKeys.find(f=>f.from_table===p.from && f.to_table===name &&
        base.has(f.from_col) && cols.has(f.to_col));
      if (!relation) deny('JOIN sem FK confirmada da tabela base');
      const alias='t'+(i+1);
      aliases.set(name,alias);
      const clause=[alias+'.'+protect(relation.to_col)+' = t0.'+protect(relation.from_col)];
      if(cols.has('unit_id')) clause.push(alias+'.unit_id = t0.unit_id');
      if(cols.has('deletado_em')) clause.push(alias+'.deletado_em IS NULL');
      if(cols.has('deleted_at')) clause.push(alias+'.deleted_at IS NULL');
      joins.push('LEFT JOIN public.'+protect(name)+' '+alias+' ON '+clause.join(' AND '));
    }
    const resolve=(name:string) => {
      const [table,col]=name.split('.');
      const columns=s.columns.get(table??'');
      const alias=aliases.get(table??'');
      if (!columns?.has(col??'') || !alias || !isSafeColumn(col??'')) deny('campo fora do escopo: '+name);
      return {expression:alias+'.'+protect(col!),type:columns.get(col!)!};
    };
    const group=p.groupBy.map(x=>resolve(x).expression);
    const used=new Set<string>();
    const projection=p.select.map((item,index)=>{
      const f=resolve(item.field);
      if(item.aggregate && !['count','sum','avg','min','max'].includes(item.aggregate)) deny('agregação inválida');
      if((item.aggregate==='sum'||item.aggregate==='avg') && !/integer|numeric|double precision|real|bigint|smallint|decimal/.test(f.type)) deny('soma/média exige campo numérico');
      if(!item.aggregate && p.select.some(x=>x.aggregate) && !group.includes(f.expression)) deny('campo não agregado precisa estar em groupBy');
      const alias=item.as ?? ('c'+index);
      if(used.has(alias)) deny('alias duplicado');used.add(alias);
      const e=item.aggregate ? item.aggregate.toUpperCase()+'('+f.expression+')' : f.expression;
      return e+' AS '+protect(alias);
    });
    const params:unknown[]=[unitId];
    const where=['t0.unit_id = $1'];
    if(base.has('deletado_em')) where.push('t0.deletado_em IS NULL');
    if(base.has('deleted_at')) where.push('t0.deleted_at IS NULL');
    for(const cond of p.where){
      const f=resolve(cond.field).expression;
      if(cond.op==='is_null'||cond.op==='not_null') {where.push(f+(cond.op==='is_null'?' IS NULL':' IS NOT NULL'));continue;}
      if(cond.value===undefined) deny('filtro sem valor');
      if(cond.op==='in'){
        if(!Array.isArray(cond.value)) deny('in exige lista');
        params.push(cond.value.map(String));
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
    return {sql,params,columns:[...used]};
  }

  async query(ctx:AuthContext,raw:unknown) {
    this.assertAllowed(ctx);
    const source=await this.source();
    const compiled=this.compile(raw,await this.schema(source),ctx.activeUnitId);
    const result=await source.executeRead<Record<string,unknown>>(compiled.sql,compiled.params);
    return {
      rows:result.rows,columns:compiled.columns, rowCount:result.rows.length,
      provenance:{source:'POSSEBON PostgreSQL, transação READ ONLY',unitId:ctx.activeUnitId,
        queriedAt:new Date().toISOString(),maxRows:200,synthetic:false}
    };
  }
}
