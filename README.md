# Modelo-Playwright

Repositório-modelo da automação de testes E2E com Playwright para projetos Salesforce da Codeart. O modelo traz a estrutura de pastas, o login pela Salesforce CLI, a execução por perfil de usuário, a conferência de acesso, a limpeza da massa de teste e o Painel de QA.

O passo a passo completo está na IT do framework, no Confluence: [Instalar e Utilizar o Framework de Automação de Testes com Playwright](https://codeartsolutions.atlassian.net/wiki/spaces/M/pages/2497675296). Este README resume o que muda ao criar um projeto a partir do modelo.

## Começar um projeto a partir do modelo

1. Criar o repositório do projeto a partir deste modelo.
2. Trocar os placeholders (`<...>`) pelos dados do projeto:

   | Arquivo | O que preencher |
   |---------|-----------------|
   | `dashboard.config.json` | `projeto` (cliente e projeto) e `qaResponsavel` |
   | `tests/e2e/test-data/perfis/<id>.json` | `usuario` (alias da Salesforce CLI) e `perfilSalesforce` de cada perfil |
   | `.github/workflows/playwrighte2e.yml` | O `--alias` de cada passo "Autenticar", igual ao `usuario` do perfil |

3. Ajustar os perfis em `tests/e2e/test-data/perfis/`. Um arquivo por perfil, e exatamente um com `"padrao": true`.
4. Ajustar `tests/e2e/test-data/acesso/objetos.json` com os objetos que a conferência de acesso deve verificar.
5. Autenticar na Salesforce CLI o usuário de cada perfil, com o alias definido no perfil:

   ```bash
   sf org login web --instance-url https://test.salesforce.com --alias <alias-admin>
   ```

6. Instalar e rodar:

   ```bash
   npm ci
   npx playwright install chrome
   npx playwright test tests/e2e/specs/smoke
   npx playwright test tests/e2e/specs/exemplo
   ```

**Regra:** a automação roda sempre em Sandbox. Nunca execute os testes em Produção.

## Responsável pela automação

Todo projeto precisa de um responsável pela automação, definido no início do projeto e registrado no `qaResponsavel` do `dashboard.config.json`. Ele cria e configura os usuários de teste, define quando o Painel de QA vai para o PO e mantém os testes: quando uma regra de negócio, um layout ou um perfil muda, atualiza os cenários afetados na mesma entrega, para que continuem validando a regra vigente. As tarefas completas estão na seção 4.11 da IT.

## Teste de exemplo

`tests/e2e/specs/exemplo/exemplo.spec.js` é o exemplo da seção 4.6 da IT, escrito com as utils deste repositório. Ele cria um Lead pela API, abre o registro na tela, confere o nome, confere pela API o que foi gravado, e a limpeza do fim da rodada exclui o Lead. Use-o como ponto de partida da primeira suíte em `tests/e2e/specs/fluxos/`, com pastas e arquivos sem acento e sem espaço (ex.: `fluxos/lead/`).

## Estrutura

| Caminho | Conteúdo |
|---------|----------|
| `playwright.config.js` | Projetos por perfil × navegador, reporter, setup e teardown |
| `tests/e2e/` | Suítes, páginas, utils, massa e perfis. Detalhes em [tests/e2e/README.md](tests/e2e/README.md) |
| `scripts/painel/` | Geração do Painel de QA e do guia por perfil |
| `scripts/novo-bug.js`, `scripts/fechar-bug.js` | Registro e fechamento de bugs ligados aos casos |
| `dashboard.config.json` | Projeto e QA responsável exibidos no painel e no relatório |

## CI (GitHub Actions)

O workflow `.github/workflows/playwrighte2e.yml` vem só com a execução manual (`workflow_dispatch`). O modelo não tem secrets, então o cron diário e a execução em PR falhariam aqui.

Para ligar o CI no projeto:

1. Cadastrar em *Settings › Secrets and variables › Actions* um secret por perfil, no formato `PROJETO_AMBIENTE_<PERFIL>`: `PROJETO_AMBIENTE_ADMIN`. Cada secret usa um usuário dedicado ao CI, com o mesmo perfil do usuário local. A forma de gerar o valor está em [tests/e2e/README.md](tests/e2e/README.md#ci-github-actions).
2. Rodar o workflow manualmente uma vez (*Actions › Playwright - Testes E2E › Run workflow*) e conferir que passa.
3. Descomentar no workflow os gatilhos `pull_request` e `schedule` (cron diário às 10:00 de Brasília).

Para um perfil novo, criar o secret `PROJETO_AMBIENTE_<PERFIL>` e copiar no workflow o passo "Autenticar usuário admin na org", trocando o secret e o alias.
