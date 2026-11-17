import { z } from 'zod';

const deltaEndpoint = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta';
const Message = z.object({
  id: z.string().min(1).max(1024),
  subject: z.string().nullish(),
  bodyPreview: z.string().nullish(),
  receivedDateTime: z.iso.datetime({ offset: true }).nullish(),
  '@removed': z.object({}).optional()
});
const Page = z.object({
  value: z.array(Message).max(1000),
  '@odata.nextLink': z.string().max(16000).optional(),
  '@odata.deltaLink': z.string().max(16000).optional()
});
const Token = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional() });
export type GraphMessage = z.infer<typeof Message>;

function deltaUrl(value: string): URL {
  const url = new URL(value);
  if (url.origin !== 'https://graph.microsoft.com' || url.username || url.password ||
      url.hash || !/^\/v1\.0\/me\/mailFolders\/[^/]+\/messages\/delta$/i.test(url.pathname)) {
    throw new Error('Cursor Microsoft Graph inválido.');
  }
  return url;
}

export async function graphMailPage(input: {
  tenant: string; clientId: string; clientSecret: string; refreshToken: string; cursor?: string
}, fetcher: typeof fetch = fetch) {
  if (!z.uuid().safeParse(input.tenant).success) throw new Error('Informe o identificador do tenant Microsoft.');
  const target = input.cursor ? deltaUrl(input.cursor) : new URL(deltaEndpoint);
  if (!input.cursor) target.searchParams.set('$select', 'id,subject,bodyPreview,receivedDateTime');
  const refresh = await fetcher(`https://login.microsoftonline.com/${input.tenant}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: input.clientId,
      client_secret: input.clientSecret, refresh_token: input.refreshToken, scope: 'https://graph.microsoft.com/Mail.Read' })
  });
  if (!refresh.ok) throw new Error(`Microsoft recusou a renovação da conta (HTTP ${refresh.status}).`);
  const token = Token.parse(await refresh.json());
  const response = await fetcher(target, {
    redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token.access_token}`, Prefer: 'odata.maxpagesize=50, IdType="ImmutableId"' }
  });
  if (!response.ok) throw new Error(`Microsoft Graph recusou a leitura da caixa (HTTP ${response.status}).`);
  const page = Page.parse(await response.json());
  const next = page['@odata.nextLink'] ?? page['@odata.deltaLink'];
  if (!next) throw new Error('Microsoft Graph não devolveu o ponto de retomada.');
  return { messages: page.value, cursor: deltaUrl(next).href, refreshToken: token.refresh_token ?? input.refreshToken };
}


/** Microsoft 365 app-only: separate mailboxes under a tenant, without human passwords. */
const mailboxAddress=z.string().trim().email().max(254);
const appCursor=(value:string,mailbox:string)=>{
  const url=new URL(value);
  const target='/v1.0/users/'+encodeURIComponent(mailbox)+'/mailFolders/inbox/messages/delta';
  if(url.origin!=='https://graph.microsoft.com'||url.pathname.toLowerCase()!==target.toLowerCase()||
    url.username||url.password||url.hash)throw new Error('Cursor Graph inválido para esta caixa postal.');
  return url;
};
const AppMessage=Message.extend({
  body:z.object({contentType:z.string().optional(),content:z.string().nullish()}).optional(),
  from:z.object({emailAddress:z.object({address:z.string().optional()}).optional()}).optional(),
  conversationId:z.string().max(1024).optional()
});
const AppPage=Page.extend({value:z.array(AppMessage).max(1000)});

export async function graphAppToken(input:{tenant:string;clientId:string;clientSecret:string},
  fetcher:typeof fetch=fetch) {
  if(!z.uuid().safeParse(input.tenant).success||!z.uuid().safeParse(input.clientId).success||
    !input.clientSecret)throw new Error('Credenciais da aplicação Microsoft 365 indisponíveis.');
  const response=await fetcher('https://login.microsoftonline.com/'+input.tenant+'/oauth2/v2.0/token',{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
    body:new URLSearchParams({grant_type:'client_credentials',
      client_id:input.clientId,client_secret:input.clientSecret,
      scope:'https://graph.microsoft.com/.default'})
  });
  if(!response.ok)throw new Error('Microsoft recusou a autenticação do aplicativo (HTTP '+response.status+').');
  return z.object({access_token:z.string().min(1)}).parse(await response.json()).access_token;
}

