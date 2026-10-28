import { redactSecrets } from '@ada/domain';

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;

/** Logger JSON de uma linha, com redação de segredos. Nunca registrar conteúdo privado de conversas. */
export function createLogger(level: string, name: string): Logger {
  const max = LEVELS[level as keyof typeof LEVELS] ?? 2;
  const emit = (lvl: keyof typeof LEVELS, obj: object, msg?: string) => {
    if (LEVELS[lvl] > max) return;
    const o = Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, v instanceof Error ? { message: v.message, stack: v.stack?.split('\n').slice(0, 4).join('\n') } : v])
    );
    const line = redactSecrets(JSON.stringify({ t: new Date().toISOString(), level: lvl, name, msg, ...o }));
    (lvl === 'error' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    info: (o, m) => emit('info', o, m),
    warn: (o, m) => emit('warn', o, m),
    error: (o, m) => emit('error', o, m)
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
