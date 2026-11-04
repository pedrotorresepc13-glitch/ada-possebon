import { useEffect, useState } from 'react';
import { api } from '../api.ts';
interface Rule {table:string;program:string;columns:string[];scope:string;scopeColumn?:string}
export function OperationalSettings(){
  const [rules,setRules]=useState<Rule[]>([]);const [loaded,setLoaded]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  useEffect(()=>{let active=true;api<{rules:Rule[]}>('/admin/operational-access').then(r=>{if(active){setRules(r.rules);setLoaded(true);}}).catch(e=>{if(active)setMessage((e as Error).message);});return()=>{active=false;};},[]);
  const change=(index:number,patch:Partial<Rule>)=>setRules(list=>list.map((r,i)=>i===index?{...r,...patch}:r));
  return <section className="card"><h3>Acessos aos dados operacionais</h3><p className="muted">Defina quais informações cada programa do POSSEBON permite consultar. Equipes e subordinados usam os vínculos confirmados pelo sistema. Sem um vínculo confirmado, o acesso permanece fechado. Administradores autorizados mantêm o acesso às tabelas de negócio disponíveis.</p>
    {message&&<div className="note-box" role="status">{message}</div>}
    <form className="grid" onSubmit={async e=>{e.preventDefault();setBusy(true);setMessage('');try{const saved=await api<{rules:Rule[]}>('/admin/operational-access',{method:'PUT',body:{rules:rules.map(r=>({...r,columns:r.columns.map(c=>c.trim()).filter(Boolean),scopeColumn:r.scope==='unit'?undefined:r.scopeColumn}))}});setRules(saved.rules);setMessage('Regras salvas. As próximas consultas já respeitam esta configuração.');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}>
    {rules.map((r,i)=><fieldset className="access-rule" key={i} disabled={busy}><legend>Regra {i+1}</legend>
      <label className="field">Tabela<input className="input" required pattern="[a-z][a-z0-9_]*" value={r.table} onChange={e=>change(i,{table:e.target.value})}/></label>
      <label className="field">Programa autorizado<input className="input" required value={r.program} onChange={e=>change(i,{program:e.target.value})} placeholder="Nome do programa no POSSEBON"/></label>
      <label className="field">Campos permitidos (separados por vírgula)<input className="input" required value={r.columns.join(',')} onChange={e=>change(i,{columns:e.target.value.split(',')})} placeholder="id,descricao,status"/></label>
      <label className="field">Registros permitidos<select className="select" value={r.scope} onChange={e=>change(i,{scope:e.target.value})}><option value="unit">Unidade autorizada</option><option value="user">Do próprio usuário</option><option value="subject">Do próprio colaborador</option><option value="team">Das equipes vinculadas</option><option value="reports">Dos subordinados vinculados</option></select></label>
      {r.scope!=='unit'&&<label className="field">Campo que identifica o vínculo<input className="input" required value={r.scopeColumn??''} onChange={e=>change(i,{scopeColumn:e.target.value})}/></label>}
      <div><button type="button" className="btn danger sm" onClick={()=>setRules(list=>list.filter((_,n)=>n!==i))}>Remover regra</button></div>
    </fieldset>)}
    <div className="row"><button type="button" className="btn" disabled={!loaded||busy} onClick={()=>setRules(r=>[...r,{table:'',program:'',columns:[],scope:'unit'}])}>Adicionar regra</button><button className="btn primary" disabled={!loaded||busy}>{busy?'Salvando…':'Salvar regras de acesso'}</button></div></form></section>;
}
