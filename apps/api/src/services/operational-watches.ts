import { randomUUID,createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { OperationalPlan } from './operational-query.ts';
import { invalid,notFound } from '../errors.ts';
import { audit } from '../audit.ts';

export const WatchInput=z.object({name:z.string().trim().min(1).max(120),plan:OperationalPlan,
  intervalMinutes:z.number().int().min(1).max(1440).default(5)}).strict();
interface WatchRow {id:string;owner_user_id:number;unit_id:number;name:string;plan:unknown;snapshot_enc:string;
  interval_minutes:number;state:string;lease_token:string;last_checked_at:Date|null;last_changed_at:Date|null;last_error:string|null}
const canonical=(row:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));

/** Compara um registro por ciclo, sem chamadas ao modelo. Revalida identidade e política antes de ler. */
export class OperationalWatchService {
  constructor(private readonly d:Deps) {}
  async preview(ctx:AuthContext,raw:unknown) {
    const input=WatchInput.parse(raw);
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
    [ctx.systemUserId,ctx.activeUnitId,input.name,input.plan,this.d.cipher.encrypt(canonical(row)),input.intervalMinutes]);
    if(!r.rows[0]) {
      const existing=await this.d.db.query<WatchRow>('SELECT * FROM ada.operational_watch WHERE owner_user_id=$1 AND unit_id=$2 AND name=$3',[ctx.systemUserId,ctx.activeUnitId,input.name]);
      if(JSON.stringify(OperationalPlan.parse(existing.rows[0]!.plan))!==JSON.stringify(input.plan)) throw invalid('Já existe outro acompanhamento com este nome. Escolha um nome diferente.');
      return {id:existing.rows[0]!.id,state:existing.rows[0]!.state};
    }
    await audit(this.d.db,{actor:ctx.systemUserId,unit:ctx.activeUnitId,action:'acompanhamento.registro_ativado',targetType:'operational_watch',targetId:r.rows[0].id,outcome:'ok'});
    return {id:r.rows[0].id,state:'active'};
  }
  async list(ctx:AuthContext) {
    const r=await this.d.db.query('SELECT id,name,state,interval_minutes,last_checked_at,last_changed_at,last_error FROM ada.operational_watch WHERE owner_user_id=$1 AND unit_id=$2 ORDER BY created_at DESC LIMIT 100',[ctx.systemUserId,ctx.activeUnitId]);
    return r.rows;
  }
  async current(ctx:AuthContext,id:string) {
    const r=await this.d.db.query<WatchRow>('SELECT * FROM ada.operational_watch WHERE id=$1 AND owner_user_id=$2 AND unit_id=$3',[z.uuid().parse(id),ctx.systemUserId,ctx.activeUnitId]);
    if(!r.rows[0])throw notFound('Acompanhamento');
    const result=await this.preview(ctx,{name:r.rows[0].name,plan:r.rows[0].plan});
    return {name:r.rows[0].name,row:result.row,queriedAt:new Date().toISOString()};
  }
  async setState(ctx:AuthContext,id:string,state:'active'|'paused') {
    const r=await this.d.db.query<WatchRow>('SELECT * FROM ada.operational_watch WHERE id=$1 AND owner_user_id=$2 AND unit_id=$3',[z.uuid().parse(id),ctx.systemUserId,ctx.activeUnitId]);
    if(!r.rows[0]) throw notFound('Acompanhamento');
    let baseline:string|undefined;
    if(state==='active') baseline=this.d.cipher.encrypt(canonical((await this.preview(ctx,{name:r.rows[0].name,plan:r.rows[0].plan})).row));
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
        const result=await this.preview(ctx,{name:job.name,plan:job.plan});
        const current=canonical(result.row);
        const changed=current!==this.d.cipher.decrypt(job.snapshot_enc);
        await this.d.db.tx(async q=>{
          const saved=await q.query(`UPDATE ada.operational_watch SET snapshot_enc=$3,last_checked_at=now(),
            last_changed_at=CASE WHEN $4 THEN now() ELSE last_changed_at END,last_error=NULL,
            next_check_at=now()+make_interval(mins=>interval_minutes),lease_until=NULL,lease_token=NULL
            WHERE id=$1 AND lease_token=$2 AND state='active' RETURNING id`,[job.id,token,this.d.cipher.encrypt(current),changed]);
          if(!saved.rowCount||!changed)return;
          // Sem cópia de dados operacionais na notificação: o detalhe exige nova consulta autorizada.
          const eventKey=createHash('sha256').update(job.id+job.snapshot_enc+current).digest('hex');
          await q.query(`INSERT INTO ada.notification(recipient_user_id,unit_id,severity,title,body,source_id,evidence,dedupe_key)
            VALUES($1,$2,'info','Atualização no acompanhamento',$3,'possebon.operational',$4,$5)
            ON CONFLICT(recipient_user_id,dedupe_key) DO NOTHING`,[job.owner_user_id,job.unit_id,
            'Foi identificada uma mudança em um registro que você acompanha. Abra seus acompanhamentos para consultar o estado atual.',{watchId:job.id},eventKey]);
        });
      } catch {
        await this.d.db.query(`UPDATE ada.operational_watch SET state='error',last_error='Não foi possível verificar o registro. Confira acesso e disponibilidade antes de retomar.',lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,[job.id,token]);
      }
    }
    return jobs.rows.length;
  }
}
