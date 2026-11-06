import type { ErrorCode } from '@ada/contracts';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, 'NOT_FOUND', `${what} não encontrado.`);
export const forbidden = (msg = 'Acesso negado.') => new HttpError(403, 'FORBIDDEN', msg);
export const invalid = (msg: string, details?: unknown) => new HttpError(400, 'VALIDATION', msg, details);
export const conflict = (msg: string) => new HttpError(409, 'CONFLICT', msg);
