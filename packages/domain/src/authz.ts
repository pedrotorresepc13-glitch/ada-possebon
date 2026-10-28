import type { AuthContext } from '@ada/contracts';
import type { Catalog, MetricDef, SourceDef } from './catalog.ts';

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message: string) {
    super(message);
  }
}

export function isAdmin(ctx: AuthContext): boolean {
  return ctx.roles.includes('admin');
}

export function hasProgram(ctx: AuthContext, program: string): boolean {
  return Object.prototype.hasOwnProperty.call(ctx.programs, program);
}

export function hasAllPrograms(ctx: AuthContext, programs: string[]): boolean {
  return programs.every((p) => hasProgram(ctx, p));
}

export function assertAdmin(ctx: AuthContext): void {
  if (!isAdmin(ctx)) throw new AuthorizationError('Acesso restrito à administração da ADA.');
}

export function assertUnit(ctx: AuthContext, unitId: number): void {
  if (!ctx.allowedUnitIds.includes(unitId)) throw new AuthorizationError('Unidade fora do escopo autorizado.');
}

/**
 * Unidades sobre as quais uma consulta pode operar.
 * Padrão: somente a unidade ativa. Consolidação entre unidades só com autorização explícita do contexto.
 */
export function queryUnitScope(ctx: AuthContext, requestCrossUnit = false): number[] {
  if (requestCrossUnit && ctx.crossUnit) return [...ctx.allowedUnitIds];
  return [ctx.activeUnitId];
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

export function canUseSource(ctx: AuthContext, source: SourceDef | undefined): AccessDecision {
  if (!source) return { allowed: false, reason: 'Fonte inexistente no catálogo.' };
  if (!hasAllPrograms(ctx, source.requiredPrograms)) {
    return { allowed: false, reason: `Você não tem permissão no POSSEBON para a fonte "${source.label}".` };
  }
  return { allowed: true };
}

export function canUseMetric(ctx: AuthContext, catalog: Catalog, metric: MetricDef | undefined, unitIds: number[]): AccessDecision {
  if (!metric) return { allowed: false, reason: 'Métrica inexistente no catálogo.' };
  const src = canUseSource(ctx, catalog.sources[metric.source]);
  if (!src.allowed) return src;
  if (!hasAllPrograms(ctx, metric.requiredPrograms)) {
    return { allowed: false, reason: `Você não tem permissão para a métrica "${metric.label}".` };
  }
  for (const u of unitIds) {
    if (!ctx.allowedUnitIds.includes(u)) return { allowed: false, reason: 'Unidade fora do escopo autorizado.' };
    if (metric.scopeLevel === 'gerencial' && !ctx.managerUnitIds.includes(u)) {
      return { allowed: false, reason: `A métrica "${metric.label}" exige escopo gerencial nesta unidade.` };
    }
  }
  return { allowed: true };
}

/** Chave de cache que separa usuário, unidade, versão de permissões e parâmetros. */
export function permissionCacheKey(ctx: AuthContext, unitIds: number[], params: unknown): string {
  return JSON.stringify([ctx.systemUserId, [...unitIds].sort(), ctx.permissionsVersion, params]);
}
