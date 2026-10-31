#!/usr/bin/env node
// ADA POSSEBON: exportacao logica do PGlite, apenas leitura.
// Preserva UUIDs, JSON, timestamps, bytea e ids; omite colunas GENERATED.
// Saida sensivel: mantenha o diretorio exportado privado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dest=process.argv[2] ? path.resolve(process.argv[2]) : null;
const ident=/^[a-z_][a-z0-9_]*$/;

function check(ok,msg){if(!ok)throw new Error(msg);}
function quote(s){check(ident.test(s),'Identificador nao permitido');return '"'+s+'"';}
function setting(raw,key){
  const line=raw.split(/\r?\n/).find(s=>new RegExp('^\\s*'+key+'\\s*=').test(s));
  return line ? line.slice(line.indexOf('=')+1).trim().replace(/^["']|["']$/g,'') : undefined;
}
check(dest,'Informe a pasta de exportacao');
check(!fs.existsSync(dest),'Pasta ja existe. Nao sobrescreveremos exportacoes.');
const envPath=path.join(root,'.env');
check(fs.existsSync(envPath),'Arquivo .env nao encontrado');
const env=fs.readFileSync(envPath,'utf8');
const key=setting(env,'ADA_ENCRYPTION_KEY');
check(key,'ADA_ENCRYPTION_KEY nao configurada. Preservar ou recifrar antes de migrar.');
check(Buffer.from(key,'base64').length===32,'ADA_ENCRYPTION_KEY invalida');
const dataDir=path.resolve(root,setting(env,'ADA_PGLITE_DIR')||'.data/pglite');
check(fs.existsSync(dataDir),'PGlite nao encontrado');
const db=new PGlite(dataDir);
try{
  await db.waitReady;
  const r=await db.query(
    "SELECT table_name,column_name,udt_name,is_generated FROM information_schema.columns WHERE table_schema='ada' ORDER BY table_name,ordinal_position"
  );
  const cols=new Map();
  for(const c of r.rows){
    check(ident.test(c.table_name)&&ident.test(c.column_name),'Schema inesperado');
    if(!cols.has(c.table_name))cols.set(c.table_name,[]);
    cols.get(c.table_name).push({
      name:c.column_name,udt:c.udt_name,generated:c.is_generated!=='NEVER'
    });
  }
  check(cols.size===39,'Numero inesperado de tabelas: '+cols.size);
  const applied=await db.query('SELECT version,checksum FROM ada_migrations.applied ORDER BY version');
  const manifest={
    format:'ada-pglite-jsonl-v1',
    exportedAt:new Date().toISOString(),
    migrations:applied.rows.map(x=>[x.version,x.checksum]),
    tables:[]
  };
  fs.mkdirSync(dest,{recursive:true,mode:0o700});
  for(const [name,definition] of [...cols].sort(([a],[b])=>a.localeCompare(b))){
    const filename=name+'.jsonl';
    const fd=fs.openSync(path.join(dest,filename),'wx',0o600);
    const hash=crypto.createHash('sha256');
    const fields=definition.filter(x=>!x.generated).map(x=>x.name);
    let count=0;
    try{
      for(let offset=0;;offset+=100){
        const page=await db.query(
          'SELECT row_to_json(t) AS payload FROM ada.'+quote(name)+' t ORDER BY t.ctid LIMIT 100 OFFSET $1',
          [offset]
        );
        if(!page.rows.length)break;
        for(const item of page.rows){
          const row=typeof item.payload==='string'?JSON.parse(item.payload):item.payload;
          check(row && typeof row==='object' && !Array.isArray(row),'Linha JSON invalida');
          const data={};
          for(const col of fields)data[col]=row[col]===undefined?null:row[col];
          const line=JSON.stringify(data)+'\n';
          fs.writeSync(fd,line);
          hash.update(line);
          count++;
        }
      }
    }finally{fs.closeSync(fd);}
    manifest.tables.push({
      name,filename,count,
      schema:definition,
      columns:fields,
      sha256:hash.digest('hex')
    });
    console.log(name.padEnd(30)+' '+count);
  }
  fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log('EXPORTACAO CONCLUIDA');
  console.log('Tabelas: '+manifest.tables.length);
  console.log('Registros: '+manifest.tables.reduce((v,t)=>v+t.count,0));
  console.log('Chave de criptografia detectada: SIM (nao exportada)');
  console.log('Destino: '+dest);
}finally{
  await db.close();
}
