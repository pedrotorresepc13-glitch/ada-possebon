import { z } from 'zod';
import { CatalogId, FieldName, ScalarValue } from './common.ts';

/**
 * Linguagem declarativa de regras de monitoramento.
 * A IA apenas PROPÕE uma RuleDefinition; o motor determinístico a executa.
 * Nenhum campo aceita código, expressão livre ou SQL.
 */
export const RuleFilter = z
  .object({
    field: FieldName,
    op: z.enum(['eq', 'neq', 'in']),
    value: z.union([ScalarValue, z.array(ScalarValue).min(1).max(50)])
  })
  .strict();
export type RuleFilter = z.infer<typeof RuleFilter>;

export const Trigger = z.discriminatedUnion('type', [
  z.object({ type: z.literal('field_changed'), field: FieldName }).strict(),
  z.object({ type: z.literal('status_changed'), field: FieldName, to: z.array(ScalarValue).max(20).optional() }).strict(),
  z.object({ type: z.literal('record_created') }).strict(),
  z.object({ type: z.literal('no_update_for'), field: FieldName, duration_hours: z.number().int().min(1).max(2160) }).strict(),
  z.object({ type: z.literal('deadline_near'), field: FieldName, within_hours: z.number().int().min(1).max(720) }).strict(),
  z.object({ type: z.literal('deadline_passed'), field: FieldName }).strict(),
  z
    .object({
      type: z.literal('threshold'),
      field: FieldName,
      op: z.enum(['gt', 'gte', 'lt', 'lte', 'eq']),
      value: z.number().finite()
    })
    .strict(),
  z
    .object({
      type: z.literal('change_pct'),
      field: FieldName,
      direction: z.enum(['increase', 'decrease', 'any']),
      pct: z.number().positive().max(10000)
    })
    .strict()
]);
export type Trigger = z.infer<typeof Trigger>;
export type TriggerType = Trigger['type'];

export const RuleAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('in_app_notification'), recipient: z.literal('rule_owner') }).strict()
]);
export type RuleAction = z.infer<typeof RuleAction>;

export const RuleDefinition = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(120),
    source: CatalogId,
    /** Escopo é sempre resolvido no backend a partir da sessão autenticada. */
    scope: z.object({ unit: z.literal('from_authenticated_session') }).strict().default({ unit: 'from_authenticated_session' }),
    filters: z.array(RuleFilter).max(5).default([]),
    triggers: z.array(Trigger).min(1).max(6),
    /** Composição lógica limitada e verificável. */
    match: z.enum(['any', 'all']).default('any'),
    actions: z.array(RuleAction).min(1).max(3).default([{ type: 'in_app_notification', recipient: 'rule_owner' }]),
    cooldown_minutes: z.number().int().min(0).max(10080).default(60),
    /** Intervalo de verificação por polling incremental, quando não houver eventos. */
    check_every_minutes: z.number().int().min(5).max(1440).optional(),
    /** Ignorado na criação: ativação só ocorre após confirmação explícita. */
    enabled: z.boolean().default(false)
  })
  .strict();
export type RuleDefinition = z.infer<typeof RuleDefinition>;
export type RuleDefinitionInput = z.input<typeof RuleDefinition>;

export const MonitorStatus = z.enum(['draft', 'active', 'paused', 'degraded', 'deleted']);
export type MonitorStatus = z.infer<typeof MonitorStatus>;

/** Resposta do RuleDesigner quando o pedido não cabe na biblioteca. */
export const RuleProposal = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), definition: RuleDefinition, explanation: z.string() }),
  z.object({ status: z.literal('requires_implementation'), reason: z.string(), suggestion: z.string().optional() })
]);
export type RuleProposal = z.infer<typeof RuleProposal>;

/** Evento normalizado vindo de webhook/outbox ou polling. */
export const NormalizedEvent = z
  .object({
    source: CatalogId,
    recordKey: z.string().min(1).max(120),
    unitId: z.number().int().positive(),
    occurredAt: z.iso.datetime({ offset: true }),
    version: z.string().max(80).optional(),
    eventId: z.string().min(1).max(120),
    record: z.record(z.string(), z.unknown())
  })
  .strict();
export type NormalizedEvent = z.infer<typeof NormalizedEvent>;
