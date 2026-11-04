import {useEffect,useState} from 'react';
import {api} from '../api.ts';
import {DictionaryApproval} from './DictionaryApproval.tsx';
interface Base{revision:string;createdAt:string;documentCount:number;catalogTruncated:boolean;modelCalls:number;areas:{id:string;name:string;purpose:string;checks:string[];documents:number;evidence:{documentId:string;title:string;source:string;observedAt:string;excerpt:string;uri:string|null}[]}[]}
export function CorporateBase({canApprove=false}:{canApprove?:boolean}){
 const [data,setData]=useState<Base|null>(null);const [error,setError]=useState('');const [area,setArea]=useState('');
 useEffect(()=>{let active=true;setError('');void api<Base>('/corporate-base'+(area?'?area='+encodeURIComponent(area):'')).then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError((e as Error).message);});return()=>{active=false;};},[area]);
 return <section className="card" aria-label="Base corporativa estruturada">
  <h2>Base corporativa estruturada</h2>
  <p className="muted small">Organizada por área com fontes e revisões. Reutiliza os documentos autorizados sem chamadas de IA para montar a base. Os dados operacionais continuam sendo consultados no sistema.</p>
  {error&&<div className="error-box" role="alert">{error}</div>}
  {!data&&!error?<p role="status">Organizando as referências disponíveis...</p>:data&&<>
   <p>{data.areas.length} áreas · {data.documentCount}{data.catalogTruncated?' ou mais':''} documentos no catálogo · {data.modelCalls} chamadas de estudo para esta organização</p>
   <label className="field">Área de conhecimento <select className="select" value={area} onChange={e=>setArea(e.target.value)}><option value="">Visão da estrutura</option>{data.areas.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   {(area?data.areas.filter(a=>a.id===area):data.areas).map(a=><article className="card" key={a.id}>
    <h3>{a.name}</h3><p>{a.purpose}</p><ul>{a.checks.map(c=><li key={c}>{c}</li>)}</ul>
    <p className="muted small">{a.documents?`${a.documents} documentos classificados nesta área; classificação não comprova leitura integral.`:'Sem documento classificado nesta área para sua sessão. O roteiro de análise não representa conhecimento dos fatos.'}</p>
    {a.evidence.map(e=><blockquote key={e.documentId}><p>{e.excerpt}</p><footer>{e.title} · {e.source} · referência {new Date(e.observedAt).toLocaleDateString('pt-BR')}{e.uri&&<> · <a href={e.uri} target="_blank" rel="noreferrer noopener">Fonte</a></>}</footer></blockquote>)}
   </article>)}
   <p className="muted small">Códigos são definidos por tabela, campo e unidade. Novos significados exigem evidência e aprovação administrativa. Fontes novas ou revisadas atualizam a base na próxima consulta; o aprofundamento por IA mantém seu controle de consumo.</p>
   {canApprove&&<DictionaryApproval key={area} sources={data.areas.flatMap(a=>a.evidence)}/>}
  </>}
 </section>;
}
