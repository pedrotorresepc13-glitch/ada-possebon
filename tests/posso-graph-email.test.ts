import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setup, type Harness, type Client } from './helpers.ts';

const TENANT='b047f728-7449-4db8-8128-8e25ce6d7f7d';
const CLIENT='8e78e1c8-1db1-4893-abd6-d667c22c7b35';
const INSTITUTIONAL='consorcioepc13@consorcioepc13.com.br';
const PERSONAL='posso@consorcioepc13.com.br';

describe('POSSO: Microsoft 365 em duas caixas com identidade e autorização independentes',()=>{
  let h:Harness;
  let admin:Client;
  let manager:Client;
  let stranger:Client;
  const calls:{url:string;method:string;body:string}[]=[];
  beforeAll(async()=>{
    vi.stubEnv('POSSO_GRAPH_CLIENT_ID',CLIENT);
    vi.stubEnv('POSSO_GRAPH_CLIENT_SECRET','test-application-credential');
    h=await setup();
    admin=await h.login('admin.demo',1);
    manager=await h.login('gerente.a',1);
    stranger=await h.login('gerente.b',2);
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);
      const method=init?.method??'GET';
      const body=String(init?.body??'');
      calls.push({url,method,body});
      if(url.startsWith('https://login.microsoftonline.com/'))return Response.json({
        access_token:'opaque-access-token',token_type:'Bearer',expires_in:3600
      });
      if(url.includes('/sendMail'))return new Response(null,{status:202});
      if(url.includes('/mailFolders/inbox/messages/delta')){
        const next=new URL(url);next.search='?$deltatoken=fixture-1';
        return Response.json({
          value:[{
            id:'msg-epc13-01',subject:'Solicitação Petrobras — confirmação técnica',
            bodyPreview:'Favor confirmar a programação da inspeção.',
            body:{contentType:'text',content:'Solicitamos confirmar a programação da inspeção de amanhã.'},
            from:{emailAddress:{address:'contato@petrobras.com.br'}},
            receivedDateTime:'2026-11-17T10:00:00Z',
            conversationId:'conv-01'
          }],
          '@odata.deltaLink':next.href
        });
      }
      if(url.includes('/messages?')){
        const phrase=new URL(url).searchParams.get('$search')??'';
        const old=phrase.includes('hist');
        return Response.json({value:[old?{
          id:'sent-2019',subject:'Histórico da correspondência com a Petrobras',
          bodyPreview:'Encaminhamos o relatório da inspeção.',
          body:{contentType:'text',content:'Prezados, segue o relatório da inspeção concluída.'},
          from:{emailAddress:{address:INSTITUTIONAL}},
          receivedDateTime:'2019-09-10T13:00:00Z',conversationId:'historic-01'
        }:{
          id:'msg-epc13-01',subject:'Solicitação Petrobras — confirmação técnica',
          bodyPreview:'Favor confirmar a programação da inspeção.',
          body:{contentType:'text',content:'Solicitamos confirmar a programação da inspeção de amanhã.'},
          from:{emailAddress:{address:'contato@petrobras.com.br'}},
          receivedDateTime:'2026-11-17T10:00:00Z',conversationId:'conv-01'
        }]});
      }
      if(url.includes('/mailFolders/inbox'))return Response.json({id:'inbox',displayName:'Caixa de Entrada'});
      return Response.json({error:{code:'not_found'}},{status:404});
    }));
  });
  afterAll(async()=>{await h.close();vi.unstubAllGlobals();vi.unstubAllEnvs();});
  afterEach(()=>{calls.splice(0);});

  it('cadastra duas caixas sem senha pessoal, testa acesso e lê e-mails na unidade correta',async()=>{
    const register=async(mailbox:string,purpose:'institutional'|'posso')=>admin.post('/admin/email/accounts',{
      kind:'email_graph',label:purpose==='posso'?'E-mail do POSSO':'Correspondência EPC13 / Petrobras',
      unit_id:1,allowed_user_ids:[9001,9002],allowed_group_ids:[],
      config:{auth_mode:'app_only',graph_sync:true,mailbox,purpose,tenant:TENANT}
    });
    const first=await register(INSTITUTIONAL,'institutional');
    const second=await register(PERSONAL,'posso');
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.json).toMatchObject({hasSecret:false,sendingEnabled:false,config:{mailbox:INSTITUTIONAL,purpose:'institutional'}});
    expect(second.json).toMatchObject({config:{mailbox:PERSONAL,purpose:'posso'}});
    const accountId=first.json.id as string;
    const test=await admin.post('/admin/email/accounts/'+accountId+'/test',{});
    expect(test.json).toMatchObject({ok:true});
    const sync=await admin.post('/admin/email/accounts/'+accountId+'/sync',{});
    expect(sync.json).toMatchObject({synchronized:1,stored:1});
    const inbox=await manager.get('/email/accounts/'+accountId+'/messages');
    expect(inbox.status).toBe(200);
    expect(inbox.json.messages[0]).toMatchObject({
      subject:'Solicitação Petrobras — confirmação técnica',
      from:'contato@petrobras.com.br',
      body:'Solicitamos confirmar a programação da inspeção de amanhã.'
    });
    expect((await stranger.get('/email/accounts/'+accountId+'/messages')).status).toBe(404);
    const search=await manager.get('/email/search?q=programação');
    expect(search.json.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({accountId,subject:'Solicitação Petrobras — confirmação técnica'})
    ]));
    const historical=await manager.get('/email/search?q=histórico');
    expect(historical.json.historyLive).toBe(true);
    expect(historical.json.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({accountId,subject:'Histórico da correspondência com a Petrobras',
        from:INSTITUTIONAL})
    ]));
    expect(calls.some(c=>c.url.includes('/messages?')&&c.url.includes('%24search='))).toBe(true);
    const stored=await h.d.db.query('SELECT value FROM ada.app_setting WHERE key=$1',['mail:graph:'+accountId]);
    expect(JSON.stringify(stored.rows)).not.toContain('Solicitamos confirmar a programação');
    const login=calls.find(c=>c.url.startsWith('https://login.microsoftonline.com/'));
    expect(login?.body).toContain('grant_type=client_credentials');
    expect(login?.body).not.toContain('refresh_token');
    expect(calls.every(c=>!c.body.includes('senha-pessoal'))).toBe(true);
  });

  it('só envia após a ativação e confirmação expressas; não repete o mesmo rascunho',async()=>{
    const accounts=(await admin.get('/admin/email/accounts')).json as Array<{id:string;config:{mailbox:string}}>;
    const institution=accounts.find(a=>a.config.mailbox===INSTITUTIONAL)!;
    const draft=await manager.post('/email/drafts',{
      accountId:institution.id,to:['engenharia@petrobras.com.br'],
      subject:'Programação da inspeção',
      body:'Prezados, confirmamos a programação proposta. Atenciosamente, Consórcio EPC13.'
    });
    expect(draft.status).toBe(201);
    expect(draft.json).toMatchObject({status:'draft',requiresConfirmation:true});
    expect((await stranger.post('/email/drafts',{
      accountId:institution.id,to:['qualquer@exemplo.com'],subject:'Teste',body:'Mensagem'
    })).status).toBe(404);
    const draftId=draft.json.id;
    expect((await manager.post('/email/drafts/'+draftId+'/send',{confirm:true})).status).toBe(400);
    expect((await manager.post('/email/drafts/'+draftId+'/send',{confirm:false})).status).toBe(400);
    const enabled=await admin.post('/admin/email/accounts/'+institution.id+'/sending',{enabled:true});
    expect(enabled.json).toMatchObject({sendingEnabled:true});
    const sent=await manager.post('/email/drafts/'+draftId+'/send',{confirm:true});
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({status:'submitted',accepted:true});
    expect(sent.json.message).not.toMatch(/entregue ao destinatário/i);
    expect((await manager.post('/email/drafts/'+draftId+'/send',{confirm:true})).status).toBe(400);
    const actualSend=calls.filter(c=>c.url.includes('/sendMail'));
    expect(actualSend).toHaveLength(1);
    expect(actualSend[0]!.url).toContain(encodeURIComponent(INSTITUTIONAL));
    expect(JSON.parse(actualSend[0]!.body).message.toRecipients[0].emailAddress.address)
      .toBe('engenharia@petrobras.com.br');
    const state=await h.d.db.query<{body_enc:string;status:string}>(
      'SELECT body_enc,status FROM ada.email_draft WHERE id=$1',[draftId]);
    expect(state.rows[0]!.status).toBe('submitted');
    expect(state.rows[0]!.body_enc).toMatch(/^v1:/);
    expect(state.rows[0]!.body_enc).not.toContain('confirmamos a programação');
  });

  it('pode cadastrar caixa pendente e completar Tenant ID após retorno da TI',async()=>{
    const draft=await admin.post('/admin/email/accounts',{
      kind:'email_graph',label:'Caixa aguarda autorização',unit_id:1,allowed_user_ids:[9001],
      config:{auth_mode:'app_only',graph_sync:true,purpose:'posso',
        mailbox:'posso.auxiliar@consorcioepc13.com.br',tenant:''}
    });
    expect(draft.status).toBe(201);
    expect(draft.json.status).toBe('nao_configurado');
    const updated=await admin.patch('/admin/email/accounts/'+draft.json.id,{tenant:TENANT});
    expect(updated.status).toBe(200);
    expect(updated.json).toMatchObject({requiresAccessTest:true});
    const tested=await admin.post('/admin/email/accounts/'+draft.json.id+'/test',{});
    expect(tested.json.ok).toBe(true);
    const list=await admin.get('/admin/email/accounts');
    expect(list.json.some((row:{id:string;status:string})=>
      row.id===draft.json.id&&row.status==='ativo')).toBe(true);
  });
});