export async function graphAppPage(input:{
  tenant:string;clientId:string;clientSecret:string;mailbox:string;cursor?:string
},fetcher:typeof fetch=fetch){
  const mailbox=mailboxAddress.parse(input.mailbox).toLowerCase();
  const token=await graphAppToken(input,fetcher);
  const url=input.cursor?appCursor(input.cursor,mailbox):
    new URL('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(mailbox)+'/mailFolders/inbox/messages/delta');
  if(!input.cursor)url.searchParams.set('$select','id,subject,bodyPreview,body,receivedDateTime,from,conversationId');
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+token,
      Prefer:'odata.maxpagesize=50, IdType="ImmutableId", outlook.body-content-type="text"'}});
  if(!response.ok)throw new Error('Microsoft Graph recusou a leitura da caixa '+mailbox+' (HTTP '+response.status+').');
  const page=AppPage.parse(await response.json());
  const next=page['@odata.nextLink']??page['@odata.deltaLink'];
  if(!next)throw new Error('Microsoft Graph não retornou a continuação de sincronização.');
  return {messages:page.value,cursor:appCursor(next,mailbox).href};
}

export async function graphAppTest(input:{
  tenant:string;clientId:string;clientSecret:string;mailbox:string
},fetcher:typeof fetch=fetch) {
  const mailbox=mailboxAddress.parse(input.mailbox).toLowerCase();
  const token=await graphAppToken(input,fetcher);
  const url=new URL('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(mailbox)+'/mailFolders/inbox');
  url.searchParams.set('$select','id,displayName');
  const response=await fetcher(url,{
    redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token}
  });
  if(!response.ok)throw new Error('Sem acesso à caixa '+mailbox+' (HTTP '+response.status+'). Solicite escopo no Exchange Online.');
  await response.json();
  return {ok:true,message:'Acesso de leitura autorizado à caixa '+mailbox+'.'};
}

const recipient=z.string().trim().email().max(254);
export async function graphAppSend(input:{
  tenant:string;clientId:string;clientSecret:string;mailbox:string;
  to:string[];subject:string;body:string
},fetcher:typeof fetch=fetch){
  const mailbox=mailboxAddress.parse(input.mailbox).toLowerCase();
  const recipients=z.array(recipient).min(1).max(20).parse(input.to);
  if(!input.subject.trim()||!input.body.trim())throw new Error('Assunto e mensagem obrigatórios.');
  const token=await graphAppToken(input,fetcher);
  const url='https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(mailbox)+'/sendMail';
  const result=await fetcher(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({message:{subject:input.subject,
      body:{contentType:'Text',content:input.body},
      toRecipients:recipients.map(address=>({emailAddress:{address}}))},
      saveToSentItems:true})});
  if(result.status!==202)throw new Error('Microsoft Graph não aceitou o envio (HTTP '+result.status+').');
  // 202 = pedido aceito pela Microsoft, não confirmação de entrega ao destinatário.
  return {accepted:true,mailbox};
}


/** Busca histórica diretamente na caixa Microsoft, incluindo recebidos e enviados.
 * Não permite URLs arbitrárias nem edição pelo conteúdo das mensagens.
 */
export async function graphAppSearch(input:{
  tenant:string;clientId:string;clientSecret:string;mailbox:string;
  query:string;limit:number
},fetcher:typeof fetch=fetch){
  const mailbox=mailboxAddress.parse(input.mailbox).toLowerCase();
  const phrase=z.string().trim().max(150).parse(input.query);
  const limit=z.number().int().min(1).max(50).parse(input.limit);
  const token=await graphAppToken(input,fetcher);
  const url=new URL('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(mailbox)+'/messages');
  url.searchParams.set('$top',String(limit));
  url.searchParams.set('$select','id,subject,bodyPreview,body,receivedDateTime,from,conversationId');
  if(phrase){
    const safe=phrase.replace(/["\\]/g,' ').replace(/\s+/g,' ').trim();
    url.searchParams.set('$search','"'+safe+'"');
  }else url.searchParams.set('$orderby','receivedDateTime desc');
  const result=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+token,Prefer:'outlook.body-content-type="text"'}});
  if(!result.ok)throw new Error('Microsoft Graph não conseguiu pesquisar a caixa '+mailbox+
    ' (HTTP '+result.status+').');
  const page=AppPage.parse(await result.json());
  return {messages:page.value,truncated:Boolean(page['@odata.nextLink'])};
}
