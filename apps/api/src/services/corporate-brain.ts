import { createHash } from 'node:crypto';
import type { AuthContext } from '@ada/contracts';
import type { Queryable } from '../db.ts';

type Kind = 'modelo' | 'tabela' | 'campo' | 'area' | 'tela' | 'modulo' | 'documento' | 'parte';
type Relation = 'representa' | 'possui_campo' | 'contem_tela' | 'contem_parte';
interface Node {
  id: string; kind: Kind; label: string; source_ref: string;
  unit_id: number | null; attributes: Record<string, string>;
}
interface Edge {
  from_id: string; to_id: string; relation: Relation; source_ref: string;
}
export interface ArchitectureInventory {
  snapshot: string;
  models: { model: string; table: string; fields: string[]; source: string }[];
  screens_by_area: Record<string, string[]>;
  custom_php_modules: string[];
}
export interface GraphHit {
  kind: Kind; label: string; source: string;
  relationships: { relation: Relation; target: string; kind: Kind; source: string }[];
}
const key = (kind: Kind, identity: string) =>
  'brain:' + createHash('sha256').update(kind + '\0' + identity).digest('hex');
const architectureNode = (kind: Kind, label: string, identity: string, source: string, snapshot: string): Node => ({
  id: key(kind, identity), kind, label, source_ref: source, unit_id: null,
  attributes: { snapshot, classification: 'interno-restrito' }
});
const contractNode = (kind: Kind, label: string, identity: string, source: string, attrs: Record<string, string>): Node => ({
  id: key(kind, 'unit:3/' + identity), kind, label, source_ref: source, unit_id: 3,
  attributes: { ...attrs, classification: 'restrito' }
});

/** Armazena apenas referências/relacionamentos, jamais linhas ou valores operacionais. */
async function writeGraph(q: Queryable, nodes: Node[], edges: Edge[]) {
  const uniqueNodes = [...new Map(nodes.map((n) => [n.id, n])).values()];
  const uniqueEdges = [...new Map(edges.map((e) => [e.from_id + '|' + e.to_id + '|' + e.relation, e])).values()];
  for (let i = 0; i < uniqueNodes.length; i += 150) {
    await q.query(
      `INSERT INTO ada.brain_node (id,kind,label,source_ref,unit_id,required_programs,attributes)
       SELECT item->>'id',item->>'kind',item->>'label',item->>'source_ref',
              (item->>'unit_id')::integer,ARRAY['AdaAdministracao']::text[],item->'attributes'
       FROM jsonb_array_elements($1::jsonb) item
       ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind,label=EXCLUDED.label,
         source_ref=EXCLUDED.source_ref,unit_id=EXCLUDED.unit_id,
         required_programs=EXCLUDED.required_programs,attributes=EXCLUDED.attributes,
         updated_at=now()
       WHERE (ada.brain_node.label,ada.brain_node.source_ref,ada.brain_node.attributes)
         IS DISTINCT FROM (EXCLUDED.label,EXCLUDED.source_ref,EXCLUDED.attributes)`,
      [JSON.stringify(uniqueNodes.slice(i,i+150))]
    );
  }
  for (let i = 0; i < uniqueEdges.length; i += 200) {
    await q.query(
      `INSERT INTO ada.brain_edge(from_id,to_id,relation,source_ref)
       SELECT item->>'from_id',item->>'to_id',item->>'relation',item->>'source_ref'
       FROM jsonb_array_elements($1::jsonb) item ON CONFLICT DO NOTHING`,
      [JSON.stringify(uniqueEdges.slice(i,i+200))]
    );
  }
  return { nodes: uniqueNodes.length, relations: uniqueEdges.length };
}

