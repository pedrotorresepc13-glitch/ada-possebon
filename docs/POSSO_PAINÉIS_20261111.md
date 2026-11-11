# Correção de painéis e cotas — 11/11/2026

- Zero desativa cotas internas mensal, diária e por minuto; valores positivos continuam sendo limites explícitos.
- O instalador com `POSSO_REPAIR_PANELS=1` atualiza a configuração existente e o widget do POSSEBON Web, com cópia de segurança e restauração em caso de falha.
- Notificações e acompanhamentos ocupam a área da conversa. O histórico permanece carregado, mas oculto. Texto e voz continuam disponíveis; uma nova mensagem retorna à conversa.
- O ícone Dashboard do widget abre um iframe na área `adianti_div_content`, sem nova guia ou menu lateral da Posso. Fechar restaura o conteúdo anterior.
- A instalação preserva os arquivos de identidade, as regras de roteamento e os layouts recuperados anteriormente.

Esta alteração não comprova concessões atuais no banco de produção, não remove limites do provedor externo e não migra o caminho `/ada/` para `/Posso/`. Essas verificações permanecem separadas. As mensagens de acesso das capturas são históricas, datadas de 06/11; não comprovam o resultado de uma consulta nova após a recuperação.
