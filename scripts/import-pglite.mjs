#!/usr/bin/env node
// ADA POSSEBON — importar exportacao logica PGlite no PostgreSQL 15.
// Protecoes: banco exclusivo ada_possebon, role ada_owner, 39 tabelas vazias,
// schema/migrations e hashes idênticos; transacao unica ou ROLLBACK.
// Nunca interromper o POSSEBON Web nem tocar no banco possebon_app.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import pg from 'pg';

const folder=process.argv[2] ? path.resolve(process.argv[2]) : null;
const ID=/^[a-z_][a-z0-9_]*$/;
function insist(ok,msg){if(!ok)throw new Error(msg);}
function quote(s){insist(ID.test(s),'Identificador SQL invalido');return '"'+s+'"';}
async function checksum(file){
  const hash=crypto.createHash('sha256');
  for await(const block of fs.createReadStream(file))hash.update(block);
  return hash.digest('hex');
}
async function columns(client){
  const r=await client.query(
    "SELECT table_name,column_name,udt_name,is_generated FROM information_schema.columns WHERE table_schema='ada' ORDER BY table_name,ordinal_position");
  const byTable=new Map();
  for(const x of r.rows){
    insist(ID.test(x.table_name)&&ID.test(x.column_name),'Schema inesperado');
    if(!byTable.has(x.table_name))byTable.set(x.table_name,[]);
    byTable.get(x.table_name).push({
      name:x.column_name,udt:x.udt_name,generated:x.is_generated!=='NEVER'
    });
  }
  return byTable;
}
async function* jsonLines(file){
  const reader=readline.createInterface({
    input:fs.createReadStream(file,{encoding:'utf8'}),crlfDelay:Infinity
  });
  for await(const line of reader)if(line)yield JSON.parse(line);
}
async function orderTables(client,names){
  const r=await client.query(
    "SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint f "+
    "JOIN pg_class child ON child.oid=f.conrelid "+
    "JOIN pg_namespace ns ON ns.oid=child.relnamespace "+
    "JOIN pg_class parent ON parent.oid=f.confrelid "+
    "JOIN pg_namespace pn ON pn.oid=parent.relnamespace "+
    "WHERE f.contype='f' AND ns.nspname='ada' AND pn.nspname='ada'"
  );
  const deps=new Map(names.map(n=>[n,new Set()]));
  for(const f of r.rows){
    if(deps.has(f.child)&&deps.has(f.parent)&&f.child!==f.parent)
      deps.get(f.child).add(f.parent);
  }
  const sorted=[];
  while(deps.size){
    const ready=[...deps].filter(([,parents])=>[...parents].every(p=>!deps.has(p)))
      .map(([name])=>name).sort();
    insist(ready.length>0,'Dependencias circulares; importacao bloqueada');
    for(const name of ready){sorted.push(name);deps.delete(name);}
  }
  return sorted;
}

insist(folder,'Uso: node scripts/import-pglite.mjs /pasta/exportacao');
insist(process.env.PGPASSWORD,'PGPASSWORD nao definido no terminal');
const manifestFile=path.join(folder,'manifest.json');
insist(fs.existsSync(manifestFile),'manifest.json ausente');
const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
insist(manifest.format==='ada-pglite-jsonl-v1','Formato de arquivo nao suportado');
insist(Array.isArray(manifest.tables)&&manifest.tables.length===39,'Esperadas 39 tabelas no manifest');
const names=manifest.tables.map(t=>t.name);
insist(new Set(names).size===39,'Nomes de tabela duplicados');
insist(Array.isArray(manifest.migrations)&&manifest.migrations.length===5,'Migrations incompletas');

console.log('===== VALIDANDO ARQUIVOS SHA-256 =====');
for(const t of manifest.tables){
  insist(ID.test(t.name)&&t.filename===t.name+'.jsonl','Nome de tabela/arquivo invalido');
  insist(Number.isSafeInteger(t.count)&&t.count>=0,'Contagem invalida');
  insist(Array.isArray(t.columns)&&t.columns.every(c=>ID.test(c)),'Colunas invalidas');
  insist(Array.isArray(t.schema),'Schema ausente no manifest');
  const actual=await checksum(path.join(folder,t.filename));
  insist(actual===t.sha256,'Arquivo alterado: '+t.filename);
}
console.log('39 arquivos verificados.');

