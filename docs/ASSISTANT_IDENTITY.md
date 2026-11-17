# Identidade institucional do POSSO

**Nome oficial:** POSSO.

**Apresentação:** POSSO — assistente virtual da POSSEBON.

O nome homenageia o fundador da POSSEBON, conhecido pelo apelido POSSO. O assistente não se apresenta como ADA nem recebe nomes diferentes por unidade, sessão, administrador ou voz.

A configuração legada `ada.app_setting.assistant_branding` continua no banco para manter compatibilidade, mas a identidade pública é fixa. O endpoint `GET /branding` retorna `{ "name": "POSSO" }`. O antigo endpoint administrativo de alteração rejeita nomes diferentes; a tela administrativa exibe a identidade oficial, sem campo para renomeá-la.

Não renomear tabelas, chaves, diretórios, variáveis, caminhos de integração ou permissões antigos sem uma migração separada e auditada.

## Voz

O serviço GPT-Live usa a voz `tempo`, fornecida pela OpenAI para português brasileiro com apresentação masculina, e instruções de fala calma, madura e clara. A voz é sintética e não tenta imitar a voz do fundador. A qualidade da rede, os modelos e a API podem afetar tempo de resposta e precisão: não há garantia de ausência de falhas.

Toda ação empresarial continua sendo delegada ao motor POSSO autenticado; nunca se declara envio ou alteração concluído sem confirmação real.

## Dashboards

Um dashboard pessoal por usuário e unidade. Para centrais de trabalho, as definições persistem somente planos declarativos de leitura; os componentes interativos de `worklist` recebem dados atuais via API, consultados com a identidade e o escopo da sessão. Antes de gravar um painel de chamados, o motor valida se existe assunto/descrição útil que identifique os registros, além de situação e filtros coerentes.

A identidade e as verificações de qualidade precisam ser comprovadas por testes e publicação controlada no servidor. Uma aprovação no GitHub não equivale a uma implantação.
