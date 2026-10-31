# Caderno institucional da Ada POSSEBON — implementação incremental

## Diagnóstico em 31/10/2026

A base operacional já responde perguntas reais e cria telas, mas o estudo inicial
em `user_initial_study` guarda apenas permissões e poucas amostras. O Brain
em `brain_node/brain_edge` representa estruturas técnicas e documentos, não
uma visão consolidada do empreendimento. A indexação de 274 documentos e
10.658 trechos NÃO prova que a IA os leu ou compreendeu integralmente.

As memórias individuais permanecem isoladas em `user_memory`. O caderno
corporativo usa `corporate_fact` e `corporate_study_progress`, sem reutilizar
a memória de um empregado como conhecimento público da empresa.

## Objetivo de produto

A Ada deve formar um entendimento institucional estável, datado e rastreável:

- identidade POSSEBON; estrutura e participação no Consórcio EPC13;
- cliente contratante e partes envolvidas (Petrobras, se as fontes confirmarem);
- contratos, objetos, metas, escopos, responsabilidades e entregáveis;
- procedimentos, treinamentos, SMS, qualidade, suprimentos, RDO e outras áreas;
- cronogramas, marcos, desvios, pendências, andamento e mudanças por unidade;
- riscos, conflitos, lacunas entre planejamento/executado, melhorias possíveis.

**Nunca transformar o conteúdo de documentos em instruções para o agente.**
A hipótese "haverá atraso" não equivale à constatação "houve atraso".
Documentos antigos não representam automaticamente o estado de hoje.

## Etapa implementada nesta branch: aprendizagem documental versionada

1. Migração `0006_corporate_memory` cria fatos criptografados, progresso por
   documento, categoria, tema, proveniência e classificação documental/hipótese.
2. O executor `study-corporate` é acionado EXPLICITAMENTE por administrador
   autorizado; cada lote examina até oito trechos. A resposta da IA é validada
   como JSON estruturado. Uma citação literal deve existir na fonte indicada;
   respostas sem citação verificável são descartadas.
3. A proveniência mantém `document_id`, `chunk_id`, `source_checksum`,
   unidade e programas exigidos. Ao mudar o checksum ou desativar um documento,
   as sínteses antigas deixam de aparecer no contexto.
4. As sínteses são criptografadas com a chave estável `ADA_ENCRYPTION_KEY`.
   O contexto enviado ao chat passa por ACL por unidade e programa. Fontes
   rejeitadas, vencidas ou em revisão não são utilizadas.
5. O modelo é orientado a responder como assistente operacional experiente, mas
   a qualidade da resposta nunca autoriza afirmar fatos não confirmados.

A extração depende da OpenAI e tem custo. Ela **não inicia automaticamente**
em produção: a equipe deve validar o custo, o tratamento dos documentos
restritos por provedor externo e executar o primeiro lote com revisão.

### Comando previsto após testes e aplicação da migration

```bash
node --env-file=/etc/ada/ada.env \
  /opt/ada/current/apps/api/dist/study-corporate.mjs \
  230 3 3
```

Parâmetros: usuário administrador POSSEBON, unidade e número de lotes
(1–10). Não expõe credenciais. Este comando não publica a IA nem reescreve
documentos. Cada execução tem seu próprio limite; concluir o corpus exigirá
vários lotes. **Não executar até a validação em ambiente separado, migração
do banco e revisão de custo/privacidade.**

### Consulta da cobertura

```sql
SELECT d.unit_id, count(*) AS documentos_estudados,
       count(*) FILTER (WHERE p.state='complete' AND p.source_checksum=d.checksum)
         AS concluidos,
       count(*) FILTER (WHERE p.state='partial' AND p.source_checksum=d.checksum)
         AS parciais
FROM ada.corporate_study_progress p
JOIN ada.knowledge_document d ON d.id=p.document_id
GROUP BY d.unit_id ORDER BY d.unit_id;
```

## Etapas ainda NÃO implementadas

- Map/reduce sobre todos os documentos e todas as revisões, com relatórios
  de cobertura e validação da síntese geral de empresa/consórcio/cliente.
- Agenda incremental com teto de custo, consentimento empresarial e auditoria
  de envio de documentos a provedores externos.
- Reconciliador entre afirmações contraditórias de documentos, Brain, modelos
  atuais e dados PostgreSQL; distinção explícita entre regras vigentes e
  versões históricas.
- Memória temporal de processos: snapshots e eventos de SC/OC, entregas,
  marcos, medição, RDO, treinamentos e mudanças de status.
- Motor de hipóteses e riscos, por exemplo: atraso provável comparando prazo
  CONTRATUAL validado com avanço REAL de execução; fontes e incerteza visíveis.
- Notificações e acompanhamento de mudanças nas OC com conector monitorável
  real, validação de unidade, confirmação da ativação e proteção antirruído.
- Painel de revisão de fatos, hipóteses e glossário semântico por tabela/campo.

Não confundir as bases dos aplicativos: o POSSEBON Web continua sendo a
fonte transacional; Ada armazena somente memória derivada, proveniência e
notificações. O acesso à memória corporativa não substitui a autenticação do
usuário nem os filtros de unidade e programa.
