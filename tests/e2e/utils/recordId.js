// @ts-check

// Depois do save, o Lightning abre o registro em /lightning/r/<Id>/view, sem o nome do
// objeto; outras navegações usam /lightning/r/<Objeto>/<Id>/view. O padrão aceita as duas
// formas. O Id tem 15 ou 18 caracteres.
const URL_RECORD_RE = /\/lightning\/r\/(?:([A-Za-z]\w*)\/)?([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)(?:[/?#]|$)/;

// Prefixo do Id (3 primeiros caracteres) → objeto padrão, para quando a URL não traz o nome.
/** @type {Record<string, string>} */
const KEY_PREFIX_OBJECT = {
    '001': 'Account',
    '003': 'Contact',
    '006': 'Opportunity',
    '00Q': 'Lead',
    '00T': 'Task',
    '00U': 'Event',
    '500': 'Case'
};

/**
 * Captura o Id do registro Salesforce a partir da URL atual (página de
 * detalhe do registro recém-criado) e anexa ao resultado do teste, para
 * alimentar a seção "Massa de teste" do dashboard de QA com dados reais.
 *
 * O Lightning troca a URL de forma assíncrona depois do save: o título do
 * registro já aparece na tela enquanto a barra de endereço ainda mostra
 * .../o/<Objeto>/new. Por isso aguardamos a URL virar a de detalhe antes de
 * ler o Id — sem falhar o teste se ela não chegar (a captura é acessória).
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').TestInfo} testInfo
 */
async function captureRecordId(page, testInfo) {
    try {
        await page.waitForURL(URL_RECORD_RE, { timeout: 10000 });
    } catch {
        // A URL real mostra por que o padrão não casou (ex.: o Lightning mudou o formato).
        console.warn(`[captureRecordId] Id não capturado em "${testInfo.title}". URL atual: ${page.url()}`);
        return;
    }

    const match = page.url().match(URL_RECORD_RE);
    if (!match) return;

    const [, objectFromUrl, id] = match;
    const object = objectFromUrl || KEY_PREFIX_OBJECT[id.slice(0, 3)] || 'Registro';
    await testInfo.attach('salesforce-record', {
        body: JSON.stringify({ object, id }),
        contentType: 'application/json'
    });
}

/**
 * Id do registro aberto na página, lido da URL. Falha se a URL não é de registro, ou se é de
 * outro objeto.
 * @param {import('@playwright/test').Page} page
 * @param {string} objeto Nome de API do objeto esperado (ex.: "Lead")
 */
function idDaUrl(page, objeto) {
    const match = page.url().match(URL_RECORD_RE);
    const [, objetoDaUrl, id] = match ?? [];
    // Sem o objeto na URL, o prefixo do Id diz qual é (quando é um objeto padrão conhecido).
    const objetoLido = objetoDaUrl || (id && KEY_PREFIX_OBJECT[id.slice(0, 3)]);
    if (!id || (objetoLido && objetoLido !== objeto)) throw new Error(`Id de ${objeto} não encontrado na URL: ${page.url()}`);
    return id;
}

module.exports = { captureRecordId, idDaUrl };