/** Os campos *_id indicam nomes, mas NÃO provam existência de FK: não inventar joins. */
export async function syncArchitectureGraph(q: Queryable, inventory: ArchitectureInventory) {
  const nodes: Node[] = [], edges: Edge[] = [];
  const snapshot = inventory.snapshot;
  for (const model of inventory.models) {
    const m = architectureNode('modelo', model.model, model.model, model.source, snapshot);
    const table = architectureNode('tabela', model.table, model.table, model.source, snapshot);
    nodes.push(m,table);
    edges.push({ from_id: m.id,to_id: table.id,relation: 'representa',source_ref: model.source });
    for (const field of model.fields) {
      const column = architectureNode('campo', field, model.table + '.' + field, model.source, snapshot);
      nodes.push(column);
      edges.push({ from_id: table.id,to_id: column.id,relation: 'possui_campo',source_ref: model.source });
    }
  }
  for (const [areaName,screens] of Object.entries(inventory.screens_by_area)) {
    const a = architectureNode('area',areaName,areaName,'inventario:areas',snapshot);
    nodes.push(a);
    for (const screen of screens) {
      const t = architectureNode('tela',screen,areaName+'/'+screen,'inventario:telas',snapshot);
      nodes.push(t);
      edges.push({ from_id: a.id,to_id: t.id,relation: 'contem_tela',source_ref: 'inventario:telas' });
    }
  }
  for (const module of inventory.custom_php_modules) {
    nodes.push(architectureNode('modulo',module,module,module,snapshot));
  }
  return writeGraph(q,nodes,edges);
}

export async function syncContractGraph(q: Queryable, sourceId: string) {
  const docs = await q.query<{ id: string; title: string; original_name: string; checksum: string }>(
    `SELECT id,title,original_name,checksum FROM ada.knowledge_document
     WHERE source_id=$1 AND status='indexado' AND unit_id=3`,[sourceId]
  );
  const nodes: Node[] = [], edges: Edge[] = [];
  for (const d of docs.rows) {
    const file = contractNode('documento',d.original_name,d.original_name,d.original_name,{unit_id:'3'});
    const part = contractNode('parte',d.title,d.id,d.original_name,
      {unit_id:'3',document_id:d.id,checksum:d.checksum});
    nodes.push(file,part);
    edges.push({ from_id:file.id,to_id:part.id,relation:'contem_parte',source_ref:d.original_name });
  }
  return writeGraph(q,nodes,edges);
}

/** Consulta delimitada por programa e unidade do usuário; autorizada em ambos os lados. */
export async function searchCorporateGraph(q: Queryable,ctx: AuthContext,term: string,max=10): Promise<GraphHit[]> {
  const needle = term.trim().slice(0,120);
  if (needle.length<2) return [];
  const programs = Object.keys(ctx.programs);
  const nodes = await q.query<{id:string;kind:Kind;label:string;source_ref:string}>(
    `SELECT id,kind,label,source_ref FROM ada.brain_node
     WHERE position(lower($1) in lower(label))>0
       AND (unit_id IS NULL OR unit_id=$2) AND required_programs <@ $3::text[]
     ORDER BY CASE WHEN lower(label)=lower($1) THEN 0 ELSE 1 END,
              CASE kind WHEN 'modelo' THEN 0 WHEN 'tabela' THEN 1 ELSE 2 END,label
     LIMIT $4`,[needle,ctx.activeUnitId,programs,Math.max(1,Math.min(max,20))]
  );
  if (!nodes.rows.length) return [];
  const links = await q.query<{
    from_id:string;to_id:string;relation:Relation;source_ref:string;
    from_kind:Kind;from_label:string;to_kind:Kind;to_label:string;
  }>(
    `SELECT e.from_id,e.to_id,e.relation,e.source_ref,
            a.kind AS from_kind,a.label AS from_label,b.kind AS to_kind,b.label AS to_label
     FROM ada.brain_edge e
     JOIN ada.brain_node a ON a.id=e.from_id
     JOIN ada.brain_node b ON b.id=e.to_id
     WHERE (e.from_id=ANY($1::text[]) OR e.to_id=ANY($1::text[]))
       AND (a.unit_id IS NULL OR a.unit_id=$2) AND (b.unit_id IS NULL OR b.unit_id=$2)
       AND a.required_programs <@ $3::text[] AND b.required_programs <@ $3::text[]
     ORDER BY e.relation LIMIT 100`,
    [nodes.rows.map((n)=>n.id),ctx.activeUnitId,programs]
  );
  return nodes.rows.map((n)=>({
    kind:n.kind,label:n.label,source:n.source_ref,
    relationships:links.rows.filter((e)=>e.from_id===n.id||e.to_id===n.id).slice(0,12).map((e)=>({
      relation:e.relation,target:e.from_id===n.id?e.to_label:e.from_label,
      kind:e.from_id===n.id?e.to_kind:e.from_kind,source:e.source_ref
    }))
  }));
}