const client=new pg.Client({
  host:'127.0.0.1',port:5432,
  database:'ada_possebon',user:'ada_owner',
  password:process.env.PGPASSWORD,ssl:false,
  connectionTimeoutMillis:10000
});
await client.connect();
try{
  const identity=(await client.query('SELECT current_database() AS db,current_user AS role')).rows[0];
  insist(identity.db==='ada_possebon' && identity.role==='ada_owner','Banco/usuario de destino diferente do esperado');
  const target=await columns(client);
  insist(target.size===39,'Destino deve conter 39 tabelas Ada');
  const migrations=(await client.query('SELECT version,checksum FROM ada_migrations.applied ORDER BY version')).rows
    .map(x=>[x.version,x.checksum]);
  insist(JSON.stringify(migrations)===JSON.stringify(manifest.migrations),'Migrations de origem e destino diferentes');
  for(const t of manifest.tables){
    insist(target.has(t.name),'Tabela ausente: '+t.name);
    insist(JSON.stringify(target.get(t.name))===JSON.stringify(t.schema),'Colunas/tipos divergentes: '+t.name);
    insist(JSON.stringify(t.columns)===JSON.stringify(t.schema.filter(c=>!c.generated).map(c=>c.name)),'Lista de colunas inconsistente');
    const count=(await client.query('SELECT count(*)::integer AS total FROM ada.'+quote(t.name))).rows[0].total;
    insist(count===0,'Tabela de destino nao esta vazia: '+t.name);
  }
  const ordered=await orderTables(client,names);
  const lookup=new Map(manifest.tables.map(t=>[t.name,t]));
  console.log('===== IMPORTANDO EM TRANSACAO =====');
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL statement_timeout='120s'");
    for(const name of ordered){
      const t=lookup.get(name);
      const cols=t.columns.map(quote).join(',');
      const sql='INSERT INTO ada.'+quote(name)+' ('+cols+') SELECT '+cols+
        ' FROM jsonb_populate_recordset(NULL::ada.'+quote(name)+',$1::jsonb)';
      let batch=[],bytes=0,written=0;
      const flush=async()=>{
        if(!batch.length)return;
        const r=await client.query(sql,[JSON.stringify(batch)]);
        written+=r.rowCount;
        batch=[];bytes=0;
      };
      for await(const row of jsonLines(path.join(folder,t.filename))){
        insist(row && typeof row==='object' && !Array.isArray(row),'Registro invalido em '+name);
        const serialized=JSON.stringify(row);
        batch.push(row);
        bytes+=Buffer.byteLength(serialized);
        if(batch.length>=100||bytes>=512*1024)await flush();
      }
      await flush();
      insist(written===t.count,'Contagem divergente: '+name);
      console.log(name.padEnd(30)+' '+written);
    }
    for(const t of manifest.tables){
      const r=await client.query('SELECT count(*)::integer AS total FROM ada.'+quote(t.name));
      insist(r.rows[0].total===t.count,'Falha na conferencia final: '+t.name);
    }
    const serials=await client.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='ada' AND column_default LIKE 'nextval(%'");
    for(const s of serials.rows){
      const max=(await client.query(
        'SELECT max('+quote(s.column_name)+')::text AS total FROM ada.'+quote(s.table_name)
      )).rows[0].total;
      const sequence=(await client.query(
        'SELECT pg_get_serial_sequence($1,$2) AS name',['ada.'+s.table_name,s.column_name]
      )).rows[0].name;
      if(sequence)await client.query('SELECT setval($1::regclass,$2::bigint,$3::boolean)',[sequence,max||'1',Boolean(max)]);
    }
    await client.query('COMMIT');
    console.log('===== IMPORTACAO VALIDADA E CONCLUIDA =====');
  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }
}finally{await client.end();}
