import { useCallback, useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { api } from '../api.ts';
import { useApp } from '../app-context.ts';

type Cell=string|number|boolean|null;
type Panel={
  title:string;type:'table'|'kpi'|'bar'|'line'|'pie';status:string;message?:string;
  rows:Record<string,Cell>[];columns:string[];rowCount:number;
  provenance?:{source:string;unitId:number;queriedAt:string};
};
interface Board{
  id:string;title:string;spec:{title:string;description:string;panels:unknown[]};
  updated_at?:string;
}
interface Data {board:Board;panels:Panel[];generatedAt:string}

const fmt=(v:Cell|undefined)=>v==null?'—':typeof v==='number'?v.toLocaleString('pt-BR',{maximumFractionDigits:2}):String(v);
function Graph({p}:{p:Panel}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const node=ref.current;
    if(!node || !p.rows.length)return;
    const obj=echarts.init(node);
    const numeric=p.columns.filter(c=>p.rows.some(r=>typeof r[c]==='number'));
    const category=p.columns.find(c=>!numeric.includes(c))??p.columns[0]??'';
    const labels=p.rows.map((r,i)=>category&&category!==numeric[0]?fmt(r[category]):String(i+1));
    const series=numeric.map(c=>({name:c,type:p.type==='line'?'line':'bar',data:p.rows.map(r=>Number(r[c]??0)),smooth:true}));
    if(p.type==='pie'){
      obj.setOption({tooltip:{trigger:'item'},legend:{bottom:0},series:[{
        type:'pie',radius:['35%','68%'],
        data:p.rows.map((r,i)=>({name:labels[i],value:Number(r[numeric[0]??'']??0)}))
      }]});
    }else{
      obj.setOption({
        tooltip:{trigger:'axis'},legend:{top:0},
        grid:{left:48,right:24,top:52,bottom:65},
        xAxis:{type:'category',data:labels,axisLabel:{rotate:labels.length>8?35:0}},
        yAxis:{type:'value'},
        series
      });
    }
    const observer=new ResizeObserver(()=>obj.resize());
    observer.observe(node);
    return()=>{observer.disconnect();obj.dispose()};
  },[p]);
  return <div ref={ref} style={{width:'100%',height:320}} role="img" aria-label={p.title}/>;
}

function PanelWidget({panel:p}:{panel:Panel}){
  const numbers=p.columns.filter(c=>p.rows.some(r=>typeof r[c]==='number'));
  return <section className="widget" style={{minWidth:0}}>
    <h3>{p.title}</h3>
    {p.status!=='ok'?<div className="note-box" role="alert">{p.message??'Fonte indisponível'}</div>:
      !p.rows.length?<div className="empty">Nenhum registro encontrado.</div>:
      p.type==='kpi'?<div className="kpi"><div className="value tabular">{fmt(p.rows[0]?.[numbers[0]??p.columns[0]??''])}</div><div className="sub">{numbers[0]??''}</div></div>:
      p.type==='table'||!numbers.length?<div style={{overflowX:'auto',maxHeight:430}}>
        <table className="data"><thead><tr>{p.columns.map(c=><th key={c}>{c}</th>)}</tr></thead>
        <tbody>{p.rows.map((r,i)=><tr key={i}>{p.columns.map(c=><td key={c}>{fmt(r[c])}</td>)}</tr>)}</tbody></table>
      </div>:<Graph p={p}/>}
    {p.provenance&&<div className="widget-foot">Fonte: {p.provenance.source} · Unidade {p.provenance.unitId} · Consultado em {new Date(p.provenance.queriedAt).toLocaleString('pt-BR')}</div>}
  </section>;
}
export function LiveBoardsList(){
  const {navigate}=useApp();
  const [rows,setRows]=useState<Board[]|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{api<Board[]>('/live-boards').then(setRows).catch(e=>setError((e as Error).message))},[]);
  return <>
    <header className="topbar"><h1 className="grow" style={{paddingLeft:36}}>Telas vivas do POSSEBON</h1><button className="btn primary sm" onClick={()=>navigate('/?nova='+Date.now())}>Criar pela conversa</button></header>
    <div className="content">
      <p className="muted">As telas são criadas pela IA a partir de tabelas reais e permanecem conectadas à fonte. Consultas de leitura e permissões são verificadas a cada atualização.</p>
      {error&&<div className="error-box" role="alert">{error}</div>}
      {!rows?<div className="skeleton" style={{height:90}}/>:
       rows.length===0?<div className="empty">Nenhuma tela viva criada. Peça à IA para criar uma tela usando dados do POSSEBON.</div>:
       <ul className="list" style={{listStyle:'none',padding:0}}>{rows.map(b=><li className="list-item" key={b.id}>
         <a href="#" onClick={e=>{e.preventDefault();navigate('/telas/'+b.id)}}><strong>{b.title}</strong></a>
       </li>)}</ul>}
    </div>
  </>;
}
export function LiveBoardDetail({id}:{id:string}){
  const {navigate}=useApp();
  const [d,setD]=useState<Data|null>(null);
  const [err,setErr]=useState('');
  const [updating,setUpdating]=useState(false);
  const load=useCallback(async()=>{
    setUpdating(true);
    try{const r=await api<Data>('/live-boards/'+id+'/data?refresh=1');setD(r);setErr('')}
    catch(e){setErr((e as Error).message)}
    finally{setUpdating(false)}
  },[id]);
  useEffect(()=>{
    void load();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load()},30_000);
    const onFocus=()=>void load();
    window.addEventListener('focus',onFocus);
    return()=>{window.clearInterval(timer);window.removeEventListener('focus',onFocus)}
  },[load]);
  return <>
    <header className="topbar">
      <button className="btn ghost sm" onClick={()=>navigate('/telas')}>Voltar</button>
      <h1 className="grow">{d?.board.title??'Painel POSSEBON'}</h1>
      <button className="btn sm" disabled={updating} onClick={()=>void load()}>{updating?'Atualizando...':'Atualizar agora'}</button>
    </header>
    <div className="content">
      {err&&<div className="error-box" role="alert">{err}</div>}
      {d?<><p className="muted small">{d.board.spec.description} · Atualizado em {new Date(d.generatedAt).toLocaleString('pt-BR')}</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,440px),1fr))',gap:16}}>
          {d.panels.map((p,i)=><PanelWidget key={i} panel={p}/>)}
        </div>
      </>:<div className="skeleton" style={{height:300}}/>}
    </div>
  </>;
}
