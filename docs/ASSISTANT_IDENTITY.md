# Nome global da assistente

Em Administração → Identidade, qualquer administrador autorizado pode alterar o nome de exibição da assistente. O nome é global para usuários e unidades, registrado em `ada.app_setting` sob a chave `assistant_branding`, com auditoria. Não exige chave de IA nem migration nova.

A interface atualiza imediatamente na sessão que salvou. Outras sessões consultam a configuração a cada 30 segundos quando visíveis e ao voltar à janela. O nome aparece no login, menu, título da aba, conversa, administração, memória e textos de apoio. As próximas chamadas do chat recebem a identidade atual. Mensagens antigas e nomes de telas escolhidos pelos usuários são preservados.

O endpoint público `GET /ada/api/ada/branding` retorna apenas `{ "name": "..." }`, sem cache ou metadados administrativos. O futuro painel compacto e o botão global devem consumir esse mesmo endpoint. A alteração é feita por `PUT /ada/api/ada/admin/branding`, com sessão administrativa e CSRF. O campo aceita de 1 a 60 caracteres, sem HTML ou controles. Sem configuração, o nome permanece IA POSSEBON.

Isso altera a identidade de apresentação. Caminhos técnicos, pacotes, variáveis, permissões POSSEBON e identificadores de banco mantêm seus nomes atuais para preservar compatibilidade. A configuração não renomeia botões externos que ainda estejam fixos no MAD Builder; esses botões precisarão usar a mesma configuração quando a integração global for instalada.

Validação: testes cobrem leitura pública mínima, autenticação, autorização, CSRF, persistência entre instâncias/unidades, validação de entrada, auditoria e aplicação do nome nas próximas chamadas do chat sem modificar mensagens antigas.
