// @ts-check
const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');
const { activeProfiles, projectName, profileGrep } = require('./tests/e2e/utils/perfis');

// Navegadores em que a suíte roda. Acrescentar um aqui cria um projeto por perfil × navegador
// e multiplica o tempo da rodada: com 15 perfis, cada navegador a mais são 15 sessões a mais na
// org. O painel se ajusta sozinho ao que estiver nesta lista.
const BROWSERS = [{ nome: 'Google Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }];

/**
 * Título do relatório HTML: o projeto e o QA responsável do dashboard.config.json, os mesmos
 * que o painel mostra. Vão no título porque é o único texto livre que o relatório exibe sempre
 * (ele só mostra o `metadata` da config com "#?show-metadata-other" na URL).
 */
function tituloDoRelatorio() {
    try {
        const { projeto, qaResponsavel } = JSON.parse(fs.readFileSync(path.join(__dirname, 'dashboard.config.json'), 'utf-8'));
        const partes = [String(projeto ?? '').trim(), qaResponsavel && `QA: ${String(qaResponsavel).trim()}`];
        return partes.filter(Boolean).join(' · ') || undefined;
    } catch {
        // Sem o arquivo, o relatório fica com o título padrão do Playwright.
        return undefined;
    }
}

module.exports = defineConfig({
    // Só as suítes: templates/, pages/ e utils/ ficam fora da coleta.
    testDir: './tests/e2e/specs',
    // Os testes fazem login via sessão OAuth compartilhada do Salesforce CLI (frontdoor.jsp), e
    // cada worker abre uma sessão própria na org. Com 1 workers, dois arquivos de teste (ou dois
    // projetos) rodam ao mesmo tempo; fullyParallel: false mantém os casos de um mesmo arquivo em
    // ordem, um de cada vez. Subir mais que isso arrisca o limite de sessões simultâneas da org.
    fullyParallel: false,
    workers: 1,
    // O primeiro carregamento do Lightning Experience (boot do Aura/LWC) pode ser lento, e a org
    // às vezes trava nele. A recuperação do openLightningPage consome até 40s (20s de espera,
    // reload, mais 20s), e cada navegação paga ~3s de Salesforce CLI para gerar o link de acesso.
    // Com 60s, um teste que precisasse recuperar não tinha folga para os próprios passos: o
    // orçamento estourava antes de o teste fazer o que veio fazer.
    timeout: 90000,
    // A org de teste às vezes trava o carregamento inicial da Lightning Experience;
    // 1 retry absorve essa instabilidade pontual sem mascarar falhas reais e consistentes.
    retries: 2,
    reporter: [['html', { open: 'never', title: tituloDoRelatorio() }], ['./tests/e2e/reporters/dashboard-reporter.js']],
    // Commit, autor e data no alto do relatório HTML: amarra o resultado a uma versão do código
    // de teste, como a faixa de identificação do painel.
    captureGitInfo: { commit: true },
    // Apaga, no fim da rodada, a massa criada pelos testes que passaram (tests/e2e/utils/limpeza.js).
    // A dos que falharam fica na org: o Id aparece no painel e é por onde se investiga.
    // Confere, antes de tudo, se cada alias está logado com o perfil Salesforce esperado.
    globalSetup: require.resolve('./tests/e2e/utils/conferirPerfis.js'),
    globalTeardown: require.resolve('./tests/e2e/utils/limpeza.js'),
    use: {
        trace: 'on-first-retry',
        // Print da tela no fim de todo caso que falha. Só vale para o caso que abre o navegador:
        // o caso que testa só pela API (fixture sfApi) não tem tela.
        screenshot: 'only-on-failure'
    },
    // Um projeto por perfil × navegador ("SDR - Google Chrome"). Cada perfil (tests/e2e/test-data/perfis)
    // roda só os testes com a tag dele; o perfil padrão roda também os testes sem tag de perfil.
    // O metadata diz ao login (utils/sfAuth.js) e ao reporter qual perfil e navegador é.
    // A suíte de acesso consulta a API e não depende de navegador: roda só no primeiro (Chrome).
    projects: activeProfiles().flatMap((perfil) =>
        BROWSERS.map((browser, i) => ({
            name: projectName(perfil, browser.nome),
            grep: profileGrep(perfil),
            testIgnore: i === 0 ? undefined : '**/acesso/**',
            metadata: { perfil: perfil.id, navegador: browser.nome },
            use: browser.use
        }))
    )
});
