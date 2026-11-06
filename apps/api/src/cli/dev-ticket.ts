import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.ts';
import { signTicketHs256 } from '../crypto.ts';

/**
 * Gera um ticket SSO de TESTE (HS256), simulando o que o POSSEBON Web emitirá.
 * Uso: npm run dev:ticket -- <system_user_id> <unit_id>
 */
const config = loadConfig();
if (config.isProduction) throw new Error('Proibido em produção.');
const secret = config.sso.hs256Secret;
if (!secret) throw new Error('Defina ADA_SSO_HS256_SECRET no .env para testar o SSO.');
const [sub = '9002', unit = '1'] = process.argv.slice(2);
const now = Math.floor(Date.now() / 1000);
const ticket = signTicketHs256(
  { iss: config.sso.issuer, aud: config.sso.audience, sub, unit_id: Number(unit), jti: randomUUID(), iat: now, exp: now + 60 },
  secret
);
console.log(ticket);
console.error(`\nVálido por 60 s, uso único. Teste:\ncurl -i -X POST http://${config.host}:${config.port}${config.basePath}/api/ada/session/exchange -H "Content-Type: application/json" -d "{\\"ticket\\":\\"${ticket}\\"}"`);
