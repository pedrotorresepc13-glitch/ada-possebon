# IA POSSEBON — Telas vivas e acesso operacional geral (31/10/2026)

## Escopo implementado
- A IA pode descobrir tabelas públicas com unit_id, colunas e FKs do PostgreSQL real, sem definir previamente uma métrica por pergunta.
- Novas ferramentas `explorar_tabelas`, `consultar_banco`, `criar_tela`: o modelo produz **JSON declarativo**, jamais SQL livre.
- O servidor confere existência de cada campo e FK com introspecção real, bloqueia tabelas de sistema, certas colunas pessoais e segredos, impõe `unit_id`, elimina registros marcados `deletado_em` e limita linhas e tempo.
- Neste primeiro lançamento, a execução de dados operacionais é **exclusiva** de sessões reais POSSEBON com `AdaAdministracao` e papel admin. Regra de acesso de demais perfis ainda deve ser mapeada por módulo, não inferida de uma convenção de nomes.
- Telas vivas persistem como `ada.operational_board`, com definição de tabela/gráfico/KPI. O navegador atualiza os dados da fonte a cada 30 s; **não chama OpenAI para atualizar o gráfico**.
- O esquema é consultado dinamicamente e atualizado em cache de 60 s; registros operacionais nunca são armazenados no banco da IA. Não existe ainda CDC, outbox ou execução de escrita nos módulos.

## Dependência: ativação UMA VEZ do conector PostgreSQL de leitura

**A implementação não cria credenciais de acesso a um banco que ainda não foram fornecidas.** O conector usa `POSSEBON_READONLY_DATABASE_URL` no `.env` local (não versionado). Requer acesso TCP autorizado e seguro ao PostgreSQL do servidor POSSEBON, de preferência por **túnel SSH**. Não copie credenciais no chat nem no GitHub.

### No servidor (SSH, administrador), criar usuário técnico dedicado

Execute somente depois de revisar os privilégios; não modifica tabelas ou registros. O PostgreSQL precisa ter autenticação por senha em localhost.

```bash
cd /tmp
runuser -u postgres -- psql -X -d possebon_app -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='possebon_ia_readonly') THEN
    CREATE ROLE possebon_ia_readonly LOGIN;
  END IF;
END $$;
ALTER ROLE possebon_ia_readonly SET default_transaction_read_only = on;
ALTER ROLE possebon_ia_readonly SET statement_timeout = '6s';
GRANT CONNECT ON DATABASE possebon_app TO possebon_ia_readonly;
GRANT USAGE ON SCHEMA public TO possebon_ia_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO possebon_ia_readonly;
SQL
runuser -u postgres -- psql -d possebon_app -c '\password possebon_ia_readonly'
```

O comando `\password` pergunta a nova senha sem escrevê-la na linha de comando. Mantenha-a no gerenciador de senhas. Avalie os privilégios totais de SELECT com o administrador de segurança antes de uso corporativo; controles de saída continuam mandatórios. Para tabelas criadas depois, configure `ALTER DEFAULT PRIVILEGES ... GRANT SELECT` para **cada papel criador**, conforme a propriedade real.

### No Windows com VS Code

1. Deixe o SSH tunnel aberto em outro terminal (substitua o endereço pelo host real acessível):
   ```powershell
   ssh -N -L 127.0.0.1:15432:127.0.0.1:5432 USUARIO_SSH@HOST_DO_SERVIDOR
   ```
2. No `.env` LOCAL, acrescente (sem mudar as chaves existentes):
   ```dotenv
   POSSEBON_READONLY_DATABASE_URL=<CONEXAO_POSTGRESQL_LOCAL_GERADA_COM_SENHA_URL_ENCODED>
   ```
   Caracteres especiais da senha precisam de URL encoding. Não exponha esse arquivo.
3. Inicie a IA com a configuração normal. Não habilite `ADA_DEMO_DATA` nem `ADA_DEV_LOGIN`. Ao usar a primeira ferramenta de dados, o backend verifica conexão, campos e leitura real, e ativa o status do conector **somente se o teste passar**.
4. Teste, com uma sessão SSO real autorizada: **"Quem trabalha na TI da EPC13? Consulte colaborador, pessoa, equipe e funcao"** e **"Crie uma tela viva do efetivo por equipe"**. Se a IA não conseguir localizar uma regra semântica (por exemplo, equivalência de status A), peça comprovação em vez de presumir.
5. Verifique o painel em **Telas vivas**. Inclua um colaborador pela rotina normal do POSSEBON Web e confirme que ele aparece em nova consulta sem usar OpenAI.

## Segurança, limites e entregas ainda pendentes
- Nunca conceder acesso irrestrito a dados a usuários só porque o agente técnico possui credencial de SELECT. Atualmente somente admin com POSSEBON Web validado pode consultar tabelas pelo novo motor.
- Nenhum SQL gerado pelo modelo é executado; `SELECT` é compilado pela aplicação, com JOIN exclusivamente por FK direta da tabela raiz (até 3), no escopo da unidade, limitando 200 linhas e com timeout no banco. Tabelas sem `unit_id` podem ser alcançadas apenas por FK saindo de tabela da unidade.
- Campos de documento, CPF, remuneração e credenciais são bloqueados nesta primeira implementação. Futuras permissões de coluna/linha/ação por módulo exigem regras específicas do POSSEBON; não criar exceções automáticas só para atender perguntas.
- O mecanismo de telas antigas e o PGlite existente são preservados. Produção exige aplicar migration `0005_operational_boards` na própria base da IA por rotina de deploy oficial; nunca na base `possebon_app`.
- A atualização periódica é *polling*, não evento instantâneo; CDC/outbox e ferramentas de escrita do MAD Builder estão pendentes. Portanto esta versão é uma etapa funcional em direção ao agente JARVIS, não autonomia total.
- Não liberar em produção sem validação de permissões e revisão do administrador responsável pelo banco.
