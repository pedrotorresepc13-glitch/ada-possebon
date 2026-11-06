import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { AiProvider } from '../apps/api/src/ai/provider.ts';
import type { AuthContext } from '@ada/contracts';
import { setup, type Harness } from './helpers.ts';

const excerpt='O consórcio EPC13 tem como cliente contratante a Petrobras e executa atividades previstas no escopo do empreendimento.';
const scripted:AiProvider={
  name:'teste',model:'teste',configured:true,
  async run(){
    return {
      text:JSON.stringify({facts:[{
        ordinal:0,category:'clientes',topic:'Petrobras',
        statement:'Segundo o documento, o cliente contratante do consórcio EPC13 é a Petrobras.',
        evidence:excerpt,
        certainty:'documental'
      },{
        ordinal:0,category:'risco',topic:'prazo',
        statement:'O empreendimento pode registrar um atraso de vinte anos sem evidência.',
        evidence:'Atraso imaginado que nao aparece no documento',
        certainty:'hipotese'
      }]}),
      usage:{input:1,output:1},toolCalls:[],steps:1
    };
  }
};
const ctx:AuthContext={
  sessionId:'test',systemUserId:230,login:'teste',displayName:'Usuário teste',
  activeUnitId:3,allowedUnitIds:[3],units:[{id:3,name:'EPC13'}],
  groups:[],programs:{AdaAdministracao:[]},roles:['admin'],managerUnitIds:[],
  crossUnit:false,permissionsVersion:'1',resolvedAt:new Date().toISOString(),
  identitySource:'dev_synthetic'
};
let h:Harness;
let docId:string;

beforeAll(async()=>{
  h=await setup({ai:scripted,env:{ADA_DEMO_DATA:'0'}});
  const source=await h.d.db.query<{id:string}>(
    "INSERT INTO ada.knowledge_source (kind,name,scope,unit_id,domain,sensitivity,required_programs,created_by) VALUES ('manual','Teste EPC13','unidade',3,'contrato','restrito',ARRAY['AdaAdministracao']::text[],230) RETURNING id"
  );
  const document=await h.d.db.query<{id:string}>(
    "INSERT INTO ada.knowledge_document (source_id,title,mime_type,checksum,status,scope,unit_id,domain,sensitivity,required_programs,extracted_text,created_by) VALUES ($1,'Documento de teste','text/plain','v1','indexado','unidade',3,'contrato','restrito',ARRAY['AdaAdministracao']::text[],$2,230) RETURNING id",
    [source.rows[0]!.id,excerpt]
  );
  docId=document.rows[0]!.id;
  await h.d.db.query('INSERT INTO ada.knowledge_chunk (document_id,ordinal,content) VALUES ($1,0,$2)',[docId,excerpt]);
});
afterAll(async()=>h.close());

describe('caderno institucional rastreável e segregado',()=>{
  it('aprende somente evidencias literalmente presentes na fonte e cifra o conteúdo',async()=>{
    const result=await h.d.corporateMemory.studyBatch(ctx);
    expect(result).toMatchObject({processed:true,chunks:1,facts:1,complete:true});
    const rows=await h.d.db.query<{statement_enc:string;certainty:string;review_state:string}>(
      'SELECT statement_enc,certainty,review_state FROM ada.corporate_fact WHERE document_id=$1',[docId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.statement_enc).toMatch(/^v1:/);
    expect(rows.rows[0]!.statement_enc).not.toContain('Petrobras');
    expect(rows.rows[0]!.certainty).toBe('documental');
    expect(rows.rows[0]!.review_state).toBe('sugerido');
    const passage=await h.d.corporateMemory.promptContext(ctx,'Quem é a Petrobras no consórcio?');
    expect(passage).toContain('cliente contratante');
    expect(passage).toContain('Documento de teste');
    expect(passage).not.toContain('vinte anos');
    expect(await h.d.corporateMemory.promptContext(ctx,'Quem é nosso cliente?')).toContain('cliente contratante');
  });
  it('nao atravessa unidade, programa nem revisao do documento',async()=>{
    expect(await h.d.corporateMemory.promptContext(
      {...ctx,activeUnitId:4,allowedUnitIds:[4]},'Petrobras')).toBe('');
    expect(await h.d.corporateMemory.promptContext(
      {...ctx,programs:{}},'Petrobras')).toBe('');
    await h.d.db.query("UPDATE ada.knowledge_document SET checksum='v2' WHERE id=$1",[docId]);
    expect(await h.d.corporateMemory.promptContext(ctx,'Petrobras')).toBe('');
  });
});
