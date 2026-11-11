import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { OperationalPlan } from './operational-query.ts';
import { invalid,notFound } from '../errors.ts';
import { audit } from '../audit.ts';
import { watchDifferences, watchFields, watchSummary } from './watch-presentation.ts';

export const WatchInput=z.object({name:z.string().trim().min(1).max(120),plan:OperationalPlan,
  todayField:z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/).optional(),
  intervalMinutes:z.number().int().min(1).max(1440).default(5)}).strict();
interface WatchRow {id:string;owner_user_id:number;unit_id:number;name:string;plan:unknown;snapshot_enc:string;
  interval_minutes:number;state:string;lease_token:string;last_checked_at:Date|null;last_changed_at:Date|null;last_error:string|null}
const storedPlan=z.object({query:OperationalPlan,todayField:z.string()}).strict();
function readPlan(plan:unknown) {
  const daily=storedPlan.safeParse(plan);
  return daily.success ? {plan:daily.data.query,todayField:daily.data.todayField} : {plan:OperationalPlan.parse(plan)};
}
const businessDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const canonical=(row:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));

/** Compara um registro por ciclo, sem chamadas ao modelo. Revalida identidade e política antes de ler. */
export class OperationalWatchService {
  constructor(private readonly d:Deps) {}
  async preview(ctx:AuthContext,raw:unknown) {
    const input=WatchInput.parse(raw);
    if(input.todayField) {
      if(input.plan.unitScope!=='current'||input.plan.groupBy.length||input.plan.select.some(s=>s.aggregate)||!input.plan.where.length)
        throw invalid('O alerta diário exige filtros de negócio confirmados e registros da unidade atual.');
      const field=input.todayField;
      if(!field.startsWith(input.plan.from+'.')) throw invalid('Use a data do próprio registro monitorado.');
      const structure=await this.d.operational.explore(ctx,'',input.plan.from);
      const dateColumn=structure.tabelas[0]?.colunas.find(column=>column.nome===field.split('.')[1]);
      if(dateColumn?.tipo!=='date') throw invalid('O alerta diário precisa de uma coluna de data de negócio confirmada.');
      const day=businessDate.format(this.d.now());
      const end=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
      const result=await this.d.operational.query(ctx,{
        ...input.plan,
        select:[{field:input.plan.from+'.id',as:'record_id'}],
        where:[...input.plan.where,{field,op:'gte',value:day},{field,op:'lt',value:end}],
        orderBy:[{field:input.plan.from+'.id',direction:'asc'}],limit:200
      });
      if(result.rows.length>=200) throw invalid('Refine a condição do alerta diário para acompanhar menos de 200 ocorrências.');
      const ids=[...new Set(result.rows.map(row=>String(row.record_id)))].sort();
      return {input,row:{day,ids:JSON.stringify(ids),ocorrencias:ids.length},
        summary:'Avisar quando houver novas ocorrências no dia: '+input.name+'. Ocorrências já localizadas hoje: '+ids.length+'.'};
    }
    if(input.plan.select.some(s=>s.aggregate)||input.plan.groupBy.length ||
      !input.plan.where.some(w=>w.field===input.plan.from+'.id'&&w.op==='eq'&&w.value!==undefined&&!Array.isArray(w.value)))
      throw invalid('O acompanhamento precisa identificar um registro pelo seu identificador confirmado, sem agregações.');
    const result=await this.d.operational.query(ctx,{...input.plan,limit:2});
    if(result.rows.length!==1) throw invalid('Localize exatamente um registro autorizado antes de acompanhar.');
    return {input,row:result.rows[0]!,summary:'Acompanhar mudanças nos campos selecionados de '+input.name+'.'};
  }
  async create(ctx:AuthContext,raw:unknown) {
    const {input,row}=await this.preview(ctx,raw);
    const r=await this.d.db.query<WatchRow>(`INSERT INTO ada.operational_watch(owner_user_id,unit_id,name,plan,snapshot_enc,interval_minutes)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_user_id,unit_id,name) DO NOTHING RETURNING *`,
    [ctx.systemUserId,ctx.activeUnitId,input.name,input.todayField?{query:input.plan,todayField:input.todayField}:input.plan,
      this.d.cipher.encrypt(input.todayField?canonical({day:row.day,ids:'[]',ocorrencias:0}):canonical(row)),input.intervalMinutes]);
    if(!r.rows[0]) {
      const existing=await this.d.db.query<WatchRow>('SELECT * FROM ada.operational_watch WHERE owner_user_id=$1 AND unit_id=$2 AND name=$3',[ctx.systemUserId,ctx.activeUnitId,input.name]);
      if(JSON.stringify(readPlan(existing.rows[0]!.plan))!==JSON.stringify({plan:input.plan,todayField:input.todayField})) throw invalid('Já existe outro acompanhamento com este nome. Escolha um nome diferente.');
      return {id:existing.rows[0]!.id,state:existing.rows[0]!.state};
    }
    await audit(this.d.db,{actor:ctx.systemUserId,unit:ctx.activeUnitId,action:'acompanhamento.registro_ativado',targetType:'operational_watch',targetId:r.rows[0].id,outcome:'ok'});
    return {id:r.rows[0].id,state:'active'};
  }
  async list(ctx:AuthContext) {
    const r=await this.d.db.query(`SELECT w.id,w.name,w.state,w.interval_minutes,w.last_checked_at,w.last_changed_at,w.last_error,
      (SELECT n.body FROM ada.notification n
       WHERE n.recipient_user_id=$1 AND n.unit_id=$2
       AND n.source_id='possebon.operational' AND n.evidence->>'watchId'=w.id::text
       ORDER BY n.created_at DESC LIMIT 1) AS last_change_summary
       FROM ada.operational_watch w
       WHERE w.owner_user_id=$1 AND w.unit_id=$2 ORDER BY w.created_at DESC LIMIT 100`,
       [ctx.systemUserId,ctx.activeUnitId]);
    return r.rows;
  }
  async current(ctx:AuthContext,id:string) {
    const r=await this.d.db.query<WatchRow>('SELECT * FROM ada.operational_watch WHERE id=$1 AND owner_user_id=$2 AND unit_id=$3',[z.uuid().parse(id),ctx.systemUserId,ctx.activeUnitId]);
    if(!r.rows[0])throw notFound('Acompanhamento');
    const watch=r.rows[0];
    const result=await this.preview(ctx,{name:watch.name,...readPlan(watch.plan)});
    const notification=await this.d.db.query<{body:string;created_at:Date;evidence:unknown}>(
      `SELECT body,created_at,evidence FROM ada.notification
       WHERE recipient_user_id=$1 AND unit_id=$2 AND source_id='possebon.operational'
         AND evidence->>'watchId'=$3 ORDER BY created_at DESC LIMIT 1`,
      [ctx.systemUserId,ctx.activeUnitId,id]);
    const latest=notification.rows[0];
    const evidence=latest?.evidence as {changes?:unknown}|undefined;
    const changes=Array.isArray(evidence?.changes) ? evidence.changes as ReturnType<typeof watchDifferences> : [];
    return {
      name:watch.name,watchId:id,state:watch.state,
      fields:watchFields(result.row),row:result.row,queriedAt:new Date().toISOString(),
      lastCheckedAt:watch.last_checked_at, lastChangedAt:watch.last_changed_at,
      lastChange:latest?{summary:latest.body,changes,observedAt:latest.created_at}:null
    };
  }

