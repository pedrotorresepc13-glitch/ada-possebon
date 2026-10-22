import {createXlsx} from './export-xlsx.mjs';
// Quadro visual: mostra somente respostas verificadas e deixa explícita a falta de fonte.
// Não gera métricas a partir de texto livre do modelo.
const el=id=>document.getElementById(id);
const board=el('wb-stage');
const viewport=el('wb-viewport');
let zoom=1, count=0;
const cards=[];
function cell(tag, cls, value){
  const n=document.createElement(tag);
  if(cls)n.className=cls;
  if(value!==undefined)n.textContent=String(value);
  return n;
}
function setZoom(next){
  zoom=Math.max(0.55,Math.min(1.5,next));
  board.style.transform='scale('+zoom+')';
  el('wb-zoom').textContent=Math.round(zoom*100)+'%';
}
function makeCard({question,answer,sources=[],visual}){
  const structured=visual && visual.type==='metrics' && Array.isArray(visual.metrics);
  const title=structured ? visual.title : (visual?.title || 'Resposta à consulta');
  const card=cell('article','wb-card');
  card.setAttribute('tabindex','0');
  const header=cell('header','wb-card-head');
  const handle=cell('span','wb-card-handle','⋮⋮');
  handle.title='Arrastar painel';
  header.append(handle,cell('strong','',title));
  card.append(header);
  const questionText=cell('p','wb-question','Pergunta: '+String(question||'').slice(0,250));
  card.append(questionText);
  if(structured){
    const metrics=cell('div','wb-metrics');
    for(const metric of visual.metrics.slice(0,12)){
      const item=cell('div','wb-metric');
      item.append(cell('span','',metric.label),cell('strong','',metric.value));
      metrics.append(item);
    }
    card.append(metrics);
    if(visual.description)card.append(cell('p','wb-answer',visual.description));
  }else{
    card.append(cell('p','wb-answer',answer||'Nenhuma resposta confirmada.'));
  }
  const provenance=cell('footer','wb-source');
  const items=Array.isArray(sources)?sources:[];
  provenance.textContent=items.length?'Fonte: '+items.slice(0,6).join(' · '):'Sem fonte operacional verificada — não utilizar como indicador.';
  card.append(provenance);
  const item={question,answer,sources:items,visual:structured?visual:null,card,x:30+(count%3)*390,y:28+Math.floor(count/3)*355};
  count++;cards.push(item);
  const place=()=>{card.style.left=item.x+'px';card.style.top=item.y+'px';};
  place();
  let moving=null;
  header.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    moving={x:e.clientX,y:e.clientY,oldX:item.x,oldY:item.y};
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove',e=>{
    if(!moving)return;
    item.x=Math.max(0,moving.oldX+(e.clientX-moving.x)/zoom);
    item.y=Math.max(0,moving.oldY+(e.clientY-moving.y)/zoom);
    place();
  });
  const stop=()=>{moving=null;};
  header.addEventListener('pointerup',stop);
  header.addEventListener('pointercancel',stop);
  board.append(card);
  el('wb-empty').hidden=true;
  viewport.scrollTo({left:Math.max(0,item.x*zoom-150),top:Math.max(0,item.y*zoom-60),behavior:'smooth'});
}
window.addEventListener('holo:answer',event=>{
  const data=event.detail||{};
  makeCard(data);
});
function buildRows(){
  const rows=[['Pergunta','Painel','Indicador','Valor','Resposta','Fonte']];
  for(const item of cards){
    if(item.visual){
      for(const metric of item.visual.metrics)rows.push([
        item.question,item.visual.title,metric.label,metric.value,item.visual.description||'',item.sources.join('; ')
      ]);
    }else rows.push([item.question,'Resposta','','',item.answer||'',item.sources.join('; ')]);
  }
  return rows;
}
function exportCsv(){
  const rows=buildRows();
  const csv='\uFEFF'+rows.map(row=>row.map(val=>'"'+String(val??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='quadro-consultas-possebon.csv';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function clearBoard(){
  cards.length=0;count=0;board.replaceChildren();el('wb-empty').hidden=false;
}
el('wb-clear').addEventListener('click',clearBoard);
window.addEventListener('holo:auth-changed',event=>{
  // Não compartilhar resultados entre usuários/unidades no mesmo navegador.
  if(!event.detail?.connected || event.detail?.identityChanged)clearBoard();
});
el('wb-export').addEventListener('click',()=>{
  const url=URL.createObjectURL(createXlsx(buildRows()));
  const a=document.createElement('a');a.href=url;a.download='quadro-consultas-possebon.xlsx';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
el('wb-export-csv').addEventListener('click',exportCsv);
el('wb-print').addEventListener('click',()=>window.print());
el('wb-zoom-in').addEventListener('click',()=>setZoom(zoom+0.1));
el('wb-zoom-out').addEventListener('click',()=>setZoom(zoom-0.1));
el('wb-fit').addEventListener('click',()=>{setZoom(1);viewport.scrollTo({left:0,top:0});});
setZoom(1);
