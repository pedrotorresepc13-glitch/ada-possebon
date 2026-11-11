import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.ts';
import { watchDifferences, watchDisplay, watchFields, watchSummary } from '../apps/api/src/services/watch-presentation.ts';

describe('POSSO: capacidades disponíveis a todos com execução real', () => {
  it('envia notificação na unidade autorizada, sem duplicar o mesmo turno e com auditoria', async () => {
    const h=await setup();
    try {
      const admin=await h.login('admin.demo',1);
      await h.login('colab.a',1);
      const ctx=await h.d.sessions.resolveContext(9004,1,'agent-test');
      const sent=await h.d.notifications.send(ctx,{
        recipient:'admin.demo', title:'Atualização concluída', message:'A atualização do POSSO foi concluída.'
      },'turn-notify-1');
      expect(sent).toMatchObject({ok:true,recipientUserId:9001,unitId:1,channel:'in_app',alreadySent:false});
      const repeated=await h.d.notifications.send(ctx,{
        recipient:'admin.demo', title:'Atualização concluída', message:'A atualização do POSSO foi concluída.'
      },'turn-notify-1');
      expect(repeated).toMatchObject({ok:true,alreadySent:true,notificationId:sent.notificationId});
      const received=await admin.get('/notifications');
      expect(received.status).toBe(200);
      expect(received.json).toEqual(expect.arrayContaining([
        expect.objectContaining({title:'Atualização concluída',body:'A atualização do POSSO foi concluída.'})
      ]));
      const audited=await h.d.db.query<{n:number}>(
        "SELECT count(*)::int AS n FROM ada.audit_event WHERE action='notificacao.interna_enviada' AND actor_user_id=9004");
      expect(audited.rows[0]?.n).toBe(1);
      await expect(h.d.notifications.send(ctx,{recipientUserId:9005,message:'Teste fora da unidade.'}))
        .rejects.toThrow('unidade atual');
    } finally { await h.close(); }
  });

  it('oferece as mesmas ferramentas de execução ao administrador e ao usuário comum', async () => {
    const captured:Record<string,string[]>={};
    const h=await setup({ai:{name:'test',model:'test',configured:true,async run(input){
      const current=input.instructions.match(/identificador de usuário (\d+)/)?.[1]??'?';
      captured[current]=input.tools.map(t=>t.name);
      return {text:'Ferramentas prontas.',usage:{input:1,output:1},toolCalls:[],steps:1};
    }}});
    try {
      await h.login('admin.demo',1);
      await h.login('colab.a',1);
      for(const id of [9001,9004]){
        const ctx=await h.d.sessions.resolveContext(id,1,'agent-'+id);
        await h.d.chat.handle(ctx,{message:'Liste suas ferramentas e recursos.'});
      }
      expect(captured['9001']).toEqual(captured['9004']);
      for(const name of ['enviar_notificacao_interna','consultar_acompanhamento_registro','executar_comando_administrativo']){
        expect(captured['9004']).toContain(name);
      }
    }finally{await h.close();}
  });

  it('explica o avanço da SC sem códigos técnicos ou progresso inventado', () => {
    const before={
      c0:95790,solicitacao:'000002481',ordem_compra:null,conclusao_cotacao:null,
      autorizacao_compra:null,previsao_autorizacao:null,ultima_alteracao:'2026-11-11T12:41:41.000Z'
    };
    const after={...before,ordem_compra:'OC-123',ultima_alteracao:'2026-11-11T12:55:41.000Z'};
    const changes=watchDifferences(before,after);
    expect(changes.find(change=>change.field==='ordem_compra')).toEqual({
      field:'ordem_compra',label:'Ordem de compra',before:'não informado',after:'OC-123'
    });
    expect(changes.find(change=>change.field==='c0')).toBeUndefined();
    expect(watchSummary('SC 000002481',changes)).toContain('Ordem de compra: não informado → OC-123');
    expect(watchFields(before).some(field=>field.field==='c0')).toBe(false);
    expect(watchDisplay(before.ultima_alteracao,'ultima_alteracao')).toMatch(/^11\/11\/2026/);
    expect(watchSummary('SC 000002481',
      watchDifferences(before,{...before,ultima_alteracao:'2026-11-11T13:00:00.000Z'})))
      .toContain('nenhuma alteração nas demais etapas');
  });

  it('a interface administrativa usa o chat real e a SC não mostra campos brutos', () => {
    const admin=readFileSync(new URL('../apps/web/src/views/Admin.tsx',import.meta.url),'utf8');
    const watches=readFileSync(new URL('../apps/web/src/components/RecordWatches.tsx',import.meta.url),'utf8');
    expect(admin).toContain('<ChatView adminEmbedded />');
    expect(admin).not.toContain('function RulesChat()');
    expect(watches).toContain('detail.lastChange.summary');
    expect(watches).toContain('detail.fields.map');
    expect(watches).not.toContain('Object.entries(detail.row)');
  });
});
