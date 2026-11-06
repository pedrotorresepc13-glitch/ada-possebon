import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');
const mode = process.argv[2];
if (!['check', 'apply', 'rollback'].includes(mode)) throw new Error('Use check ou apply.');
const client = new Client({ connectionString: process.env.POSSEBON_READONLY_DATABASE_URL, connectionTimeoutMillis: 8000 });
if (!process.env.POSSEBON_READONLY_DATABASE_URL) throw new Error('Conexão operacional não configurada.');
await client.connect();
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
try {
  const { rows: [database] } = await client.query("SELECT current_database() AS name,current_user AS role,pg_postmaster_start_time()::text AS started");
  const local = sql => {
    const result = spawnSync('runuser', ['-u', 'postgres', '--', 'psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname='+database.name], {
      cwd: '/tmp', input: sql, encoding: 'utf8', env: { PATH: process.env.PATH, LANG: 'C.UTF-8' }
    });
    if (result.status !== 0) throw new Error('Falha na validação ou concessão no PostgreSQL local. '+result.stderr);
    return result.stdout.trim();
  };
  if (local('SELECT pg_postmaster_start_time()::text') !== database.started) {
    throw new Error('A conexão aponta para outro PostgreSQL. A concessão exige acesso ao servidor de origem.');
  }
  if (mode === 'rollback') {
    const file = process.argv[3];
    if (!file || !file.startsWith('/var/backups/ada/') || !file.endsWith('.sql') || file.includes('..')) throw new Error('Caminho de reversão inválido.');
    local(readFileSync(file,'utf8'));
    console.log('Concessões desta atualização revertidas.');
  } else {  const required = ['system_users','system_group','system_program','system_user_group','system_group_program','system_user_program','system_user_unit','system_unit'];
  const columns = ['id','name','login','active','controller','actions','system_user_id','system_group_id','system_program_id','system_unit_id'];
  const { rows } = await client.query(
    "SELECT c.relname,a.attname,has_column_privilege(current_user,c.oid,a.attnum,'SELECT') AS allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped AND a.attname=ANY($2::text[])",
    [required,columns]
  );
  for (const table of required) {
    if (!rows.some(row=>row.relname===table)) throw new Error('Tabela ausente no banco operacional: '+table);
  }
  const missing = rows.filter(row=>!row.allowed);
  const usage = (await client.query("SELECT has_schema_privilege(current_user,'public','USAGE') AS allowed")).rows[0].allowed;
  console.log('Banco operacional identificado. Campos que precisam de leitura: '+missing.length);
  const sql = readFileSync(new URL('../../deploy/sql/possebon-directory-read.sql',import.meta.url),'utf8').replace(":'posso_role'",literal(database.role));
  if (mode === 'check') {
    local(sql.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
    console.log('Concessão validada em transação revertida.');
  } else {
    const backup = process.argv[3];
    if (!backup || !/^\/var\/backups\/ada\/[A-Za-z0-9_./-]+\.sql$/.test(backup) || backup.includes('..')) throw new Error('Informe arquivo de reversão em /var/backups/ada.');
    const undo = missing.map(row=>'REVOKE SELECT ('+identifier(row.attname)+') ON public.'+identifier(row.relname)+' FROM '+identifier(database.role)+';');
    if (!usage) undo.push('REVOKE USAGE ON SCHEMA public FROM '+identifier(database.role)+';');
    writeFileSync(backup,'BEGIN;\n'+undo.join('\n')+'\nCOMMIT;\n',{mode:0o600,flag:'wx'});
    local(sql);
    for (const table of required) {
      const fields=rows.filter(row=>row.relname===table).map(row=>identifier(row.attname)).join(',');
      await client.query('SELECT '+fields+' FROM public.'+identifier(table)+' LIMIT 0');
    }
    console.log('Leitura dos cadastros e vínculos validada. Reversão: '+backup);
  }
  }
} finally { await client.end(); }
