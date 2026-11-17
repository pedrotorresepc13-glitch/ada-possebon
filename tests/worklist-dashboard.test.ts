import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.ts';
import { OperationalQueryService } from '../apps/api/src/services/operational-query.ts';

const spec = {
  title: 'Meus chamados — Central de atendimento',
  description: 'Fila dos chamados atribuídos ao atendente da sessão.',
  panels: [{
    title: 'Minha fila de chamados', type: 'worklist' as const,
    plan: {
      from: 'chamado',
      select: [
        {field:'chamado.id',as:'numero'},
        {field:'chamado.situacao',as:'situacao'},
        {field:'chamado.assunto',as:'assunto'},
        {field:'chamado.descricao',as:'descricao'},
        {field:'chamado.prioridade',as:'prioridade'},
        {field:'chamado.produto',as:'produto'},
        {field:'chamado.categoria',as:'categoria'},
        {field:'chamado.data_abertura',as:'data_abertura'}
      ],
      where: [{field:'chamado.atendente_id',op:'eq',value:9001}],
      orderBy:[{field:'chamado.data_abertura',direction:'desc'}],
      limit:200
    },
    worklist: {
      fields:{
        id:'numero',status:'situacao',subject:'assunto',description:'descricao',
        priority:'prioridade',product:'produto',category:'categoria',createdAt:'data_abertura'
      },
      defaultStatuses:['Aberto','Em atendimento']
    }
  }]
};

describe('Central de trabalho premium e verificação de qualidade', () => {
  it('valida assuntos reais e abre uma central interativa sem misturar usuários e unidades',async()=>{
    const h=await setup();
    try {
      await h.d.db.exec(`
        CREATE TABLE public.chamado(
          id integer PRIMARY KEY,unit_id integer,atendente_id integer,
          situacao text,assunto text,descricao text,prioridade text,
          produto text,categoria text,data_abertura timestamp
        );
        INSERT INTO public.chamado VALUES
        (1519,1,9001,'Em atendimento','Corrigir falha de acesso ao aplicativo','Não abre na tela inicial','Alta','POSSEBON App','Aplicativo','2026-11-10'),
        (1500,1,9001,'Aberto','Erro ao enviar documento','O anexo falha durante o envio','Normal','POSSEBON App','Aplicativo','2026-11-09'),
        (1492,1,9001,'Fechado','Revisar permissão de acesso','Grupo liberado e validado','Baixa','POSSEBON App','Aplicativo','2026-11-05'),
        (1493,1,9004,'Aberto','Solicitação de outra pessoa','Não pertence a este atendente','Alta','POSSEBON App','Aplicativo','2026-11-11'),
        (1494,2,9001,'Aberto','Chamado de outra unidade','Não pertence à EPC13','Alta','POSSEBON App','Aplicativo','2026-11-11');
      `);
      h.d.operational=new OperationalQueryService(
        async()=>({executeRead:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)}),
        async()=>({admin:true,tables:{}})
      );
      const ctx={...await h.d.sessions.resolveContext(9001,1,'worklist-test'),identitySource:'possebon' as const};
      const result=await h.d.liveBoards.evaluate(ctx,spec);
      expect(result).toMatchObject({validated:true,panels:[{records:3}]});
      const board=await h.d.liveBoards.create(ctx,spec);
      const data=await h.d.liveBoards.data(ctx,board.id);
      expect(data.panels).toHaveLength(1);
      expect(data.panels[0]).toMatchObject({type:'worklist',status:'ok',rowCount:3,
        worklist:{fields:{subject:'assunto'},defaultStatuses:['Aberto','Em atendimento']}});
      const rows=data.panels[0]!.rows as {numero:number;assunto:string}[];
      expect(rows.map(row=>row.numero).sort()).toEqual([1492,1500,1519]);
      expect(rows.find(row=>row.numero===1519)?.assunto).toContain('Corrigir falha');
      const candidates=await h.d.liveBoards.study(ctx,'chamado');
      expect(candidates.results.find(x=>x.table==='chamado')?.subject).toContain('assunto');
      expect(candidates.results.find(x=>x.table==='chamado')?.priority).toContain('prioridade');
      expect(candidates.results.find(x=>x.table==='chamado')?.responsibility).toContain('atendente_id');
    } finally { await h.close(); }
  });

  it('impede salvar uma falsa central premium sem problema/assunto do chamado',async()=>{
    const h=await setup();
    try {
      await h.d.db.exec(`
        CREATE TABLE public.chamado(id integer PRIMARY KEY,unit_id integer,
          atendente_id integer,situacao text,produto text);
        INSERT INTO public.chamado VALUES
          (1,1,9001,'Aberto','POSSEBON App'),
          (2,1,9001,'Em atendimento','POSSEBON App'),
          (3,1,9001,'Fechado','POSSEBON App'),
          (4,1,9001,'Rejeitado','POSSEBON App');
      `);
      h.d.operational=new OperationalQueryService(
        async()=>({executeRead:<T=Record<string,unknown>>(sql:string,params:unknown[]=[])=>h.d.db.query<T>(sql,params)}),
        async()=>({admin:true,tables:{}})
      );
      const ctx={...await h.d.sessions.resolveContext(9001,1,'worklist-missing-subject'),identitySource:'possebon' as const};
      const bad={
        title:'Dashboard de teste',
        panels:[{
          title:'Chamados sem assunto',type:'worklist',
          plan:{from:'chamado',select:[
            {field:'chamado.id',as:'numero'},
            {field:'chamado.situacao',as:'situacao'},
            {field:'chamado.produto',as:'produto'}
          ],where:[{field:'chamado.atendente_id',op:'eq',value:9001}],limit:200},
          worklist:{fields:{id:'numero',status:'situacao',subject:'produto',product:'produto'},
            defaultStatuses:['Aberto','Em atendimento']}
        }]
      };
      await expect(h.d.liveBoards.create(ctx,bad)).rejects.toThrow(/assunto|produto|categoria/i);
      expect((await h.d.db.query('SELECT 1 FROM ada.operational_board WHERE owner_user_id=9001')).rowCount).toBe(0);
    } finally { await h.close(); }
  });

  it('oferece controles de situação, gráfico, pesquisa, detalhes e validação na mesma tela',()=>{
    const source=readFileSync(new URL('../apps/web/src/components/WorklistPanel.tsx',import.meta.url),'utf8');
    expect(source).toContain('Distribuição por situação');
    expect(source).toContain('defaultStatuses');
    expect(source).toContain('Buscar número, assunto ou descrição');
    expect(source).toContain('aria-pressed');
    expect(source).toContain('Mostrar mais');
    expect(source).toContain('onClick={()=>setExpanded');
    const api=readFileSync(new URL('../apps/api/src/services/chat.ts',import.meta.url),'utf8');
    expect(api).toContain('avaliar_dashboard_antes_de_salvar');
    expect(api).toContain('investigar_requisitos_dashboard');
    expect(api).toContain('QUALIDADE PREMIUM');
    expect(api).toContain('Nunca confunda título do chamado');
  });
});
