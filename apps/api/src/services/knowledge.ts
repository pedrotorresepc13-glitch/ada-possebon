import type { AuthContext } from '@ada/contracts';
import { assertSafeUrl, chunkText, redactSecrets, scanForInjection } from '@ada/domain';
import { z } from 'zod';
import type { Deps } from '../core.ts';
import { audit } from '../audit.ts';
import { sha256 } from '../crypto.ts';
import { HttpError, invalid, notFound } from '../errors.ts';
import { htmlToText, isAllowedContentType, robotsAllows, safeFetch } from '../web-fetch.ts';

export const SourceInput = z
  .object({
    kind: z.enum(['upload', 'url', 'manual']),
    name: z.string().trim().min(1).max(120),
    uri: z.string().url().max(2000).optional(),
    scope: z.enum(['global', 'unidade', 'dominio']),
    unit_id: z.number().int().positive().optional(),
    domain: z.string().trim().min(1).max(60).optional(),
    sensitivity: z.enum(['publico', 'interno', 'restrito', 'confidencial']).default('interno'),
    required_programs: z.array(z.string().regex(/^[A-Za-z0-9_]{1,120}$/)).max(20).default([])
  })
  .strict()
  .refine((v) => v.scope !== 'unidade' || v.unit_id, { message: 'Escopo por unidade exige unit_id' })
  .refine((v) => v.scope !== 'dominio' || v.domain, { message: 'Escopo por domínio exige domain' });

export const DocumentMeta = z
  .object({
    title: z.string().trim().max(200).optional(),
    valid_until: z.iso.date().optional()
  })
  .strict();

const TEXT_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html'
};
const PENDING_EXTRACTOR = ['.pdf', '.docx', '.xlsx', '.doc', '.xls', '.pptx'];

interface SourceRow {
  id: string;
  kind: string;
  name: string;
  uri: string | null;
  scope: 'global' | 'unidade' | 'dominio';
  unit_id: number | null;
  domain: string | null;
  sensitivity: string;
  required_programs: string[];
}

export interface KnowledgeHit {
  chunkId: string;
  documentId: string;
  title: string;
  source: string;
  uri: string | null;
  excerpt: string;
  observedAt: string;
  checksum: string;
  scope: string;
  rank: number;
}

export class KnowledgeService {
  constructor(private readonly d: Deps) {}

