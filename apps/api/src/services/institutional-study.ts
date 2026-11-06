import {randomUUID} from 'node:crypto';
import {assertAdmin} from '@ada/domain';
import type {AuthContext} from '@ada/contracts';
import type {Deps} from '../core.ts';
type Job={id:string;owner:number;unit:number;state:'running'|'paused'|'budget'|'complete'|'error';remaining:number;processed:number;leaseUntil:number;token?:string;nextAt:number;error?:string;version?:number;pauseRequested?:boolean;tokensSpent?:number;tokenLimit?:number;inputTokens?:number;outputTokens?:number;lastProgressAt?:string;characters?:number};
const KEY='institutional_study_job';
/** Um estudo corporativo por vez, com reserva persistente e orçamento de chamadas. */
export class InstitutionalStudyService {
  constructor(private readonly d:Deps){}
  async ensure(ctx:AuthContext){
    if(!ctx.programs.AdaAdministracao||!this.d.ai.configured)return;
    const value:Job={id:randomUUID(),owner:ctx.systemUserId,unit:ctx.activeUnitId,version:2,state:'paused',remaining:0,tokenLimit:8000,tokensSpent:0,inputTokens:0,outputTokens:0,processed:0,leaseUntil:0,nextAt:0};
    await this.d.db.query('INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[KEY,value,ctx.systemUserId]);
    await this.d.db.query(`UPDATE ada.app_setting SET value=value || '{"version":2,"pauseRequested":true,"tokenLimit":8000,"tokensSpent":0,"inputTokens":0,"outputTokens":0}'::jsonb,updated_at=now() WHERE key=$1 AND NOT(value ? 'version')`,[KEY]);
  }
  async control(ctx:AuthContext,action:'continue'|'pause'){
    assertAdmin(ctx);
    return this.d.db.tx(async q=>{
      const r=await q.query<{value:Job}>('SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE',[KEY]);const old=r.rows[0]?.value;
      if(action==='pause'&&old){await q.query('UPDATE ada.app_setting SET value=$2,updated_at=now() WHERE key=$1',[KEY,{...old,pauseRequested:true,state:old.leaseUntil>Date.now()?old.state:'paused'}]);return {state:'paused'};}
      if(old&&old.leaseUntil>Date.now())throw new Error('Um lote está em execução. Aguarde a conclusão para alterar o estudo.');
      if(old?.state==='running'&&old.unit!==ctx.activeUnitId)throw new Error('Existe um estudo de outra unidade em execução.');
      const value:Job={id:randomUUID(),owner:ctx.systemUserId,unit:ctx.activeUnitId,version:2,tokenLimit:8000,tokensSpent:0,inputTokens:0,outputTokens:0,characters:0,lastProgressAt:old?.lastProgressAt,state:action==='pause'?'paused':'running',remaining:action==='pause'?0:20,processed:old?.unit===ctx.activeUnitId?old.processed:0,leaseUntil:0,nextAt:0};
      await q.query('INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()',[KEY,value,ctx.systemUserId]);return {state:value.state};
    });
  }
  async status(ctx:AuthContext){
    const r=await this.d.db.query<{value:Job}>('SELECT value FROM ada.app_setting WHERE key=$1',[KEY]);const job=r.rows[0]?.value;
    const coverage=await this.d.db.query<{indexed:number;studied:number;facts:number}>(`SELECT count(*)::int AS indexed,
      count(*) FILTER(WHERE p.state='complete' AND p.source_checksum=d.checksum)::int AS studied,
      COALESCE(sum(CASE WHEN p.source_checksum=d.checksum THEN p.facts_extracted ELSE 0 END),0)::int AS facts
      FROM ada.knowledge_document d JOIN ada.knowledge_source s ON s.id=d.source_id
      LEFT JOIN ada.corporate_study_progress p ON p.document_id=d.id
      WHERE d.status='indexado' AND s.status='ativo' AND COALESCE(s.config->>'skip_ai_study','false')<>'true' AND (d.valid_until IS NULL OR d.valid_until>=current_date)
      AND (d.unit_id IS NULL OR d.unit_id=$1) AND d.required_programs <@ $2::text[]
      AND (d.sensitivity<>'confidencial' OR cardinality(d.required_programs)>0)`,[ctx.activeUnitId,Object.keys(ctx.programs)]);
    return {...coverage.rows[0],state:job?.unit===ctx.activeUnitId?job.state:this.d.ai.configured?'pending':'not_configured',remaining:job?.unit===ctx.activeUnitId?job.remaining:0,phase:job?.unit===ctx.activeUnitId?(job.pauseRequested&&job.leaseUntil>Date.now()?'pause_requested':job.leaseUntil>Date.now()?'executing':'waiting'):'waiting',lastProgressAt:job?.unit===ctx.activeUnitId?job.lastProgressAt:undefined,nextAt:job?.unit===ctx.activeUnitId?job.nextAt:undefined,inputTokens:job?.unit===ctx.activeUnitId?job.inputTokens??0:0,outputTokens:job?.unit===ctx.activeUnitId?job.outputTokens??0:0,tokensSpent:job?.unit===ctx.activeUnitId?job.tokensSpent??0:0,tokenLimit:job?.unit===ctx.activeUnitId?job.tokenLimit??8000:8000,characters:job?.unit===ctx.activeUnitId?job.characters??0:0,error:job?.unit===ctx.activeUnitId?job.error:undefined};
  }
  async runDue(){
    const token=randomUUID();const job=await this.d.db.tx(async q=>{
      const r=await q.query<{value:Job}>('SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE',[KEY]);const j=r.rows[0]?.value;
      if(j&&!j.version){j.version=2;j.pauseRequested=true;j.state=j.leaseUntil>Date.now()?j.state:'paused';j.tokenLimit=8000;j.tokensSpent=0;j.inputTokens=0;j.outputTokens=0;await q.query('UPDATE ada.app_setting SET value=$2,updated_at=now() WHERE key=$1',[KEY,j]);return null;}
      if(j?.pauseRequested){if(j.leaseUntil<=Date.now()&&j.state!=='paused'){j.state='paused';await q.query('UPDATE ada.app_setting SET value=$2 WHERE key=$1',[KEY,j]);}return null;}
      if(!j||!['running','complete'].includes(j.state)||j.leaseUntil>Date.now()||j.nextAt>Date.now())return null;
      if(j.remaining<=0){j.state='budget';await q.query('UPDATE ada.app_setting SET value=$2 WHERE key=$1',[KEY,j]);return null;}
      if((j.tokensSpent??0)+7000>(j.tokenLimit??8000)){j.state='budget';await q.query('UPDATE ada.app_setting SET value=$2 WHERE key=$1',[KEY,j]);return null;}
      j.tokensSpent=(j.tokensSpent??0)+7000;

      j.token=token;j.leaseUntil=Date.now()+300000;j.remaining--; // Reserva orçamento antes da chamada, inclusive em falha.
      await q.query('UPDATE ada.app_setting SET value=$2,updated_at=now() WHERE key=$1',[KEY,j]);return j;
    });
    if(!job)return;
    try{
      const ctx=await this.d.sessions.resolveContext(job.owner,job.unit,'institutional-study',{force:true});assertAdmin(ctx);
      const result=await this.d.corporateMemory.studyBatch(ctx);
      job.processed+=result.processed?1:0;
      const calledModel=result.inputTokens!==undefined;
      job.inputTokens=(job.inputTokens??0)+(result.inputTokens??0);
      job.outputTokens=(job.outputTokens??0)+(result.outputTokens??0);
      job.tokensSpent=(job.tokensSpent??7000)-7000+(result.inputTokens??0)+(result.outputTokens??0);
      if(result.processed){
        job.characters=(job.characters??0)+(result.characters??0);
        job.lastProgressAt=new Date().toISOString();
      }
      if(!calledModel)job.remaining++; // Busca sem documento não consome chamada ao modelo.
      job.state=!result.processed&&!calledModel?'complete':job.remaining===0?'budget':'running';
    }catch(error){const e=error as {name?:string;code?:string;message?:string};const http=e.message?.match(/HTTP (\d{3})/)?.[1];job.state='error';job.error=e.name==='ZodError'||e.name==='SyntaxError'?'O provedor retornou um formato inválido. O trecho não foi marcado como concluído.':e.code==='42501'?'A credencial da aplicação não tem permissão para persistir o estudo.':http?'O provedor respondeu HTTP '+http+'. Confira a configuração administrativa.':'O estudo parou durante a verificação de acesso ou processamento. O orçamento da tentativa foi reservado; o progresso anterior foi preservado.';}
    job.leaseUntil=0;job.nextAt=Date.now()+(job.state==='complete'?600000:3000);
    await this.d.db.tx(async q=>{const r=await q.query<{value:Job}>('SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE',[KEY]);const current=r.rows[0]?.value;if(current?.token!==token)return;if(current.pauseRequested){job.pauseRequested=true;job.state='paused';}await q.query('UPDATE ada.app_setting SET value=$2,updated_at=now() WHERE key=$1',[KEY,job]);});
  }
}
