// @ts-check
// Ponto de entrada das suítes: importe `test` e `expect` daqui, e não de @playwright/test.
// Toda suíte ganha, sem declarar hooks:
//   - os bugs do bugs.json ligados ao caso, como anotação no relatório (utils/bugs.js);
//   - a limpeza da massa criada quando o caso passa (utils/limpeza.js). Se falhar, a massa
//     fica na org para investigação.
// A fixture sfApi dá a REST API da org (utils/sfApi.js), para massa e conferência; o que ela
// cria entra na mesma limpeza.
// Página de objeto com regra própria (pages/<Objeto>Page.js) entra aqui como fixture:
//   leadPage: async ({ page }, use) => { await use(new LeadPage(page)); }
// e a suíte a recebe como async ({ leadPage }) => { ... }.
const base = require('@playwright/test');
const { anotarBugs } = require('../utils/bugs');
const { registrarParaLimpeza } = require('../utils/limpeza');
const { abrirApi } = require('../utils/sfApi');

/**
 * @type {base.TestType<base.PlaywrightTestArgs & base.PlaywrightTestOptions & {
 *   sfApi: import('../utils/sfApi').SfApi, _bugsELimpeza: void
 * }, base.PlaywrightWorkerArgs & base.PlaywrightWorkerOptions>}
 */
const test = base.test.extend({
    _bugsELimpeza: [
        async ({}, use, testInfo) => {
            await anotarBugs({}, testInfo);
            await use();
            await registrarParaLimpeza({}, testInfo);
        },
        // box: fica fora dos passos do relatório e do trace, que mostram só os passos do caso.
        { auto: true, box: true }
    ],
    sfApi: async ({}, use, testInfo) => {
        await use(await abrirApi(testInfo));
    }
});

module.exports = { test, expect: base.expect };
