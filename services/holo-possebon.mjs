// Integração HOLO -> POSSEBON Brain: somente HTTPS, somente leitura.
// Nunca chama /brain/sync, /brain/feedback, endpoints SQL, nem altera o MAD Builder.
import {mkdir,readFile,writeFile,appendFile,rename,rm,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DEFAULT_BASE='https://app.possebon.com.br:19302';
const namespaces=['rule','schema','model','permission','process','import_catalog','code'];
const wait=ms=>new Promise(ok=>setTimeout(ok,ms));
const short=(v,max)=>String(v??'').slice(0,max);
const json=v=>JSON.stringify(v);
const authError='A sessão POSSEBON expirou ou foi recusada. Conecte novamente.';
function targetUrl(){
  const base=new URL((process.env.HOLO_POSSEBON_URL||DEFAULT_BASE).trim());
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash ||
     base.pathname!=='/' && base.pathname!=='')throw Error('Use HOLO_POSSEBON_URL com HTTPS e endereço base, sem caminho ou credenciais.');
  return base.origin;
}
export function createHoloPossebon({localDir,fetchImpl=fetch}){
  let session=null;
  let task=null;
  let progress={running:false,done:false,phase:'desconectado',count:0,expected:0,namespace:'',error:null};
  let cached={ready:false,count:0,unitId:null,userId:null,completedAt:null,byNamespace:{}};
  const folder=path.join(localDir,'conhecimento-possebon');
  const key=()=>session ? 'user-'+session.userId+'-unit-'+session.unitId : '';
  const cachePath=()=>path.join(folder,key()+'.jsonl');
  const metaPath=()=>path.join(folder,key()+'.meta.json');
  const remote=targetUrl();

  function publicStatus(){
    if(session && Date.now()>=session.expiresAt && !task)clearSession();
    return {ok:true,connected:!!session,unit_id:session?.unitId||null,user_name:session?.userName||null,
      expires_at:session?.expiresAt||null,remote,progress:{...progress},knowledge:{...cached}};
  }
  function clearSession(){
    session=null;
    cached={ready:false,count:0,unitId:null,userId:null,completedAt:null,byNamespace:{}};
    if(!task)progress={running:false,done:false,phase:'desconectado',count:0,expected:0,namespace:'',error:null};
  }
  async function remoteJson(route,{method='GET',payload,token,timeout=20000}={}){
    const response=await fetchImpl(remote+route,{
      method,headers:{'Accept':'application/json',...(payload?{'Content-Type':'application/json'}:{}),
        ...(token?{'Authorization':'Bearer '+token}:{})},
      ...(payload?{body:json(payload)}:{}),
      signal:AbortSignal.timeout(timeout)
    });
    let data;
    try{data=await response.json();}catch{throw Error('A API POSSEBON não retornou JSON (HTTP '+response.status+').');}
    if(!response.ok||data?.status==='error'){
      const safeStatus=response.status===401?'Acesso recusado (401).':response.status===403?'Acesso sem permissão (403).':
        'HTTP '+response.status+'.';
      const reason=short(data?.error||safeStatus,200);
      const err=new Error(reason);
      err.httpStatus=response.status;
      throw err;
    }
    return data?.data||{};
  }
  async function loadExisting(){
    cached={ready:false,count:0,unitId:session?.unitId||null,userId:session?.userId||null,completedAt:null,byNamespace:{}};
    try{
      const meta=JSON.parse(await readFile(metaPath(),'utf8'));
      if(meta.unitId===session.unitId && meta.userId===session.userId && meta.ready===true){
        await stat(cachePath());
        cached={ready:true,count:meta.count||0,unitId:meta.unitId,userId:meta.userId,
          completedAt:meta.completedAt||null,byNamespace:meta.byNamespace||{}};
      }
    }catch{}
  }
  async function login(payload){
    if(task)throw Error('Aguarde o estudo atual terminar antes de trocar de unidade.');
    const login=short(payload?.login,201).trim();
    const password=String(payload?.password||'');
    const unitId=Number(payload?.unit_id)||0;
    if(!login||login.length>200||!password||password.length>1024||!Number.isSafeInteger(unitId)||unitId<0)
      throw Error('Informe usuário, senha e, quando necessário, uma unidade válida.');
    // A senha nunca é armazenada. Enviada somente ao destino HTTPS configurado.
    const response=await remoteJson('/api/app/holo/autenticar',
      {method:'POST',payload:{login,password,...(unitId?{unit_id:unitId}:{})},timeout:15000});
    if(response.requires_unit_selection){
      return {ok:true,requires_unit_selection:true,units:(response.units||[]).map(u=>({id:u.id,name:u.name}))};
    }
    if(!response.access_token||!response.unit_id)throw Error('A API POSSEBON não devolveu uma sessão válida.');
    // Em memória APENAS. NÃO gravar JWT, login ou senha em JSON/arquivos.
    session={token:response.access_token,unitId:Number(response.unit_id),
      userId:parseUserId(response.access_token),userName:short(response.user_name,160),
      expiresAt:Date.now()+Math.max(1,Number(response.expires_in||1800))*1000};
    if(!session.userId){clearSession();throw Error('Sessão recebida sem identificação de usuário.');}
    await mkdir(folder,{recursive:true,mode:0o700});
    await loadExisting();
    progress={running:false,done:false,phase:'conectado',count:cached.count,expected:0,namespace:'',error:null};
    return {ok:true,connected:true,unit_id:session.unitId,user_name:session.userName,expires_at:session.expiresAt,
      knowledge:{...cached}};
  }
  // Decodifica somente o ID para nomear o cache. A autenticação real é verificada no servidor POSSEBON.
  function parseUserId(token){
    try{const p=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
      const n=Number(p.userid);return Number.isSafeInteger(n)&&n>0?n:0;
    }catch{return 0;}
  }
  function checkSession(){
    if(!session || Date.now()>=session.expiresAt){clearSession();throw Error(authError);}
    return session;
  }
  async function doStudy(){
    const current=checkSession();
    const clientKey=key();
    const temporary=path.join(folder,clientKey+'.building.jsonl');
    const final=cachePath();
    let completed=false;
    try{
      const status=await remoteJson('/api/app/holo/brain/status',{token:current.token});
      const counts=Object.fromEntries((status.namespaces||[]).map(n=>[n.namespace,Number(n.active_count)||0]));
      progress.expected=Object.values(counts).reduce((a,b)=>a+b,0);
      progress.phase='estudando';progress.namespace='';
      // O catálogo existente fica intacto até que o estudo completo termine.
      await writeFile(temporary,'',{mode:0o600});
      const byNamespace={};
      // Primeiro as fontes principais, depois qualquer outro namespace encontrado.
      const toRead=[...new Set([...namespaces,...Object.keys(counts)])].filter(ns=>/^[a-z0-9_-]{1,50}$/i.test(ns));
      for(const ns of toRead){
        if(!counts[ns])continue;
        if(session!==current)throw Error('Sessão alterada: estudo interrompido.');
        progress.namespace=ns;
        let cursor=0, total=0, pages=0;
        while(true){
          checkSession();
          const url='/api/app/holo/brain/itens?namespace='+encodeURIComponent(ns)+
             '&after_id='+cursor+'&snapshot_max_id='+encodeURIComponent(status.snapshot_max_id)+'&limit=30';
          const response=await remoteJson(url,{token:current.token,timeout:30000});
          const items=Array.isArray(response.items)?response.items:[];
          if(items.length){
            const rows=items.map(item=>json({
              id:item.id,unit_id:item.unit_id,namespace:ns,
              title:short(item.title,300),knowledge_key:short(item.knowledge_key,300),
              content:short(item.content,16000),source_ref:short(item.source_ref,300),
              source_type:short(item.source_type,100),authority:Number(item.authority)||0,
              last_seen_at:item.last_seen_at||null
            })).join('\n')+'\n';
            await appendFile(temporary,rows,{encoding:'utf8',mode:0o600});
          }
          total+=items.length;progress.count+=items.length;
          const next=Number(response.next_after_id)||cursor;
          if(next<=cursor || !response.has_more)break;
          cursor=next;
          if(++pages>4000)throw Error('Limite de paginação de segurança atingido.');
          // Consultas pequenas, sequenciais e espaçadas: reduz impacto sobre o MAD Builder.
          await wait(240);
        }
        byNamespace[ns]=total;
      }
      // Não promover snapshot parcial como conhecimento completo.
      const finished={ready:true,count:progress.count,byNamespace,userId:current.userId,
        unitId:current.unitId,completedAt:new Date().toISOString(),snapshotMaxId:status.snapshot_max_id,
        lastSync:status.last_sync?.finalizado_em||null};
      await rename(temporary,final);
      await writeFile(metaPath(),json(finished),{mode:0o600});
      cached={...finished};
      progress.phase='concluido';progress.done=true;completed=true;
    }catch(err){
      progress.phase='erro';progress.error=short(err?.message||'Erro de sincronização',220);
      if(!completed)await rm(temporary,{force:true}).catch(()=>{});
    }finally{progress.running=false;task=null;}
  }
  async function startStudy(){
    checkSession();
    if(task)return {ok:true,started:false,progress:{...progress}};
    progress={running:true,done:false,phase:'iniciando',count:0,expected:0,namespace:'',error:null};
    task=doStudy();
    return {ok:true,started:true,progress:{...progress}};
  }
  async function findEvidence(question){
    if(!session||!cached.ready||Date.now()>=session.expiresAt)return [];
    const normalized=short(question,1200).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const summaryQuery=/(o que (voce )?(aprendeu|conhece|estudou)|resum[ao]|quais regras|conhecimento (do|sobre)|sobre (o )?possebon)/.test(normalized);
    const words=[...new Set(normalized.match(/[a-z0-9_]{4,}/g)||[])].filter(w=>!new Set([
        'para','sobre','como','quais','porque','entao','essa','esse','aqui','dessa','voce','hoje',
        'mais','mostre','mostrar','abrir','quero','preciso','possebon','holo','sistema'
      ]).has(w)).slice(0,16);
    if(!words.length && !summaryQuery)return [];
    const results=[];
    const input=readline.createInterface({input:createReadStream(cachePath(),{encoding:'utf8'}),crlfDelay:Infinity});
    for await(const line of input){
      let item;
      try{item=JSON.parse(line);}catch{continue;}
      const title=(item.title+' '+item.knowledge_key).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const body=String(item.content||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const score=words.reduce((n,w)=>n+(title.includes(w)?8:0)+(body.includes(w)?1:0),0)+
        (summaryQuery && item.namespace==='rule'?20:0);
      if(score>0){
        results.push({score,item});
        results.sort((a,b)=>b.score-a.score);
        if(results.length>10)results.pop();
      }
    }
    return results.slice(0,7).map(x=>x.item);
  }

  // Visão baseada SOMENTE nos títulos/fontes do Brain, nunca em contagens operacionais.
  async function overview(){
    checkSession();
    const groups={
      geral:{title:'Visão geral',keywords:[]},
      pessoas:{title:'Pessoas',keywords:['pessoa','colaborador','equipe','funcao','treinamento','candidato','rh','admissao','cracha']},
      compras:{title:'Compras',keywords:['compra','procurement','material','fornecedor','solicitacao','pedido','estoque','totvs','importacao']},
      seguranca:{title:'Segurança',keywords:['seguranca','auditoria','ronda','audicomp','epi','acao','plano','risco','incidente']},
      operacoes:{title:'Operações',keywords:['rdo','operacao','obra','projeto','transporte','rota','producao','atividade','equipe','contrato']}
    };
    const result={source:'POSSEBON Brain',unit_id:session.unitId,operationalConnected:false,
      ready:cached.ready,total:cached.count,completedAt:cached.completedAt,
      namespaces:{...cached.byNamespace},areas:{}};
    for(const [key,def] of Object.entries(groups)){
      result.areas[key]={id:key,title:def.title,count:0,namespaces:{},examples:[]};
    }
    if(!cached.ready)return result;
    const input=readline.createInterface({input:createReadStream(cachePath(),{encoding:'utf8'}),crlfDelay:Infinity});
    for await(const line of input){
      let item;try{item=JSON.parse(line);}catch{continue;}
      const label=short([item.title,item.knowledge_key,item.source_ref].join(' '),1000)
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      const matched=['geral',...Object.entries(groups).filter(([id,def])=>
        id!=='geral' && def.keywords.some(term=>label.includes(term))).map(([id])=>id)];
      for(const id of matched){
        const area=result.areas[id];area.count++;
        const ns=short(item.namespace,50)||'outros';
        area.namespaces[ns]=(area.namespaces[ns]||0)+1;
        if(area.examples.length<6&&item.title){
          area.examples.push({title:short(item.title,120),namespace:ns,
            source:short(item.source_ref||item.source_type,90)});
        }
      }
    }
    return result;
  }

  // Métrica operacional sob demanda. Não é extraída do Brain nem salva em cache.
  async function activeCollaborators(){
    const current=checkSession();
    const metric=await remoteJson('/api/app/holo/operacional/colaboradores/ativos',{
      token:current.token,timeout:15000
    });
    if(Number(metric.unit_id)!==current.unitId ||
       !Number.isSafeInteger(Number(metric.pessoas_ativas)) ||
       Number(metric.pessoas_ativas)<0 ||
       metric.fonte!=='possebon_app.colaborador' ||
       !/^\d{4}-\d{2}-\d{2}$/.test(String(metric.data_referencia))){
      throw Error('A API devolveu uma métrica incompatível com a unidade ou fonte autenticada.');
    }
    return {
      unit_id:current.unitId, data_referencia:metric.data_referencia,
      pessoas_ativas:Number(metric.pessoas_ativas),
      vinculos_ativos:Number(metric.vinculos_ativos)||0,
      fonte:metric.fonte, filtros:Array.isArray(metric.filtros)?metric.filtros:[],
      readOnly:true
    };
  }

  async function handle(req,res,url,send,readBody){
    if(!url.pathname.startsWith('/api/possebon/'))return false;
    function bad(e){
      const status=e.httpStatus===401||/sessão|sessao|expirou|recusad/i.test(e.message)?401:
        e.httpStatus===403?403:502;
      send(res,status,{ok:false,error:short(e.message,240)});
    }
    try{
      if(req.method==='GET'&&url.pathname==='/api/possebon/status'){send(res,200,publicStatus());return true;}
      if(req.method==='GET'&&url.pathname==='/api/possebon/overview'){send(res,200,{ok:true,...await overview()});return true;}
      if(req.method==='GET'&&url.pathname==='/api/possebon/operacional/colaboradores/ativos'){send(res,200,{ok:true,...await activeCollaborators()});return true;}
      if(req.method==='POST'&&url.pathname==='/api/possebon/login'){
        const input=await readBody(req);send(res,200,await login(input));return true;
      }
      if(req.method==='POST'&&url.pathname==='/api/possebon/logout'){
        if(task)throw Error('Aguarde o estudo terminar para sair.');
        clearSession();send(res,200,{ok:true});return true;
      }
      if(req.method==='POST'&&url.pathname==='/api/possebon/study'){
        send(res,200,await startStudy());return true;
      }
      send(res,404,{ok:false,error:'Rota HOLO/POSSEBON inexistente.'});return true;
    }catch(e){bad(e);return true;}
  }
  return {handle,findEvidence,status:publicStatus,activeCollaborators,knowledgeOverview:overview};
}
