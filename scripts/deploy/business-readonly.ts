import {isProtectedTable} from '../../apps/api/src/services/unit-path.ts';
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {Client}=require('pg');
export const protectedBusinessTable=isProtectedTable;
const ident=(s:string)=>'"'+s.replaceAll('"','""')+'"';
export function readGrants(tables:{name:string;can_read:boolean}[],role:string){
  return tables.filter(t=>!protectedBusinessTable(t.name)&&!t.can_read).map(t=>'GRANT SELECT ON public.'+ident(t.name)+' TO '+ident(role)+';');
}
if(process.argv[2]==='apply'||process.argv[2]==='plan'){
  if(!process.env.POSSEBON_READONLY_DATABASE_URL)throw new Error('Conexão operacional não configurada.');
  const client=new Client({connectionString:process.env.POSSEBON_READONLY_DATABASE_URL,connectionTimeoutMillis:8000});
  await client.connect();
  try{
    const r=await client.query("SELECT current_database() AS db,current_user AS role,pg_postmaster_start_time()::text AS started");
    const config=r.rows[0] as {db:string;role:string;started:string};
    const psql=(sql:string)=>{const p=spawnSync('runuser',['-u','postgres','--','psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','--dbname='+config.db],{cwd:'/tmp',input:sql,encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C.UTF-8'}});if(p.status!==0)throw new Error('Administração PostgreSQL local indisponível para o banco operacional.');return p.stdout.trim();};
    if(psql('SELECT pg_postmaster_start_time()::text')!==config.started)throw new Error('A fonte operacional está em outro PostgreSQL. Os privilégios precisam ser revisados no servidor de origem.');
    const tables=await client.query("SELECT c.relname AS name,has_table_privilege(current_user,c.oid,'SELECT') AS can_read FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname");
    const grants=readGrants(tables.rows,config.role);
    console.log('Tabelas de negócio que precisam de SELECT: '+grants.length);
    if(process.argv[2]==='apply'&&grants.length){
      // Acesso apenas de leitura para a credencial técnica já existente. API mantém autorização por usuário/unidade.
      const usage=(await client.query("SELECT has_schema_privilege(current_user,'public','USAGE') AS allowed")).rows[0].allowed;
      const undo=process.argv[3];if(!undo||!undo.startsWith('/var/backups/ada/')||!undo.endsWith('.sql'))throw new Error('Caminho do registro de reversão inválido.');
      writeFileSync(undo,'-- Banco: '+config.db+'\nBEGIN;\n'+tables.rows.filter((t:{name:string;can_read:boolean})=>!protectedBusinessTable(t.name)&&!t.can_read).map((t:{name:string})=>'REVOKE SELECT ON public.'+ident(t.name)+' FROM '+ident(config.role)+';').join('\n')+(usage?'':'\nREVOKE USAGE ON SCHEMA public FROM '+ident(config.role)+';')+'\nCOMMIT;\n',{mode:0o600});
      psql('BEGIN; GRANT USAGE ON SCHEMA public TO '+ident(config.role)+';\n'+grants.join('\n')+'\nCOMMIT;');
      console.log('Leitura de negócio concedida. Tabelas técnicas protegidas foram excluídas.');
    }
  }finally{await client.end();}
}
