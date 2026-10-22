// Teste de onboarding sem internet, credenciais reais ou banco POSSEBON.
// Simula estritamente as respostas da API, validando escopo e cache local.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHoloPossebon} from '../services/holo-possebon.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'holo-possebon-test-'));
let tokenCalls=0;
const fakeJwt=(id,unitId)=>'e30.'+Buffer.from(JSON.stringify({userid:id,unit_id:unitId})).toString('base64url')+'.simulado';
const fakeFetch=async(uri,opts)=>{
  const u=new URL(uri);
  assert.equal(u.protocol,'https:');
  assert.ok(u.pathname.startsWith('/api/app/holo/'));
  const input=opts.body?JSON.parse(opts.body):null;
  let response;
  if(u.pathname.endsWith('/autenticar')){
    assert.equal(opts.method,'POST');
    assert.equal(input.password,'segredo_apenas_para_teste');
    if(!input.unit_id) response={requires_unit_selection:true,units:[{id:3,name:'EPC13'},{id:4,name:'Outra unidade'}]};
    else response={access_token:fakeJwt(21,input.unit_id),unit_id:input.unit_id,user_name:'Usuario Teste',expires_in:1800,
      can_manage_ai:input.login!=='usuario_comum'};
  }else if(u.pathname.endsWith('/operacional/colaboradores/ativos')){
    assert.ok(opts.headers.Authorization.startsWith('Bearer '));
    const tokenPayload=JSON.parse(Buffer.from(opts.headers.Authorization.slice(7).split('.')[1],'base64url').toString('utf8'));
    assert.equal(tokenPayload.userid,21);
    const unit=u.searchParams.get('unit_id');
    assert.equal(unit,null,'A unidade não pode ser passada na query');
    const tokenUnit=JSON.parse(Buffer.from(opts.headers.Authorization.slice(7).split('.')[1],'base64url').toString('utf8')).unit_id;
    response={unit_id:tokenUnit||3,pessoas_ativas:tokenUnit===4?7:17,
      vinculos_ativos:tokenUnit===4?8:18,data_referencia:'2026-10-21',
      fonte:'possebon_app.colaborador',filtros:['status=A']};
  }else if(u.pathname.endsWith('/brain/status')){
    assert.ok(opts.headers.Authorization.startsWith('Bearer '));
    tokenCalls++;
    response={unit_id:3,snapshot_max_id:2,namespaces:[{namespace:'rule',active_count:1},{namespace:'schema',active_count:1}],last_sync:null};
  }else if(u.pathname.endsWith('/brain/itens')){
    const ns=u.searchParams.get('namespace');
    response={items:ns==='rule'?
      [{id:1,namespace:'rule',knowledge_key:'regra_rdo',title:'Regra do RDO',
        content:'A visibilidade do Meu RDO exige grupo 20.',source_ref:'curadoria',authority:100,unit_id:null}]:
      ns==='schema'?
      [{id:2,namespace:'schema',knowledge_key:'rdo',title:'Tabela rdo',
        content:'Estrutura do modulo RDO.',source_ref:'schema',authority:80,unit_id:null}]:[],
      next_after_id:ns==='rule'?1:2,has_more:false,snapshot_max_id:2};
  }else throw Error('Chamada inesperada: '+u.pathname);
  return new Response(JSON.stringify({status:'success',data:response}),{
    status:200,headers:{'Content-Type':'application/json'}});
};
const bridge=createHoloPossebon({localDir:temp,fetchImpl:fakeFetch});
async function call(route,payload){
  let result,code;
  await bridge.handle({method:['/api/possebon/status','/api/possebon/overview','/api/possebon/operacional/colaboradores/ativos'].includes(route)?'GET':'POST'}, {}, new URL(route,'http://127.0.0.1:4891'),
    (_res,status,obj)=>{code=status;result=obj;},async()=>payload);
  assert.equal(code,200,result?.error||'HTTP '+code);
  return result;
}
async function settled(){
  for(let i=0;i<60;i++){
    if(!bridge.status().progress.running)return;
    await new Promise(ok=>setTimeout(ok,30));
  }
  throw Error('Estudo não terminou');
}
try{
  assert.deepEqual(await bridge.findEvidence('RDO'),[]);
  const units=await call('/api/possebon/login',{login:'teste',password:'segredo_apenas_para_teste'});
  assert.equal(units.requires_unit_selection,true);
  assert.equal(bridge.status().connected,false);
  const first=await call('/api/possebon/login',{login:'teste',password:'segredo_apenas_para_teste',unit_id:3});
  assert.equal(first.connected,true);
  assert.equal(bridge.status().unit_id,3);
  const live=await call('/api/possebon/operacional/colaboradores/ativos',{});
  assert.equal(live.pessoas_ativas,17);
  assert.equal(live.vinculos_ativos,18);
  assert.equal(live.unit_id,3);
  assert.equal(live.fonte,'possebon_app.colaborador');
  assert.equal(bridge.status().knowledge.ready,false);
  await call('/api/possebon/study',{});
  await settled();
  assert.equal(bridge.status().knowledge.ready,true);
  assert.equal(bridge.status().knowledge.count,2);
  const overview=await call('/api/possebon/overview',{});
  assert.equal(overview.total,2);
  assert.equal(overview.areas.geral.count,2);
  assert.equal(overview.areas.operacoes.count,2,'Regra e schema RDO associados a Operações pela fonte real');
  assert.equal(overview.operationalConnected,false,'O catálogo não é métrica operacional');
  assert.ok((await bridge.findEvidence('regra do RDO')).some(x=>x.title==='Regra do RDO'));
  const filepath=path.join(temp,'conhecimento-possebon','user-21-unit-3.jsonl');
  const saved=await readFile(filepath,'utf8');
  assert.match(saved,/Regra do RDO/);
  assert.doesNotMatch(saved,/segredo_apenas_para_teste/);
  assert.doesNotMatch(saved,/simulado/);
  assert.ok(tokenCalls>=1);
  await call('/api/possebon/logout',{});
  assert.equal(bridge.status().connected,false);
  assert.deepEqual(await bridge.findEvidence('regra do RDO'),[]);
  const next=await call('/api/possebon/login',{login:'teste',password:'segredo_apenas_para_teste',unit_id:4});
  assert.equal(next.connected,true);
  const liveOther=await call('/api/possebon/operacional/colaboradores/ativos',{});
  assert.equal(liveOther.unit_id,4);
  assert.equal(liveOther.pessoas_ativas,7,'Unidade 4 não herda contagem da EPC13');
  assert.equal(bridge.status().knowledge.ready,false,'Outra unidade não herda índice EPC13');
  assert.deepEqual(await bridge.findEvidence('RDO'),[]);
  await call('/api/possebon/logout',{});
  await call('/api/possebon/login',{login:'teste',password:'segredo_apenas_para_teste',unit_id:3});
  assert.equal(bridge.status().knowledge.ready,true,'Reutiliza cache seguro da mesma unidade');
  await call('/api/possebon/logout',{});
  await call('/api/possebon/login',{login:'usuario_comum',password:'segredo_apenas_para_teste',unit_id:3});
  assert.equal(bridge.status().can_manage_ai,false);
  assert.deepEqual(await bridge.findEvidence('Regra do RDO'),[],
    'Usuário sem permissão não recebe trechos de código ou regras, mesmo que cache exista');
  for(const route of ['/api/possebon/study','/api/possebon/overview']){
    let code;
    await bridge.handle({method:route.endsWith('study')?'POST':'GET'}, {},
      new URL(route,'http://127.0.0.1:4891'),(_res,status)=>{code=status;},async()=>({}));
    assert.equal(code,403,'Brain administrativo deve ficar protegido: '+route);
  }

  console.log('HOLO Brain: login por unidade, estudo, leitura e cache isolado OK');
}finally{await rm(temp,{recursive:true,force:true});}
