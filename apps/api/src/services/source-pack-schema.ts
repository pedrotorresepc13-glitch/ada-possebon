import {z} from 'zod';
const name=z.string().min(1).max(200);const identifier=z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const source=z.object({path:z.string().regex(/^app\/(?:model|control|custom|service)\/[A-Za-z0-9_./-]+\.php$/).refine(p=>!p.includes('..')),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
export const SystemSourcePack=z.object({format:z.literal('possebon-system-source-v1'),classification:z.literal('interno-restrito'),snapshot:z.iso.datetime(),
 models:z.array(z.object({name,table:identifier,fields:z.array(identifier).max(300),source})).max(3000),
 queries:z.array(z.object({name,fields:z.array(identifier).max(300),candidateTables:z.array(identifier).max(200),source})).max(1000).default([]),
 modules:z.array(z.object({name,methods:z.array(name).max(300),source})).max(1000).default([]),
 screens:z.array(z.object({name,title:name,area:name,table:identifier.nullable(),fields:z.array(z.string().max(150)).max(500),
  definitions:z.array(z.object({field:identifier,code:z.string().min(1).max(12),label:z.string().min(1).max(120)})).max(300),
  optionLists:z.array(z.object({field:z.string().max(150),values:z.array(z.object({code:z.string().min(1).max(12),label:z.string().min(1).max(120)})).max(40)})).max(100).default([]),
  defaults:z.array(z.object({field:identifier,value:z.string().max(80)})).max(100),source})).max(10000)
}).strict().superRefine((pack,ctx)=>{
 if(!pack.models.length&&!pack.queries.length&&!pack.screens.length)ctx.addIssue({code:'custom',message:'Pacote sem estruturas.'});
 const paths=new Set<string>();for(const item of [...pack.models,...pack.queries,...pack.screens,...pack.modules]){if(paths.has(item.source.path))ctx.addIssue({code:'custom',message:'Fonte duplicada no pacote.'});paths.add(item.source.path);}
 for(const screen of pack.screens)for(const definition of screen.definitions){if(!pack.models.some(m=>m.table===screen.table&&m.fields.includes(definition.field)))ctx.addIssue({code:'custom',message:'Definição sem campo do modelo declarado.'});}
});
export type SourcePack=z.infer<typeof SystemSourcePack>;
