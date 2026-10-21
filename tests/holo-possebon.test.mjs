// Teste de onboarding sem internet, credenciais reais ou banco POSSEBON.
// Simula estritamente as respostas da API, validando escopo e cache local.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHoloPossebon} from '../services/holo-possebon.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'holo-possebon-test-'));
let tokenCalls=0;
const fakeJwt=(id)=>'e30.'+Buffer.from(JSON.stringify({userid:id})).toString('base64url')+'.simulado';
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
    else response={access_token:fakeJwt(21),unit_id:input.unit_id,user_name:'Usuario Teste',expires_in:1800};
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
  await bridge.handle({method:route==='/api/possebon/status'?'GET':'POST'}, {}, new URL(route,'http://127.0.0.1:4891'),
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
  assert.equal(bridge.status().knowledge.ready,false);
  await call('/api/possebon/study',{});
  await settled();
  assert.equal(bridge.status().knowledge.ready,true);
  assert.equal(bridge.status().knowledge.count,2);
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
  assert.equal(bridge.status().knowledge.ready,false,'Outra unidade não herda índice EPC13');
  assert.deepEqual(await bridge.findEvidence('RDO'),[]);
  await call('/api/possebon/logout',{});
  await call('/api/possebon/login',{login:'teste',password:'segredo_apenas_para_teste',unit_id:3});
  assert.equal(bridge.status().knowledge.ready,true,'Reutiliza cache seguro da mesma unidade');
  console.log('HOLO Brain: login por unidade, estudo, leitura e cache isolado OK');
}finally{await rm(temp,{recursive:true,force:true});}
