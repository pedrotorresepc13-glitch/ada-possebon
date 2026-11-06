# ADA POSSEBON — Permissões e isolamento

## Autoridade

As permissões **vêm do POSSEBON Web**. A ADA nunca aceita `user_id`, `unit_id`, `admin` ou programas enviados pelo navegador.

| Conceito POSSEBON | Tabelas | Uso na ADA |
|---|---|---|
| Usuário ativo | `system_users.active = 'Y'` | Inativo ⇒ sessões revogadas na próxima revalidação |
| Unidades permitidas | `system_user_unit` | `allowedUnitIds`. A unidade ativa precisa estar na lista |
| Grupos | `system_user_group`, `system_group` | Destinatários de compartilhamento; exibição |
| Programas e ações | `system_group_program(actions)`, `system_user_program`, `system_program.controller` | Papéis da ADA e programas exigidos por métrica, fonte e documento |
| Escopo gerencial | **regra a confirmar** (proposta: programa `AdaGestor`) | `managerUnitIds`; métricas `gerencial` exigem esse escopo |

## Papéis da ADA (derivados, nunca digitados)

| Papel | Regra (configurável por variável de ambiente) |
|---|---|
| `user` | Todo usuário ativo autenticado. Opcional: exigir `ADA_ACCESS_PROGRAM` |
| `manager` | Unidade ativa em `manager_unit_ids` ou programa `ADA_MANAGER_PROGRAM` (`AdaGestor`) |
| `admin` | Programa `ADA_ADMIN_PROGRAM` (`AdaAdministracao`) |
| Consolidação entre unidades | Programa `ADA_CROSSUNIT_PROGRAM`. Sem ele, toda consulta usa **somente a unidade ativa** (inclusive para admin) |

## Regras aplicadas em toda operação

1. **Unidade.** Consultas filtram `unit_id = ANY($unidades)`. Os joins repetem a igualdade de unidade. Caches, notificações, conversas, dashboards e monitores são particionados por unidade.
2. **Métrica.** O usuário precisa de todos os programas exigidos pela métrica e pela fonte. Métricas `gerencial` exigem escopo gerencial na unidade.
3. **Dashboard compartilhado.** Ter acesso ao arquivo não dá acesso aos dados: cada widget reaplica `canUseMetric` para quem abre (status `forbidden` sem números).
4. **Cache.** A chave inclui `system_user_id`, unidades, `permissions_version` e parâmetros, e a linha guarda `owner_user_id`. Nada é reaproveitado entre pessoas.
5. **Conversas e memórias.** São filtradas pelo dono e cifradas. **Não existe rota, ferramenta de IA ou tela de admin que leia conteúdo de outra pessoa.** Perguntas como "o que Fulano perguntou?" são recusadas antes de qualquer consulta.
6. **Administração.** As rotas `/admin/*` exigem papel `admin`. Tentativas negadas são auditadas. Ser admin não amplia o escopo de dados nem dá acesso a conversas privadas.
7. **Monitores.** O dono é revalidado a cada execução. Se perde a unidade ou o programa, a regra vai para erro/degradada sem ler dados.
8. **Revogação.** O TTL padrão do cache de permissões é 300 s. Para efeito imediato, o POSSEBON chama `POST /internal/revoke` (HMAC).
9. **Respostas.** Recurso inexistente e recurso sem acesso devolvem o mesmo 404 (não revela existência).

## Auditoria excepcional de conteúdo

**Não implementada, de propósito.** Se a empresa exigir, deverá ser um procedimento separado, com permissão especial, justificativa, dupla aprovação, trilha imutável e conformidade com a política interna e a LGPD. Nunca por chat nem pelo painel atual.

## Testes que provam o isolamento

`tests/isolation.test.ts`, `tests/sso-session.test.ts`, `tests/dashboards.test.ts` (permissão reaplicada) e `tests/monitors.test.ts` (gerente B × OS da unidade 1) cobrem: dois colaboradores, dois gerentes, um admin, duas unidades, revogação de grupo, desativação, manipulação de parâmetros (`unit_id` no corpo é rejeitado), GET direto por ID, cache, exportação CSV, IA (ferramentas) e notificações.
