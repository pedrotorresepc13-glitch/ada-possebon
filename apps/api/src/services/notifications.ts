import type { AuthContext, NotificationDto } from '@ada/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { audit } from '../audit.ts';
import type { Deps } from '../core.ts';
import { forbidden, invalid, notFound } from '../errors.ts';

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

export const SendNotificationInput = z.object({
  recipient: z.string().trim().min(1).max(120).optional(),
  recipientUserId: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(160).default('Mensagem do POSSO'),
  message: z.string().trim().min(1).max(1800),
  severity: z.enum(['info', 'aviso', 'critico']).default('info')
}).strict().refine(value => Boolean(value.recipient) !== Boolean(value.recipientUserId), {
  message: 'Informe apenas o login/nome ou o ID do destinatário.'
});

interface Recipient {
  systemUserId: number;
  login: string;
  displayName: string;
}

/** Central de notificações persistida. Escopo: destinatário + unidade ativa. */
export class NotificationService {
  constructor(private readonly d: Deps) {}

  /**
   * Ferramenta de escrita do POSSO. Toda pessoa pode solicitar envios; a identidade,
   * a unidade real do destinatário e a gravação são conferidas pelo servidor.
   * Nunca confunda uma mensagem gerada com uma notificação efetivamente registrada.
   */
  async send(ctx: AuthContext, raw: unknown, requestKey?: string) {
    const input = SendNotificationInput.parse(raw);
    if (!ctx.allowedUnitIds.includes(ctx.activeUnitId)) throw forbidden('Unidade da sessão inválida.');
    let id = input.recipientUserId;
    if (!id && input.recipient) {
      const value = input.recipient.toLocaleLowerCase('pt-BR');
      const local = await this.d.db.query<{ system_user_id: number }>(
        'SELECT system_user_id FROM ada.user_identity_map WHERE lower(login)=$1 OR lower(display_name)=$1 ORDER BY system_user_id LIMIT 3',
        [value]
      );
      if (local.rows.length > 1) throw invalid('Existem vários usuários com esse nome. Indique o login exato ou o ID.');
      id = local.rows[0]?.system_user_id;
      if (!id) {
        try {
          const directory = await this.d.operational.query(ctx, {
            from: 'system_users',
            select: [{ field: 'system_users.id', as: 'id' }],
            where: [{ field: 'system_users.login', op: 'eq', value: input.recipient }],
            limit: 3
          });
          if (directory.rows.length === 1) id = Number(directory.rows[0]?.id);
          else if (directory.rows.length > 1) throw invalid('Login ambíguo. Informe o identificador do destinatário.');
        } catch (error) {
          if (error instanceof Error && error.message.includes('ambíguo')) throw error;
          // A integração de identidade por ID continua sendo a autoridade para o envio.
        }
      }
      if (!id) throw invalid('Não localizei esse destinatário. Informe o login exato ou seu ID no POSSEBON.');
    }
    if (!id) throw invalid('Informe o destinatário.');
    const identity = await this.d.identity.resolve(id);
    if (!identity || !identity.active) throw invalid('Destinatário inexistente ou inativo no POSSEBON.');
    if (!identity.units.some(unit => unit.id === ctx.activeUnitId)) throw forbidden('Destinatário não pertence à unidade atual.');
    const token = requestKey ?? randomUUID();
    const dedupeKey = createHash('sha256')
      .update(JSON.stringify([ctx.systemUserId, ctx.activeUnitId, id, token, input.title, input.message])).digest('hex');
    const result = await this.d.db.tx(async q => {
      const created = await q.query<{ id: string }>(
        `INSERT INTO ada.notification(recipient_user_id,unit_id,severity,title,body,source_id,evidence,dedupe_key)
         VALUES($1,$2,$3,$4,$5,'posso.chat',$6,$7)
         ON CONFLICT(recipient_user_id,dedupe_key) DO NOTHING RETURNING id`,
        [id, ctx.activeUnitId, input.severity, input.title, input.message,
          { actorUserId: ctx.systemUserId, via: 'posso.chat' }, dedupeKey]
      );
      if (created.rows[0]) {
        await audit(q, { actor: ctx.systemUserId, unit: ctx.activeUnitId,
          action: 'notificacao.interna_enviada', targetType: 'notification',
          targetId: created.rows[0].id, outcome: 'ok',
          details: { recipientUserId: id, severity: input.severity, channel: 'in_app' } });
        return { id: created.rows[0].id, created: true };
      }
      const existing = await q.query<{ id: string }>(
        'SELECT id FROM ada.notification WHERE recipient_user_id=$1 AND dedupe_key=$2', [id, dedupeKey]
      );
      return { id: existing.rows[0]?.id, created: false };
    });
    return {
      ok: Boolean(result.id), delivered: Boolean(result.id),
      alreadySent: !result.created, notificationId: result.id,
      channel: 'in_app', recipientUserId: id, recipientLogin: identity.login,
      unitId: ctx.activeUnitId, title: input.title
    };
  }

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
