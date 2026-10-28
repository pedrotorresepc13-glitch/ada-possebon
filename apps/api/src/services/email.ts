import tls from 'node:tls';
import type { AuthContext } from '@ada/contracts';
import { assertSafeUrl } from '@ada/domain';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { invalid, notFound } from '../errors.ts';

export const EmailAccountInput = z
  .object({
    kind: z.enum(['email_imap', 'email_gmail', 'email_graph']),
    label: z.string().trim().min(1).max(120),
    unit_id: z.number().int().positive(),
    allowed_user_ids: z.array(z.number().int().positive()).max(500).default([]),
    allowed_group_ids: z.array(z.number().int().positive()).max(100).default([]),
    config: z
      .object({
        host: z.string().trim().max(255).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        username: z.string().trim().max(255).optional(),
        folders: z.array(z.string().max(120)).max(20).default(['INBOX']),
        attachments: z.enum(['nao_indexar', 'somente_texto']).default('nao_indexar'),
        tenant: z.string().max(120).optional()
      })
      .strict(),
    /** Senha de app ou token OAuth. Gravado cifrado; nunca retornado. */
    secret: z.string().min(1).max(4000).optional()
  })
  .strict();

interface AccountRow {
  id: string;
  kind: string;
  label: string;
  unit_id: number;
  allowed_user_ids: number[];
  allowed_group_ids: number[];
  config: Record<string, unknown>;
  secret_enc: string | null;
  status: string;
  sending_enabled: boolean;
  last_test_at: Date | null;
  last_test_result: string | null;
  last_sync_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Representação pública: credenciais nunca saem do servidor. */
function publicView(r: AccountRow) {
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    unitId: r.unit_id,
    allowedUserIds: r.allowed_user_ids,
    allowedGroupIds: r.allowed_group_ids,
    config: r.config,
    hasSecret: Boolean(r.secret_enc),
    status: r.status,
    sendingEnabled: r.sending_enabled,
    lastTestAt: r.last_test_at,
    lastTestResult: r.last_test_result,
    lastSyncAt: r.last_sync_at,
    sync: 'Recepção/indexação incremental: preparada (contrato e armazenamento); sincronização ainda não implementada nesta versão.',
    sending: 'Envio externo desabilitado. Futuro: rascunho + confirmação explícita antes de transmitir.'
  };
}

/** Teste de conexão IMAP real (TLS 993): saudação, LOGIN e LOGOUT. Não lê mensagens. */
export function imapLoginTest(host: string, port: number, username: string, password: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port, servername: host, timeout: timeoutMs });
    let buf = '';
    let stage = 0;
    const quote = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const done = (err: Error | null, msg?: string) => {
      sock.destroy();
      if (err) reject(err);
      else resolve(msg!);
    };
    sock.on('timeout', () => done(new Error('Tempo limite na conexão IMAP')));
    sock.on('error', (e) => done(new Error('Falha de conexão IMAP: ' + e.message)));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      if (stage === 0 && /^\* OK/m.test(buf)) {
        stage = 1;
        buf = '';
        sock.write(`a1 LOGIN ${quote(username)} ${quote(password)}\r\n`);
      } else if (stage === 1 && /^a1 (OK|NO|BAD)/m.test(buf)) {
        if (/^a1 OK/m.test(buf)) {
          stage = 2;
          sock.write('a2 LOGOUT\r\n');
          done(null, 'Conexão TLS e autenticação IMAP bem-sucedidas.');
        } else done(new Error('Servidor IMAP recusou as credenciais.'));
      }
    });
  });
}

export class EmailService {
  constructor(private readonly d: Deps) {}

  async list() {
    const r = await this.d.db.query<AccountRow>(`SELECT * FROM ada.integration_account WHERE deleted_at IS NULL ORDER BY created_at DESC`);
    return r.rows.map(publicView);
  }

  private async row(id: string): Promise<AccountRow> {
    if (!z.uuid().safeParse(id).success) throw notFound('Conta');
    const r = await this.d.db.query<AccountRow>(`SELECT * FROM ada.integration_account WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!r.rows[0]) throw notFound('Conta');
    return r.rows[0];
  }

  async create(ctx: AuthContext, input: unknown) {
    const p = EmailAccountInput.safeParse(input);
    if (!p.success) throw invalid('Conta inválida.', p.error.issues);
    if (!ctx.allowedUnitIds.includes(p.data.unit_id)) throw invalid('Unidade fora do seu escopo.');
    if (p.data.kind === 'email_imap' && p.data.config.host) assertSafeUrl(`https://${p.data.config.host}/`);
    const configured = p.data.kind === 'email_imap' ? Boolean(p.data.config.host && p.data.config.username && p.data.secret) : false;
    const r = await this.d.db.query<AccountRow>(
      `INSERT INTO ada.integration_account (kind, label, unit_id, allowed_user_ids, allowed_group_ids, config, secret_enc, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        p.data.kind, p.data.label, p.data.unit_id, p.data.allowed_user_ids, p.data.allowed_group_ids, p.data.config,
        p.data.secret ? this.d.cipher.encrypt(p.data.secret) : null, configured ? 'configurado_nao_validado' : 'nao_configurado', ctx.systemUserId
      ]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'email.conta_criada', targetType: 'integration_account', targetId: r.rows[0]!.id, outcome: 'ok', details: { kind: p.data.kind } });
    return publicView(r.rows[0]!);
  }

  async test(ctx: AuthContext, id: string) {
    const a = await this.row(id);
    let ok = false;
    let message: string;
    if (a.kind !== 'email_imap') {
      message = 'OAuth (Gmail/Microsoft Graph) requer registro de aplicativo e consentimento do provedor; ainda não configurado.';
    } else if (!a.secret_enc || !a.config.host || !a.config.username) {
      message = 'Conta não configurada: informe servidor, usuário e senha de aplicativo.';
    } else {
      try {
        message = await imapLoginTest(String(a.config.host), Number(a.config.port ?? 993), String(a.config.username), this.d.cipher.decrypt(a.secret_enc));
        ok = true;
      } catch (err) {
        message = (err as Error).message;
      }
    }
    await this.d.db.query(
      `UPDATE ada.integration_account SET last_test_at = now(), last_test_result = $2, status = CASE WHEN $3 THEN 'configurado_nao_validado' WHEN status = 'nao_configurado' THEN status ELSE 'erro' END, updated_at = now() WHERE id = $1`,
      [id, message, ok]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'email.teste_conexao', targetType: 'integration_account', targetId: id, outcome: ok ? 'ok' : 'erro' });
    return { ok, message };
  }

  async remove(ctx: AuthContext, id: string) {
    await this.row(id);
    await this.d.db.query(`UPDATE ada.integration_account SET deleted_at = now(), secret_enc = NULL, status = 'desabilitado' WHERE id = $1`, [id]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'email.conta_removida', targetType: 'integration_account', targetId: id, outcome: 'ok' });
  }

  /** ACL de leitura futura: conta configurada por admin não dá acesso irrestrito a qualquer usuário. */
  canUserRead(ctx: AuthContext, a: { unit_id: number; allowed_user_ids: number[]; allowed_group_ids: number[] }): boolean {
    if (a.unit_id !== ctx.activeUnitId) return false;
    return a.allowed_user_ids.includes(ctx.systemUserId) || ctx.groups.some((g) => a.allowed_group_ids.includes(g.id));
  }
}
