// Painel de voz da assistente HOLO. Somente o serviço local fornece respostas reais.
import {areas,requestedNavigationId} from './demo.js';
const host=document.createElement('div');
host.id='holo-companion';
host.innerHTML=[
'<button id="hc-launch" class="hc-launch" type="button" aria-expanded="false"><span class="hc-orb">✦</span><span>HOLO <small>Assistente</small></span></button>',
'<section id="hc-panel" class="hc-panel" hidden aria-label="Conversa com HOLO">',
'<header class="hc-header"><span class="hc-orb" id="hc-orb">✦</span><span><strong>HOLO · Assistente empresarial</strong><small id="hc-status">Verificando serviço local...</small></span><button id="hc-min" aria-label="Minimizar" type="button">−</button></header>',
'<div id="hc-feed" class="hc-feed" role="log" aria-live="polite"><p class="hc-line">Posso consultar o conhecimento catalogado no POSSEBON Brain da unidade autorizada e navegar pelo mapa. Pergunte sobre regras, módulos e processos.</p></div>',
'<form id="hc-form" class="hc-form"><input id="hc-input" maxlength="2000" placeholder="Pergunte sobre a empresa..." autocomplete="off" required aria-label="Digite sua pergunta"><button type="submit" id="hc-send" aria-label="Enviar">➜</button></form>',
'<div class="hc-tools"><button id="hc-mic" type="button">🎙 Falar</button><button id="hc-voice" type="button" aria-pressed="true">🔊 Voz ativa</button><button id="hc-auto" type="button" aria-pressed="false">↻ Contínua</button><button id="hc-docs" type="button">▣ Arquivos</button></div>',
'<p class="hc-foot" id="hc-foot">A voz do navegador pode utilizar serviços externos. Não compartilhe dados confidenciais sem verificar a configuração.</p>',
'</section>',
'<div id="hc-reader" class="hc-reader" hidden role="dialog" aria-label="Visualizador de arquivos"><div id="hc-reader-head" class="hc-reader-head"><strong id="hc-reader-title">Biblioteca</strong><button id="hc-reader-close" type="button" aria-label="Fechar">✕</button></div><div id="hc-reader-content" class="hc-reader-content"></div></div>'
].join('');
(document.querySelector('#holo-companion-slot')||document.body).append(host);
// O painel pertence à aba Conversar com HOLO, não fica sobrepondo o mapa.
host.classList.add('hc-docked');
host.querySelector('#hc-panel').hidden=false;
const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href='/studio/companion.css';document.head.append(sheet);
const $=id=>host.querySelector('#'+id);
let expanded=true,voice=true,continuous=false,recognition=null,busy=false,speaking=false,alive=false;
function line(s,who='assistant'){
  const p=document.createElement('p');p.className='hc-line '+(who==='user'?'hc-user':'hc-ai');p.textContent=String(s);
  $('hc-feed').append(p);$('hc-feed').scrollTop=$('hc-feed').scrollHeight;
}
const status=s=>$('hc-status').textContent=s;
function stopMic(){if(recognition){try{recognition.abort();}catch{}recognition=null;}}
function resumeMic(){if(continuous&&expanded&&alive&&!busy&&!speaking)setTimeout(listen,550);}
function say(message){
  if(!voice||!('speechSynthesis'in window))return resumeMic();
  stopMic();
  const utterance=new SpeechSynthesisUtterance(message);utterance.lang='pt-BR';utterance.rate=1;
  const choice=speechSynthesis.getVoices().find(v=>v.lang.toLowerCase()==='pt-br');if(choice)utterance.voice=choice;
  utterance.onstart=()=>{speaking=true;$('hc-orb').classList.add('speaking');$('hc-launch').classList.add('speaking');};
  utterance.onend=utterance.onerror=()=>{speaking=false;$('hc-orb').classList.remove('speaking');$('hc-launch').classList.remove('speaking');resumeMic();};
  speechSynthesis.cancel();speechSynthesis.speak(utterance);
}
async function json(url,options={}){
  const response=await fetch(url,{...options,headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(100000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'HTTP '+response.status);return data;
}
async function health(){
  try{
    const h=await json('/api/health');alive=true;
    status((h.provider==='api'?'API externa':'IA local')+' · '+(h.possebonKnowledgeCount?
      h.possebonKnowledgeCount+' itens do Brain':'Brain não estudado')+
      (h.ollamaConnected===false?' · Ollama desligado':''));
    $('hc-foot').textContent='Modelo: '+h.model+' · Memória: '+h.historyCount+' mensagens, '+h.notesCount+' notas. Voz depende do navegador.';
    const history=await json('/api/history');
    // Histórico completo fica fora da tela de consultas; respostas aparecem no quadro branco.
  }catch{alive=false;status('Servidor local indisponível');$('hc-foot').textContent='Abra o HOLO instalado no Windows para conectar a IA. A prévia na Vercel não executa modelos locais.';}
}
async function ask(message){
  message=message.trim();if(!message||busy)return;
  busy=true;stopMic();$('hc-send').disabled=true;line(message,'user');status('Pensando...');
  const navigation=requestedNavigationId(message);
  if(navigation){
    window.dispatchEvent(new CustomEvent('holo:navigate-area',{detail:{id:navigation}}));
    line('Abrindo '+(areas.find(a=>a.id===navigation)?.name||'área')+' no mapa holográfico.');
  }
  const area=navigation||document.querySelector('.area-button[aria-current="page"]')?.dataset.area||'geral';
  const demoMode=document.querySelector('#data-badge')?.textContent==='DADOS DEMONSTRATIVOS';
  try{
    const response=await json('/api/chat',{method:'POST',body:JSON.stringify({message,area,navigation,demoMode})});
    window.dispatchEvent(new CustomEvent('holo:answer',{detail:{
      question:message,answer:response.answer,sources:response.sources||[],visual:response.visual||null
    }}));
    line('Resposta organizada no quadro branco'+(response.visual?.type==='metrics'?' com indicadores verificados.':'.'));
    status('Consulta '+response.provider+' · '+(response.sources?.length?'Fonte identificada':'Sem fonte operacional'));
    busy=false;say(response.answer);
  }catch(e){line('Não consegui responder: '+e.message);status('IA indisponível');busy=false;resumeMic();}
  finally{$('hc-send').disabled=false;}
}
function listen(){
  if(!alive||busy||speaking||recognition)return;
  const Engine=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Engine){line('Reconhecimento de voz não disponível neste navegador. Use o campo de texto.');return;}
  const mic=new Engine();recognition=mic;mic.lang='pt-BR';mic.interimResults=false;mic.continuous=false;
  mic.onresult=e=>{const message=e.results?.[0]?.[0]?.transcript||'';recognition=null;void ask(message);};
  mic.onend=()=>{if(recognition===mic){recognition=null;if(continuous)resumeMic();}};
  mic.onerror=e=>{if(recognition===mic)recognition=null;status('Microfone: '+e.error);if(e.error==='not-allowed'){continuous=false;$('hc-auto').setAttribute('aria-pressed','false');}};
  try{mic.start();status('Escutando...');}catch{recognition=null;line('Falha ao iniciar microfone.');}
}
$('hc-launch').addEventListener('click',()=>{expanded=!expanded;$('hc-panel').hidden=!expanded;$('hc-launch').setAttribute('aria-expanded',String(expanded));if(expanded){$('hc-input').focus();void health();}else stopMic();});
$('hc-min').addEventListener('click',()=>window.dispatchEvent(new Event('holo:show-knowledge')));
$('hc-form').addEventListener('submit',e=>{e.preventDefault();const message=$('hc-input').value;$('hc-input').value='';void ask(message);});
$('hc-mic').addEventListener('click',()=>{if(recognition){stopMic();status('Microfone parado');}else listen();});
$('hc-voice').addEventListener('click',()=>{voice=!voice;$('hc-voice').setAttribute('aria-pressed',String(voice));$('hc-voice').textContent=voice?'🔊 Voz ativa':'🔇 Voz desligada';if(!voice&&'speechSynthesis'in window)speechSynthesis.cancel();});
$('hc-auto').addEventListener('click',()=>{continuous=!continuous;$('hc-auto').setAttribute('aria-pressed',String(continuous));if(continuous)listen();else stopMic();});
$('hc-reader-close').addEventListener('click',()=>{$('hc-reader').hidden=true;$('hc-reader-content').replaceChildren();});
const reader=(title)=>{$('hc-reader').hidden=false;$('hc-reader-title').textContent=title;$('hc-reader-content').replaceChildren();return $('hc-reader-content');};
function openFile(name){
  const area=reader(name),src='/api/document?name='+encodeURIComponent(name),ext=name.split('.').pop().toLowerCase();
  if(['pdf','png','jpg','jpeg'].includes(ext)){const frame=document.createElement('iframe');frame.src=src;frame.title=name;area.append(frame);}
  else fetch(src).then(r=>{if(!r.ok)throw Error('Arquivo indisponível');return r.text();}).then(t=>{const pre=document.createElement('pre');pre.textContent=t.slice(0,700000);area.append(pre);}).catch(e=>area.textContent=e.message);
}
$('hc-docs').addEventListener('click',async()=>{
  const area=reader('Biblioteca autorizada');
  try{
    const data=await json('/api/documents');
    if(!data.files?.length){area.textContent=data.configured?'Nenhum arquivo compatível encontrado.':'Defina HOLO_DOCUMENTOS_DIR no computador para autorizar uma pasta local. Não há acesso automático aos arquivos da POSSEBON.';return;}
    for(const f of data.files){const b=document.createElement('button');b.type='button';b.className='hc-file';b.textContent='▣ '+f.name;b.addEventListener('click',()=>openFile(f.name));area.append(b);}
  }catch(e){area.textContent='Biblioteca indisponível: '+e.message;}
});
// Janela flutuante móvel por mouse/toque. Gestos 3D nos arquivos ainda são uma etapa separada.
let drag=null;
$('hc-reader-head').addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const rect=$('hc-reader').getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};$('hc-reader-head').setPointerCapture(e.pointerId);});
$('hc-reader-head').addEventListener('pointermove',e=>{if(!drag)return;const pane=$('hc-reader');pane.style.left=Math.max(0,Math.min(innerWidth-120,drag.left+e.clientX-drag.x))+'px';pane.style.top=Math.max(0,Math.min(innerHeight-60,drag.top+e.clientY-drag.y))+'px';pane.style.right='auto';});
$('hc-reader-head').addEventListener('pointerup',()=>drag=null);
$('hc-reader-head').addEventListener('pointercancel',()=>drag=null);
window.addEventListener('holo:assistant-notice',event=>{
  const note=String(event.detail?.message||'').trim();if(note)line(note);
});
window.addEventListener('holo:ask',event=>{
  const message=String(event.detail?.message||'').trim();
  if(message){window.dispatchEvent(new Event('holo:chat-open'));void ask(message);}
});
window.addEventListener('holo:name-changed',event=>{
  const name=String(event.detail?.name||'HOLO');
  host.querySelector('.hc-header strong').textContent=name+' · Assistente empresarial';
  host.querySelector('#hc-launch span:nth-child(2)').firstChild.textContent=name+' ';
});
window.addEventListener('holo:auth-changed',event=>{
  if(!event.detail?.connected){
    stopMic();if('speechSynthesis'in window)speechSynthesis.cancel();
    $('hc-feed').replaceChildren();line('Entre com seu usuário POSSEBON para realizar consultas.');
  }else void health();
});
window.addEventListener('pagehide',()=>{stopMic();if('speechSynthesis'in window)speechSynthesis.cancel();});
void health();
