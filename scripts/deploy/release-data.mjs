import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {parseEnv} from 'node:util';
const [mode,file]=process.argv.slice(2);
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL ausente em migrate.env');
const url=new URL(process.env.DATABASE_URL);
if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Atualização exige PostgreSQL.');
if(mode==='validate'){
  const config=parseEnv(readFileSync('/etc/ada/ada.env','utf8'));
  if(config.ADA_DB_DRIVER==='pglite'||!config.DATABASE_URL)throw new Error('Este atualizador é exclusivo para o PostgreSQL do servidor.');
  const appUrl=new URL(config.DATABASE_URL);
  if(appUrl.hostname!==url.hostname||(appUrl.port||'5432')!==(url.port||'5432')||appUrl.pathname!==url.pathname)throw new Error('A aplicação e as migrations apontam para bancos diferentes.');
}else if(mode==='backup'){
  const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password)};
  if(url.searchParams.has('sslmode'))env.PGSSLMODE=url.searchParams.get('sslmode');
  const r=spawnSync('pg_dump',['--format=custom','--no-owner','--schema=ada','--schema=ada_migrations','--file='+file],{env,stdio:['ignore','inherit','pipe']});
  if(r.status!==0)throw new Error('pg_dump falhou. Verifique conexão e permissões do usuário de migração.');
  if(spawnSync('pg_restore',['--list',file],{stdio:'ignore'}).status!==0)throw new Error('Backup ilegível. Atualização interrompida.');
}else if(mode==='snapshot'||mode==='verify'){
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try{const result={};
    for(const table of ['conversation','message','dashboard','dashboard_revision','operational_board','user_memory','user_preference']){
      const exists=await client.query('SELECT to_regclass($1) AS table',['ada.'+table]);if(!exists.rows[0].table)continue;
      const rows=await client.query(`SELECT count(*)::text AS count,md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS hash FROM ada.${table} t) hashes`);
      result[table]=rows.rows[0];
    }
    if(mode==='snapshot')writeFileSync(file,JSON.stringify(result),{mode:0o600});
    else if(JSON.stringify(result)!==readFileSync(file,'utf8'))throw new Error('Dados existentes diferem do snapshot anterior. Promoção interrompida.');
  }finally{await client.end();}
}else throw new Error('Modo inválido.');
