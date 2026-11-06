import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { operationalChangeEvidence, pullPossebonOutbox } from '../apps/api/src/services/possebon-outbox.ts';
import { OperationalQueryService } from '../apps/api/src/services/operational-query.ts';
import { ReadonlyPostgresConnector } from '../apps/api/src/services/readonly-postgres.ts';
import { setup } from './helpers.ts';

it('retoma do ponto confirmado e reverte o lote inteiro quando a origem tem uma lacuna', async () => {
  const h = await setup();
  try {
    h.d.config.possebonOutbox = true;
    const connector = new ReadonlyPostgresConnector('postgres://localhost/fixture');
    const read = vi.spyOn(connector, 'executeRead');
    vi.spyOn(h.d.catalog, 'operationalSource').mockResolvedValue(connector);
    const source = Object.values(h.d.catalog.catalog.sources).find(item => item.monitor)!.id;
    const row = (sequence: number, eventId = String(sequence)) => ({
      sequence: String(sequence),
      event: { source, recordKey: 'test', unitId: 1, occurredAt: '2026-11-01T12:00:00Z', eventId, record: {} }
    });
    const count = async () => (await h.d.db.query('SELECT event_id FROM ada.inbound_event')).rowCount;
    await h.d.db.exec(await readFile(new URL('../deploy/sql/possebon-change-outbox.sql', import.meta.url), 'utf8'));
    const publish = 'SELECT posso_integration.publish_change($1::jsonb)::text AS sequence';
    await expect(h.d.db.tx(async q => {
      await q.query(publish, [JSON.stringify(row(1).event)]);
      throw new Error('reverter publicação');
    })).rejects.toThrow('reverter publicação');
    expect((await h.d.db.query(publish, [JSON.stringify(row(1).event)])).rows)
      .toEqual([{ sequence: '1' }]);
    await h.d.db.exec(`CREATE TABLE public.captura_teste (id integer PRIMARY KEY, unit_id integer, status text, senha text);
      CREATE TRIGGER captura_posso AFTER INSERT OR UPDATE ON public.captura_teste
      FOR EACH ROW EXECUTE FUNCTION posso_integration.capture_monitored_row('${source}', 'id', 'unit_id', 'status');
      INSERT INTO public.captura_teste VALUES(1,1,'aberto','segredo');
      UPDATE public.captura_teste SET senha='outro segredo';
      UPDATE public.captura_teste SET status='fechado';`);
    const emitted = await h.d.db.query<{ event: { record: unknown; source: string } }>(
      'SELECT event FROM posso_integration.change_outbox WHERE sequence>1 ORDER BY sequence'
    );
    expect(emitted.rows.map(row => row.event.record)).toEqual([
      {id:1,unit_id:1,status:'aberto'}, {id:1,unit_id:1,status:'fechado'}
    ]);
    expect(emitted.rows.every(row => row.event.source === source)).toBe(true);
    read.mockResolvedValueOnce({ rows: [row(1), row(3)], rowCount: 2 });
    await expect(pullPossebonOutbox(h.d)).rejects.toThrow('Lacuna');
    expect(await count()).toBe(0);
    read.mockResolvedValueOnce({ rows: [row(1), row(2, '1')], rowCount: 2 });
    expect(await pullPossebonOutbox(h.d)).toBe(1);
    expect(read).toHaveBeenLastCalledWith(expect.any(String), ['0']);
    read.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await pullPossebonOutbox(h.d)).toBe(0);
    expect(read).toHaveBeenLastCalledWith(expect.any(String), ['2']);
    expect(await count()).toBe(1);
    await h.d.db.query(
      `INSERT INTO ada.operational_watch(owner_user_id,unit_id,name,plan,snapshot_enc,next_check_at)
       VALUES (9001,1,'teste',$1,'fixture',now()+interval '1 hour'),
              (9001,2,'teste',$1,'fixture',now()+interval '1 hour')`, [{ from: 'captura_teste' }]
    );
    await h.d.db.exec(`DROP TRIGGER captura_posso ON public.captura_teste;
      CREATE TRIGGER captura_posso AFTER INSERT OR UPDATE ON public.captura_teste
      FOR EACH ROW EXECUTE FUNCTION posso_integration.capture_monitored_row('possebon.operational', 'id', 'unit_id', 'status');
      UPDATE public.captura_teste SET status='em análise';`);
    const operational = (await h.d.db.query<{event: unknown}>(
      'SELECT event FROM posso_integration.change_outbox WHERE sequence=4'
    )).rows[0]!.event;
    expect(operational).toMatchObject({source:'possebon.operational',record:{table:'captura_teste'}});
    read.mockResolvedValueOnce({rows:[{sequence:'3',event:operational}],rowCount:1});
    expect(await pullPossebonOutbox(h.d)).toBe(1);
    expect((await h.d.db.query('SELECT unit_id,next_check_at <= now() AS due FROM ada.operational_watch ORDER BY unit_id')).rows)
      .toEqual([{unit_id:1,due:true},{unit_id:2,due:false}]);
    h.d.operational = new OperationalQueryService(async () => ({
      executeRead: <T>(sql: string, params: unknown[] = []) => h.d.db.query<T>(sql, params)
    }));
    const actor = { ...await h.d.sessions.resolveContext(9001,1,'test'), identitySource:'possebon' as const };
    expect(await operationalChangeEvidence(h.d,actor,'captura_teste'))
      .toMatchObject({state:'evento_observado',unitId:1,last:{sequence:'3'},requiresCurrentQuery:true});
    expect(await operationalChangeEvidence(h.d,{...actor,activeUnitId:2},'captura_teste'))
      .toMatchObject({state:'sem_evento_observado'});
    await expect(operationalChangeEvidence(h.d,{...actor,roles:['user'],programs:{}},'captura_teste')).rejects.toThrow();
  } finally { await h.close(); }
});
