import type { AuthContext, DashboardSpec } from '@ada/contracts';
import { MemoryInput, PreferenceInput } from '@ada/contracts';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { invalid, notFound } from '../errors.ts';

export interface DraftDashboard {
  spec: DashboardSpec;
  history: DashboardSpec[];
  savedDashboardId?: string;
}

export interface ConversationRow {
  id: string;
  owner_user_id: number;
  unit_id: number;
  title: string;
  draft_dashboard: DraftDashboard | null;
  dashboard_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Memória privada do usuário. Toda consulta filtra pelo DONO e pela unidade ativa;
 * não existe caminho (API, ferramenta de IA ou admin) para ler conversas de outra pessoa.
 */
export class ConversationService {
  constructor(private readonly d: Deps) {}

  async create(ctx: AuthContext, title = 'Nova conversa'): Promise<ConversationRow> {
    const r = await this.d.db.query<ConversationRow>(
      `INSERT INTO ada.conversation (owner_user_id, unit_id, title) VALUES ($1,$2,$3) RETURNING *`,
      [ctx.systemUserId, ctx.activeUnitId, title.slice(0, 120)]
    );
    return r.rows[0]!;
  }

  async get(ctx: AuthContext, id: string): Promise<ConversationRow> {
    if (!z.uuid().safeParse(id).success) throw notFound('Conversa');
    const r = await this.d.db.query<ConversationRow>(
      `SELECT * FROM ada.conversation WHERE id = $1 AND owner_user_id = $2 AND unit_id = $3 AND deleted_at IS NULL`,
      [id, ctx.systemUserId, ctx.activeUnitId]
    );
    if (!r.rows[0]) throw notFound('Conversa');
    return r.rows[0];
  }

  async list(ctx: AuthContext, search?: string) {
    const params: unknown[] = [ctx.systemUserId, ctx.activeUnitId];
    let where = 'owner_user_id = $1 AND unit_id = $2 AND deleted_at IS NULL';
    if (search) {
      params.push(`%${search.replace(/[%_\\]/g, (c) => '\\' + c).slice(0, 80)}%`);
      where += ` AND title ILIKE $${params.length}`;
    }
    const r = await this.d.db.query(
      `SELECT id, title, created_at, updated_at, archived_at, dashboard_id FROM ada.conversation WHERE ${where} ORDER BY updated_at DESC LIMIT 200`,
      params
    );
    return r.rows;
  }

  async messages(ctx: AuthContext, id: string) {
    await this.get(ctx, id);
    const r = await this.d.db.query<{ id: string; role: string; content_enc: string; metadata: unknown; created_at: Date }>(
      `SELECT id, role, content_enc, metadata, created_at FROM ada.message WHERE conversation_id = $1 AND owner_user_id = $2 ORDER BY created_at, id`,
      [id, ctx.systemUserId]
    );
    return r.rows.map((m) => ({ id: m.id, role: m.role, content: this.d.cipher.decrypt(m.content_enc), metadata: m.metadata, createdAt: m.created_at }));
  }

  async addMessage(ctx: AuthContext, conversationId: string, role: 'user' | 'assistant' | 'system_note', content: string, metadata: Record<string, unknown> = {}) {
    const r = await this.d.db.query<{ id: string; created_at: Date }>(
      `INSERT INTO ada.message (conversation_id, owner_user_id, role, content_enc, metadata) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [conversationId, ctx.systemUserId, role, this.d.cipher.encrypt(content), metadata]
    );
    await this.d.db.query(`UPDATE ada.conversation SET updated_at = now() WHERE id = $1`, [conversationId]);
    return r.rows[0]!;
  }

  async setDraft(ctx: AuthContext, id: string, draft: DraftDashboard | null) {
    await this.get(ctx, id);
    await this.d.db.query(`UPDATE ada.conversation SET draft_dashboard = $2, updated_at = now() WHERE id = $1`, [id, draft]);
  }

  async rename(ctx: AuthContext, id: string, title: string) {
    await this.get(ctx, id);
    await this.d.db.query(`UPDATE ada.conversation SET title = $2, updated_at = now() WHERE id = $1`, [id, title.slice(0, 120)]);
  }

  async remove(ctx: AuthContext, id: string) {
    await this.get(ctx, id);
    // Exclusão definitiva das mensagens; conversa fica marcada para trilha mínima sem conteúdo.
    await this.d.db.query(`DELETE FROM ada.message WHERE conversation_id = $1`, [id]);
    await this.d.db.query(`UPDATE ada.conversation SET deleted_at = now(), title = '(excluída)', draft_dashboard = NULL WHERE id = $1`, [id]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conversa.excluida', targetType: 'conversation', targetId: id, outcome: 'ok' });
  }

  /* ----------------------------------------------------------- memória e preferências */

  async listMemories(ctx: AuthContext) {
    const r = await this.d.db.query<{ id: string; kind: string; content_enc: string; sensitivity: string; origin: string; created_at: Date }>(
      `SELECT id, kind, content_enc, sensitivity, origin, created_at FROM ada.user_memory WHERE owner_user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [ctx.systemUserId]
    );
    return r.rows.map((m) => ({ id: m.id, kind: m.kind, content: this.d.cipher.decrypt(m.content_enc), sensitivity: m.sensitivity, origin: m.origin, createdAt: m.created_at }));
  }

