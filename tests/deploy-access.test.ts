import {afterAll,beforeAll,expect,it} from 'vitest';
import {createPglite,type Db} from '../apps/api/src/db.ts';
import {migrateUp} from '../apps/api/src/migrate.ts';
const {checkMigrationAccess}=await import(new URL('../scripts/deploy/migration-access.mjs',import.meta.url).href);
let db:Db;
beforeAll(async()=>{
  db=await createPglite();await migrateUp(db);
  await db.exec(`CREATE ROLE release_reader;
    GRANT USAGE ON SCHEMA ada,ada_migrations TO release_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA ada,ada_migrations TO release_reader;
    CREATE ROLE release_writer;
    GRANT USAGE,CREATE ON SCHEMA ada,ada_migrations TO release_writer;
    GRANT SELECT,REFERENCES ON ALL TABLES IN SCHEMA ada TO release_writer;
    GRANT SELECT ON ada_migrations.applied TO release_writer;`);
});
afterAll(async()=>db.close());
it('aceita a conexão existente quando ela já possui privilégios de migração',async()=>{
  await expect(checkMigrationAccess(db)).resolves.toBeUndefined();
});
it('rejeita conexão de leitura sem alterar tabelas ou permissões',async()=>{
  const before=await db.query('SELECT * FROM ada_migrations.applied ORDER BY version');
  await db.exec('SET ROLE release_reader');
  try{await expect(checkMigrationAccess(db)).rejects.toThrow(/Serviços continuam ativos/);}finally{await db.exec('RESET ROLE');}
  expect((await db.query('SELECT * FROM ada_migrations.applied ORDER BY version')).rows).toEqual(before.rows);
});
it('exige INSERT no registro de migrations mesmo quando SELECT e CREATE estão liberados',async()=>{
  await db.exec('SET ROLE release_writer');
  try{await expect(checkMigrationAccess(db)).rejects.toThrow(/permissões de migração/);}finally{await db.exec('RESET ROLE');}
  await db.exec('GRANT INSERT ON ada_migrations.applied TO release_writer; SET ROLE release_writer');
  try{await expect(checkMigrationAccess(db)).resolves.toBeUndefined();}finally{await db.exec('RESET ROLE');}
});
