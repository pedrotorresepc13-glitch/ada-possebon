import {useState} from 'react';
import {api} from '../api.ts';
interface Source{documentId:string;title:string;excerpt:string}
export function DictionaryApproval({sources}:{sources:Source[]}){
 const [form,setForm]=useState({table:'',column:'status',code:'',label:'',documentId:'',quote:''});const [busy,setBusy]=useState(false);const [result,setResult]=useState('');const [error,setError]=useState('');
 const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setResult('');try{await api('/admin/business-dictionary',{method:'PUT',body:form});setResult('Significado aprovado. As próximas consultas deste campo já usarão a definição enquanto a fonte permanecer válida.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <details><summary>Homologar significado de um código</summary>
  <p className="muted small">Somente administração. Escolha uma fonte da área selecionada que documente a relação entre código e descrição. A definição vale apenas para esta tabela, campo e unidade.</p>
  {!sources.length?<p>Selecione uma área com documento elegível. Se a regra ainda não estiver documentada, cadastre a documentação antes de aprovar.</p>:<form className="grid" style={{gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))"}} onSubmit={e=>void submit(e)}>
   <label className="field">Tabela do módulo<input className="input" required maxLength={63} pattern="[a-z][a-z0-9_]*" value={form.table} onChange={e=>setForm({...form,table:e.target.value})}/></label>
   <label className="field">Campo<input className="input" required maxLength={63} pattern="[a-z][a-z0-9_]*" value={form.column} onChange={e=>setForm({...form,column:e.target.value})}/></label>
   <label className="field">Código<input className="input" required maxLength={50} value={form.code} onChange={e=>setForm({...form,code:e.target.value})}/></label>
   <label className="field">Significado documentado<input className="input" required maxLength={120} value={form.label} onChange={e=>setForm({...form,label:e.target.value})}/></label>
   <label className="field">Documento de referência<select className="select" required value={form.documentId} onChange={e=>setForm({...form,documentId:e.target.value,quote:''})}><option value="">Escolha a fonte</option>{sources.map(s=><option key={s.documentId} value={s.documentId}>{s.title}</option>)}</select></label>
   <label className="field" style={{gridColumn:"1 / -1"}}>Trecho literal que relaciona o código ao significado<textarea className="textarea" rows={4} required minLength={12} maxLength={700} value={form.quote} onChange={e=>setForm({...form,quote:e.target.value})}/></label>
   <button className="btn primary" style={{gridColumn:"1 / -1"}} disabled={busy}>{busy?'Validando evidência...':'Aprovar significado com esta evidência'}</button>
  </form>}
  {error&&<p className="error-box" role="alert">{error}</p>}{result&&<p className="note-box" role="status">{result}</p>}
 </details>;
}