  async describe(ctx:AuthContext,name:string) {
    const term=name.trim().toLocaleLowerCase('pt-BR');
    const all=await this.list(ctx) as {id:string;name:string}[];
    const exact=all.filter(w=>w.name.toLocaleLowerCase('pt-BR')===term);
    let matched=exact.length===1?exact:all.filter(w=>w.name.toLocaleLowerCase('pt-BR').includes(term));
    if(matched.length===0) {
      const number=term.match(/\d{3,}/)?.[0]?.replace(/^0+/,'');
      if(number)matched=all.filter(w=>w.name.match(/\d{3,}/g)?.some(part=>part.replace(/^0+/,'')===number));
    }
    if(matched.length!==1) return {
      encontrado:false,
      motivo:matched.length?'Há mais de um acompanhamento com essa descrição.':'Não encontrei esse acompanhamento nesta unidade.',
      acompanhamentos:all.map(w=>w.name)
    };
    const data=await this.current(ctx,matched[0]!.id);
    return {
      encontrado:true,nome:data.name,estado:data.state,
      ultimaVerificacao:data.lastCheckedAt,ultimaMudanca:data.lastChangedAt,
      situacaoAtual:data.fields,
      alteracaoConfirmada:data.lastChange
    };
  }
  async setState(ctx:AuthContext,id:string,state:'active'|'paused') {
    const r=await this.d.db.query<WatchRow>('SELECT * FROM ada.operational_watch WHERE id=$1 AND owner_user_id=$2 AND unit_id=$3',[z.uuid().parse(id),ctx.systemUserId,ctx.activeUnitId]);
    if(!r.rows[0]) throw notFound('Acompanhamento');
    let baseline:string|undefined;
    if(state==='active') baseline=this.d.cipher.encrypt(canonical((await this.preview(ctx,{name:r.rows[0].name,...readPlan(r.rows[0].plan)})).row));
    await this.d.db.query(`UPDATE ada.operational_watch SET state=$2,snapshot_enc=COALESCE($3,snapshot_enc),next_check_at=now(),last_error=NULL,
      lease_token=NULL,lease_until=NULL WHERE id=$1`,[id,state,baseline??null]);
    return {id,state};
  }
  async runDue(limit=15) {
    const token=randomUUID();
    const jobs=await this.d.db.query<WatchRow>(`UPDATE ada.operational_watch SET lease_token=$1,lease_until=now()+interval '2 minutes'
      WHERE id IN (SELECT id FROM ada.operational_watch WHERE state='active' AND next_check_at<=now()
        AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check_at LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING *`,[token,limit]);
    for(const job of jobs.rows) {
      try {
        const ctx=await this.d.sessions.resolveContext(job.owner_user_id,job.unit_id,'watch',{force:true});
        const result=await this.preview(ctx,{name:job.name,...readPlan(job.plan)});
        const previous=this.d.cipher.decrypt(job.snapshot_enc);
        let current=canonical(result.row);
        let changed=current!==previous;
        let changes=watchDifferences(JSON.parse(previous) as Record<string,unknown>,result.row);
        if(result.input.todayField) {
          const saved=JSON.parse(previous) as {day:string;ids:string[]|string};
          const seen=new Set<string>(saved.day===result.row.day ? JSON.parse(String(saved.ids)) as string[] : []);
          const ids=JSON.parse(String(result.row.ids)) as string[];
          changed=ids.some(id=>!seen.has(id));
          if(changed)changes=[{field:'ocorrencias',label:'Novas ocorrências no dia',before:String(seen.size),after:String(ids.filter(id=>!seen.has(id)).length)+' nova(s)'}];
          for(const id of ids) seen.add(id);
          current=canonical({...result.row,ids:JSON.stringify([...seen].sort())});
        }
        await this.d.db.tx(async q=>{
          const saved=await q.query(`UPDATE ada.operational_watch SET snapshot_enc=$3,last_checked_at=now(),
            last_changed_at=CASE WHEN $4 THEN now() ELSE last_changed_at END,last_error=NULL,
            next_check_at=now()+make_interval(mins=>interval_minutes),lease_until=NULL,lease_token=NULL
            WHERE id=$1 AND lease_token=$2 AND state='active' RETURNING id`,[job.id,token,this.d.cipher.encrypt(current),changed]);
          if(!saved.rowCount||!changed)return;
          // Resumo verificável: diferenças apenas dos campos que o proprietário já podia consultar.
          const eventKey=createHash('sha256').update(job.id+job.snapshot_enc+current).digest('hex');
          const body= result.input.todayField
            ? job.name+': novas ocorrências foram registradas no dia. Consulte o acompanhamento para conferir.'
            : watchSummary(job.name,changes);
          await q.query(`INSERT INTO ada.notification(recipient_user_id,unit_id,severity,title,body,source_id,evidence,dedupe_key)
            VALUES($1,$2,'info',$3,$4,'possebon.operational',$5,$6)
            ON CONFLICT(recipient_user_id,dedupe_key) DO NOTHING`,[job.owner_user_id,job.unit_id,
            'Atualização: '+job.name,body,{watchId:job.id,changes:changes.slice(0,12)},eventKey]);
        });
      } catch {
        await this.d.db.query(`UPDATE ada.operational_watch SET state='error',last_error='Não foi possível verificar o registro. Confira acesso e disponibilidade antes de retomar.',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,[job.id,token]);
      }
    }
    return jobs.rows.length;
  }
}
