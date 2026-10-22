// Painel único de conhecimento, com números reais do índice POSSEBON Brain.
// NÃO os apresenta como indicadores operacionais (colaboradores, compras, RDO etc.).
const $$=s=>document.querySelector(s);
const summaryTab=$$('#intel-tab-knowledge');
const assistantTab=$$('#intel-tab-assistant');
const summaryPanel=$$('#insights-summary');
const assistantPanel=$$('#holo-companion-slot');
let lastOverview=null,lastUnit=null,lastCompleted=null;
function switchTab(tab,focus=false){
  const talking=tab==='assistant';
  summaryPanel.hidden=talking;
  assistantPanel.hidden=!talking;
  summaryTab.setAttribute('aria-selected',String(!talking));
  assistantTab.setAttribute('aria-selected',String(talking));
  if(focus)(talking?assistantPanel.querySelector('#hc-input'):summaryTab)?.focus();
}
summaryTab.addEventListener('click',()=>switchTab('knowledge'));
assistantTab.addEventListener('click',()=>switchTab('assistant',true));
window.addEventListener('holo:chat-open',()=>switchTab('assistant',true));
const safeText=(value)=>String(value??'');
function renderSummary(status,overview){
  const summary=$$('#brain-summary');
  summary.replaceChildren();
  const ready=!!overview?.ready;
  const heading=document.createElement('strong');
  heading.className='brain-state';
  heading.textContent=ready?'Brain conectado · catálogo disponível':
    status.progress?.running?'Estudando o POSSEBON Brain...':
    status.connected?'Aguardando estudo do Brain':'Conecte o POSSEBON para estudar o sistema';
  summary.append(heading);
  const detail=document.createElement('p');
  detail.textContent=ready?
    safeText(overview.total)+' itens de conhecimento catalogados na unidade '+status.unit_id+
      '. Fontes: '+Object.keys(overview.namespaces||{}).length+' categorias.':
    status.progress?.running?
      safeText(status.progress.count||0)+' de '+safeText(status.progress.expected||'?')+' itens lidos.' :
      status.progress?.error||'Abra Conectar POSSEBON e autorize a unidade.';
  summary.append(detail);
  if(ready){
    const time=document.createElement('small');
    time.textContent='Último estudo local: '+(overview.completedAt?
      new Date(overview.completedAt).toLocaleString('pt-BR'):'data não informada')+
      ' · Não são métricas operacionais.';
    summary.append(time);
  }
  window.dispatchEvent(new CustomEvent('holo:knowledge-updated',{
    detail:{overview:ready?overview:null,connected:!!status.connected,unit_id:status.unit_id}
  }));
}
async function get(path){
  const r=await fetch(path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  const data=await r.json();
  if(!r.ok||data.ok===false)throw Error(data.error||'HTTP '+r.status);
  return data;
}
let inFlight=false;
async function refresh(){
  if(inFlight)return;
  inFlight=true;
  try{
    const state=await get('/api/possebon/status');
    let overview=null;
    if(state.knowledge?.ready){
      const changed=!lastOverview||lastUnit!==state.unit_id||
         lastCompleted!==state.knowledge.completedAt;
      if(changed){
        overview=await get('/api/possebon/overview');
        lastOverview=overview;lastUnit=state.unit_id;lastCompleted=state.knowledge.completedAt;
      }else overview=lastOverview;
    }else{
      lastOverview=null;lastUnit=null;lastCompleted=null;
    }
    renderSummary(state,overview);
  }catch(err){
    const element=$$('#brain-summary');
    element.textContent='Não foi possível consultar o catálogo local: '+err.message;
  }finally{inFlight=false;}
}
window.addEventListener('holo:brain-refresh',()=>void refresh());
switchTab('knowledge');
void refresh();
setInterval(()=>void refresh(),8000);
