# ADA POSSEBON

Aplicação independente de inteligência empresarial, incorporável ao **POSSEBON Web** por iframe seguro e com login único.

- O colaborador entra com o login do POSSEBON. Unidade, grupos e permissões vêm do POSSEBON.
- Conversa em pt-BR, dashboards criados e refinados por linguagem natural (spec declarativa; valores atuais a cada abertura).
- Acompanhamentos: a IA (ou o interpretador determinístico) **propõe** a regra, o usuário **confirma** e um motor **sem IA** verifica e notifica.
- Memória privada por usuário (cifrada) e conhecimento empresarial compartilhado conforme o escopo.
- Administração restrita: fontes de conhecimento, conectores, e-mail, IA/custos, políticas e auditoria.

## Início rápido (desenvolvimento)

```bash
npm install
cp .env.example .env            # PGlite local, usuários e dados SINTÉTICOS
npm run build -w @ada/web
npm run dev:api                 # http://127.0.0.1:4800/ada/
```

Escolha um usuário sintético (admin, gerente A/B, colaborador A/B) e teste: *"cria efetivo por equipe nos últimos seis meses"*, *"compara com o previsto"*, *"salva como Efetivo EPC13"*, *"monitore a OS 123 e me avise quando mudarem o prazo ou ficar 48h sem avanço"*.

| Comando | O que faz |
|---|---|
| `npm test` | 86 testes (SSO, isolamento, dashboards, monitores, conhecimento, e-mail, IA, migrations) |
| `npm run lint` · `npm run typecheck` · `npm run build` | qualidade e build (web, api, worker) |
| `node scripts/smoke.mjs` | smoke HTTP contra uma instância em execução |
| `npm run dev:ticket -- 9002 1` | gera ticket SSO de teste (requer `ADA_SSO_HS256_SECRET`) |
| `npm run openapi` | regenera `docs/openapi-ada.json` |

## Documentação
- [Auditoria inicial](docs/ADA_AUDITORIA_INICIAL.md) · [Escopo e status real](docs/ADA_ESCOPO_E_STATUS.md)
- [Arquitetura](docs/ADA_ARQUITETURA.md) · [Permissões](docs/ADA_PERMISSOES.md)
- [Integração POSSEBON](docs/ADA_INTEGRACAO_POSSEBON.md) · [Implantação](docs/ADA_DEPLOY_POSSEBON.md) · [Plano de testes](docs/ADA_TEST_PLAN.md)
- OpenAPI: [ADA](docs/openapi-ada.json) · [contrato proposto ao POSSEBON](docs/openapi-possebon-identity.yaml)

**Dados de produção nunca são fictícios.** O schema `ada_demo` e o login de desenvolvimento são recusados com `ADA_ENV=production`, e o catálogo de produção fica vazio até que métricas reais sejam validadas.
