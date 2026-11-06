import { NormalizedEvent } from '@ada/contracts';
import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { isProtectedTable } from './unit-path.ts';
import { forbidden } from '../errors.ts';

const checkpointKey = 'possebon:outbox:sequence';
const changeKey = (unitId: number, table: string) => `possebon:change:${unitId}:${table}`;

/** Metadados de mudanças da unidade, sem chaves de registros nem conteúdo operacional. */
export async function operationalChangeEvidence(d: Deps, ctx: AuthContext, table: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table) || isProtectedTable(table) ||
      !ctx.allowedUnitIds.includes(ctx.activeUnitId) || ctx.identitySource !== 'possebon') {
    throw forbidden('A consulta de mudanças exige tabela de negócio e unidade autorizada.');
  }
  // O sinal é por tabela e unidade. Um acesso limitado a um registro não autoriza
  // inferir atividade dos outros registros por essa via.
  const policy = await d.operationalAccess.policy(ctx);
  if (!policy.admin) throw forbidden('O sinal de mudanças por tabela exige administração POSSEBON.');
  if (!d.config.possebonOutbox) return { table, unitId: ctx.activeUnitId, state: 'fila_desabilitada' };
  const structure = await d.operational.explore(ctx, '', table);
  if (!structure.tabelas.some(item => item.nome === table)) {
    return { table, unitId: ctx.activeUnitId, state: 'estrutura_nao_confirmada' };
  }
  const stored = await d.db.query<{ value: { occurredAt: string; receivedAt: string; sequence: string } }>(
    'SELECT value FROM ada.app_setting WHERE key=$1', [changeKey(ctx.activeUnitId, table)]
  );
  const last = stored.rows[0]?.value;
  return last
    ? { table, unitId: ctx.activeUnitId, state: 'evento_observado', last, requiresCurrentQuery: true }
    : { table, unitId: ctx.activeUnitId, state: 'sem_evento_observado' };
}

/** A origem serializa a atribuição da sequência dentro da transação de publicação. */
export async function pullPossebonOutbox(d: Deps): Promise<number> {
  if (!d.config.possebonOutbox) return 0;
  const source = await d.catalog.operationalSource(0);
  return d.db.tx(async q => {
    await q.query(
      'INSERT INTO ada.app_setting(key,value) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING',
      [checkpointKey, JSON.stringify({ sequence: '0' })]
    );
    const saved = await q.query<{ value: { sequence: string } }>(
      'SELECT value FROM ada.app_setting WHERE key=$1 FOR UPDATE', [checkpointKey]
    );
    const sequence = saved.rows[0]!.value.sequence;
    if (!/^\d{1,19}$/.test(sequence)) throw new Error('Ponto de leitura inválido na fila POSSEBON.');
    const batch = await source.executeRead<{ sequence: string; event: unknown }>(
      `SELECT sequence::text AS sequence, event FROM posso_integration.change_outbox
       WHERE sequence > $1::bigint ORDER BY change_outbox.sequence LIMIT 100`, [sequence]
    );
    let position = BigInt(sequence);
    let inserted = 0;
    for (const row of batch.rows) {
      if (!/^\d{1,19}$/.test(row.sequence) || BigInt(row.sequence) !== position + 1n) {
        throw new Error('Lacuna detectada na fila POSSEBON. O ponto de leitura foi preservado.');
      }
      const event = NormalizedEvent.parse(row.event);
      const operational = event.source === 'possebon.operational';
      const table = event.record.table;
      if (operational && (typeof table !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(table) ||
          isProtectedTable(table) || Object.keys(event.record).length !== 1)) {
        throw new Error('Evento operacional deve identificar apenas uma tabela de negócio.');
      }
      if (!operational && (!Object.hasOwn(d.catalog.catalog.sources, event.source) ||
          !d.catalog.catalog.sources[event.source]?.monitor)) {
        throw new Error('A fila POSSEBON contém uma fonte sem contrato de monitoramento.');
      }
      const result = await q.query(
        `INSERT INTO ada.inbound_event(source_id,event_id,record_key,unit_id,occurred_at,payload,processed_at)
         VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN now() END) ON CONFLICT (source_id,event_id) DO NOTHING`,
        [event.source, event.eventId, event.recordKey, event.unitId, event.occurredAt, event.record, operational]
      );
      if (operational && result.rowCount) {
        await q.query(
          `INSERT INTO ada.app_setting(key,value) VALUES($1,$2::jsonb)
           ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
          [changeKey(event.unitId, String(table)), JSON.stringify({
            occurredAt: event.occurredAt, receivedAt: d.now().toISOString(), sequence: row.sequence
          })]
        );
        await q.query(
          `UPDATE ada.operational_watch SET next_check_at=LEAST(next_check_at,now())
           WHERE state='active' AND unit_id=$1 AND COALESCE(plan->'query'->>'from',plan->>'from')=$2
             AND (lease_until IS NULL OR lease_until<now())`,
          [event.unitId, table]
        );
      }
      inserted += result.rowCount;
      position = BigInt(row.sequence);
    }
    if (position !== BigInt(sequence)) {
      await q.query(
        'UPDATE ada.app_setting SET value=$2::jsonb,updated_at=now() WHERE key=$1',
        [checkpointKey, JSON.stringify({ sequence: position.toString() })]
      );
    }
    return inserted;
  });
}
