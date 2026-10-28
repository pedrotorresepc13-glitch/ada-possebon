import type { AdaRole, AuthContext, IntegrationStatus } from '@ada/contracts';
import type { AdaConfig } from './config.ts';

/**
 * Identidade e permissões resolvidas pela AUTORIDADE (POSSEBON Web).
 * A ADA nunca deduz permissões a partir de dados enviados pelo navegador.
 */
export interface ResolvedIdentity {
  systemUserId: number;
  login: string;
  displayName: string;
  active: boolean;
  units: { id: number; name: string }[];
  groups: { id: number; name: string }[];
  /** controller do system_program → ações (system_group_program.actions / system_user_program). */
  programs: Record<string, string[]>;
  /** Unidades com escopo gerencial, calculadas pelo POSSEBON (gerência/equipe/cargo). */
  managerUnitIds: number[];
  permissionsVersion: string;
}

export interface IdentityProvider {
  readonly kind: AuthContext['identitySource'];
  status(): IntegrationStatus;
  resolve(systemUserId: number): Promise<ResolvedIdentity | null>;
}

export class IdentityUnavailableError extends Error {}

/**
 * Cliente do endpoint servidor-servidor PROPOSTO ao POSSEBON Web
 * (ver docs/ADA_INTEGRACAO_POSSEBON.md e integration/possebon-web/). O endpoint ainda não existe
 * no baseline conhecido; enquanto não for implantado e validado, este provedor fica "não configurado".
 */
export class PossebonIdentityProvider implements IdentityProvider {
  readonly kind = 'possebon' as const;
  constructor(private readonly cfg: AdaConfig['possebon']) {}

  status(): IntegrationStatus {
    return this.cfg.identityUrl && this.cfg.serviceToken ? 'configurado_nao_validado' : 'nao_configurado';
  }

  async resolve(systemUserId: number): Promise<ResolvedIdentity | null> {
    if (!this.cfg.identityUrl || !this.cfg.serviceToken) throw new IdentityUnavailableError('Integração de identidade POSSEBON não configurada');
    const url = new URL(this.cfg.identityUrl);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1') throw new IdentityUnavailableError('Endpoint de identidade deve usar HTTPS');
    url.searchParams.set('system_user_id', String(systemUserId));
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.cfg.serviceToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
    } catch (err) {
      throw new IdentityUnavailableError('POSSEBON indisponível: ' + (err as Error).message);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new IdentityUnavailableError(`POSSEBON respondeu HTTP ${res.status}`);
    const d = (await res.json()) as Record<string, unknown>;
    return parseIdentityPayload(d);
  }
}

/** Valida estritamente o payload do contrato v1 (docs/openapi-possebon-identity.yaml). */
export function parseIdentityPayload(d: Record<string, unknown>): ResolvedIdentity {
  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new IdentityUnavailableError('Payload de identidade inválido');
    return n;
  };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const programs: Record<string, string[]> = {};
  for (const p of arr(d.programs)) {
    const o = p as { controller?: unknown; actions?: unknown };
    if (typeof o.controller === 'string' && /^[A-Za-z0-9_]{1,120}$/.test(o.controller)) {
      programs[o.controller] = arr(o.actions).filter((a): a is string => typeof a === 'string');
    }
  }
  return {
    systemUserId: num(d.system_user_id),
    login: String(d.login ?? ''),
    displayName: String(d.name ?? d.login ?? ''),
    active: d.active === true,
    units: arr(d.units).map((u) => ({ id: num((u as { id: unknown }).id), name: String((u as { name?: unknown }).name ?? '') })),
    groups: arr(d.groups).map((g) => ({ id: num((g as { id: unknown }).id), name: String((g as { name?: unknown }).name ?? '') })),
    programs,
    managerUnitIds: arr(d.manager_unit_ids).map(num),
    permissionsVersion: String(d.permissions_version ?? '')
  };
}

/* ------------------------------------------------------------------------ */
/* Identidades SINTÉTICAS de desenvolvimento/teste. Recusadas em produção.  */
/* ------------------------------------------------------------------------ */

export const DEMO_UNITS = [
  { id: 1, name: 'Unidade Sintética Norte' },
  { id: 2, name: 'Unidade Sintética Sul' }
];

const ALL_DEMO = { DemoEfetivoList: ['view'], DemoTreinamentoList: ['view'], DemoOsList: ['view'], DemoCompraList: ['view'] };

