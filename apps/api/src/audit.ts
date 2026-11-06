import type { Queryable } from './db.ts';
import { redactSecrets } from '@ada/domain';

export interface AuditEntry {
  actor?: number | null;
  unit?: number | null;
  action: string;
  targetType?: string;
  targetId?: string;
  outcome: 'ok' | 'negado' | 'erro';
  /** Nunca incluir texto privado de conversas ou segredos. */
  details?: Record<string, unknown>;
}

export async function audit(q: Queryable, e: AuditEntry): Promise<void> {
  const details = e.details ? JSON.parse(redactSecrets(JSON.stringify(e.details))) : {};
  await q.query(
    `INSERT INTO ada.audit_event (actor_user_id, unit_id, action, target_type, target_id, outcome, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.actor ?? null, e.unit ?? null, e.action, e.targetType ?? null, e.targetId ?? null, e.outcome, details]
  );
}
