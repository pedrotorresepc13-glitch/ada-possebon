import type { AuthContext, NotificationDto } from '@ada/contracts';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { notFound } from '../errors.ts';

interface NotificationRow {
  id: string;
  severity: NotificationDto['severity'];
  title: string;
  body: string;
  source_id: string | null;
  monitor_id: string | null;
  dashboard_id: string | null;
  created_at: Date;
  read_at: Date | null;
  acknowledged_at: Date | null;
  evidence: unknown;
}

const toDto = (r: NotificationRow): NotificationDto => ({
  id: r.id,
  severity: r.severity,
  title: r.title,
  body: r.body,
  source: r.source_id,
  monitorId: r.monitor_id,
  dashboardId: r.dashboard_id,
  createdAt: new Date(r.created_at).toISOString(),
  readAt: r.read_at ? new Date(r.read_at).toISOString() : null,
  acknowledgedAt: r.acknowledged_at ? new Date(r.acknowledged_at).toISOString() : null,
  evidence: r.evidence
});

/** Central de notificações persistida. Escopo: destinatário + unidade ativa. */
export class NotificationService {
  constructor(private readonly d: Deps) {}

  async list(ctx: AuthContext, opts: { unreadOnly?: boolean; severity?: string; limit?: number } = {}) {
    const params: unknown[] = [ctx.systemUserId, ctx.activeUnitId];
    let where = 'recipient_user_id = $1 AND unit_id = $2';
    if (opts.unreadOnly) where += ' AND read_at IS NULL';
    if (opts.severity && ['info', 'aviso', 'critico'].includes(opts.severity)) {
      params.push(opts.severity);
      where += ` AND severity = $${params.length}`;
    }
    params.push(Math.min(opts.limit ?? 50, 200));
    const r = await this.d.db.query<NotificationRow>(
      `SELECT id, severity, title, body, source_id, monitor_id, dashboard_id, created_at, read_at, acknowledged_at, evidence
       FROM ada.notification WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return r.rows.map(toDto);
  }

  async unreadCount(ctx: AuthContext): Promise<number> {
    const r = await this.d.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ada.notification WHERE recipient_user_id = $1 AND unit_id = $2 AND read_at IS NULL`,
      [ctx.systemUserId, ctx.activeUnitId]
    );
    return r.rows[0]?.n ?? 0;
  }

  async mark(ctx: AuthContext, id: string, what: 'read' | 'ack') {
    if (!z.uuid().safeParse(id).success) throw notFound('Notificação');
    const col = what === 'read' ? 'read_at = COALESCE(read_at, now())' : 'acknowledged_at = COALESCE(acknowledged_at, now()), read_at = COALESCE(read_at, now())';
    const r = await this.d.db.query(`UPDATE ada.notification SET ${col} WHERE id = $1 AND recipient_user_id = $2 AND unit_id = $3`, [
      id, ctx.systemUserId, ctx.activeUnitId
    ]);
    if (r.rowCount === 0) throw notFound('Notificação');
  }

  async markAllRead(ctx: AuthContext) {
    await this.d.db.query(`UPDATE ada.notification SET read_at = now() WHERE recipient_user_id = $1 AND unit_id = $2 AND read_at IS NULL`, [
      ctx.systemUserId, ctx.activeUnitId
    ]);
  }
}
