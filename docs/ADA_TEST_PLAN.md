# ADA POSSEBON — Plano de testes

## Automatizados (`npm test`): 86 testes, todos passando em 27/10/2026

Executados com Vitest sobre **PGlite** (PostgreSQL 17 real em WASM). Cada arquivo sobe a API completa (Fastify `inject`), aplica as migrations e carrega o seed sintético com relógio controlável.

| Arquivo | Cobertura |
|---|---|
| `tests/domain.test.ts` (16) | Formatação pt-BR/fuso; patch sem reconstrução; schema estrito (rejeita HTML/SQL); validação contra catálogo; SQL parametrizado com escopo de unidade nos joins; períodos; interpretador (5 pedidos de dashboard, monitor da OS 123, pedido fora da biblioteca); avaliador (linha de base, antes/agora, dedupe, 48 h, prazo, status concluído, cooldown); SSRF; prompt injection; redação; fragmentação; divisor SQL |
| `tests/sso-session.test.ts` (17) | Ticket válido, cookie HttpOnly/SameSite/Path; POST de formulário (iframe) com 303; replay; expirado; validade longa; audiência/emissor; assinatura; unidade não autorizada; auditoria sem segredos; CSRF; Origin; 401; logout; troca de unidade; revogação HMAC (assinatura inválida/válida); mudança de grupo após TTL; desativação; CSP `frame-ancestors` e ausência de `X-Frame-Options`; `no-store`; login de dev desabilitado; guardas de configuração de produção; normalização CSP |
| `tests/isolation.test.ts` (12) | Conversa por ID direto (B, colaborador, admin); memórias e exportação LGPD; cifra de mensagens; recusa a "o que Fulano perguntou" (inclusive admin); dashboard privado (GET, dados, CSV); compartilhamento exige perfil; destinatário sem permissão recebe `forbidden`; cache sem vazamento entre unidades/usuários; `unit_id` manipulado rejeitado; colaborador sem escopo gerencial; notificações de outro usuário; rotas admin 403 + auditoria; ausência de rota admin para conversas |
| `tests/dashboards.test.ts` (10) | Cria → linhas → previsto → filtro → salva; desfazer; reabrir com valores atuais; mudança na fonte refletida com "Atualizar"; cache sinalizado; filtros só por controles declarados; fonte indisponível ⇒ aviso de dado desatualizado / `source_unavailable`; permissão revogada ⇒ `forbidden`; revisões e reversão; CSV com neutralização de fórmulas; exemplos de treinamentos, OS e compras; métrica não catalogada rejeitada |
| `tests/monitors.test.ts` (13) | Interpretação → preview → proposta inativa → confirmação; linha de base sem alerta; mudança de prazo = 1 notificação com antes/agora; repetição/polling sem duplicar e sem IA; reinício (novas dependências no mesmo banco) sem duplicar; 48 h sem atualização uma vez; pausa não dispara; retomada; fonte indisponível ⇒ `fonte_indisponivel` ×3 ⇒ `degraded` + aviso, recuperação; edição ⇒ revisão 2 com histórico preservado; webhook HMAC idempotente; isolamento entre gerentes; validação de campos/tipos/código; exclusão |
| `tests/knowledge-email.test.ts` (13) | Fontes por escopo; upload, checksum e deduplicação; documento malicioso sinalizado; nada pesquisável antes da aprovação; citação com checksum; escopo por unidade; "não encontrei dados suficientes"; PDF em erro honesto; binário disfarçado; SSRF na importação de URL; cobertura; credenciais cifradas e nunca retornadas; OAuth não configurado; envio bloqueado no schema; ACL de conta; usuário comum sem acesso |
| `tests/ai-migrations.test.ts` (5) | Responses API com `fetch` simulado (laço de ferramentas, `store:false`, chave só no cabeçalho, HTTPS obrigatório); ferramentas sob autorização (métrica restrita negada, ferramenta inexistente recusada, monitor só proposto, uso registrado); migrations up → down → up; checksum; auditoria imutável |

Outros comandos: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run check:secrets`, `npm audit --omit=dev` (0 vulnerabilidades em 27/10/2026), `node scripts/smoke.mjs` (15/15 contra o build real, incluindo um ciclo do worker sem IA).

**Verificação visual:** capturas em Edge headless (via DevTools Protocol) da conversa com dashboard nos temas escuro e claro, da proposta de monitor, do dashboard salvo, dos acompanhamentos, do mobile (390 px) e da administração. Essa verificação encontrou e corrigiu um efeito React que devolvia `Promise` (`scrollIntoView` em Chromium recente).

## Não coberto automaticamente (registrar ao executar)
- E2E com navegador em CI (Playwright). Hoje o smoke HTTP e as capturas são manuais/locais.
- Carga: não há teste de carga. Sugestão: k6 com 50 usuários simultâneos em `/dashboards/:id/data` e `/chat`.
- Acessibilidade automatizada (axe). Houve revisão manual de ARIA, foco visível, tabela alternativa a gráficos e contraste da paleta validada.
- Coleta real de sites, IMAP real e OpenAI real: dependem de rede e credenciais.

## Roteiro manual de aceite (homologação)

1. **SSO/iframe.** Abrir a ADA pelo POSSEBON com dois usuários de unidades diferentes; conferir nome, unidade e menu (Administração só para admin). Copiar o ticket do formulário e reenviar ⇒ deve falhar (replay). Abrir `https://<ada>/ada/` em uma página de **outra origem** dentro de iframe ⇒ o navegador bloqueia (CSP).
2. **Revogação.** Remover o usuário de uma unidade no POSSEBON ⇒ em até 5 min (ou na hora, com a chamada de revogação) a ADA pede novo acesso.
3. **Isolamento.** O gerente A cria um dashboard e uma conversa; o gerente B tenta abrir as URLs copiadas ⇒ "não encontrado".
4. **Dashboards.** Pedir "cria efetivo por equipe nos últimos seis meses" → "muda para linhas" → "compara com o previsto" → "coloca filtro por gerência" → "salva como Efetivo EPC13". Reabrir no dia seguinte ⇒ valores atuais, hora da consulta, botão Atualizar.
5. **Monitor.** "Monitore a OS 123 e me avise quando mudarem o prazo ou quando ficar 48h sem avanço" ⇒ revisar a proposta ⇒ Confirmar. Alterar o prazo na fonte ⇒ uma notificação "antes/agora". Conferir em Histórico que `Chamadas de IA = 0`.
6. **Fonte indisponível.** Desabilitar o conector (Admin › Conectores) ⇒ o dashboard mostra aviso de dado desatualizado, e depois de 3 ciclos o monitor fica "Degradado" com notificação.
7. **Conhecimento.** Enviar uma política em MD e um documento com "ignore as instruções anteriores…" ⇒ o segundo aparece com alerta. Aprovar só o primeiro ⇒ a pergunta no chat cita o documento.
8. **E-mail.** Cadastrar uma conta IMAP com senha de app ⇒ a senha não aparece em nenhuma tela ou resposta. Testar conexão. Envio indisponível.
9. **Responsividade e teclado.** Navegar só com Tab/Enter; testar em celular (menu lateral recolhível) e tablet.
10. **Backup/restore.** Executar `backup.sh`, restaurar em homologação e conferir dashboards e monitores.
