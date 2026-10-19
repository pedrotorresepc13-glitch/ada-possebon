// Motor de gestos adaptado da logica do HOLO original (holo.html), preservando sua licença MIT.
// Independente da interface: gestos geram eventos, e nao acessam dados da empresa.
const PINCH_IN = 0.30, PINCH_OUT = 0.42, PINCH_EARN = 2, SPAN_MIN = 0.025;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
function metrics(lm) {
  const span=Math.max(1e-4,distance(lm[0],lm[9]));
  const finger=i=>distance(lm[i],lm[0])/span;
  const tips=[finger(8),finger(12),finger(16),finger(20)];
  return {
    span, pinch:distance(lm[4],lm[8])/span,
    peace:tips[0]>1.45&&tips[1]>1.45&&tips[2]<1.15&&tips[3]<1.15,
    tip:lm[8], palm:{x:(lm[0].x+lm[9].x)/2,y:(lm[0].y+lm[9].y)/2}
  };
}
function makeHand() {
  return {present:false,seen:0,pinch:false,pinchN:0,peaceN:0,
    palm:null,cur:null,filter:null,start:null,started:0};
}
// Filtro One Euro do HOLO: cursor estavel parado, responsivo em movimento.
function oneEuro(st,raw,now) {
  if(!st.filter)st.filter={t:now,x:raw.x,y:raw.y,dx:0,dy:0};
  const f=st.filter,dt=clamp((now-f.t)/1000,1/240,0.2);f.t=now;
  const alpha=cut=>{const r=2*Math.PI*cut*dt;return r/(r+1);};
  const aD=alpha(2.5);
  f.dx+=((raw.x-f.x)/dt-f.dx)*aD;
  f.dy+=((raw.y-f.y)/dt-f.dy)*aD;
  const a=alpha(1.3+0.009*Math.hypot(f.dx,f.dy));
  f.x+=(raw.x-f.x)*a; f.y+=(raw.y-f.y)*a;
  return {x:f.x,y:f.y};
}
export function createGestureEngine({bounds,onStart,onMove,onEnd,onDouble,onPeace,onCursor}) {
  const hands=[makeHand(),makeHand()];
  let pair=null,lastPeace=-Infinity;
  const toPixel=p=>{const r=bounds();return {
    x:clamp((0.5-(p.x-0.5)*1.35)*r.width,0,r.width),
    y:clamp((0.5+(p.y-0.5)*1.35)*r.height,0,r.height)
  };};
  function assign(candidates) {
    const valid=candidates.map(lm=>({lm,m:metrics(lm)})).filter(c=>c.m.span>=SPAN_MIN).slice(0,2);
    const out=[null,null],used=new Set();
    for(const i of [0,1].filter(i=>hands[i].present).sort((a,b)=>hands[b].seen-hands[a].seen)) {
      let j=-1,d=Infinity;
      valid.forEach((c,k)=>{if(used.has(k))return;const gap=distance(c.m.palm,hands[i].palm);
        if(gap<d){d=gap;j=k;}});
      if(j>=0&&d<0.35){out[i]=valid[j];used.add(j);}
    }
    valid.forEach((v,j)=>{if(used.has(j))return;
      const free=out.findIndex((c,i)=>!c&&!hands[i].present);
      const i=free>=0?free:out.findIndex(c=>!c);
      if(i>=0){out[i]=v;used.add(j);}
    });
    return out;
  }
  function drop(i,cancelled=true) {
    const h=hands[i];
    if(h.pinch)onEnd(i,h.cur,{cancelled,elapsed:0,movement:Infinity});
    hands[i]=makeHand();pair=null;
  }
  function reset() {drop(0);drop(1);onCursor(null,false);}
  function update(candidates,now=performance.now()) {
    const slots=assign(candidates||[]);
    for(let i=0;i<2;i++){
      const candidate=slots[i];
      if(!candidate){if(hands[i].present)drop(i);continue;}
      const h=hands[i],m=candidate.m,raw=toPixel(m.tip);
      h.present=true;h.seen++;h.palm=m.palm;
      h.cur=oneEuro(h,raw,now);
      if(!h.pinch&&h.seen>=3&&m.pinch<PINCH_IN){
        if(++h.pinchN>=PINCH_EARN) {
          h.pinch=true;h.started=now;h.start={...h.cur};
          onStart(i,h.cur);
        }
      }else if(!h.pinch&&m.pinch>=PINCH_IN)h.pinchN=0;
      else if(h.pinch&&m.pinch>PINCH_OUT){
        h.pinch=false;h.pinchN=0;
        onEnd(i,h.cur,{cancelled:false,elapsed:now-h.started,movement:distance(h.cur,h.start)});
        pair=null;
      }else if(h.pinch)onMove(i,h.cur);
      if(m.peace&&!h.pinch){
        h.peaceN++;
        if(h.peaceN===8&&now-lastPeace>2500){
          lastPeace=now;onPeace();
        }
      }else h.peaceN=0;
    }
    if(hands.every(h=>h.present&&h.pinch)){
      const a=hands[0].cur,b=hands[1].cur;
      const d=distance(a,b),angle=Math.atan2(b.y-a.y,b.x-a.x);
      if(d>Math.min(140,bounds().width*0.22)){
        if(pair){
          let delta=angle-pair.angle;
          while(delta>Math.PI)delta-=2*Math.PI;
          while(delta< -Math.PI)delta+=2*Math.PI;
          onDouble({scale:clamp(d/Math.max(40,pair.distance),0.94,1.06),
            rotation:clamp(delta,-0.12,0.12)});
        }
        pair={distance:d,angle};
      }else pair=null;
    }else pair=null;
    const pointer=hands.find(h=>h.present);
    onCursor(pointer?.cur||null,Boolean(pointer?.pinch));
  }
  return {update,reset};
}
