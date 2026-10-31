import {expect,it} from 'vitest';
import {ownerMigrationSql} from '../scripts/deploy/local-owner.ts';
import {createPglite} from '../apps/api/src/db.ts';
import {migrateUp,migrateDown} from '../apps/api/src/migrate.ts';
it('migra com o proprietário e libera somente tabelas novas para a aplicação',async()=>{
 const db=await createPglite();try{await migrateUp(db);await migrateDown(db,2);
 await db.exec('CREATE ROLE ada_owner SUPERUSER; CREATE ROLE app_restrita; GRANT USAGE ON SCHEMA ada TO app_restrita;');
 const applied=await db.query<{version:string;checksum:string}>('SELECT version,checksum FROM ada_migrations.applied ORDER BY version');
 await db.exec(ownerMigrationSql(applied.rows,'app_restrita'));
 expect((await db.query("SELECT tableowner FROM pg_tables WHERE schemaname='ada' AND tablename='personal_workspace'")).rows[0]).toEqual({tableowner:'ada_owner'});
 await db.exec('SET ROLE app_restrita');
 expect((await db.query("SELECT has_table_privilege(current_user,'ada.personal_workspace','INSERT') AS ok")).rows[0]).toEqual({ok:true});
 await db.exec('RESET ROLE');
 await db.exec(ownerMigrationSql((await db.query<{version:string;checksum:string}>('SELECT version,checksum FROM ada_migrations.applied ORDER BY version')).rows,'app_restrita'));
 expect((await db.query('SELECT * FROM ada_migrations.applied')).rows).toHaveLength(7);
 }finally{await db.close();}
});
