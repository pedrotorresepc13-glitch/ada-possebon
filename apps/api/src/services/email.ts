import tls from 'node:tls';
import type { AuthContext } from '@ada/contracts';
import { assertAdmin, assertSafeUrl, redactSecrets } from '@ada/domain';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { invalid, notFound } from '../errors.ts';
import { graphMailPage, graphAppPage, graphAppTest, graphAppSend } from './graph-mail.ts';

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
        tenant: z.string().max(120).optional(),
        graph_sync: z.boolean().optional(),
        mailbox: z.string().trim().email().max(254).optional(),
        auth_mode: z.enum(['delegated_refresh','app_only']).optional(),
        purpose: z.enum(['institutional','posso']).optional()
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
  watermark: string | null;
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
    sync: r.kind === 'email_graph' && r.config.graph_sync === true
      ? 'Microsoft Graph: sincronização incremental da caixa de entrada habilitada.'
      : 'Sincronização não habilitada para esta conta.',
    sending: r.sending_enabled ? 'Habilitado: exige rascunho e confirmação por pessoa autorizada.' : 'Desabilitado. Habilite somente após validar leitura e permissões Microsoft Graph.'
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
  private nextGraphPoll = 0;
  constructor(private readonly d: Deps) {}

  private cacheKey(id: string) { return 'mail:graph:' + id; }

  async syncGraph(ctx: AuthContext, id: string) {
    assertAdmin(ctx);
    const account = await this.row(id);
    if (!ctx.allowedUnitIds.includes(account.unit_id)||account.unit_id!==ctx.activeUnitId) throw notFound('Conta');
    const clientId = process.env.POSSO_GRAPH_CLIENT_ID;
    const clientSecret = process.env.POSSO_GRAPH_CLIENT_SECRET;
    const appOnly = account.config.auth_mode === 'app_only';
    if (account.kind !== 'email_graph' || account.config.graph_sync !== true ||
        (!appOnly && !account.secret_enc) || !clientId || !clientSecret) {
      throw invalid('Conta Microsoft Graph ainda sem configuração de sincronização.');
    }
    const cursor = account.watermark ? this.d.cipher.decrypt(account.watermark) : undefined;
    const page = appOnly
      ? await graphAppPage({
        tenant: String(account.config.tenant ?? ''), clientId, clientSecret,
        mailbox: String(account.config.mailbox ?? ''), cursor
      })
      : await graphMailPage({
        tenant: String(account.config.tenant ?? ''), clientId, clientSecret,
        refreshToken: this.d.cipher.decrypt(account.secret_enc!), cursor
      });
    return this.d.db.tx(async q => {
      const row = (await q.query<AccountRow>(
        'SELECT * FROM ada.integration_account WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [id]
      )).rows[0];
      if (!row || row.watermark !== account.watermark || row.secret_enc !== account.secret_enc) {
        throw invalid('A conta mudou durante a leitura. Atualize e tente novamente.');
      }
      const key = this.cacheKey(id);
      const saved = (await q.query<{ value: { encrypted: string } }>('SELECT value FROM ada.app_setting WHERE key=$1', [key])).rows[0];
      type Entry = { id: string; subject: string; excerpt: string; body?: string; from?: string;
        conversationId?: string; receivedAt: string | null };
      const existing: Entry[] = saved ? JSON.parse(this.d.cipher.decrypt(saved.value.encrypted)) : [];
      const messages = new Map(existing.map(entry => [entry.id, entry]));
      for (const message of page.messages) {
        if (message['@removed']) { messages.delete(message.id); continue; }
        const previous = messages.get(message.id);
        messages.set(message.id, {
          id: message.id,
          subject: message.subject === undefined ? previous?.subject ?? '' : redactSecrets(message.subject ?? '').slice(0, 300),
          excerpt: message.bodyPreview === undefined ? previous?.excerpt ?? '' : redactSecrets(message.bodyPreview ?? '').slice(0, 800),
          ...('body' in message && message.body ? { body: redactSecrets(message.body.content ?? '').slice(0, 16000) } :
            previous?.body !== undefined ? { body: previous.body } : {}),
          ...('from' in message && message.from?.emailAddress?.address
            ? { from: message.from.emailAddress.address.slice(0,254) } :
              previous?.from ? {from:previous.from} : {}),
          ...('conversationId' in message && message.conversationId
            ? {conversationId:message.conversationId} : previous?.conversationId?{conversationId:previous.conversationId}:{}),
          receivedAt: message.receivedDateTime === undefined ? previous?.receivedAt ?? null : message.receivedDateTime
        });
      }
      const entries = [...messages.values()].sort((a, b) => Date.parse(b.receivedAt ?? '1970-01-01') -
        Date.parse(a.receivedAt ?? '1970-01-01')).slice(0, 200);
      await q.query(
        `INSERT INTO ada.app_setting(key,value,updated_by) VALUES($1,$2,$3)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
        [key, { encrypted: this.d.cipher.encrypt(JSON.stringify(entries)) }, ctx.systemUserId]
      );
      await q.query(`UPDATE ada.integration_account SET watermark=$2, secret_enc=$3,
        last_sync_at=now(),updated_at=now(),status='ativo' WHERE id=$1`, [id,
        this.d.cipher.encrypt(page.cursor),
        appOnly ? account.secret_enc : this.d.cipher.encrypt('refreshToken' in page ? page.refreshToken : '')]);
      await audit(q, {actor:ctx.systemUserId,unit:account.unit_id,action:'email.graph_sincronizado',
        targetType:'integration_account',targetId:id,outcome:'ok',details:{changed:page.messages.length}});
      return { synchronized: page.messages.length, stored: entries.length };
    });
  }

  async tickGraph() {
    if (!this.d.config.isProduction || !process.env.POSSO_GRAPH_CLIENT_ID || !process.env.POSSO_GRAPH_CLIENT_SECRET ||
        Date.now() < this.nextGraphPoll) return;
    this.nextGraphPoll = Date.now() + 5 * 60_000;
    const result = await this.d.db.query<{ id: string; unit_id: number; created_by: number }>(
      `SELECT id,unit_id,created_by FROM ada.integration_account
       WHERE deleted_at IS NULL AND kind='email_graph' AND config->>'graph_sync'='true'
         AND (config->>'auth_mode'='app_only' OR secret_enc IS NOT NULL)
         AND (config->>'auth_mode'!='app_only' OR config->>'tenant' ~ '^[0-9a-fA-F-]{36}
         AND updated_at < now()-interval '5 minutes'
       ORDER BY updated_at,id LIMIT 4`
    );
    for (const account of result.rows) {
      try {
        const ctx = await this.d.sessions.resolveContext(account.created_by, account.unit_id, 'graph-mail-sync', { force: true });
        await this.syncGraph(ctx, account.id);
      } catch {
        await this.d.db.query(`UPDATE ada.integration_account SET updated_at=now()
          WHERE id=$1 AND deleted_at IS NULL`, [account.id]);
        this.d.log.warn({ accountId: account.id }, 'falha ao sincronizar caixa Microsoft Graph');
      }
    }
  }

  async readGraph(ctx: AuthContext, id: string) {
    const account = await this.row(id);
    if (account.kind !== 'email_graph' || account.config.graph_sync !== true || !this.canUserRead(ctx, account)) throw notFound('Conta');
    const result = await this.d.db.query<{ value: { encrypted: string } }>(
      'SELECT value FROM ada.app_setting WHERE key=$1', [this.cacheKey(id)]
    );
    return { account: account.label, messages: result.rows[0]
      ? JSON.parse(this.d.cipher.decrypt(result.rows[0].value.encrypted)) as unknown : [] };
  }

  async readableGraphAccounts(ctx: AuthContext) {
    if (!ctx.allowedUnitIds.includes(ctx.activeUnitId)) return [];
    const result = await this.d.db.query<{ id: string; label: string; last_sync_at: Date | null;
      mailbox:string|null;purpose:string|null;sending_enabled:boolean;status:string }>(
      `SELECT id,label,last_sync_at,config->>'mailbox' AS mailbox,
        config->>'purpose' AS purpose,sending_enabled,status
       FROM ada.integration_account
       WHERE deleted_at IS NULL AND kind='email_graph' AND config->>'graph_sync'='true'
         AND unit_id=$1 AND ($2=ANY(allowed_user_ids) OR allowed_group_ids && $3::int[])
       ORDER BY label,id LIMIT 100`, [ctx.activeUnitId, ctx.systemUserId, ctx.groups.map(group => group.id)]
    );
    return result.rows;
  }

  async list(ctx:AuthContext) {
    assertAdmin(ctx);
    const r = await this.d.db.query<AccountRow>(`SELECT * FROM ada.integration_account WHERE deleted_at IS NULL AND unit_id=$1 ORDER BY created_at DESC`,[ctx.activeUnitId]);
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
    if (!ctx.allowedUnitIds.includes(p.data.unit_id)||p.data.unit_id!==ctx.activeUnitId) throw invalid('Unidade fora da sessão atual.');
    const appOnly = p.data.kind === 'email_graph' && p.data.config.auth_mode === 'app_only';
    if (p.data.config.graph_sync && (p.data.kind !== 'email_graph' ||
        (!appOnly && !z.uuid().safeParse(p.data.config.tenant).success) ||
        (appOnly ? !p.data.config.mailbox : !p.data.secret))) {
      throw invalid(appOnly
        ? 'Microsoft Graph requer Tenant ID e endereço da caixa. O aplicativo deve ser autorizado pela TI.'
        : 'A sincronização Graph delegada exige tenant e token de renovação.');
    }
    if (appOnly && p.data.secret) throw invalid('Não informe senha ou token de usuário em contas Microsoft Graph do tipo aplicativo.');
    if (p.data.kind === 'email_imap' && p.data.config.host) assertSafeUrl(`https://${p.data.config.host}/`);
    const configured = p.data.kind === 'email_imap' ? Boolean(p.data.config.host && p.data.config.username && p.data.secret)
      : p.data.kind === 'email_graph' && p.data.config.graph_sync === true &&
        z.uuid().safeParse(p.data.config.tenant).success &&
        (appOnly ? Boolean(p.data.config.mailbox && process.env.POSSO_GRAPH_CLIENT_ID && process.env.POSSO_GRAPH_CLIENT_SECRET)
          : Boolean(p.data.secret));
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
    if(a.unit_id!==ctx.activeUnitId||!ctx.allowedUnitIds.includes(a.unit_id)) throw notFound('Conta');
    let ok = false;
    let message: string;
    if (a.kind === 'email_graph' && a.config.auth_mode === 'app_only') {
      const clientId=process.env.POSSO_GRAPH_CLIENT_ID,clientSecret=process.env.POSSO_GRAPH_CLIENT_SECRET;
      if (!clientId || !clientSecret || !a.config.mailbox) {
        message='O aplicativo Microsoft 365 ainda não foi configurado pela equipe de TI no servidor POSSO.';
      } else {
        try {
          const result=await graphAppTest({
            tenant:String(a.config.tenant??''),clientId,clientSecret,
            mailbox:String(a.config.mailbox)
          });
          ok=result.ok;message=result.message;
        }catch(error){ message=(error as Error).message; }
      }
    } else if (a.kind !== 'email_imap') {
      message = 'OAuth (Gmail/Microsoft Graph delegado) requer registro e consentimento do provedor.';
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
      `UPDATE ada.integration_account SET last_test_at = now(), last_test_result = $2,
         status = CASE WHEN $3 THEN 'ativo' WHEN status = 'nao_configurado' THEN status ELSE 'erro' END, updated_at = now() WHERE id = $1`,
      [id, message, ok]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'email.teste_conexao', targetType: 'integration_account', targetId: id, outcome: ok ? 'ok' : 'erro' });
    return { ok, message };
  }

  /** O envio externo fica desabilitado até ativação explícita por administrador. */
  /** Configuração posterior do Tenant ID Microsoft e do público autorizado. */
  async configureGraph(ctx:AuthContext,id:string,raw:unknown) {
    assertAdmin(ctx);
    const acc=await this.row(id);
    if(acc.unit_id!==ctx.activeUnitId||acc.kind!=='email_graph'||acc.config.auth_mode!=='app_only')
      throw notFound('Conta');
    const v=z.object({
      tenant:z.uuid(),
      mailbox:z.string().trim().email().max(254).optional(),
      purpose:z.enum(['institutional','posso']).optional(),
      allowedUserIds:z.array(z.number().int().positive()).max(500).optional(),
      allowedGroupIds:z.array(z.number().int().positive()).max(100).optional()
    }).strict().parse(raw);
    const config={...acc.config,tenant:v.tenant,
      ...(v.mailbox?{mailbox:v.mailbox}:{}),
      ...(v.purpose?{purpose:v.purpose}:{})};
    const changed=config.tenant!==acc.config.tenant||config.mailbox!==acc.config.mailbox;
    await this.d.db.tx(async q=>{
      await q.query(`UPDATE ada.integration_account SET config=$2::jsonb,
        allowed_user_ids=$3, allowed_group_ids=$4,
        watermark=CASE WHEN $5 THEN NULL ELSE watermark END,
        status=CASE WHEN $5 THEN 'configurado_nao_validado' ELSE status END,
        sending_enabled=CASE WHEN $5 THEN false ELSE sending_enabled END,
        last_test_at=CASE WHEN $5 THEN NULL ELSE last_test_at END,
        last_test_result=CASE WHEN $5 THEN NULL ELSE last_test_result END,
        updated_at=now() WHERE id=$1`,
        [id,JSON.stringify(config),v.allowedUserIds??acc.allowed_user_ids,
          v.allowedGroupIds??acc.allowed_group_ids,changed]);
      if(changed)await q.query('DELETE FROM ada.app_setting WHERE key=$1',[this.cacheKey(id)]);
      await audit(q,{actor:ctx.systemUserId,unit:ctx.activeUnitId,
        action:'email.graph_configuracao_atualizada',targetType:'integration_account',
        targetId:id,outcome:'ok',details:{identityChanged:changed}});
    });
    return {id,requiresAccessTest:changed};
  }

  async setSending(ctx: AuthContext, id: string, enabled: boolean) {
    assertAdmin(ctx);
    const account=await this.row(id);
    if (!ctx.allowedUnitIds.includes(account.unit_id)||account.unit_id!==ctx.activeUnitId) throw notFound('Conta');
    if (enabled && (account.kind!=='email_graph' || account.config.auth_mode!=='app_only' ||
      account.status!=='ativo' || !account.config.mailbox))
      throw invalid('Teste primeiro a leitura da caixa Microsoft Graph e configure o aplicativo autorizado.');
    await this.d.db.query(`UPDATE ada.integration_account SET sending_enabled=$2,updated_at=now() WHERE id=$1`,
      [id,enabled]);
    await audit(this.d.db,{actor:ctx.systemUserId,unit:account.unit_id,
      action:'email.envio_configurado',targetType:'integration_account',targetId:id,
      outcome:'ok',details:{enabled}});
    return {id,sendingEnabled:enabled};
  }

  /** Pesquisa somente caixas e mensagens explicitamente autorizadas para o usuário/unidade. */
  async search(ctx:AuthContext,raw:unknown) {
    const p=z.object({query:z.string().trim().max(200).default(''),
      accountId:z.uuid().optional(),limit:z.number().int().min(1).max(30).default(15)
    }).strict().parse(raw);
    const accounts=await this.readableGraphAccounts(ctx);
    const visible=p.accountId?accounts.filter(a=>a.id===p.accountId):accounts;
    if(p.accountId && !visible.length)throw notFound('Conta');
    const hits:{accountId:string;account:string;id:string;from:string;subject:string;
      excerpt:string;body:string;receivedAt:string|null}[]=[];
    for(const acc of visible.slice(0,12)){
      const inbox=await this.readGraph(ctx,acc.id);
      const entries=inbox.messages as Array<{id:string;subject?:string;excerpt?:string;body?:string;
        from?:string;receivedAt?:string|null}>;
      for(const mail of entries){
        const searched=[mail.subject,mail.excerpt,mail.body,mail.from].join(' ').toLocaleLowerCase('pt-BR');
        if(p.query && !searched.includes(p.query.toLocaleLowerCase('pt-BR')))continue;
        hits.push({
          accountId:acc.id,account:acc.label,id:mail.id,
          from:mail.from??'',subject:mail.subject??'',excerpt:mail.excerpt??'',
          body:(mail.body??'').slice(0,6000),receivedAt:mail.receivedAt??null
        });
      }
    }
    hits.sort((a,b)=>Date.parse(b.receivedAt??'1970-01-01')-Date.parse(a.receivedAt??'1970-01-01'));
    return {messages:hits.slice(0,p.limit),checkedAccounts:visible.length,
      note:'Pesquisa no conteúdo já sincronizado de cada caixa, não na totalidade do histórico Microsoft 365.'};
  }

  async createDraft(ctx:AuthContext,raw:unknown) {
    const p=z.object({
      accountId:z.uuid(),to:z.array(z.string().trim().email().max(254)).min(1).max(20),
      subject:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(20000)
    }).strict().parse(raw);
    const account=await this.row(p.accountId);
    if(account.kind!=='email_graph'||account.config.auth_mode!=='app_only'||
      !this.canUserRead(ctx,account))throw notFound('Conta');
    const created=await this.d.db.query<{id:string}>(`
      INSERT INTO ada.email_draft(account_id,unit_id,author_user_id,recipients,subject,body_enc)
      VALUES($1,$2,$3,$4::jsonb,$5,$6) RETURNING id`,
      [account.id,ctx.activeUnitId,ctx.systemUserId,JSON.stringify(p.to),p.subject,
        this.d.cipher.encrypt(p.body)]);
    const id=created.rows[0]!.id;
    await audit(this.d.db,{actor:ctx.systemUserId,unit:ctx.activeUnitId,
      action:'email.rascunho_criado',targetType:'email_draft',targetId:id,
      outcome:'ok',details:{accountId:account.id,recipientCount:p.to.length}});
    return {id,account:account.label,from:account.config.mailbox,
      to:p.to,subject:p.subject,body:p.body,status:'draft',requiresConfirmation:true};
  }

  async drafts(ctx:AuthContext) {
    const rows=await this.d.db.query<{id:string;account_id:string;unit_id:number;author_user_id:number;
      recipients:string[];subject:string;body_enc:string;status:string;created_at:Date}>(`
      SELECT id,account_id,unit_id,author_user_id,recipients,subject,body_enc,status,created_at
      FROM ada.email_draft WHERE unit_id=$1 AND author_user_id=$2
      ORDER BY created_at DESC LIMIT 30`,[ctx.activeUnitId,ctx.systemUserId]);
    const permitted=await this.readableGraphAccounts(ctx);
    const allowed=new Set(permitted.map(account=>account.id));
    return rows.rows.filter(r=>allowed.has(r.account_id)).map(r=>({
      id:r.id,accountId:r.account_id,to:r.recipients,subject:r.subject,
      body:this.d.cipher.decrypt(r.body_enc),status:r.status,createdAt:r.created_at
    }));
  }

  async sendDraft(ctx:AuthContext,id:string,confirmed:boolean) {
    if(confirmed!==true)throw invalid('É necessária confirmação explícita antes do envio externo.');
    const draft=(await this.d.db.query<{
      id:string;account_id:string;unit_id:number;author_user_id:number;
      recipients:string[];subject:string;body_enc:string;status:string
    }>(`SELECT * FROM ada.email_draft WHERE id=$1`,[z.uuid().parse(id)])).rows[0];
    if(!draft || draft.unit_id!==ctx.activeUnitId || draft.author_user_id!==ctx.systemUserId)
      throw notFound('Rascunho');
    const account=await this.row(draft.account_id);
    if(!this.canUserRead(ctx,account)||!account.sending_enabled||
      account.status!=='ativo'||account.config.auth_mode!=='app_only')
      throw invalid('Envio não habilitado para esta caixa ou usuário.');
    const clientId=process.env.POSSO_GRAPH_CLIENT_ID,clientSecret=process.env.POSSO_GRAPH_CLIENT_SECRET;
    if(!clientId||!clientSecret)throw invalid('Aplicativo Microsoft 365 ainda não configurado.');
    const reserved=await this.d.db.query<{id:string}>(`
      UPDATE ada.email_draft SET status='sending',updated_at=now()
      WHERE id=$1 AND status='draft' RETURNING id`,[id]);
    if(!reserved.rows[0])throw invalid('Este rascunho não está disponível para novo envio.');
    try{
      await graphAppSend({
        tenant:String(account.config.tenant??''),clientId,clientSecret,
        mailbox:String(account.config.mailbox??''),to:draft.recipients,
        subject:draft.subject,body:this.d.cipher.decrypt(draft.body_enc)
      });
      await this.d.db.query(`
        UPDATE ada.email_draft SET status='submitted',submitted_at=now(),updated_at=now()
        WHERE id=$1`,[id]);
      await audit(this.d.db,{actor:ctx.systemUserId,unit:ctx.activeUnitId,
        action:'email.graph_envio_aceito',targetType:'email_draft',targetId:id,
        outcome:'ok',details:{accountId:account.id,recipientCount:draft.recipients.length}});
      return {id,status:'submitted',accepted:true,
        message:'Microsoft Graph aceitou o envio. A entrega final ao destinatário ainda não foi confirmada.'};
    }catch(err){
      await this.d.db.query(`
        UPDATE ada.email_draft SET status='failed',last_error=$2,updated_at=now()
        WHERE id=$1`,[id,(err as Error).message.slice(0,300)]);
      this.d.log.warn({accountId:account.id,draftId:id},'falha de envio Graph; não repetir automaticamente');
      throw invalid('O envio não foi confirmado. Verifique a caixa Itens Enviados antes de criar outra tentativa.');
    }
  }

  async remove(ctx: AuthContext, id: string) {
    const account=await this.row(id);
    if(account.unit_id!==ctx.activeUnitId||!ctx.allowedUnitIds.includes(account.unit_id)) throw notFound('Conta');
    await this.d.db.tx(async q => {
      await q.query(`UPDATE ada.integration_account SET deleted_at = now(), secret_enc = NULL, watermark = NULL, status = 'desabilitado' WHERE id = $1`, [id]);
      await q.query('DELETE FROM ada.app_setting WHERE key=$1', [this.cacheKey(id)]);
    });
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'email.conta_removida', targetType: 'integration_account', targetId: id, outcome: 'ok' });
  }

  /** ACL de leitura futura: conta configurada por admin não dá acesso irrestrito a qualquer usuário. */
  canUserRead(ctx: AuthContext, a: { unit_id: number; allowed_user_ids: number[]; allowed_group_ids: number[] }): boolean {
    if (a.unit_id !== ctx.activeUnitId || !ctx.allowedUnitIds.includes(ctx.activeUnitId)) return false;
    return a.allowed_user_ids.includes(ctx.systemUserId) || ctx.groups.some((g) => a.allowed_group_ids.includes(g.id));
  }
}
