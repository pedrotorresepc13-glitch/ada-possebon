import {expect,it} from 'vitest';
import {Extraction} from '../apps/api/src/services/corporate-memory.ts';
const fact={ordinal:0,topic:'Contrato',statement:'O contrato exige a entrega dos documentos.',evidence:'O contrato exige a entrega dos documentos.',certainty:'documental'};
it('aceita lote misto com categorias canônicas, plurais, acentos e temas novos',()=>{
 const result=Extraction.parse({facts:['cliente',' CONTRATOS ','Obrigações','financeiro','prazos'].map(category=>({...fact,category}))});
 expect(result.facts.map(f=>f.category)).toEqual(['cliente','contrato','obrigacao','outro','prazo']);
 expect(result.facts.every(f=>f.evidence===fact.evidence)).toBe(true);
});
it('mantém validação de evidência, certeza, ordinal e tipo da categoria',()=>{
 for(const patch of [{category:12},{certainty:'comprovado'},{ordinal:-1},{evidence:'curta'}]){
   expect(Extraction.safeParse({facts:[{...fact,category:'contrato',...patch}]}).success).toBe(false);
 }
});