export const DEMO_USERS: ResolvedIdentity[] = [
  {
    systemUserId: 9001, login: 'admin.demo', displayName: 'Administração (sintético)', active: true,
    units: DEMO_UNITS, groups: [{ id: 901, name: 'ADA Administração (sintético)' }],
    programs: { ...ALL_DEMO, AdaAdministracao: ['view', 'edit'] }, managerUnitIds: [1, 2], permissionsVersion: 'demo-1'
  },
  {
    systemUserId: 9002, login: 'gerente.a', displayName: 'Gerente A (sintético)', active: true,
    units: [DEMO_UNITS[0]!], groups: [{ id: 902, name: 'Gerentes Norte (sintético)' }],
    programs: { ...ALL_DEMO, AdaGestor: ['view'] }, managerUnitIds: [1], permissionsVersion: 'demo-1'
  },
  {
    systemUserId: 9003, login: 'gerente.b', displayName: 'Gerente B (sintético)', active: true,
    units: [DEMO_UNITS[1]!], groups: [{ id: 903, name: 'Gerentes Sul (sintético)' }],
    programs: { ...ALL_DEMO, AdaGestor: ['view'] }, managerUnitIds: [2], permissionsVersion: 'demo-1'
  },
  {
    systemUserId: 9004, login: 'colab.a', displayName: 'Colaborador A (sintético)', active: true,
    units: [DEMO_UNITS[0]!], groups: [{ id: 904, name: 'Colaboradores Norte (sintético)' }],
    programs: { DemoOsList: ['view'], DemoTreinamentoList: ['view'] }, managerUnitIds: [], permissionsVersion: 'demo-1'
  },
  {
    systemUserId: 9005, login: 'colab.b', displayName: 'Colaborador B (sintético)', active: true,
    units: [DEMO_UNITS[1]!], groups: [{ id: 905, name: 'Colaboradores Sul (sintético)' }],
    programs: { DemoOsList: ['view'] }, managerUnitIds: [], permissionsVersion: 'demo-1'
  }
];

export class DevIdentityProvider implements IdentityProvider {
  readonly kind = 'dev_synthetic' as const;
  private readonly users = new Map<number, ResolvedIdentity>();
  constructor() {
    for (const u of DEMO_USERS) this.users.set(u.systemUserId, structuredClone(u));
  }
  status(): IntegrationStatus {
    return 'demonstracao';
  }
  async resolve(systemUserId: number): Promise<ResolvedIdentity | null> {
    const u = this.users.get(systemUserId);
    return u ? structuredClone(u) : null;
  }
  findByLogin(login: string): ResolvedIdentity | undefined {
    return [...this.users.values()].find((u) => u.login === login);
  }
  /** Simula mudança de grupo/revogação no POSSEBON (testes). */
  update(systemUserId: number, patch: Partial<ResolvedIdentity>): void {
    const u = this.users.get(systemUserId);
    if (!u) throw new Error('usuário sintético inexistente');
    this.users.set(systemUserId, { ...u, ...patch, permissionsVersion: `${u.permissionsVersion}+` });
  }
}

export class UnitNotAllowedError extends Error {}
export class InactiveUserError extends Error {}

/** Converte a identidade autoritativa em contexto da ADA para uma unidade ativa. */
export function buildAuthContext(
  identity: ResolvedIdentity,
  activeUnitId: number,
  sessionId: string,
  cfg: AdaConfig['programs'],
  source: AuthContext['identitySource']
): AuthContext {
  if (!identity.active) throw new InactiveUserError('Usuário inativo no POSSEBON');
  const allowedUnitIds = identity.units.map((u) => u.id);
  if (!allowedUnitIds.includes(activeUnitId)) throw new UnitNotAllowedError('Unidade não autorizada para este usuário');
  if (cfg.access && !identity.programs[cfg.access] && !identity.programs[cfg.admin]) {
    throw new UnitNotAllowedError('Usuário sem permissão de acesso à ADA no POSSEBON');
  }
  const roles: AdaRole[] = ['user'];
  const managerUnitIds = identity.managerUnitIds.filter((u) => allowedUnitIds.includes(u));
  if (managerUnitIds.includes(activeUnitId) || identity.programs[cfg.manager]) roles.push('manager');
  if (identity.programs[cfg.admin]) roles.push('admin');
  return {
    sessionId,
    systemUserId: identity.systemUserId,
    login: identity.login,
    displayName: identity.displayName,
    activeUnitId,
    allowedUnitIds,
    units: identity.units,
    groups: identity.groups,
    programs: identity.programs,
    roles,
    managerUnitIds,
    crossUnit: Boolean(identity.programs[cfg.crossUnit]),
    permissionsVersion: identity.permissionsVersion,
    resolvedAt: new Date().toISOString(),
    identitySource: source
  };
}
