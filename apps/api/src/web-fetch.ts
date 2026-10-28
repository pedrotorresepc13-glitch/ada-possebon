import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { assertSafeUrl, isBlockedAddress } from '@ada/domain';

export const USER_AGENT = 'ADA-POSSEBON-Bot/0.1 (+coleta autorizada pela administração)';
const ALLOWED_TYPES = ['text/html', 'text/plain', 'text/markdown', 'application/json', 'application/xhtml+xml'];

/**
 * Lookup que valida o IP RESOLVIDO no momento da conexão (mitiga DNS rebinding):
 * qualquer endereço privado, loopback, link-local ou de metadata é recusado.
 */
const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = Array.isArray(addresses) ? addresses : [];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (!list.length || bad) return callback(new Error('Destino resolve para endereço interno/reservado — bloqueado'), '', 4);
    if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return callback(null, list[0]!.address, list[0]!.family);
  });
};

export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
}

function requestOnce(url: URL, maxBytes: number, timeoutMs: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'GET', lookup: safeLookup, timeout: timeoutMs, headers: { 'User-Agent': USER_AGENT, Accept: ALLOWED_TYPES.join(', ') } },
      (res) => {
        const len = Number(res.headers['content-length'] ?? 0);
        if (len > maxBytes) {
          res.destroy();
          return reject(new Error(`Conteúdo excede o limite de ${Math.round(maxBytes / 1024)} KB`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new Error(`Conteúdo excede o limite de ${Math.round(maxBytes / 1024)} KB`));
          } else chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Tempo limite excedido')));
    req.on('error', reject);
    req.end();
  });
}

/** GET seguro com revalidação de cada redirecionamento. */
export async function safeFetch(raw: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {}): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  let url = assertSafeUrl(raw);
  for (let i = 0; i <= (opts.maxRedirects ?? 3); i++) {
    const r = await requestOnce(url, maxBytes, opts.timeoutMs ?? 15000);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      url = assertSafeUrl(new URL(r.headers.location, url).toString());
      continue;
    }
    const contentType = String(r.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    return { finalUrl: url.toString(), status: r.status, contentType, body: r.body };
  }
  throw new Error('Redirecionamentos em excesso');
}

/** Respeita robots.txt (User-agent: * e ADA-POSSEBON-Bot). Ausência de robots.txt = permitido. */
export async function robotsAllows(target: URL): Promise<boolean> {
  let txt: string;
  try {
    const r = await safeFetch(new URL('/robots.txt', target).toString(), { maxBytes: 256 * 1024, timeoutMs: 8000 });
    if (r.status >= 400) return true;
    txt = r.body.toString('utf8');
  } catch {
    return true;
  }
  let applies = false;
  const disallow: string[] = [];
  const allow: string[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const [k, ...rest] = line.split(':');
    const key = (k ?? '').trim().toLowerCase();
    const val = rest.join(':').trim();
    if (key === 'user-agent') applies = val === '*' || /ada-possebon-bot/i.test(val);
    else if (applies && key === 'disallow' && val) disallow.push(val);
    else if (applies && key === 'allow' && val) allow.push(val);
  }
  const p = target.pathname;
  const longest = (arr: string[]) => Math.max(-1, ...arr.filter((x) => p.startsWith(x)).map((x) => x.length));
  return longest(allow) >= longest(disallow);
}

export function isAllowedContentType(ct: string): boolean {
  return ALLOWED_TYPES.includes(ct);
}

/** Converte HTML em texto simples (sem executar nada). */
export function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
  const text = html
    .replace(/<(script|style|noscript|template|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();
  return { title: decodeTitle(title), text };
}

function decodeTitle(t: string) {
  return t.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').slice(0, 200);
}
