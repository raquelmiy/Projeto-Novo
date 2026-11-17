// @ts-check
const { expect } = require('@playwright/test');
const { escapeRegExp, selectPicklist, selectButtonPicklist, selectLookup } = require('./lightning');
const { captureEvidence } = require('./evidence');
const { captureRecordId } = require('./recordId');
const { closeToast } = require('./toast');

/**
 * Monta um padrão que corresponde ao rótulo exato, com ou sem o prefixo "*" que o
 * Lightning adiciona a campos obrigatórios (ex: "Last Name" -> "*Last Name").
 * Necessário porque um match por substring simples (o padrão do getByRole/getByLabel)
 * causa colisões entre rótulos parecidos, como "Phone" x "Home Phone" x "Other Phone".
 * @param {string} label
 */
function exactLabel(label) {
    return new RegExp(`^\\*?${escapeRegExp(label)}$`);
}

/**
 * Preenche campos de texto (input/textarea) pelo rótulo visível.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string,string>} fields Rótulo -> valor
 */
async function fillTextFields(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await page.getByRole('textbox', { name: exactLabel(label) }).fill(value);
    }
}

/**
 * Preenche campos numéricos (int/double/currency, renderizados como spinbutton) pelo rótulo.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string,string>} fields Rótulo -> valor
 */
async function fillNumberFields(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await page.getByRole('spinbutton', { name: exactLabel(label) }).fill(value);
    }
}

/**
 * Preenche campos de data pelo nome de API do campo (ex: "CloseDate"), pois no Lightning
 * eles não expõem aria-label/aria-labelledby de forma consistente. A org usa formato dd/mm/aaaa.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string,string>} fields Nome de API -> valor "dd/mm/aaaa"
 */
async function fillDateFields(page, fields) {
    for (const [apiName, value] of Object.entries(fields)) {
        await page.locator(`input[name="${apiName}"]`).fill(value);
    }
}

/**
 * Seleciona picklists (lightning-combobox) pelo rótulo.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string,string>} fields Rótulo -> opção
 */
async function fillPicklists(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await selectPicklist(page, label, value);
    }
}

/**
 * Preenche campos de lookup (relacionamento) pelo rótulo, buscando o registro pelo nome.
 * @param {import('@playwright/test').Page} page
 * @param {Record<string,string>} fields Rótulo -> nome exato do registro
 */
async function fillLookups(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await selectLookup(page, label, value);
    }
}

/**
 * Seleciona picklists no formato "botão" do formulário compacto da Task (Status, Priority).
 * @param {import('@playwright/test').Page} page
 * @param {Record<string,string>} fields Rótulo -> opção
 */
async function fillButtonPicklists(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await selectButtonPicklist(page, label, value);
    }
}

/**
 * Preenche um campo de moeda (renderizado como spinbutton).
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 * @param {string} value Só os dígitos, como o usuário digita (ex: "500000")
 */
async function fillCurrency(page, label, value) {
    await page.getByRole('spinbutton', { name: exactLabel(label) }).fill(value);
}

/**
 * Padrão que aceita o número com ou sem separador de milhar: ao reabrir a edição, a org
 * reformata o valor de um campo de moeda (ex: "500000" vira "R$ 500.000" ou "500,000").
 * @param {string} value
 */
function currencyPattern(value) {
    const digits = value.replace(/\D/g, '');
    const groups = [];
    for (let end = digits.length; end > 0; end -= 3) {
        groups.unshift(digits.slice(Math.max(0, end - 3), end));
    }
    // Tolera o símbolo da moeda antes e os centavos depois, mas não outro número colado.
    return new RegExp(`^\\D*${groups.join('[.,]?')}(?:[.,]\\d{2})?$`);
}

/** @param {import('@playwright/test').Page} page @param {string} label @param {string} value */
async function expectCurrency(page, label, value) {
    await expect(page.getByRole('spinbutton', { name: exactLabel(label) })).toHaveValue(currencyPattern(value));
}

/** @param {import('@playwright/test').Page} page @param {Record<string,string>} fields */
async function expectPicklists(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await expect(page.getByRole('combobox', { name: label, exact: true })).toHaveAttribute('data-value', value);
    }
}

/**
 * Salva o formulário, confirma que o registro abriu, registra a evidência e o Id, e fecha o
 * toast de sucesso, que encobre os botões de ação do registro.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {{ titulo: string, evidencia: string }} opcoes titulo: o nome do registro salvo
 */
async function saveRecord(page, testInfo, { titulo, evidencia }) {
    // O nome do botão segue o idioma do usuário (inglês ou português).
    await page.getByRole('button', { name: /^(Save|Salvar)$/ }).click();
    // Sandbox pode levar mais de 15 s no primeiro salvamento (trigger e regras no servidor).
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible({ timeout: 30000 });
    await captureEvidence(page, testInfo, evidencia);
    await captureRecordId(page, testInfo);
    await closeToast(page);
}

/** @param {import('@playwright/test').Page} page @param {Record<string,string>} fields */
async function expectTextFields(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await expect(page.getByRole('textbox', { name: exactLabel(label) })).toHaveValue(value);
    }
}

/** @param {import('@playwright/test').Page} page @param {Record<string,string>} fields */
async function expectNumberFields(page, fields) {
    for (const [label, value] of Object.entries(fields)) {
        await expect(page.getByRole('spinbutton', { name: exactLabel(label) })).toHaveValue(value);
    }
}

/** @param {import('@playwright/test').Page} page @param {Record<string,string>} fields */
async function expectDateFields(page, fields) {
    for (const [apiName, value] of Object.entries(fields)) {
        await expect(page.locator(`input[name="${apiName}"]`)).toHaveValue(value);
    }
}

module.exports = {
    fillTextFields,
    fillNumberFields,
    fillDateFields,
    fillPicklists,
    fillButtonPicklists,
    fillLookups,
    fillCurrency,
    saveRecord,
    expectTextFields,
    expectNumberFields,
    expectDateFields,
    expectPicklists,
    expectCurrency
};