  async addMemory(ctx: AuthContext, input: unknown) {
    const p = MemoryInput.safeParse(input);
    if (!p.success) throw invalid('Memória inválida.', p.error.issues);
    const r = await this.d.db.query<{ id: string }>(
      `INSERT INTO ada.user_memory (owner_user_id, unit_id, kind, content_enc, sensitivity, origin) VALUES ($1,$2,$3,$4,$5,'usuario') RETURNING id`,
      [ctx.systemUserId, ctx.activeUnitId, p.data.kind, this.d.cipher.encrypt(p.data.content), p.data.sensitivity]
    );
    return r.rows[0]!;
  }

  async deleteMemory(ctx: AuthContext, id: string) {
    if (!z.uuid().safeParse(id).success) throw notFound('Memória');
    const r = await this.d.db.query(`UPDATE ada.user_memory SET deleted_at = now(), content_enc = $3 WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`, [
      id, ctx.systemUserId, this.d.cipher.encrypt('')
    ]);
    if (r.rowCount === 0) throw notFound('Memória');
  }

  async preferences(ctx: AuthContext): Promise<Record<string, unknown>> {
    const r = await this.d.db.query<{ prefs: Record<string, unknown> }>(`SELECT prefs FROM ada.user_preference WHERE owner_user_id = $1`, [ctx.systemUserId]);
    return { theme: 'auto', remember_conversations: true, quiet_hours: null, retention_days: 365, ...(r.rows[0]?.prefs ?? {}) };
  }

  async setPreferences(ctx: AuthContext, input: unknown) {
    const p = PreferenceInput.safeParse(input);
    if (!p.success) throw invalid('Preferências inválidas.', p.error.issues);
    await this.d.db.query(
      `INSERT INTO ada.user_preference (owner_user_id, prefs) VALUES ($1,$2)
       ON CONFLICT (owner_user_id) DO UPDATE SET prefs = ada.user_preference.prefs || EXCLUDED.prefs, updated_at = now()`,
      [ctx.systemUserId, p.data]
    );
    return this.preferences(ctx);
  }

  /** Exportação (LGPD — acesso/portabilidade) apenas dos próprios dados. */
  async exportAll(ctx: AuthContext) {
    const convs = await this.d.db.query<{ id: string; title: string; unit_id: number; created_at: Date }>(
      `SELECT id, title, unit_id, created_at FROM ada.conversation WHERE owner_user_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [ctx.systemUserId]
    );
    const out = [];
    for (const c of convs.rows) {
      const msgs = await this.d.db.query<{ role: string; content_enc: string; created_at: Date }>(
        `SELECT role, content_enc, created_at FROM ada.message WHERE conversation_id = $1 AND owner_user_id = $2 ORDER BY created_at`,
        [c.id, ctx.systemUserId]
      );
      out.push({ ...c, messages: msgs.rows.map((m) => ({ role: m.role, content: this.d.cipher.decrypt(m.content_enc), createdAt: m.created_at })) });
    }
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'usuario.exportacao_dados', outcome: 'ok' });
    return { exportedAt: new Date().toISOString(), user: { systemUserId: ctx.systemUserId, login: ctx.login }, conversations: out, memories: await this.listMemories(ctx), preferences: await this.preferences(ctx) };
  }

  /** Política de retenção: remove conversas inativas além do prazo escolhido pelo usuário. */
  async applyRetention(): Promise<number> {
    const r = await this.d.db.query(
      `UPDATE ada.conversation c SET deleted_at = now(), title = '(expirada)', draft_dashboard = NULL
       WHERE c.deleted_at IS NULL
         AND c.updated_at < now() - make_interval(days => COALESCE(
           (SELECT (p.prefs->>'retention_days')::int FROM ada.user_preference p WHERE p.owner_user_id = c.owner_user_id), 365))
       RETURNING c.id`
    );
    if (r.rowCount) await this.d.db.query(`DELETE FROM ada.message m USING ada.conversation c WHERE m.conversation_id = c.id AND c.deleted_at IS NOT NULL`);
    return r.rowCount;
  }
}
