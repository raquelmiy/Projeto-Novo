// @ts-check
const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = 'test-evidence';
const stepCounters = new WeakMap();

function slugify(value) {
    return String(value).replace(/[^a-zA-Z0-9]+/g, '-');
}

/**
 * Extrai o ID do caso de teste (ex: "CT0001") do título, com fallback para um slug do título.
 * @param {string} title
 */
function caseIdFromTitle(title) {
    const match = title.match(/^(CT\d+)/);
    return match ? match[1] : slugify(title);
}

/**
 * Deriva um identificador de suíte a partir do nome do arquivo de spec
 * (ex: "lead.suite.spec.js" -> "lead"), usado para não colidir CT IDs entre
 * suítes diferentes que reiniciam a numeração (CT0001 do Lead vs CT0001 do Account).
 * @param {string} file
 */
function suiteSlugFromFile(file) {
    return path.basename(file).replace(/\.suite\.spec\.[jt]s$/, '').replace(/\.spec\.[jt]s$/, '');
}

/**
 * Tira um screenshot do passo atual do teste e salva em
 * test-evidence/<suíte>/<CT-ID>/<projeto>/<NN>-<passo>.png (isolado por projeto, ou seja
 * por perfil e navegador, para uma execução não sobrescrever a evidência de outra),
 * além de anexar ao relatório HTML padrão do Playwright.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {string} stepName Descrição curta do passo (ex: "lead-criado")
 */
async function captureEvidence(page, testInfo, stepName) {
    const suiteSlug = suiteSlugFromFile(testInfo.file);
    const caseId = caseIdFromTitle(testInfo.title);
    const projectSlug = slugify(testInfo.project.name);

    const dir = path.join(EVIDENCE_DIR, suiteSlug, caseId, projectSlug);
    fs.mkdirSync(dir, { recursive: true });

    const step = (stepCounters.get(testInfo) ?? 0) + 1;
    stepCounters.set(testInfo, step);

    const fileName = `${String(step).padStart(2, '0')}-${slugify(stepName)}.png`;
    const filePath = path.join(dir, fileName);

    await page.screenshot({ path: filePath, fullPage: true });
    // O Playwright copia o arquivo para test-results/ ao anexar; usamos isso apenas
    // para o relatório HTML padrão dele. O painel de QA lê direto de test-evidence/.
    await testInfo.attach(stepName, { path: filePath, contentType: 'image/png' });
}

module.exports = { captureEvidence, caseIdFromTitle, slugify, suiteSlugFromFile };
