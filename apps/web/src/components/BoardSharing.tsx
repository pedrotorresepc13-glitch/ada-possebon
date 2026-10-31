import { useCallback,useEffect,useState } from 'react';
import { api } from '../api.ts';
type Person={id:number;name:string|null};
export function BoardSharing({id}:{id:string}){
  const [people,setPeople]=useState<Person[]>([]);const [shares,setShares]=useState<Person[]>([]);const [selected,setSelected]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{const [p,s]=await Promise.all([api<Person[]>('/sharing/recipients'),api<Person[]>('/live-boards/'+id+'/shares')]);setPeople(p);setShares(s);},[id]);
  useEffect(()=>{void load().catch(e=>setError((e as Error).message));},[load]);
  async function act(remove?:number){setBusy(true);setError('');try{await api('/live-boards/'+id+'/shares'+(remove?'/'+remove:''),remove?{method:'DELETE'}:{body:{userId:Number(selected)}});setSelected('');await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <details className="card sharing-panel"><summary>Compartilhar esta tela</summary><p className="small muted">Compartilha a organização da tela. Cada destinatário consulta somente os dados permitidos para ele, com autorização verificada em cada atualização.</p>{error&&<p className="error-box" role="alert">{error}</p>}
    <form className="row" onSubmit={e=>{e.preventDefault();void act();}}><label className="field grow">Pessoa da unidade<select className="select" value={selected} onChange={e=>setSelected(e.target.value)} required><option value="">Selecione uma pessoa</option>{people.filter(p=>!shares.some(s=>s.id===p.id)).map(p=><option key={p.id} value={p.id}>{p.name??'Usuário '+p.id}</option>)}</select></label><button className="btn primary" disabled={busy||!selected}>Compartilhar</button></form>
    {!people.length&&<p className="small muted">Os usuários aparecem depois de acessarem a assistente nesta unidade.</p>}
    {shares.map(p=><div className="row" key={p.id}><span className="grow">{p.name??'Usuário '+p.id}</span><button className="btn danger sm" disabled={busy} onClick={()=>void act(p.id)}>Remover acesso à tela</button></div>)}
  </details>;
}
