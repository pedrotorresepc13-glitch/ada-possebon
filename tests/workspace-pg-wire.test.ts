import {expect,it} from 'vitest';
import {createRequire} from 'node:module';
import {setup} from './helpers.ts';
import type {Queryable} from '../apps/api/src/db.ts';
const require=createRequire(import.meta.url);
const {prepareValue}=require('pg/lib/utils');
it('prepara e retoma etapas com a serialização de parâmetros usada pelo driver PostgreSQL',async()=>{
  const h=await setup();
  const original=h.d.db;
  const wire=(q:Queryable):Queryable=>({query:<T>(sql:string,params:unknown[]=[])=>q.query<T>(sql,params.map(p=>prepareValue(p)))});
  h.d.db={...original,query:wire(original).query,tx:fn=>original.tx(q=>fn(wire(q)))};
  try{
    const c=await h.login('admin.demo');const me=(await c.get('/me')).json;
    const ctx=await h.d.sessions.resolveContext(me.user.systemUserId,me.activeUnit.id,'pg-wire');
    await h.d.workspace.run(ctx);
    const rows=await original.query<{state:string;tasks:{state:string}[];conversation_id:string}>('SELECT state,tasks,conversation_id FROM ada.personal_workspace');
    expect(rows.rows[0]?.state).toBe('ready');
    expect(rows.rows[0]?.tasks.filter(t=>t.state==='done')).toHaveLength(4);
    expect(rows.rows[0]?.conversation_id).toBeTruthy();
    await h.d.workspace.retry(ctx);
    await h.d.workspace.run(ctx);
  }finally{await h.close();}
});
