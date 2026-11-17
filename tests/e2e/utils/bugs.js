// @ts-check
/**
 * Leva os bugs do bugs.json para o relatório HTML do Playwright, como anotação do caso.
 *
 * O painel de QA já cruza caso e bug sozinho, no build. O relatório do Playwright não sabe
 * que o bugs.json existe: quem abre uma falha ali não tem como saber se ela é nova ou se já
 * está registrada. A anotação resolve isso na própria página do teste, e o campo de busca do
 * relatório passa a filtrar por ela ("annot:bug").
 *
 * Ligação: `test.beforeEach(anotarBugs)` em cada suíte.
 */
const fs = require('fs');
const path = require('path');
const { caseIdFromTitle, suiteSlugFromFile } = require('./evidence');
const { allProfiles } = require('./perfis');
const { currentProfile } = require('./sfAuth');

const BUGS_FILE = path.join(__dirname, '..', '..', '..', 'bugs.json');

/** @type {Array<Record<string, any>> | null} */
let cache = null;

/**
 * O arquivo é opcional, e a validação dele é do build do painel (scripts/painel/build.js).
 * Aqui um bugs.json ausente ou ilegível só deixa os casos sem anotação: derrubar a rodada
 * por causa de um registro manual seria trocar um relatório incompleto por nenhum.
 */
function lerBugs() {
    if (cache) return cache;
    try {
        const bugs = JSON.parse(fs.readFileSync(BUGS_FILE, 'utf-8'));
        cache = Array.isArray(bugs) ? bugs.filter((b) => b && b.id && b.caso) : [];
    } catch {
        cache = [];
    }
    return cache;
}

/**
 * Mesma regra do bugCobre do painel (scripts/painel/app.js): sem "perfilUsuario", ou com um
 * valor que não corresponde a nenhum perfil conhecido, o bug vale para o caso inteiro.
 * @param {Record<string, any>} bug
 * @param {string} perfilId
 */
function cobrePerfil(bug, perfilId) {
    const alvo = String(bug.perfilUsuario || '').trim().toLowerCase();
    const perfil = allProfiles().find((p) =>
        [p.id, p.nome, p.perfilSalesforce].some((nome) => nome && String(nome).trim().toLowerCase() === alvo)
    );
    return !perfil || perfil.id === perfilId;
}

/**
 * Anota no caso os bugs ligados a ele ("<suíte>/<CT>") que valem para o perfil em execução.
 * O primeiro parâmetro precisa ser a desestruturação literal {}: o Playwright lê o texto da
 * função para descobrir quais fixtures ela pede, e recusa um parâmetro nomeado.
 * @param {{}} _fixtures
 * @param {import('@playwright/test').TestInfo} testInfo
 */
async function anotarBugs({}, testInfo) {
    const caso = `${suiteSlugFromFile(testInfo.file)}/${caseIdFromTitle(testInfo.title)}`;
    const { id: perfilId } = currentProfile();
    for (const bug of lerBugs()) {
        if (bug.caso !== caso || !cobrePerfil(bug, perfilId)) continue;
        const aberto = String(bug.status).toLowerCase() === 'aberto';
        testInfo.annotations.push({
            type: aberto ? 'bug aberto' : 'bug corrigido',
            // O relatório transforma em link a URL que estiver no texto.
            description: [`${bug.id}: ${bug.titulo}`, bug.linkRegistro].filter(Boolean).join(' · ')
        });
    }
}

module.exports = { anotarBugs };
