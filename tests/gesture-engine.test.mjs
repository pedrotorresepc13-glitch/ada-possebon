import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const file = readFileSync(new URL('../studio/gesture-engine.js', import.meta.url),'utf8');
const {createGestureEngine} = await import('data:text/javascript;base64,'+Buffer.from(file).toString('base64'));

function hand(x=.35,{pinch=false,peace=false,tipX=x}={}) {
  const lm=Array.from({length:21},()=>({x,y:.76,z:0}));
  lm[0]={x,y:.8,z:0};
  lm[9]={x,y:.6,z:0};
  lm[8]={x:tipX,y:.4,z:0};
  lm[4]=pinch?{x:tipX+.005,y:.405,z:0}:{x:x+.16,y:.56,z:0};
  lm[12]={x,y:peace?.38:.7,z:0};
  lm[16]={x,y:.71,z:0};
  lm[20]={x,y:.71,z:0};
  return lm;
}
function makeEngine(events) {
  return createGestureEngine({
    bounds:()=>({width:1000,height:700}),
    onStart:(i,p)=>events.push(['start',i,p]),
    onMove:(i,p)=>events.push(['move',i,p]),
    onEnd:(i,p,details)=>events.push(['end',i,details]),
    onDouble:data=>events.push(['double',data]),
    onPeace:()=>events.push(['peace']),
    onCursor:(p,pinching)=>events.push(['cursor',p,pinching])
  });
}
{
  const events=[],e=makeEngine(events);
  for(let i=0;i<6;i++)e.update([hand(.35,{pinch:true})],i*100);
  assert.equal(events.filter(x=>x[0]==='start').length,1,'A pinça deve iniciar uma vez');
  for(let i=6;i<13;i++)e.update([hand(.42,{pinch:true,tipX:.42})],i*100);
  assert.ok(events.some(x=>x[0]==='move'),'O arraste deve emitir movimentos');
  e.update([hand(.42,{pinch:false})],1400);
  const end=events.find(x=>x[0]==='end');
  assert.ok(end,'Soltar a pinça deve finalizar o arraste');
  assert.equal(end[2].cancelled,false,'Soltura não deve ser cancelamento');
  e.reset();
  assert.equal(events.at(-1)[0],'cursor');
}
{
  const events=[],e=makeEngine(events);
  for(let i=0;i<8;i++)e.update([hand(.3,{pinch:true}),hand(.7,{pinch:true})],i*100);
  for(let i=8;i<14;i++)e.update([hand(.28,{pinch:true}),hand(.76,{pinch:true})],i*100);
  const doubles=events.filter(x=>x[0]==='double');
  assert.ok(doubles.length>=1,'Duas pinças devem produzir zoom/rotação');
  assert.ok(doubles.every(x=>Number.isFinite(x[1].scale)&&Number.isFinite(x[1].rotation)));
}
{
  const events=[],e=makeEngine(events);
  for(let i=0;i<11;i++)e.update([hand(.4,{peace:true})],i*100);
  assert.equal(events.filter(x=>x[0]==='peace').length,1,'Paz restaura o mapa uma vez');
}
{
  const events=[],e=makeEngine(events);
  for(let i=0;i<5;i++)e.update([hand(.4,{pinch:true})],i*100);
  e.update([],800);
  const cancelled=events.find(x=>x[0]==='end');
  assert.equal(cancelled?.[2].cancelled,true,'Perda de rastreio cancela a captura');
}
console.log('Gestos: pinça, arraste, soltura, duas mãos, paz e perda de rastreio — OK');
