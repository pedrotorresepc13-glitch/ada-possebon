import crypto from 'node:crypto';

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, data: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/** AES-256-GCM para segredos de integração e conteúdo privado de usuários. */
export class Cipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Chave de criptografia deve ter 32 bytes');
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [v, iv, tag, ct] = payload.split(':');
    if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Formato cifrado desconhecido');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  }
}

/* ------------------------------------------------------------------------ */
/* JWS compacto (HS256 / EdDSA) para tickets de SSO de curta duração.       */
/* ------------------------------------------------------------------------ */

export interface TicketClaims {
  iss: string;
  aud: string;
  sub: string;
  unit_id: number;
  jti: string;
  iat: number;
  exp: number;
  nonce?: string;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

export function signTicketHs256(claims: TicketClaims, secret: string): string {
  const head = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlJson(claims);
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export function signTicketEd25519(claims: TicketClaims, privateKeyPem: string): string {
  const head = b64urlJson({ alg: 'EdDSA', typ: 'JWT' });
  const body = b64urlJson(claims);
  const sig = crypto.sign(null, Buffer.from(`${head}.${body}`), privateKeyPem).toString('base64url');
  return `${head}.${body}.${sig}`;
}

export class TicketError extends Error {}

/** Verifica assinatura e decodifica. Validação de claims fica no serviço de SSO. */
export function verifyTicketSignature(token: string, keys: { hs256Secret?: string; ed25519PublicKey?: string }): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 4096) throw new TicketError('Ticket malformado');
  const [h, b, s] = parts as [string, string, string];
  let header: { alg?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  } catch {
    throw new TicketError('Ticket malformado');
  }
  const signed = Buffer.from(`${h}.${b}`);
  const sig = Buffer.from(s, 'base64url');
  if (header.alg === 'HS256' && keys.hs256Secret) {
    const expected = crypto.createHmac('sha256', keys.hs256Secret).update(signed).digest();
    if (expected.length !== sig.length || !crypto.timingSafeEqual(expected, sig)) throw new TicketError('Assinatura inválida');
  } else if (header.alg === 'EdDSA' && keys.ed25519PublicKey) {
    if (!crypto.verify(null, signed, keys.ed25519PublicKey, sig)) throw new TicketError('Assinatura inválida');
  } else {
    throw new TicketError('Algoritmo de assinatura não aceito');
  }
  return payload;
}
