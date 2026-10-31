import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Raiz do release (db/migrations, apps/web/dist). Em produção, definida por ADA_ROOT no systemd. */
export const REPO_ROOT = process.env.ADA_ROOT
  ? path.resolve(process.env.ADA_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const EnvSchema = z.object({
  ADA_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ADA_HOST: z.string().default('127.0.0.1'),
  ADA_PORT: z.coerce.number().int().default(4800),
  ADA_BASE_PATH: z
    .string()
    .default('/ada')
    .refine((v) => /^\/[a-z0-9_-]*$/i.test(v), 'ADA_BASE_PATH deve ser como /ada'),
  /** Origens confiáveis para checagem de Origin em requisições mutáveis (separadas por espaço). */
  ADA_ALLOWED_ORIGINS: z.string().default('http://127.0.0.1:4800 http://localhost:4800 http://localhost:5173'),
  /** Origens autorizadas a incorporar a ADA em iframe (CSP frame-ancestors). */
  ADA_FRAME_ANCESTORS: z.string().default("'self'"),
  DATABASE_URL: z.string().optional(),
  ADA_DB_DRIVER: z.enum(['pg', 'pglite']).optional(),
  ADA_PGLITE_DIR: z.string().default('.data/pglite'),
  ADA_ENCRYPTION_KEY: z.string().optional(),
  ADA_SESSION_TTL_HOURS: z.coerce.number().default(12),
  ADA_SESSION_IDLE_MINUTES: z.coerce.number().default(60),
  ADA_COOKIE_SECURE: z.string().optional(),
  ADA_COOKIE_SAMESITE: z.enum(['Lax', 'Strict', 'None']).default('Lax'),
  ADA_SSO_ISSUER: z.string().default('possebon-web'),
  ADA_SSO_AUDIENCE: z.string().default('ada-possebon'),
  ADA_SSO_HS256_SECRET: z.string().optional(),
  ADA_SSO_ED25519_PUBLIC_KEY: z.string().optional(),
  ADA_SSO_MAX_AGE_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  POSSEBON_IDENTITY_URL: z.string().optional(),
  POSSEBON_SERVICE_TOKEN: z.string().optional(),
  POSSEBON_BRAIN_CONTEXT_URL: z.string().optional(),
  POSSEBON_READONLY_DATABASE_URL: z.string().optional(),
  ADA_ADMIN_PROGRAM: z.string().default('AdaAdministracao'),
  ADA_MANAGER_PROGRAM: z.string().default('AdaGestor'),
  ADA_CROSSUNIT_PROGRAM: z.string().default('AdaConsolidarUnidades'),
  ADA_ACCESS_PROGRAM: z.string().optional(),
  ADA_PERMISSION_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
  ADA_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(120),
  ADA_DEV_LOGIN: bool,
  ADA_DEMO_DATA: bool,
  ADA_INTERNAL_HMAC_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ADA_OPENAI_MODEL: z.string().optional(),
  ADA_OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  ADA_AI_TIMEOUT_MS: z.coerce.number().int().default(45000),
  ADA_AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().default(1500),
  ADA_AI_DAILY_REQUESTS_PER_USER: z.coerce.number().int().default(200),
  ADA_CHAT_PER_MINUTE: z.coerce.number().int().default(20),
  ADA_UPLOAD_MAX_MB: z.coerce.number().default(20),
  ADA_WEB_DIST: z.string().optional(),
  ADA_LOG_LEVEL: z.string().default('info')
});

export type Env = z.infer<typeof EnvSchema>;

export interface AdaConfig {
  env: Env['ADA_ENV'];
  isProduction: boolean;
  host: string;
  port: number;
  basePath: string;
  allowedOrigins: Set<string>;
  frameAncestors: string;
  db: { driver: 'pg' | 'pglite'; url?: string; pgliteDir: string };
  encryptionKey: Buffer;
  encryptionKeyConfigured: boolean;
  session: { ttlHours: number; idleMinutes: number; cookieSecure: boolean; sameSite: 'Lax' | 'Strict' | 'None' };
  sso: { issuer: string; audience: string; hs256Secret?: string; ed25519PublicKey?: string; maxAgeSeconds: number };
  possebon: { identityUrl?: string; serviceToken?: string; readonlyUrl?: string };
  brain: { contextUrl?: string };
  programs: { admin: string; manager: string; crossUnit: string; access?: string };
  permissionTtlSeconds: number;
  cacheTtlSeconds: number;
  devLogin: boolean;
  demoData: boolean;
  internalHmacSecret?: string;
  ai: { apiKey?: string; model?: string; baseUrl: string; timeoutMs: number; maxOutputTokens: number; dailyRequestsPerUser: number; chatPerMinute: number };
  uploadMaxBytes: number;
  webDist: string;
  logLevel: string;
}

const DEV_KEY = Buffer.alloc(32, 7); // chave fixa SOMENTE para desenvolvimento/testes

export class ConfigError extends Error {}

/** Garante aspas em palavras-chave CSP (arquivos .env costumam remover as aspas simples). */
export function normalizeSources(v: string): string {
  return v
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (/^(self|none)$/i.test(t) ? `'${t.toLowerCase()}'` : t))
    .join(' ');
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AdaConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError('Configuração inválida: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const e = parsed.data;
  const isProduction = e.ADA_ENV === 'production';
  const problems: string[] = [];

  let encryptionKey = DEV_KEY;
  if (e.ADA_ENCRYPTION_KEY) {
    encryptionKey = Buffer.from(e.ADA_ENCRYPTION_KEY, 'base64');
    if (encryptionKey.length !== 32) problems.push('ADA_ENCRYPTION_KEY deve ter 32 bytes em base64');
  } else if (isProduction) problems.push('ADA_ENCRYPTION_KEY é obrigatória em produção');

  const driver = e.ADA_DB_DRIVER ?? (e.DATABASE_URL ? 'pg' : 'pglite');
  if (isProduction) {
    if (driver !== 'pg' || !e.DATABASE_URL) problems.push('Produção exige PostgreSQL (DATABASE_URL); PGlite é apenas para desenvolvimento/testes');
    if (e.ADA_DEV_LOGIN === true) problems.push('ADA_DEV_LOGIN não pode ser habilitado em produção');
    if (e.ADA_DEMO_DATA === true) problems.push('ADA_DEMO_DATA (dados sintéticos) não pode ser habilitado em produção');
    if (!e.ADA_SSO_HS256_SECRET && !e.ADA_SSO_ED25519_PUBLIC_KEY) problems.push('Produção exige ADA_SSO_HS256_SECRET ou ADA_SSO_ED25519_PUBLIC_KEY');
    if (e.ADA_SSO_HS256_SECRET && e.ADA_SSO_HS256_SECRET.length < 32) problems.push('ADA_SSO_HS256_SECRET deve ter ao menos 32 caracteres');
    if (e.ADA_COOKIE_SECURE === 'false') problems.push('Cookies devem ser Secure em produção');
    if (e.ADA_FRAME_ANCESTORS.includes('*')) problems.push('ADA_FRAME_ANCESTORS não pode conter curinga');
  }
  if (problems.length) throw new ConfigError(problems.join('; '));

  const cookieSecure = e.ADA_COOKIE_SECURE ? e.ADA_COOKIE_SECURE !== 'false' : isProduction;
  if (e.ADA_COOKIE_SAMESITE === 'None' && !cookieSecure) throw new ConfigError('SameSite=None exige cookie Secure');

  return {
    env: e.ADA_ENV,
    isProduction,
    host: e.ADA_HOST,
    port: e.ADA_PORT,
    basePath: e.ADA_BASE_PATH.replace(/\/$/, ''),
    allowedOrigins: new Set(e.ADA_ALLOWED_ORIGINS.split(/\s+/).filter(Boolean)),
    frameAncestors: normalizeSources(e.ADA_FRAME_ANCESTORS),
    db: { driver, url: e.DATABASE_URL, pgliteDir: path.resolve(REPO_ROOT, e.ADA_PGLITE_DIR) },
    encryptionKey,
    encryptionKeyConfigured: Boolean(e.ADA_ENCRYPTION_KEY),
    session: { ttlHours: e.ADA_SESSION_TTL_HOURS, idleMinutes: e.ADA_SESSION_IDLE_MINUTES, cookieSecure, sameSite: e.ADA_COOKIE_SAMESITE },
    sso: {
      issuer: e.ADA_SSO_ISSUER,
      audience: e.ADA_SSO_AUDIENCE,
      hs256Secret: e.ADA_SSO_HS256_SECRET,
      ed25519PublicKey: e.ADA_SSO_ED25519_PUBLIC_KEY,
      maxAgeSeconds: e.ADA_SSO_MAX_AGE_SECONDS
    },
    possebon: { identityUrl: e.POSSEBON_IDENTITY_URL, serviceToken: e.POSSEBON_SERVICE_TOKEN, readonlyUrl: e.POSSEBON_READONLY_DATABASE_URL },
    brain: { contextUrl: e.POSSEBON_BRAIN_CONTEXT_URL },
    programs: { admin: e.ADA_ADMIN_PROGRAM, manager: e.ADA_MANAGER_PROGRAM, crossUnit: e.ADA_CROSSUNIT_PROGRAM, access: e.ADA_ACCESS_PROGRAM },
    permissionTtlSeconds: e.ADA_PERMISSION_TTL_SECONDS,
    cacheTtlSeconds: e.ADA_CACHE_TTL_SECONDS,
    devLogin: e.ADA_DEV_LOGIN === true && !isProduction,
    demoData: e.ADA_DEMO_DATA === true && !isProduction,
    internalHmacSecret: e.ADA_INTERNAL_HMAC_SECRET,
    ai: {
      apiKey: e.OPENAI_API_KEY,
      model: e.ADA_OPENAI_MODEL,
      baseUrl: e.ADA_OPENAI_BASE_URL,
      timeoutMs: e.ADA_AI_TIMEOUT_MS,
      maxOutputTokens: e.ADA_AI_MAX_OUTPUT_TOKENS,
      dailyRequestsPerUser: e.ADA_AI_DAILY_REQUESTS_PER_USER,
      chatPerMinute: e.ADA_CHAT_PER_MINUTE
    },
    uploadMaxBytes: Math.round(e.ADA_UPLOAD_MAX_MB * 1024 * 1024),
    webDist: e.ADA_WEB_DIST ? path.resolve(e.ADA_WEB_DIST) : path.join(REPO_ROOT, 'apps/web/dist'),
    logLevel: e.ADA_LOG_LEVEL
  };
}
