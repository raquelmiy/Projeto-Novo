# Automação E2E (Playwright)

Testes ponta a ponta na org Salesforce do projeto. Visão geral e primeiros passos: [README da raiz](../../README.md) e a IT do framework no Confluence. Cobrem conexão com a org (smoke), fluxos de negócio por objeto e conferência de acesso por perfil.

## Sumário

1. [Pré-requisitos](#pré-requisitos)
2. [Execução](#execução)
3. [Perfis](#perfis)
4. [Estrutura](#estrutura)
5. [Saídas](#saídas)
6. [Regras para escrever suíte](#regras-para-escrever-suíte)
7. [CI (GitHub Actions)](#ci-github-actions)

## Pré-requisitos

1. Instalar Node.js 22 ou superior. O CI usa Node 24.
2. Instalar as dependências: `npm ci`.
3. Instalar o Salesforce CLI: `npm install --global @salesforce/cli`.
4. Instalar o Chrome do Playwright: `npx playwright install chrome`.
5. Autenticar na Salesforce CLI o usuário de cada perfil. O alias deve ser igual ao campo `usuario` do perfil em `test-data/perfis/<id>.json`.

## Execução

Executar os comandos a partir da raiz do repositório.

| Comando | O que roda |
|---------|------------|
| `npm run test:e2e` | Todas as suítes, em todos os perfis ativos |
| `npx playwright test tests/e2e/specs/smoke` | Somente a conexão com a org |
| `npx playwright test tests/e2e/specs/exemplo` | Somente o teste de exemplo (IT, seção 4.6) |
| `npx playwright test tests/e2e/specs/fluxos/lead` | Somente as suítes de uma pasta |
| `npx playwright test tests/e2e/specs/acesso` | Somente a conferência de acesso |

Rodar o smoke primeiro. Se o smoke falhar, então o problema é de acesso à org, não de regra de negócio.

### Variáveis de ambiente

| Variável | Efeito |
|----------|--------|
| `PERFIS` | Limita os perfis da rodada. Exemplo: `PERFIS=admin,sdr`. Sem a variável, rodam todos os perfis |
| `SF_TARGET_ORG` | Substitui o alias da CLI do perfil padrão |
| `DASHBOARD_RESET` | Com `1`, o painel descarta o histórico e começa da rodada atual |

## Perfis

- Cada arquivo em `test-data/perfis/<id>.json` é um perfil. O formato está documentado em `utils/perfis.js`.
- O `<id>` (nome do arquivo) é a tag do perfil. Um teste com `{ tag: '@sdr' }` roda somente no perfil `sdr`.
- Exatamente um perfil tem `"padrao": true`. O perfil padrão roda também os testes sem tag de perfil.
- O Playwright cria um projeto por perfil × navegador. Exemplo: `Admin - Google Chrome`.
- A suíte de acesso consulta a API e não depende de navegador. Ela roda somente no primeiro navegador da lista.

## Estrutura

```text
playwright.config.js          Configuração (raiz do repositório): perfis × navegadores, reporter, teardown
tests/e2e/
├── specs/                    Suítes (*.spec.js). Única pasta que o Playwright coleta
│   ├── smoke/                Conexão com a org (CLI, login, Lightning)
│   ├── exemplo/              Teste de exemplo da IT: massa pela API, tela, conferência pela API
│   ├── fluxos/               Fluxos de negócio, organizados como o Jira do projeto (épico, história ou objeto)
│   └── acesso/               Conferência de permissões por perfil (API e tela)
├── pages/                    Page Objects
│   ├── RecordPage.js         Formulário padrão de qualquer objeto (abrir novo, preencher, salvar)
│   ├── AcessoTelaPage.js     O que a interface mostra ao usuário (lista, Novo, Editar, Excluir)
│   └── <Objeto>Page.js       Somente para objeto com regra própria; estende RecordPage
├── fixtures/baseTest.js      O `test` das suítes: bugs, limpeza da massa e páginas
├── utils/                    Base Salesforce: login via CLI, formulário por rótulo, evidência, limpeza, documentos
├── test-data/
│   ├── perfis/               Um JSON por perfil de usuário (usuário da CLI, acessos esperados)
│   └── acesso/objetos.json   Objetos que a conferência de acesso verifica
└── reporters/                Reporter do painel
```

## Saídas

Os arquivos gerados ficam na raiz do repositório e fora do Git.

| Pasta | Conteúdo |
|-------|----------|
| `playwright-report/` | Relatório HTML |
| `test-results/` | Trace e falhas |
| `test-evidence/` | Screenshots por suíte, caso e perfil. O painel lê esta pasta |

### Limpeza da massa

- No fim da rodada, o teardown (`utils/limpeza.js`) apaga a massa criada pelos testes que passaram.
- A massa dos testes que falharam fica na org. O Id aparece no painel para investigação.
- Se a limpeza falhar, então a rodada não falha. No CI, o resumo da execução mostra um aviso.

## Regras para escrever suíte

1. Importar `test` e `expect` de `fixtures/baseTest.js`. Não importar de `@playwright/test`. Assim nenhuma suíte omite a limpeza da massa ou as anotações de bug.
2. Se o objeto não tem regra própria, então usar `new RecordPage(page, '<Objeto>', <campo obrigatório>)`. Criar `<Objeto>Page.js` somente se o objeto tem comportamento próprio (conversão, fase, tela customizada).
3. Manter o seletor na página (`pages/`). Se o seletor serve a qualquer objeto, então colocar em `utils/`. A suíte descreve passos, não seletores.
4. Conferir na org do projeto os rótulos de campo e os valores de picklist antes de fixar no código.
5. Gerar CPF e CNPJ com `utils/documentos.js`. Não fixar documento no código: regras de duplicidade da org podem recusar documento já usado em outro registro.
6. Não renomear a pasta `specs/acesso/`. O reporter usa esse nome para separar conferência de acesso de fluxo de negócio.
7. O nome do arquivo da suíte é o id dela no painel e em `test-evidence/`. Se o arquivo for renomeado, então o histórico recomeça.

## CI (GitHub Actions)

Workflow: `.github/workflows/playwrighte2e.yml`.

| Gatilho | Quando | No modelo |
|---------|--------|-----------|
| `workflow_dispatch` | Manual. Entradas: `perfis` (padrão `admin,sdr`) e `spec` (vazio = todas) | Ligado |
| `schedule` | Todos os dias às 10:00 (Brasília) | Comentado |
| `pull_request` | PR para `main` com mudança em `tests/e2e/`, `playwright.config.js`, `package.json`, `package-lock.json` ou no workflow | Comentado |

- O projeto descomenta `schedule` e `pull_request` depois de cadastrar os secrets. Sem eles, toda rodada falha no passo "Autenticar".
- Somente uma rodada executa por vez. A org aceita poucas sessões simultâneas.
- Cada usuário da CLI precisa de um secret `SF_AUTH_URL_<PERFIL>`: `SF_AUTH_URL_ADMIN` (obrigatório) e `SF_AUTH_URL_SDR`. Sem `SF_AUTH_URL_SDR`, a rodada segue só com o admin e mostra um aviso.
- O `--alias` de cada passo "Autenticar" do workflow é igual ao `usuario` do perfil em `test-data/perfis/<id>.json`.
- Cada secret usa um usuário dedicado ao CI, com o mesmo perfil do usuário local: o uso local renova o refresh token e invalida a cópia do secret. Registrar o username do usuário de CI na documentação do projeto, não neste repositório.
- Gerar o valor do secret: `sf org login web --instance-url https://test.salesforce.com --alias ci-temp` com o usuário de CI, depois `sf org display --target-org ci-temp --verbose --json` com a variável de ambiente `TEMP_SHOW_SECRETS=true` (as versões novas da CLI escondem o valor sem ela) e copiar `result.sfdxAuthUrl`. Em seguida, `sf org logout --target-org ci-temp`. O valor dá acesso à org: não colar em chat, issue ou arquivo do repositório.
- O CI publica os artifacts `playwright-report` e `test-evidence` (evidências, painel e `test-results/`) por 30 dias.
