# ADA POSSEBON — conhecimento público inicial (28/10/2026)

Este pacote **não é uma demonstração**. É uma base de fatos públicos, parafraseados e datados, com proveniência por registro, obtidos de páginas institucionais da POSSEBON e da Petrobras e dos links sociais publicados no APP POSSEBON.

## Instalação local (VS Code, PowerShell)

1. Pare a API local com `Ctrl+C`, especialmente com PGlite (um processo por diretório).
2. Faça checkout da branch `feat/ada-brain-public-sources-20261028` (ou depois de revisada/mesclada na main).
3. Na pasta raiz, use `npm ci`.
4. Garanta `ADA_DEMO_DATA=0` e `ADA_DEV_LOGIN=0` no `.env`. **Não** configure identidades fictícias nem copie segredos para o Git.
5. Execute `npm run knowledge:bootstrap` (migrations e indexação idempotentes).
6. Inicie com `npm run dev:api`. Sem SSO real a interface mostrará autenticação pendente: a base foi indexada, mas o chat exige usuário real.
7. Depois de integrar SSO/permissões ao POSSEBON Web, teste busca pela ADA: “Qual é o escopo divulgado do EPC13?”, “Como o Consórcio CCPC difere do EPC13?”, “Quais são os canais oficiais da POSSEBON?”. A resposta deve citar a fonte e data.

## O que o comando faz

- Lê o JSON `knowledge/public/possebon-empresa-epc13-petrobras.2026-10-28.json`.
- Valida schema, integridade, lista de domínios e ausência de padrões típicos de injeção de prompt.
- Cria uma fonte institucional **global e pública**, sem `unit_id` ou permissões restritivas.
- Insere ou atualiza documentos por título e checksum, gerando fragmentos com FTS em português.
- Só autoaprova conteúdo **curado e versionado neste repositório**; não aprova coleta web arbitrária.
- Não apaga memórias, dashboards, conversas nem unidades. Não consulta o banco operacional do POSSEBON e não faz requisições externas.
- Pode ser executado novamente: conteúdo inalterado é ignorado.

## Regras editoriais e de segurança

- Conhecimento público (história, serviços, notícias, obras divulgadas) não equivale a dados privados (efetivo, folha, contratos integrais, OS, planejamento, documentos e produtividade).
- Escopo **EPC13** (consórcio Possebon/UPE/CPL) não é a mesma coisa que consórcio **CCPC** (Conenge-SC/Possebon).
- Data do artigo e data do acontecimento são diferentes; plano de investimento não significa obra contratada ou executada.
- A notícia do site corporativo é uma fonte institucional **autodeclarada**. Valide conteúdo operacional no POSSEBON Web em tempo real, respeitando `unit_id`, grupo e programa.
- Não execute sincronização irrestrita do portal de notícias: algumas páginas e links do site contêm conteúdo que parece spam/desvio de tema. Coletas devem passar por filtros, verificação de fonte e aprovação do administrador.
- Nunca inclua credenciais, conteúdo de e-mails privados, dados de pessoas ou contratos confidenciais neste repositório.

## Evoluções necessárias

- **Integração**: conectar login único real, permissões e POSSEBON Brain (credencial técnica própria). O repositório `possebon_web` não representa sozinho o backend vivo; validar no MAD Builder antes de alterações.
- **Leitura de documentos**: extrair PDF/DOCX/XLSX/contratos em rotina segura, com ACL e revisão.
- **Catálogo operacional**: mapear métricas, regras de cálculo, joins por unidade, responsáveis e eventos; usar APIs/VIEWs readonly do POSSEBON vivo.
- **Atualização recorrente**: worker de monitoramento editorial diário/semanal com verificação de novos artigos, deduplicação, logs, datas e aprovação humana; fontes sociais podem exigir API/autorização. Não alegar atualização contínua até implantado.
- **Lembretes e previsões**: somente com dados reais e critérios de validade/monitoramento autorizados.

## Fontes base (ver links individuais no JSON)

- POSSEBON: `https://possebon.com.br/empresa/`, `https://possebon.com.br/servicos/`, `https://possebon.com.br/noticias/`, `https://possebon.com.br/obras-em-andamento/`.
- EPC13: `https://possebon.com.br/petrobras-formaliza-contrato-com-o-consorcio-possebon-upe-cpl-epc-13-para-avanco-do-complexo-de-energias-boaventura/`.
- Consórcio CCPC: `https://possebon.com.br/consorcio-ccpc-entrega-importante-obra-no-setor-de-energia/`.
- Petrobras: `https://petrobras.com.br/quem-somos/complexo-boaventura`, `https://petrobras.com.br/quem-somos/refino`.
- Canais sociais extraídos de `lib/screens/home_screen.dart` do APP POSSEBON.
