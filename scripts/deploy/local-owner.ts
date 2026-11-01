import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {listMigrations} from '../../apps/api/src/migrate.ts';
const require=createRequire(import.meta.url);
const pg=require('pg');
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export function ownerMigrationSql(applied:{version:string;checksum:string}[],appRole:string){
  const all=listMigrations();const known=new Map(applied.map(r=>[r.version,r.checksum]));
  for(const m of all)if(known.has(m.version)&&known.get(m.version)!==m.checksum)throw new Error('Checksum divergente: '+m.version);
  const pending=all.filter(m=>!known.has(m.version));
  if(pending.some(m=>!['0006_corporate_memory','0007_personal_workspace','0008_study_offsets'].includes(m.version)))throw new Error('Estado anterior inesperado.');
  const registry=JSON.stringify([...applied].sort((a,b)=>a.version.localeCompare(b.version)));
  const guard=`DO $guard$ BEGIN IF (SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'checksum',checksum) ORDER BY version),'[]'::jsonb) FROM ada_migrations.applied) <> ${literal(registry)}::jsonb THEN RAISE EXCEPTION 'Registro de migrations mudou'; END IF; END $guard$;`;
  const role='"'+appRole.replaceAll('"','""')+'"';
  const grants=pending.flatMap(m=>m.up.match(/CREATE TABLE ada\.([a-z_]+)/g)??[]).map(s=>s.replace('CREATE TABLE ',''));
  return `BEGIN; SET LOCAL ROLE ada_owner; LOCK TABLE ada_migrations.applied IN ACCESS EXCLUSIVE MODE;\n${guard}\n`+pending.map(m=>m.up+`\nINSERT INTO ada_migrations.applied(version,checksum) VALUES(${literal(m.version)},${literal(m.checksum)});`).join('\n')+(grants.length?`\nGRANT SELECT,INSERT,UPDATE,DELETE ON ${grants.join(',')} TO ${role};`:'')+'\nCOMMIT;';
}
function psql(sql:string){
  const r=spawnSync('runuser',['-u','postgres','--','psql','-X','-w','-qAt','-v','ON_ERROR_STOP=1','-d','ada_possebon'],{cwd:'/tmp',input:sql,encoding:'utf8',env:{PATH:process.env.PATH,LANG:'C.UTF-8'},maxBuffer:8*1024*1024});
  if(r.status!==0)throw new Error('Operação PostgreSQL local falhou: '+r.stderr);
  return r.stdout.trim();
}
if(process.argv[2]==='validate'||process.argv[2]==='migrate'){
  const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
  await client.connect();
  try{
    const sql="SELECT json_build_object('db',current_database(),'started',pg_postmaster_start_time()::text)::text";
    const remote=(await client.query(sql)).rows[0].json_build_object;
    const local=psql(sql);
    if(remote!==local)throw new Error('A conexão da aplicação não corresponde ao PostgreSQL local confirmado.');
    if(psql("SELECT string_agg(nspname||':'||pg_get_userbyid(nspowner),',' ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('ada','ada_migrations')")!=='ada:ada_owner,ada_migrations:ada_owner')throw new Error('Proprietários de schema divergentes.');
    const appRole=(await client.query('SELECT current_user AS name')).rows[0].name;
    const applied=JSON.parse(psql("SELECT COALESCE(json_agg(t),'[]'::json)::text FROM (SELECT version,checksum FROM ada_migrations.applied ORDER BY version) t"));
    const plan=ownerMigrationSql(applied,appRole);
    if(process.argv[2]==='migrate')psql(plan);
    console.log(process.argv[2]==='validate'?'Migração local com ada_owner validada.':'Migração local concluída com ada_owner.');
  }finally{await client.end();}
}
