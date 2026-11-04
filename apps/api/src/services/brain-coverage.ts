import type { AuthContext } from '@ada/contracts';
import type { Deps } from '../core.ts';
import { CORPORATE_AREAS, corporateArea } from './corporate-structure.ts';

/**
 * Termômetro do cérebro corporativo: não interpreta documentos nem chama OpenAI.
 * Respeita unidade, programa, validade e status da fonte em TODAS as leituras de usuário.
 * "Ausência de documento" é lacuna documental, não prova de ausência de dados operacionais.
 */
export class BrainCoverageService {
  private nextPulseAt = 0;
  constructor(private readonly d: Deps) {}

  async status(ctx: AuthContext) {
    const programs = Object.keys(ctx.programs);
    const [documents, graph] = await Promise.all([
      this.d.db.query<{domain:string|null;title:string;observed_at:Date;source_id:string}>(
        `SELECT d.domain,d.title,d.observed_at,d.source_id
         FROM ada.knowledge_document d
         JOIN ada.knowledge_source s ON s.id=d.source_id
         WHERE d.status='indexado' AND s.status='ativo'
           AND (d.valid_until IS NULL OR d.valid_until >= current_date)
           AND (d.unit_id IS NULL OR d.unit_id=$1)
           AND (s.unit_id IS NULL OR s.unit_id=$1)
           AND d.required_programs <@ $2::text[]
           AND s.required_programs <@ $2::text[]
           AND (d.sensitivity <> 'confidencial' OR cardinality(d.required_programs)>0)
           AND (s.sensitivity <> 'confidencial' OR cardinality(s.required_programs)>0)
         ORDER BY d.observed_at DESC,d.id LIMIT 2001`,
        [ctx.activeUnitId,programs]
      ),
      this.d.db.query<{nodes:number;edges:number}>(
        `SELECT
          (SELECT count(*)::int FROM ada.brain_node
           WHERE (unit_id IS NULL OR unit_id=$1) AND required_programs <@ $2::text[]) AS nodes,
          (SELECT count(*)::int FROM ada.brain_edge e
           JOIN ada.brain_node a ON a.id=e.from_id
           JOIN ada.brain_node b ON b.id=e.to_id
           WHERE (a.unit_id IS NULL OR a.unit_id=$1) AND (b.unit_id IS NULL OR b.unit_id=$1)
             AND a.required_programs <@ $2::text[] AND b.required_programs <@ $2::text[]) AS edges`,
        [ctx.activeUnitId,programs]
      )
    ]);

    let tables: { nome:string }[] = [];
    let operationalSource: 'available'|'unavailable' = 'unavailable';
    try {
      const map = await this.d.operational.processMap(ctx);
      tables = map.tables;
      operationalSource = 'available';
    } catch {
      // A ausência de conexão ou de permissão não significa que o módulo inexiste.
    }

    const limited = documents.rows.length>2000;
    const docs = documents.rows.slice(0,2000);
    const areas = CORPORATE_AREAS.map(area => {
      const inArea = docs.filter(doc => corporateArea(doc.domain,doc.title).id===area.id);
      const relatedTables = tables.filter(table => corporateArea(null,table.nome).id===area.id);
      const lastDocument = inArea[0]?.observed_at;
      return {
        id:area.id,name:area.name,
        indexedDocuments:inArea.length,
        availableSources:new Set(inArea.map(doc=>doc.source_id)).size,
        authorizedTables:relatedTables.length,
        latestDocumentObservedAt:lastDocument ? new Date(lastDocument).toISOString() : null,
        // Indicadores de COBERTURA, não juízo sobre a operação real ou interpretação do contrato.
        coverage: inArea.length>0 && relatedTables.length>0 ? 'fontes_identificadas'
          : inArea.length>0 ? 'sem_tabela_consultavel'
          : relatedTables.length>0 ? 'sem_documentacao_aprovada' : 'sem_referencia_confirmada'
      };
    });
    return {
      unitId:ctx.activeUnitId,checkedAt:this.d.now().toISOString(),modelCalls:0,
      operationalSource, indexedDocuments:docs.length,catalogTruncated:limited,
      authorizedGraphNodes:graph.rows[0]?.nodes??0,authorizedGraphEdges:graph.rows[0]?.edges??0,
      areas,
      note:'A cobertura mostra referências autorizadas e estrutura acessível, não conhecimento integral nem saúde da operação. Consultas atuais e regras comprovadas são necessárias para concluir.'
    };
  }

  /**
   * Pulso local a cada cinco minutos: detecta movimentação da base de conhecimento,
   * sem copiar linhas do POSSEBON e sem gastar tokens. Escopo GLOBAL reservado ao admin.
   * Idempotente: reinício de worker somente atualiza o mesmo app_setting.
   */
  async tick(force=false) {
    const now=Date.now();
    if (!force && now<this.nextPulseAt) return false;
    this.nextPulseAt=now+5*60_000;
    try {
      const result=await this.d.db.query<{
        documents:number;sources:number;nodes:number;edges:number;last_document_change:Date|null
      }>(`SELECT
         (SELECT count(*)::int FROM ada.knowledge_document WHERE status='indexado') AS documents,
         (SELECT count(*)::int FROM ada.knowledge_source WHERE status='ativo') AS sources,
         (SELECT count(*)::int FROM ada.brain_node) AS nodes,
         (SELECT count(*)::int FROM ada.brain_edge) AS edges,
         (SELECT max(updated_at) FROM ada.knowledge_document) AS last_document_change`);
      const data=result.rows[0];
      if (!data) return false;
      const value={
        checkedAt:this.d.now().toISOString(),modelCalls:0,
        indexedDocuments:data.documents,activeSources:data.sources,
        graphNodes:data.nodes,graphEdges:data.edges,
        lastDocumentChange:data.last_document_change?.toISOString()??null
      };
      await this.d.db.query(
        `INSERT INTO ada.app_setting(key,value) VALUES('brain:pulse', $1)
         ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[value]
      );
      return true;
    } catch(err) {
      this.nextPulseAt=0; // falhas não são registradas como coleta bem-sucedida
      throw err;
    }
  }

  async lastPulse() {
    const row=await this.d.db.query<{value:unknown}>("SELECT value FROM ada.app_setting WHERE key='brain:pulse'");
    return row.rows[0]?.value??{checkedAt:null,modelCalls:0,state:'not_collected'};
  }
}
