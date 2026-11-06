import { RuleDefinition, type AuthContext, type Trigger } from '@ada/contracts';
import type { Catalog, MonitorField, SourceDef } from './catalog.ts';
import { canUseSource } from './authz.ts';
import { formatDate, formatDateTime } from './format.ts';

export interface RuleValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  definition?: RuleDefinition;
  source?: SourceDef;
  checkEveryMinutes?: number;
}

const TEMPORAL = new Set<MonitorField['type']>(['date', 'timestamp']);

/** RuleValidator: schema, fonte catalogada e monitorável, permissões, campos e limites. */
export function validateRule(input: unknown, catalog: Catalog, ctx: AuthContext, enabledSources: Set<string>): RuleValidation {
  const parsed = RuleDefinition.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'regra'}: ${i.message}`), warnings: [] };
  }
  const def = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const source = catalog.sources[def.source];
  if (!source) return { ok: false, errors: [`Fonte "${def.source}" não está catalogada.`], warnings };
  if (!source.monitor) return { ok: false, errors: [`A fonte "${source.label}" ainda não suporta monitoramento.`], warnings };
  if (!enabledSources.has(source.id)) errors.push(`A fonte "${source.label}" não está habilitada/configurada neste ambiente.`);
  const access = canUseSource(ctx, source);
  if (!access.allowed) errors.push(access.reason!);
  const fields = new Map(source.monitor.fields.map((f) => [f.name, f]));
  for (const f of def.filters) if (!fields.has(f.field)) errors.push(`Campo de filtro inexistente: ${f.field}`);
  for (const t of def.triggers) {
    if (t.type === 'record_created') continue;
    const fd = fields.get(t.field);
    if (!fd) {
      errors.push(`Campo inexistente na fonte: ${t.field}`);
      continue;
    }
    if ((t.type === 'deadline_near' || t.type === 'deadline_passed' || t.type === 'no_update_for') && !TEMPORAL.has(fd.type)) {
      errors.push(`O gatilho ${t.type} exige campo de data; "${fd.label}" não é.`);
    }
    if ((t.type === 'threshold' || t.type === 'change_pct') && fd.type !== 'number') {
      errors.push(`O gatilho ${t.type} exige campo numérico; "${fd.label}" não é.`);
    }
    if (t.type === 'status_changed' && source.monitor.statusField && t.field !== source.monitor.statusField) {
      warnings.push(`"${fd.label}" não é o campo de status oficial da fonte.`);
    }
  }
  const hasKeyFilter = def.filters.some((f) => f.field === source.monitor!.keyField);
  if (!hasKeyFilter) warnings.push('A regra não está restrita a um registro específico; poderá gerar mais alertas.');
  if (def.match === 'all' && def.triggers.some((t) => t.type === 'record_created')) {
    errors.push('Composição "todos" não pode incluir criação de registro.');
  }
  const checkEveryMinutes = Math.max(def.check_every_minutes ?? 15, source.monitor.minCheckMinutes);
  return { ok: errors.length === 0, errors, warnings, definition: def, source, checkEveryMinutes };
}

function fieldLabel(source: SourceDef, field: string): string {
  return source.monitor?.fields.find((f) => f.name === field)?.label ?? field;
}

export function describeTrigger(t: Trigger, source: SourceDef): string {
  switch (t.type) {
    case 'field_changed':
      return `quando "${fieldLabel(source, t.field)}" for alterado`;
    case 'status_changed':
      return t.to?.length ? `quando o status mudar para ${t.to.join(' ou ')}` : 'quando o status mudar';
    case 'record_created':
      return `quando um novo registro (${source.monitor?.recordLabel ?? 'item'}) for criado`;
    case 'no_update_for':
      return `quando ficar ${t.duration_hours} horas sem atualização`;
    case 'deadline_near':
      return `quando faltarem ${t.within_hours} horas ou menos para "${fieldLabel(source, t.field)}"`;
    case 'deadline_passed':
      return `quando "${fieldLabel(source, t.field)}" vencer sem conclusão`;
    case 'threshold': {
      const ops = { gt: 'maior que', gte: 'maior ou igual a', lt: 'menor que', lte: 'menor ou igual a', eq: 'igual a' } as const;
      return `quando "${fieldLabel(source, t.field)}" ficar ${ops[t.op]} ${t.value}`;
    }
    case 'change_pct': {
      const dir = { increase: 'aumentar', decrease: 'reduzir', any: 'variar' } as const;
      return `quando "${fieldLabel(source, t.field)}" ${dir[t.direction]} ${t.pct}% ou mais`;
    }
  }
}

/** Resumo em português para confirmação do usuário (RulePreview). */
export function describeRule(def: RuleDefinition, source: SourceDef, checkEveryMinutes: number): string[] {
  const lines: string[] = [];
  const filters = def.filters.map((f) => `${fieldLabel(source, f.field)} ${f.op === 'neq' ? '≠' : '='} ${Array.isArray(f.value) ? f.value.join(', ') : f.value}`);
  lines.push(`O que será acompanhado: ${source.label}${filters.length ? ` (${filters.join('; ')})` : ''}, somente na sua unidade ativa.`);
  lines.push(`Quando alertar (${def.match === 'all' ? 'todas as condições' : 'qualquer condição'}): ${def.triggers.map((t) => describeTrigger(t, source)).join('; ')}.`);
  lines.push(`Frequência: verificação incremental a cada ${checkEveryMinutes} minutos (somente registros alterados desde a última verificação), além de eventos recebidos quando a fonte enviar.`);
  lines.push('Destinatário: somente você, na central de notificações da ADA.');
  lines.push(`Supressão de ruído: no máximo um alerta do mesmo tipo a cada ${def.cooldown_minutes} minutos por registro.`);
  lines.push('Custo: a verificação é determinística e não usa IA.');
  return lines;
}

/* ------------------------------------------------------------------ */
/* RuleEvaluator — determinístico, puro e idempotente                 */
/* ------------------------------------------------------------------ */

export type RecordValues = Record<string, string | number | boolean | null>;

export interface RecordSnapshot {
  values: RecordValues;
  /** Último disparo por chave de gatilho (ISO) — usado para cooldown. */
  lastFiredAt: Record<string, string>;
}

export interface Occurrence {
  triggerType: Trigger['type'];
  triggerKey: string;
  /** Chave de deduplicação estável: o mesmo fato nunca gera dois eventos. */
  dedupeKey: string;
  title: string;
  body: string;
  severity: 'info' | 'aviso' | 'critico';
  suppressed: boolean;
  evidence: { field?: string; before?: unknown; after?: unknown; observedAt: string; recordKey: string };
}

export interface EvaluationResult {
  occurrences: Occurrence[];
  snapshot: RecordSnapshot;
  baseline: boolean;
}

/** Normaliza valores vindos do banco/eventos para comparação estável. */
export function normalizeRecord(record: Record<string, unknown>, fields: MonitorField[]): RecordValues {
  const out: RecordValues = {};
  for (const f of fields) {
    const v = record[f.name];
    if (v === undefined || v === null || v === '') out[f.name] = null;
    else if (f.type === 'timestamp' || f.type === 'date') {
      const d = v instanceof Date ? v : new Date(String(v));
      out[f.name] = Number.isNaN(d.getTime()) ? null : d.toISOString();
    } else if (f.type === 'number') out[f.name] = typeof v === 'number' ? v : Number(v);
    else out[f.name] = String(v);
  }
  return out;
}

function show(v: unknown, field: MonitorField | undefined): string {
  if (v === null || v === undefined) return '(vazio)';
  if (field?.type === 'date') return formatDate(String(v));
  if (field?.type === 'timestamp') return formatDateTime(String(v));
  return String(v);
}

function triggerKey(t: Trigger, i: number): string {
  return `${i}:${t.type}:${'field' in t ? t.field : ''}`;
}

export function evaluateRecord(args: {
  definition: RuleDefinition;
  source: SourceDef;
  recordKey: string;
  current: RecordValues;
  previous: RecordSnapshot | null;
  now: Date;
  activatedAt: Date;
}): EvaluationResult {
  const { definition: def, source, recordKey, current, previous, now, activatedAt } = args;
  const mon = source.monitor!;
  const fields = new Map(mon.fields.map((f) => [f.name, f]));
  const prev = previous?.values ?? null;
  const label = `${mon.recordLabel} ${recordKey}${mon.titleField && current[mon.titleField] ? ` — ${current[mon.titleField]}` : ''}`;
  const status = mon.statusField ? String(current[mon.statusField] ?? '') : '';
  const closed = mon.closedStatuses.includes(status);
  const nowMs = now.getTime();
  const observedAt = now.toISOString();

  type Hit = Omit<Occurrence, 'suppressed'>;
  const hits: (Hit | null)[] = def.triggers.map((t, i): Hit | null => {
    const key = triggerKey(t, i);
    const base = { triggerType: t.type, triggerKey: key };
    switch (t.type) {
      case 'field_changed':
      case 'status_changed': {
        if (!prev) return null; // primeira observação = linha de base, sem alerta
        const before = prev[t.field] ?? null;
        const after = current[t.field] ?? null;
        if (before === after) return null;
        if (t.type === 'status_changed' && t.to?.length && !t.to.map(String).includes(String(after))) return null;
        const fd = fields.get(t.field);
        return {
          ...base,
          dedupeKey: `${key}:${String(before)}->${String(after)}@${String(current[mon.updatedAtField] ?? '')}`,
          title: `${label}: ${fd?.label ?? t.field} alterado`,
          body: `${fd?.label ?? t.field} alterado em ${formatDateTime(now)}; antes ${show(before, fd)}, agora ${show(after, fd)}.`,
          severity: 'aviso',
          evidence: { field: t.field, before, after, observedAt, recordKey }
        };
      }
      case 'record_created': {
        if (prev || !mon.createdAtField) return null;
        const created = current[mon.createdAtField];
        if (!created || new Date(String(created)).getTime() < activatedAt.getTime()) return null;
        return {
          ...base,
          dedupeKey: `${key}:${recordKey}`,
          title: `Novo registro: ${label}`,
          body: `Criado em ${formatDateTime(String(created))}.`,
          severity: 'info',
          evidence: { observedAt, recordKey, after: created }
        };
      }
      case 'no_update_for': {
        const last = current[t.field];
        if (!last || closed) return null;
        const ageH = (nowMs - new Date(String(last)).getTime()) / 3_600_000;
        if (ageH < t.duration_hours) return null;
        return {
          ...base,
          dedupeKey: `${key}:${String(last)}`,
          title: `${label}: ${t.duration_hours}h sem atualização`,
          body: `Última atualização em ${formatDateTime(String(last))} (há ${Math.floor(ageH)} horas).`,
          severity: 'aviso',
          evidence: { field: t.field, after: last, observedAt, recordKey }
        };
      }
      case 'deadline_near':
      case 'deadline_passed': {
        const dl = current[t.field];
        if (!dl || closed) return null;
        const diffH = (new Date(String(dl)).getTime() - nowMs) / 3_600_000;
        const fd = fields.get(t.field);
        if (t.type === 'deadline_near' && (diffH <= 0 || diffH > t.within_hours)) return null;
        if (t.type === 'deadline_passed' && diffH > 0) return null;
        return {
          ...base,
          dedupeKey: `${key}:${String(dl)}`,
          title: t.type === 'deadline_near' ? `${label}: prazo se aproximando` : `${label}: prazo vencido`,
          body:
            t.type === 'deadline_near'
              ? `${fd?.label ?? t.field}: ${show(dl, fd)} (faltam ${Math.ceil(diffH)} horas).`
              : `${fd?.label ?? t.field}: ${show(dl, fd)} — vencido e status atual "${status || 'desconhecido'}".`,
          severity: t.type === 'deadline_near' ? 'aviso' : 'critico',
          evidence: { field: t.field, after: dl, observedAt, recordKey }
        };
      }
      case 'threshold': {
        const v = current[t.field];
        if (typeof v !== 'number') return null;
        const test = (x: number) => ({ gt: x > t.value, gte: x >= t.value, lt: x < t.value, lte: x <= t.value, eq: x === t.value })[t.op];
        if (!test(v)) return null;
        const pv = prev?.[t.field];
        if (typeof pv === 'number' && test(pv)) return null; // dispara na borda, não continuamente
        return {
          ...base,
          dedupeKey: `${key}:${v}:${String(current[mon.updatedAtField])}`,
          title: `${label}: limite atingido`,
          body: `${fields.get(t.field)?.label ?? t.field} = ${v} (regra: ${t.op} ${t.value}).`,
          severity: 'aviso',
          evidence: { field: t.field, before: pv ?? null, after: v, observedAt, recordKey }
        };
      }
      case 'change_pct': {
        const v = current[t.field];
        const pv = prev?.[t.field];
        if (typeof v !== 'number' || typeof pv !== 'number' || pv === 0 || v === pv) return null;
        const pct = ((v - pv) / Math.abs(pv)) * 100;
        const ok = t.direction === 'any' ? Math.abs(pct) >= t.pct : t.direction === 'increase' ? pct >= t.pct : -pct >= t.pct;
        if (!ok) return null;
        return {
          ...base,
          dedupeKey: `${key}:${pv}->${v}`,
          title: `${label}: variação de ${pct.toFixed(1).replace('.', ',')}%`,
          body: `${fields.get(t.field)?.label ?? t.field}: antes ${pv}, agora ${v}.`,
          severity: 'aviso',
          evidence: { field: t.field, before: pv, after: v, observedAt, recordKey }
        };
      }
    }
  });

  let active = hits.filter((h): h is Hit => h !== null);
  if (def.match === 'all') {
    active =
      active.length === def.triggers.length
        ? [
            {
              triggerType: active[0]!.triggerType,
              triggerKey: 'all',
              dedupeKey: 'all:' + active.map((h) => h.dedupeKey).join('|'),
              title: `${label}: todas as condições atendidas`,
              body: active.map((h) => h.body).join(' '),
              severity: active.some((h) => h.severity === 'critico') ? 'critico' : 'aviso',
              evidence: active[0]!.evidence
            }
          ]
        : [];
  }

  const lastFiredAt = { ...(previous?.lastFiredAt ?? {}) };
  const cooldownMs = def.cooldown_minutes * 60_000;
  const occurrences: Occurrence[] = active.map((h) => {
    const last = lastFiredAt[h.triggerKey];
    const suppressed = !!last && nowMs - new Date(last).getTime() < cooldownMs;
    if (!suppressed) lastFiredAt[h.triggerKey] = observedAt;
    return { ...h, suppressed };
  });

  return { occurrences, snapshot: { values: current, lastFiredAt }, baseline: prev === null };
}

/** Próxima verificação com backoff exponencial em caso de falha (máx. 6 h). */
export function nextRunAt(now: Date, everyMinutes: number, consecutiveFailures: number): Date {
  if (consecutiveFailures <= 0) return new Date(now.getTime() + everyMinutes * 60_000);
  const backoff = Math.min(everyMinutes * 2 ** consecutiveFailures, 360);
  return new Date(now.getTime() + backoff * 60_000);
}
