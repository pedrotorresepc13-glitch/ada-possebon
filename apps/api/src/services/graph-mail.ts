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