  async createSource(ctx: AuthContext, input: unknown) {
    const p = SourceInput.safeParse(input);
    if (!p.success) throw invalid('Fonte inválida.', p.error.issues);
    if (p.data.scope === 'unidade' && !ctx.allowedUnitIds.includes(p.data.unit_id!)) throw invalid('Unidade fora do seu escopo.');
    const r = await this.d.db.query<{ id: string }>(
      `INSERT INTO ada.knowledge_source (kind, name, uri, scope, unit_id, domain, sensitivity, required_programs, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [p.data.kind, p.data.name, p.data.uri ?? null, p.data.scope, p.data.unit_id ?? null, p.data.domain ?? null, p.data.sensitivity, p.data.required_programs, ctx.systemUserId]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conhecimento.fonte_criada', targetType: 'knowledge_source', targetId: r.rows[0]!.id, outcome: 'ok', details: { kind: p.data.kind, scope: p.data.scope } });
    return r.rows[0]!;
  }

  async listSources() {
    const r = await this.d.db.query(
      `SELECT s.*, (SELECT count(*)::int FROM ada.knowledge_document d WHERE d.source_id = s.id) AS documents FROM ada.knowledge_source s ORDER BY s.created_at DESC`
    );
    return r.rows;
  }

  private async source(id: string): Promise<SourceRow> {
    if (!z.uuid().safeParse(id).success) throw notFound('Fonte');
    const r = await this.d.db.query<SourceRow>(`SELECT * FROM ada.knowledge_source WHERE id = $1`, [id]);
    if (!r.rows[0]) throw notFound('Fonte');
    return r.rows[0];
  }

  /** Upload em lote: cada arquivo vira documento "aguardando" com checksum (deduplicado por fonte). */
  async upload(ctx: AuthContext, sourceId: string, file: { filename: string; mimetype: string; data: Buffer }, metaInput: unknown) {
    const src = await this.source(sourceId);
    const meta = DocumentMeta.safeParse(metaInput ?? {});
    if (!meta.success) throw invalid('Metadados inválidos.', meta.error.issues);
    if (file.data.length > this.d.config.uploadMaxBytes) throw invalid('Arquivo excede o tamanho máximo.');
    const name = file.filename.replace(/[^\w.\- ()À-ú]/g, '_').slice(0, 200);
    const ext = (/\.[a-z0-9]+$/i.exec(name)?.[0] ?? '').toLowerCase();
    if (!TEXT_TYPES[ext] && !PENDING_EXTRACTOR.includes(ext)) throw invalid(`Tipo de arquivo não aceito: ${ext || 'sem extensão'}`);
    const checksum = sha256(file.data);
    const r = await this.d.db.query<{ id: string }>(
      `INSERT INTO ada.knowledge_document (source_id, title, mime_type, original_name, size_bytes, checksum, status, scope, unit_id, domain, sensitivity, required_programs, valid_until, raw_content, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'aguardando',$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (source_id, checksum) DO NOTHING RETURNING id`,
      [src.id, meta.data.title || name, TEXT_TYPES[ext] ?? 'application/octet-stream', name, file.data.length, checksum, src.scope, src.unit_id, src.domain, src.sensitivity, src.required_programs, meta.data.valid_until ?? null, file.data, ctx.systemUserId]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conhecimento.upload', targetType: 'knowledge_source', targetId: src.id, outcome: 'ok', details: { file: name, checksum, duplicate: !r.rows[0] } });
    return { id: r.rows[0]?.id ?? null, duplicate: !r.rows[0], checksum };
  }

  /** Importação de URL sob comando do admin: só registra; a coleta segura roda no worker. */
  async importUrl(ctx: AuthContext, sourceId: string, url: string) {
    const src = await this.source(sourceId);
    let u: URL;
    try {
      u = assertSafeUrl(url);
    } catch (err) {
      await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conhecimento.url_bloqueada', outcome: 'negado', details: { motivo: (err as Error).message } });
      throw invalid(`URL recusada: ${(err as Error).message}.`);
    }
    const r = await this.d.db.query<{ id: string }>(
      `INSERT INTO ada.knowledge_document (source_id, title, mime_type, original_name, checksum, status, scope, unit_id, domain, sensitivity, required_programs, created_by)
       VALUES ($1,$2,'text/html',$3,$4,'aguardando',$5,$6,$7,$8,$9,$10) ON CONFLICT (source_id, checksum) DO NOTHING RETURNING id`,
      [src.id, u.toString().slice(0, 200), u.toString(), 'url:' + sha256(u.toString()), src.scope, src.unit_id, src.domain, src.sensitivity, src.required_programs, ctx.systemUserId]
    );
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: 'conhecimento.url_importada', targetType: 'knowledge_source', targetId: src.id, outcome: 'ok', details: { host: u.host } });
    return { id: r.rows[0]?.id ?? null, duplicate: !r.rows[0] };
  }

  private async extract(doc: { id: string; original_name: string | null; mime_type: string; checksum: string; raw_content: Buffer | Uint8Array | null }): Promise<{ text: string; title?: string; checksum?: string }> {
    if (doc.checksum.startsWith('url:')) {
      const url = new URL(doc.original_name!);
      if (!(await robotsAllows(url))) throw new Error('Coleta não permitida pelo robots.txt do site.');
      const r = await safeFetch(url.toString());
      if (r.status >= 400) throw new Error(`O site respondeu HTTP ${r.status}.`);
      if (!isAllowedContentType(r.contentType)) throw new Error(`Tipo de conteúdo não suportado: ${r.contentType || 'desconhecido'}.`);
      const raw = r.body.toString('utf8');
      const isHtml = r.contentType.includes('html');
      const parsed = isHtml ? htmlToText(raw) : { title: '', text: raw };
      return { text: parsed.text, title: parsed.title || undefined, checksum: sha256(r.body) };
    }
    const ext = (/\.[a-z0-9]+$/i.exec(doc.original_name ?? '')?.[0] ?? '').toLowerCase();
    if (PENDING_EXTRACTOR.includes(ext)) {
      throw new Error(`Extrator para ${ext} (PDF/DOCX/XLSX/OCR) ainda não está instalado nesta versão. O arquivo foi preservado para reprocessamento.`);
    }
    const buf = Buffer.from(doc.raw_content ?? new Uint8Array());
    if (buf.includes(0)) throw new Error('Arquivo declarado como texto contém dados binários; recusado.');
    const text = buf.toString('utf8');
    return ext === '.html' || ext === '.htm' ? { text: htmlToText(text).text } : { text };
  }

  /** Fila de estudo: aguardando → processando → revisando (ou erro). Indexação só após aprovação humana. */
  async processPending(limit = 10): Promise<number> {
    const claimed = await this.d.db.query<{ id: string; original_name: string | null; mime_type: string; checksum: string; raw_content: Buffer | null }>(
      `UPDATE ada.knowledge_document SET status = 'processando', updated_at = now() WHERE id IN (
         SELECT id FROM ada.knowledge_document WHERE status = 'aguardando' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, original_name, mime_type, checksum, raw_content`,
      [limit]
    );
    for (const doc of claimed.rows) {
      try {
        const ex = await this.extract(doc);
        const text = redactSecrets(ex.text).slice(0, 2_000_000);
        if (!text.trim()) throw new Error('Nenhum texto extraído.');
        const scan = scanForInjection(text);
        const chunks = chunkText(text);
        await this.d.db.tx(async (q) => {
          await q.query(`DELETE FROM ada.knowledge_chunk WHERE document_id = $1`, [doc.id]);
          for (const c of chunks) await q.query(`INSERT INTO ada.knowledge_chunk (document_id, ordinal, content) VALUES ($1,$2,$3)`, [doc.id, c.ordinal, c.content]);
          await q.query(
            `UPDATE ada.knowledge_document SET status = 'revisando', extracted_text = $2, injection_flags = $3, error = NULL, observed_at = now(), updated_at = now(),
               title = COALESCE($4, title) WHERE id = $1`,
            [doc.id, text, JSON.stringify(scan.findings), ex.title ?? null]
          );
        });
      } catch (err) {
        await this.d.db.query(`UPDATE ada.knowledge_document SET status = 'erro', error = $2, updated_at = now() WHERE id = $1`, [doc.id, (err as Error).message.slice(0, 500)]);
      }
    }
    return claimed.rows.length;
  }

  async listDocuments(status?: string) {
    const r = await this.d.db.query(
      `SELECT d.id, d.source_id, s.name AS source_name, d.title, d.mime_type, d.original_name, d.size_bytes, d.checksum, d.version, d.status, d.scope, d.unit_id, d.domain,
              d.sensitivity, d.valid_until, d.injection_flags, d.error, d.observed_at, d.reviewed_at, d.created_at,
              (SELECT count(*)::int FROM ada.knowledge_chunk c WHERE c.document_id = d.id) AS chunks
       FROM ada.knowledge_document d JOIN ada.knowledge_source s ON s.id = d.source_id
       WHERE ($1::text IS NULL OR d.status = $1) ORDER BY d.created_at DESC LIMIT 500`,
      [status ?? null]
    );
    return r.rows;
  }

  async getDocument(id: string) {
    if (!z.uuid().safeParse(id).success) throw notFound('Documento');
    const r = await this.d.db.query<Record<string, unknown>>(
      `SELECT id, source_id, title, mime_type, original_name, checksum, status, scope, unit_id, sensitivity, injection_flags, error, observed_at,
              left(extracted_text, 20000) AS extracted_preview FROM ada.knowledge_document WHERE id = $1`,
      [id]
    );
    if (!r.rows[0]) throw notFound('Documento');
    return r.rows[0];
  }

  async review(ctx: AuthContext, id: string, decision: 'aprovar' | 'rejeitar', note?: string) {
    const doc = await this.getDocument(id);
    if (doc.status !== 'revisando') throw new HttpError(409, 'CONFLICT', 'Documento não está em revisão.');
    const status = decision === 'aprovar' ? 'indexado' : 'rejeitado';
    await this.d.db.query(`UPDATE ada.knowledge_document SET status = $2, reviewed_by = $3, reviewed_at = now(), error = $4, updated_at = now() WHERE id = $1`, [
      id, status, ctx.systemUserId, decision === 'rejeitar' ? (note ?? 'Rejeitado na revisão').slice(0, 300) : null
    ]);
    await audit(this.d.db, { actor: ctx.systemUserId, unit: ctx.activeUnitId, action: `conhecimento.${status}`, targetType: 'knowledge_document', targetId: id, outcome: 'ok', details: { injection_flags: doc.injection_flags } });
  }

  async reprocess(ctx: AuthContext, id: string) {
    await this.getDocument(id);
    await this.d.db.query(`UPDATE ada.knowledge_document SET status = 'aguardando', version = version + 1, updated_at = now() WHERE id = $1`, [id]);
    await audit(this.d.db, { actor: ctx.systemUserId, action: 'conhecimento.reprocessar', targetType: 'knowledge_document', targetId: id, outcome: 'ok' });
  }

  /**
   * Recuperação com ACL: somente documentos aprovados, válidos, no escopo (global/domínio/unidade ativa)
   * e cujos programas exigidos o usuário possui. Ranking por FTS (português).
   */
  async search(ctx: AuthContext, query: string, limit = 6): Promise<KnowledgeHit[]> {
    const q = query.trim().slice(0, 300);
    if (!q) return [];
    const r = await this.d.db.query<{
      id: string; document_id: string; title: string; source_name: string; uri: string | null; excerpt: string; observed_at: Date; checksum: string; scope: string; rank: number;
    }>(
      // Perguntas naturais: OU entre radicais (português), exigindo que ao menos metade dos termos coincida.
      `WITH terms AS (
         SELECT array(SELECT DISTINCT l FROM unnest(tsvector_to_array(to_tsvector('portuguese', $1))) l WHERE length(l) > 1) AS t
       ), qq AS (
         SELECT t, to_tsquery('simple', array_to_string(array(SELECT quote_literal(x) FROM unnest(t) x), ' | ')) AS q FROM terms WHERE cardinality(t) > 0
       ), hits AS (
         SELECT c.id, c.document_id, c.content, qq.q, ts_rank(c.tsv, qq.q) AS rank,
                (SELECT count(*) FROM unnest(qq.t) x WHERE c.tsv @@ to_tsquery('simple', quote_literal(x))) AS matched,
                cardinality(qq.t) AS total
         FROM ada.knowledge_chunk c, qq WHERE c.tsv @@ qq.q
       )
       SELECT h.id, d.id AS document_id, d.title, s.name AS source_name, COALESCE(d.original_name, s.uri) AS uri,
              ts_headline('portuguese', h.content, h.q, 'MaxFragments=2, MaxWords=40, MinWords=12, StartSel=[, StopSel=]') AS excerpt,
              d.observed_at, d.checksum, d.scope, h.rank
       FROM hits h
       JOIN ada.knowledge_document d ON d.id = h.document_id
       JOIN ada.knowledge_source s ON s.id = d.source_id
       WHERE h.matched >= GREATEST(1, ceil(h.total / 2.0))
         AND d.status = 'indexado'
         AND (d.valid_until IS NULL OR d.valid_until >= current_date)
         AND (d.unit_id IS NULL OR d.unit_id = $2)
         AND (d.scope <> 'unidade' OR d.unit_id = $2)
         AND d.required_programs <@ $3::text[]
         AND (d.sensitivity <> 'confidencial' OR cardinality(d.required_programs) > 0)
       ORDER BY h.matched DESC, h.rank DESC LIMIT $4`,
      [q, ctx.activeUnitId, Object.keys(ctx.programs), Math.min(limit, 20)]
    );
    return r.rows.map((x) => ({
      chunkId: x.id,
      documentId: x.document_id,
      title: x.title,
      source: x.source_name,
      uri: x.uri?.startsWith('http') ? x.uri : null,
      excerpt: x.excerpt,
      observedAt: new Date(x.observed_at).toISOString(),
      checksum: x.checksum,
      scope: x.scope,
      rank: Number(x.rank)
    }));
  }

  /** Cobertura por status e domínio — usado no painel e para a ADA nunca alegar que "estudou tudo". */
  async coverage() {
    const byStatus = await this.d.db.query(`SELECT status, count(*)::int AS n FROM ada.knowledge_document GROUP BY status ORDER BY status`);
    const byDomain = await this.d.db.query(
      `SELECT COALESCE(domain, scope) AS area, count(*) FILTER (WHERE status = 'indexado')::int AS indexados, count(*)::int AS total, max(observed_at) AS ultima_observacao
       FROM ada.knowledge_document GROUP BY 1 ORDER BY 1`
    );
    const runs = await this.d.db.query(`SELECT * FROM ada.knowledge_sync_run ORDER BY started_at DESC LIMIT 20`);
    return { byStatus: byStatus.rows, byDomain: byDomain.rows, syncRuns: runs.rows };
  }
}
