import * as THREE from '../vendor/three.module.js';
import {areas, helpText} from './demo.js';
import {createGestureEngine} from './gesture-engine.js';

// Prototipo frontend: sem tokens, endpoints externos ou dados empresariais reais.
const $ = (s) => document.querySelector(s);
const key = 'holo-enterprise-prototipo-v1';
let restored = {};
try { restored = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
const state = {
  area:'geral', company:typeof restored.company === 'string' ? restored.company : 'Empresa Exemplo',
  custom:restored.custom === true, voice:false, provider:restored.provider || 'demo',
  model:null, stream:null, landmark:null, lastFrame:0, gestureEngine:null, gestureGrab:null,
  scene:null, camera:null, renderer:null, group:null, baseCameraZ:12,
  nodes:[], drag:null, rotY:0, rotX:0, rotZ:0, zoom:1
};
function save() {
  try { localStorage.setItem(key, JSON.stringify({company:state.company,custom:state.custom,provider:state.provider})); }
  catch { setStatus('Armazenamento local indisponível'); }
}
function setStatus(t) { $('#camera-status').textContent=t; }
function text(tag, value, cls) {
  const e=document.createElement(tag); if(cls)e.className=cls; e.textContent=value; return e;
}
function formatArea(a) { return state.custom ? {
  ...a,description:'Empresa criada localmente. Nenhuma fonte de dados está conectada.',
  stats:[['Fonte de dados','Pendente'],['Indicadores','0'],['IA','Não conectada'],['Conexões','0']],
  bars:[],summary:'Sua empresa ainda não possui dados. Configure conexões de forma segura no backend antes de consultar informações reais.'
} : a; }
function selectArea(id, announce=false) {
  const a=areas.find(x=>x.id===id) || areas[0]; state.area=a.id;
  const shown=formatArea(a);
  $('#selected-title').textContent=a.name;
  $('#selected-description').textContent=shown.description;
  $('#scene-title').textContent=a.id==='geral'?'Sua empresa em outra dimensão.':'Explorando '+a.name.toLowerCase()+'.';
  const metrics=$('#metrics');metrics.replaceChildren();
  for(const [name,value] of shown.stats) {
    const card=text('div','', 'metric'); card.append(text('strong',value), text('small',name));metrics.append(card);
  }
  const bars=$('#bars');bars.replaceChildren();
  if(!shown.bars.length) bars.append(text('p','Nenhum indicador disponível.','disclaimer'));
  else {
    const max=Math.max(1,...shown.bars.map(x=>x[1]));
    for(const [label,value] of shown.bars) {
      const row=text('div','','bar-row');const rail=text('div','','bar-rail');
      const fill=text('div','','bar-fill');fill.style.width=Math.max(4,(value/max)*100)+'%';
      rail.append(fill);row.append(text('span',label),rail,text('b',String(value)));bars.append(row);
    }
  }
  for(const b of document.querySelectorAll('.area-button')) {
    const active=b.dataset.area===a.id;b.classList.toggle('active',active);
    b.setAttribute('aria-current',active?'page':'false');
  }
  state.nodes.forEach(n=> {
    const active=n.id===a.id;
    n.mesh.material.emissiveIntensity=active?1.1:0.36;
    n.mesh.scale.setScalar((active?1.27:1)*(n.userScale||1));
  });
  if(announce) respond(shown.summary);
}
function respond(value) {
  const log=$('#assistant-log'); log.append(text('p',value,'ai-message'));log.scrollTop=log.scrollHeight;
  if(state.voice && window.speechSynthesis) {
    const u=new SpeechSynthesisUtterance(value);u.lang='pt-BR';u.rate=1;
    const match=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()==='pt-br');
    if(match)u.voice=match;
    speechSynthesis.cancel();speechSynthesis.speak(u);
  }
}
function ask(question) {
  const input=question.trim();if(!input)return;
  const log=$('#assistant-log'); log.append(text('p',input,'user-message'));log.scrollTop=log.scrollHeight;
  if(state.provider!=='demo') { void askModel(input); return; }
  const q=input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const destinations={
    pessoas:['pessoa','colaborador','equipe','rh','treinamento','funcionario'],
    compras:['compra','material','fornecedor','solicitacao','suprimento'],
    seguranca:['seguranca','inspecao','auditoria','acidente','plano de acao','ronda'],
    operacoes:['operacao','projeto','atividade','obra','producao'],
    geral:['visao geral','painel geral','inicio','tudo','panorama']
  };
  if(q.includes('apresenta') || q.includes('tela cheia') || q.includes('telao')) {
    respond('Você pode entrar no modo de apresentação pelo botão Apresentar. Nesse modo os indicadores seguem sendo apenas demonstrativos.');
    return;
  }
  if(q.includes('ajuda')||q.includes('comando')){respond(helpText);return;}
  if(q.includes('modelo')||q.includes('conectar ia')){openSettings('ia');respond('Configure o tipo de modelo no painel. As opções local e API ainda precisam de um serviço backend para responder.');return;}
  const id=Object.keys(destinations).find(k=>destinations[k].some(w=>q.includes(w)));
  if(id) {selectArea(id);respond(formatArea(areas.find(a=>a.id===id)).summary);return;}
  if(q.includes('resumo')||q.includes('relatorio')) {
    respond(state.custom?'Esta empresa ainda não possui fontes de dados autorizadas. Não posso produzir um relatório real.':'Resumo ilustrativo: 128 pessoas, 42 solicitações de compras, 11 planos de segurança e 8 projetos. Todos os números são inventados para o protótipo.');
    return;
  }
  respond('Esta primeira versão utiliza comandos de demonstração, não um modelo de IA. '+helpText);
}
async function askModel(prompt) {
  if(!['localhost','127.0.0.1'].includes(location.hostname)) {
    respond('O modelo local ou por API exige um serviço backend autenticado. Nesta prévia pública ele ainda não está disponível. Use Demonstração.');
    return;
  }
  respond('Consultando o provedor configurado no serviço local. Nenhuma fonte empresarial está conectada.');
  try {
    const reply=await fetch('http://127.0.0.1:4892/api/assist',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt:prompt,area:state.area,provider:state.provider}),
      signal:AbortSignal.timeout(50000)
    });
    const data=await reply.json();
    if(!reply.ok)throw new Error(data.error||('HTTP '+reply.status));
    respond(data.answer);
  } catch(err) {
    respond('Não foi possível consultar o modelo: '+String(err?.message||'Falha de comunicação')+'. Inicie o serviço local e confira a configuração.');
  }
}
function updateCompany() {
  $('#company-name').textContent=state.company;
  $('#company-type').textContent=state.custom?'Empresa local sem conexões':'Ambiente de demonstração';
  $('#data-badge').textContent=state.custom?'SEM FONTE DE DADOS':'DADOS FICTÍCIOS';
  selectArea(state.area);
}
function setupNavigation() {
  const nav=$('#area-list');
  for(const a of areas) {
    const b=document.createElement('button');b.className='area-button';
    b.type='button';b.dataset.area=a.id;
    b.append(text('span',a.icon,'area-symbol'),text('span',a.name));
    b.addEventListener('click',()=>selectArea(a.id,true));nav.append(b);
  }
  updateCompany();
  $('#command-form').addEventListener('submit',ev=>{
    ev.preventDefault();ask($('#command-input').value);$('#command-input').value='';
  });
  $('#btn-company').addEventListener('click',()=>$('#modal-company').showModal());
  $('#company-form').addEventListener('submit',ev=>{
    ev.preventDefault();const name=$('#new-company-name').value.trim();
    if(!name)return;
    state.company=name.slice(0,80);state.custom=true;save();updateCompany();
    $('#modal-company').close();respond('Empresa criada neste navegador, com indicadores vazios. Para acesso compartilhado e persistência na nuvem será preciso conectar um backend.');
  });
  $('#btn-back-demo').addEventListener('click',()=>{
    state.company='Empresa Exemplo';state.custom=false;save();updateCompany();
    $('#modal-company').close();respond('Demonstração com dados fictícios restaurada.');
  });
  document.querySelectorAll('.close-modal').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  $('#btn-connect').addEventListener('click',()=>openSettings('dados'));
  $('#btn-source').addEventListener('click',()=>openSettings('ia'));
  $('#btn-present').addEventListener('click',async()=>{
    try {
      if(!document.fullscreenElement)await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { respond('Não foi possível ativar a tela cheia neste navegador.');}
  });
  $('#btn-reset').addEventListener('click',()=>{
    resetScene(true);
  });
  $('#btn-mic').addEventListener('click',listen);
  $('#btn-tts').addEventListener('click',()=>{
    state.voice=!state.voice;$('#btn-tts').textContent=state.voice?'🔊 Voz ligada':'🔈 Voz desligada';
    $('#btn-tts').setAttribute('aria-pressed',String(state.voice));
    if(!state.voice&&window.speechSynthesis)speechSynthesis.cancel();
  });
  $('#btn-gestures').addEventListener('click',toggleGestures);
  $('#btn-immersive').addEventListener('click',()=>{
    const immersive=$('.app').classList.toggle('immersive');
    $('#btn-immersive').setAttribute('aria-pressed',String(immersive));
    $('#btn-immersive').textContent=immersive?'◩ Exibir painéis':'◌ Modo imersivo';
  });
}
function openSettings(mode) {
  const host=$('#settings-content');host.replaceChildren();
  if(mode==='dados') {
    $('#modal-settings-title').textContent='Conectores empresariais';
    $('#settings-description').textContent='Arquitetura prevista. Ainda não há conexão ativa: senhas e tokens nunca devem ser inseridos nesta página de demonstração.';
    for(const [title,detail] of [
      ['Banco interno da plataforma','PostgreSQL por empresa, com controle de acesso e histórico.'],
      ['MySQL / MariaDB / PostgreSQL','Conector por serviço backend, usuário de leitura e consultas aprovadas.'],
      ['Firebase / Firestore','Integração por serviço autenticado e regras de segurança.'],
      ['API REST / POSSEBON / TOTVS','Conexão segura com escopo de unidade, permissões e registros de auditoria.']
    ]) {
      const c=text('div',title,'settings-choice');c.append(text('small',detail));host.append(c);
    }
  } else {
    $('#modal-settings-title').textContent='Motor de inteligência híbrida';
    $('#settings-description').textContent='Você escolhe o provedor, mas o backend ainda não está conectado. Nenhuma pergunta é enviada a modelos externos nesta versão.';
    for(const [value,title,detail] of [
      ['demo','Demonstração (ativa)','Regras locais, respostas reproduzíveis, sem modelo de IA.'],
      ['local','Modelo aberto / local','Planejado para Ollama ou servidor compatível, via backend protegido.'],
      ['api','API de IA externa','Planejado para provedores com chave mantida apenas no servidor.']
    ]) {
      const c=document.createElement('button');c.className='settings-choice wide';
      c.textContent=(state.provider===value?'✓ ':'')+title;
      c.append(text('small',detail));c.addEventListener('click',()=>{
        state.provider=value;save();openSettings('ia');
      });host.append(c);
    }
    host.append(text('p','Provedor selecionado: '+state.provider+'. Conexão operacional: somente demonstração.','disclaimer'));
  }
  if(!$('#modal-settings').open) $('#modal-settings').showModal();
}
function listen() {
  const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Speech){respond('Reconhecimento de voz indisponível neste navegador. Use o campo de texto.');return;}
  const rec=new Speech();rec.lang='pt-BR';rec.interimResults=false;rec.maxAlternatives=1;
  $('#btn-mic').textContent='🎙 Ouvindo…';
  rec.onresult=e=>{const spoken=e.results[0][0].transcript;ask(spoken);};
  rec.onerror=e=>respond('Não foi possível reconhecer a fala ('+e.error+').');
  rec.onend=()=>{$('#btn-mic').textContent='🎙 Falar';};
  try{rec.start();}catch{respond('Não foi possível iniciar o microfone.');}
}
function labelSprite(label) {
  const c=document.createElement('canvas');c.width=512;c.height=96;
  const cx=c.getContext('2d');cx.fillStyle='rgba(8,20,38,.72)';cx.fillRect(0,0,512,96);
  cx.strokeStyle='#375e78';cx.strokeRect(1,1,510,94);
  cx.fillStyle='#e1fbff';cx.font='bold 36px system-ui';cx.textAlign='center';
  cx.fillText(label.toUpperCase(),256,61);
  const tex=new THREE.CanvasTexture(c);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sprite.scale.set(2.2,.43,1);return sprite;
}
function initScene() {
  try {
    const host=$('#scene-wrap');const canvas=$('#scene');
    const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(45,1,.1,100);
    camera.position.set(0,0,12);
    const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    const group=new THREE.Group();scene.add(group);
    scene.add(new THREE.AmbientLight(0xffffff,.7));
    const light=new THREE.PointLight(0x7dece1,30,35);light.position.set(2,5,6);scene.add(light);
    const backLight=new THREE.PointLight(0x6a90ff,16,32);
    backLight.position.set(-5,-3,-4);scene.add(backLight);
    const count=180,verts=[];
    for(let i=0;i<count;i++)verts.push((Math.random()-.5)*24,(Math.random()-.5)*15,-5-Math.random()*12);
    const stars=new THREE.BufferGeometry();stars.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    scene.add(new THREE.Points(stars,new THREE.PointsMaterial({color:0x478ca3,size:.028,transparent:true,opacity:.55})));
    areas.forEach((a,i)=>{
      const angle=i*Math.PI*2/areas.length-Math.PI/2;
      // Distribuicao espacial: areas em planos de profundidade distintos, nao coladas numa tela.
      const depths=[.45,-.8,1.05,-.45,.7];
      const x=Math.cos(angle)*3.15,y=Math.sin(angle)*1.85,z=depths[i%depths.length];
      const geometry=new THREE.IcosahedronGeometry(.63,2);
      const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
        color:a.color,emissive:a.color,emissiveIntensity:.37,roughness:.25,metalness:.28,flatShading:true
      }));
      // Anel holografico faz parte do objeto, portanto acompanha pegada, giro e zoom.
      const ring=new THREE.Mesh(
        new THREE.TorusGeometry(.81,.012,8,72),
        new THREE.MeshBasicMaterial({color:a.color,transparent:true,opacity:.56,depthWrite:false})
      );
      ring.rotation.x=Math.PI/3;
      mesh.add(ring);
      const core=new THREE.Mesh(
        new THREE.OctahedronGeometry(.20,0),
        new THREE.MeshBasicMaterial({color:0xe8fff5,transparent:true,opacity:.24,depthWrite:false})
      );
      mesh.add(core);
      mesh.position.set(x,y,z);group.add(mesh);
      const halo=new THREE.Mesh(new THREE.SphereGeometry(.86,24,16),
        new THREE.MeshBasicMaterial({color:a.color,transparent:true,opacity:.09,depthWrite:false}));
      halo.position.copy(mesh.position);group.add(halo);
      const name=labelSprite(a.name);name.position.set(x,y-.98,z);group.add(name);
      state.nodes.push({id:a.id,mesh,halo,name,home:mesh.position.clone(),userScale:1});
    });
    const orbit=new THREE.Mesh(new THREE.TorusGeometry(3.28,.012,8,120),
      new THREE.MeshBasicMaterial({color:0x36789b,transparent:true,opacity:.32}));
    orbit.scale.set(1,.6,1);group.add(orbit);
    state.scene=scene;state.camera=camera;state.renderer=renderer;state.group=group;
    function resize() {
      const bounds=host.getBoundingClientRect();
      const w=Math.max(1,bounds.width),h=Math.max(1,bounds.height);
      camera.aspect=w/h;state.baseCameraZ=w<500?16:w<800?14:12;
      camera.position.z=state.baseCameraZ/state.zoom;
      camera.updateProjectionMatrix();renderer.setSize(w,h,false);
    }
    new ResizeObserver(resize).observe(host);resize();
    const raycaster=new THREE.Raycaster(),mouse=new THREE.Vector2();
    canvas.addEventListener('pointerdown',e=>{
      state.drag={x:e.clientX,y:e.clientY,moved:false};
      try{canvas.setPointerCapture(e.pointerId);}catch{}
    });
    canvas.addEventListener('pointermove',e=>{
      if(!state.drag)return;
      const dx=e.clientX-state.drag.x,dy=e.clientY-state.drag.y;
      if(Math.abs(dx)+Math.abs(dy)>2)state.drag.moved=true;
      if(state.drag.moved) {
        state.rotY+=dx*.005;state.rotX=Math.max(-.5,Math.min(.5,state.rotX+dy*.003));
        state.drag.x=e.clientX;state.drag.y=e.clientY;
      }
    });
    canvas.addEventListener('pointerup',e=>{
      if(!state.drag)return;
      if(!state.drag.moved) {
        const rect=canvas.getBoundingClientRect();
        mouse.set(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
        raycaster.setFromCamera(mouse,camera);
        const hits=raycaster.intersectObjects(state.nodes.map(n=>n.mesh));
        if(hits.length) {
          const match=state.nodes.find(n=>n.mesh===hits[0].object);if(match)selectArea(match.id,true);
        }
      } state.drag=null;
    });
    const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function frame(t) {
      requestAnimationFrame(frame);
      group.rotation.y=state.rotY+(reduce?0:Math.sin(t*.00013)*.07);
      group.rotation.x=state.rotX;
      group.rotation.z=state.rotZ;
      camera.position.z=state.baseCameraZ/state.zoom;
      state.nodes.forEach((n,i)=>{
        n.halo.scale.setScalar((n.userScale||1)*(1+(reduce?0:Math.sin(t*.002+i)*.06)));
      });
      renderer.render(scene,camera);
    }requestAnimationFrame(frame);
    selectArea(state.area);
  }catch(err) {
    console.warn('WebGL não disponível',err);
    $('#scene-fallback').hidden=false;setStatus('Mapa 3D indisponível');
  }
}
function closestArea(x,y) {
  if(!state.group||!state.camera)return null;
  const host=$('#scene-wrap').getBoundingClientRect();
  state.group.updateMatrixWorld(true);
  let best=null,dist=Infinity;
  for(const n of state.nodes) {
    const p=new THREE.Vector3();n.mesh.getWorldPosition(p);p.project(state.camera);
    if(p.z>1)continue;
    const px=(p.x+1)*host.width/2,py=(1-p.y)*host.height/2;
    const d=Math.hypot(px-x,py-y);
    if(d<dist){dist=d;best=n;}
  }
  return dist<110?best:null;
}
async function toggleGestures() {
  if(state.stream){stopGestures();return;}
  if(!navigator.mediaDevices?.getUserMedia) {
    respond('Este navegador não permite câmera aqui. Use HTTPS ou localhost.');return;
  }
  setStatus('Iniciando câmera…');
  try {
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:640,height:480},audio:false});
    state.stream=stream;
    const video=$('#camera-feed');video.srcObject=stream;video.hidden=false;
    await video.play();
    const mp=await import('../vendor/vision_bundle.mjs');
    const vision=await mp.FilesetResolver.forVisionTasks('/vendor/wasm');
    const options=(delegate)=>({baseOptions:{modelAssetPath:'/vendor/hand_landmarker.task',delegate},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.6});
    try {state.landmark=await mp.HandLandmarker.createFromOptions(vision,options('GPU'));}
    catch {state.landmark=await mp.HandLandmarker.createFromOptions(vision,options('CPU'));}
    state.gestureEngine=createGestureEngine({
      bounds:()=>$('#scene-wrap').getBoundingClientRect(),
      onStart:beginAirGesture,onMove:moveAirGesture,onEnd:endAirGesture,
      onDouble:twoHandGesture,onPeace:()=>resetScene(true),onCursor:showGestureCursor
    });
    $('#btn-gestures').textContent='✋ Desativar gestos';
    setStatus('Gestos: pinça para pegar · duas mãos para ampliar/girar · ✌ para restaurar');
    requestAnimationFrame(trackHands);
  }catch(err) {
    stopGestures();
    respond('A câmera ou o rastreamento não pôde ser iniciado: '+(err?.message||'erro desconhecido')+'. O mouse continua disponível.');
  }
}
function stopGestures() {
  if(state.landmark){try{state.landmark.close();}catch{}state.landmark=null;}
  if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}
  const video=$('#camera-feed');video.hidden=true;video.srcObject=null;
  $('#gesture-pointer').hidden=true;$('#btn-gestures').textContent='✋ Ativar gestos';
  state.gestureEngine?.reset();state.gestureEngine=null;state.gestureGrab=null;
  $('.app').classList.remove('is-grabbing');
  setStatus('Câmera desligada');
}
// Acoes espaciais do mapa, acionadas pelo motor de gestos adaptado do original.
function showGestureCursor(position,pinching) {
  const cursor=$('#gesture-pointer');
  cursor.hidden=!position;
  if(!position)return;
  cursor.style.left=position.x+'px';cursor.style.top=position.y+'px';
  cursor.style.borderColor=pinching?'#ffd083':'#8cffc4';
}
function beginAirGesture(hand,point) {
  if(state.gestureGrab)return;
  const node=closestArea(point.x,point.y);
  let offset={x:0,y:0};
  if(node) {
    const b=$('#scene-wrap').getBoundingClientRect(),p=node.mesh.getWorldPosition(new THREE.Vector3()).project(state.camera);
    offset={x:(p.x+1)*b.width/2-point.x,y:(1-p.y)*b.height/2-point.y};
  }
  state.gestureGrab={hand,node,offset,previous:{...point}};
  $('.app').classList.add('is-grabbing');
}
function moveAirGesture(hand,point) {
  const grab=state.gestureGrab;
  if(!grab||grab.hand!==hand)return;
  const dx=point.x-grab.previous.x,dy=point.y-grab.previous.y;
  if(Math.hypot(dx,dy)<2)return;
  grab.previous={...point};
  if(!grab.node) {
    state.rotY+=dx*.005;
    state.rotX=Math.max(-.5,Math.min(.5,state.rotX+dy*.003));
    return;
  }
  // Projetar o dedo no plano 3D atual, sem deslocar subitamente o objeto ao pega-lo.
  const node=grab.node,b=$('#scene-wrap').getBoundingClientRect();
  const camera=state.camera,group=state.group;
  camera.updateMatrixWorld(true);group.updateMatrixWorld(true);
  const worldZ=node.mesh.getWorldPosition(new THREE.Vector3()).z;
  const px=point.x+grab.offset.x,py=point.y+grab.offset.y;
  const ray=new THREE.Vector3(2*px/b.width-1,1-2*py/b.height,.5).unproject(camera);
  const direction=ray.sub(camera.position).normalize();
  if(Math.abs(direction.z)<.001)return;
  const depth=(worldZ-camera.position.z)/direction.z;
  if(depth<=0)return;
  const local=group.worldToLocal(camera.position.clone().addScaledVector(direction,depth));
  if(!Number.isFinite(local.x)||!Number.isFinite(local.y))return;
  node.mesh.position.set(Math.max(-4.5,Math.min(4.5,local.x)),Math.max(-3.2,Math.min(3.2,local.y)),local.z);
  node.halo.position.copy(node.mesh.position);
  node.name.position.copy(node.mesh.position);node.name.position.y-=.98;
}
function endAirGesture(hand,point,details) {
  const grab=state.gestureGrab;
  if(!grab||grab.hand!==hand)return;
  if(!details.cancelled&&grab.node&&details.elapsed<450&&details.movement<60)selectArea(grab.node.id,true);
  state.gestureGrab=null;
  $('.app').classList.remove('is-grabbing');
}
function twoHandGesture({scale,rotation}) {
  const grab=state.gestureGrab;
  if(grab?.node) {
    const node=grab.node;
    node.userScale=Math.max(.55,Math.min(2.3,(node.userScale||1)*scale));
    node.mesh.rotation.y+=rotation*1.6;
    // Esticar aproxima no eixo Z; comprimir afasta. Outro objeto permanece em seu plano.
    node.mesh.position.z=Math.max(-1.8,Math.min(2,node.mesh.position.z+(scale-1)*3));
    node.halo.position.copy(node.mesh.position);
    node.name.position.copy(node.mesh.position);node.name.position.y-=.98;
    node.halo.scale.setScalar(node.userScale);
    selectArea(state.area);
  }else {
    state.zoom=Math.max(.65,Math.min(1.85,state.zoom*scale));
    state.rotZ=Math.max(-.75,Math.min(.75,state.rotZ+rotation));
  }
}
function resetScene(announce=false) {
  state.rotX=0;state.rotY=0;state.rotZ=0;state.zoom=1;
  state.gestureGrab=null;
  $('.app').classList.remove('is-grabbing');
  for(const node of state.nodes) {
    node.mesh.position.copy(node.home);
    node.mesh.rotation.set(0,0,0);
    node.halo.position.copy(node.home);node.halo.scale.setScalar(1);
    node.name.position.copy(node.home);node.name.position.y-=.98;
    node.userScale=1;
  }
  selectArea('geral',announce);
}
function trackHands(t) {
  if(!state.landmark||!state.stream)return;
  if(t-state.lastFrame>=90&&$('#camera-feed').readyState>=2) {
    state.lastFrame=t;
    try {
      const result=state.landmark.detectForVideo($('#camera-feed'),t);
      state.gestureEngine?.update(result.landmarks||[],t);
    }catch(err){console.warn('Falha no rastreamento',err);}
  }
  requestAnimationFrame(trackHands);
}

window.addEventListener('pagehide',stopGestures);
setupNavigation();
initScene();
