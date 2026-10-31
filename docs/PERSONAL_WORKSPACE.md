# Ambiente pessoal e conversa compacta

O primeiro acesso à página inicial inicia uma preparação por usuário e unidade. Cada consulta é validada com a autorização atual antes de compor os painéis. Etapas concluídas ficam no banco; após interrupção, uma nova visita retoma o trabalho quando a reserva de execução expirar (até três minutos). Falhas mostram uma opção de tentar novamente. O resumo pessoal é cifrado e invalidado quando permissões ou regras de acesso mudam.

O panorama inicial seleciona até quatro métricas disponíveis e até quatro tabelas operacionais autorizadas, priorizando áreas reconhecidas e compatíveis com o contexto. Prepara contagens e distribuições de situação quando esses campos existem. É uma visão inicial limitada e verificável: não afirma estudar todo o banco ou identificar automaticamente todas as necessidades do usuário. Refinamentos são feitos por conversa; criar_tela salva uma tela e adicionar_painel permite ampliá-la em etapas. Permanece o limite de doze painéis por tela.

Ao terminar, cria uma conversa de boas-vindas e a abre no assistente compacto. O usuário pode ampliar a conversa, continuar no painel completo e repetir a preparação inicial em Meu ambiente. Repetir cria uma nova visão e boas-vindas sem apagar conversas ou dashboards antigos. Não há limpeza automática do histórico do Pedro.

## Acesso operacional

Administração → Acessos operacionais configura tabela, programa POSSEBON, campos e escopo. Sem regra, usuários comuns não recebem acesso à tabela. Escopos: unidade ativa; usuário; colaborador vinculado; equipes; subordinados. Relações ausentes negam o acesso, sem ampliar para toda a unidade. O programa deve existir na identidade autoritativa.

Administradores com AdaAdministracao podem consultar as tabelas de negócio expostas pelo conector na unidade autorizada. Permanecem as proteções existentes de campos sensíveis, tabelas de autenticação, dados privados de outros usuários, leitura somente e relacionamentos verificados. Cargo ou texto do nome não concedem permissões. Não existe SQL livre nem escrita arbitrária no MAD Builder.

O endpoint de identidade aceita o campo opcional work_contexts:

```json
{"work_contexts":[{"unit_id":3,"title":"Coordenador","subject_id":123,"team_ids":[7,8],"report_user_ids":[456,789]}]}
```

Cada vínculo deve vir da regra de negócio confirmada no servidor POSSEBON. subject_id é o identificador do colaborador e report_user_ids são identificadores de usuários subordinados; configure scopeColumn de acordo com o mesmo domínio de identificadores. Não misture IDs de usuário e colaborador. A integração PHP atual continua compatível sem este campo, mas os escopos que dependem dele permanecem fechados. A alteração no endpoint PHP não é implantada por esta versão.

## Telas compartilhadas e acompanhamentos

O dono pode compartilhar sua tela viva com outro usuário ativo da unidade. O destinatário recebe a definição; cada atualização consulta com as permissões do destinatário. Remover o compartilhamento bloqueia novas leituras. Usuários aparecem na seleção depois de acessarem a assistente naquela unidade; a identidade é revalidada no compartilhamento.

Um acompanhamento operacional identifica exatamente um registro por id, sem agregações. A IA propõe e o usuário ativa pelo botão. O worker compara os campos selecionados a cada intervalo, sem chamadas ao modelo. Alterações geram notificação privada; ausência de alteração não gera mensagens. A notificação não copia valores operacionais. Consultar agora revalida o acesso e busca o estado atual. Pausar interrompe verificações; retomar estabelece uma nova referência. Fonte indisponível, registro removido ou acesso revogado deixam o acompanhamento em estado de atenção, exigindo retomada após correção. São notificações internas; não há envio de WhatsApp/e-mail nem atualização instantânea por eventos.

## Incorporação futura no POSSEBON Web

O painel completo e /ada/compacto usam a mesma API, sessão, conversas e permissões. O arquivo /ada/possebon-assistant.js está pronto para inclusão futura no layout global do MAD Builder, na mesma origem e após estabelecer a sessão SSO:

```html
<script defer src="/ada/possebon-assistant.js" data-base="/ada/"></script>
```

O módulo que abre um registro pode fornecer uma pista de contexto:

```js
window.PossebonAssistant.setContext({module:'Compras',table:'solicitacao_compra',recordId:123});
// Ao sair do registro:
window.PossebonAssistant.setContext(null);
```

Mensagens entre janela e iframe verificam origem e janela emissora. O contexto da página nunca concede acesso nem substitui consulta ao registro. O botão carrega o nome da configuração administrativa. Não passe tokens na URL. A sessão SSO, o ponto de inclusão no layout e os nomes reais de tabelas devem ser validados na integração MAD Builder. Esta entrega não altera arquivos PHP nem habilita microfone/voz.

## Atualização e validação

scripts/deploy/update.sh exige um commit completo e a estrutura /opt/ada/current → /opt/ada/releases, /etc/ada/ada.env. Se /etc/ada/migrate.env existir, usa a conexão de migração separada; caso contrário, valida os privilégios da conexão já configurada em ada.env, sem alterar credenciais ou conceder permissões. A verificação ocorre antes de parar serviços. Executa CI em novo release antes de parar serviços, confere se aplicação e migração apontam ao mesmo PostgreSQL, para API/worker, copia configuração, gera pg_dump, confere legibilidade, registra resumo criptográfico dos registros existentes, migra, verifica preservação, troca o link e testa saúde. Falhas retornam o código anterior; o banco permanece com migrations aditivas. Releases e backups não são apagados. Restauração do banco é operação manual; pg_restore --list não substitui ensaio de restauração em banco isolado.

O script não serve para atualização do PGlite local. Nenhum .env, PGlite ou banco local existente foi alterado nos testes. A migração 0007 é aditiva. A suíte usa PGlite isolado; o ensaio SSH/systemd/PostgreSQL real e a qualidade das respostas com o provedor real precisam ser validados no ambiente de homologação/servidor. Não confundir sucesso dos testes locais com implantação em produção.
