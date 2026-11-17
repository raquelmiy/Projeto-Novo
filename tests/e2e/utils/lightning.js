// @ts-check
const { errors, expect } = require('@playwright/test');
const { getOrgLoginUrl, currentProfile, runSf } = require('./sfAuth');

/** Escapa um texto para usá-lo dentro de uma expressão regular. */
const escapeRegExp = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// App em que os testes abrem as páginas: o "Vendas" da Lightning Experience. Sem isso, a URL de
// um registro abre no último app que o usuário usou (Console de vendas, Inside Sales...), e a
// tela muda: a conversão vira aba do console, o cabeçalho tem outras ações. SF_APP troca o app.
const APP_DOS_TESTES = process.env.SF_APP || 'LightningSales';

/** Usuários (alias na CLI) que já estão no app dos testes neste processo. */
const appGarantido = new Set();

/**
 * Deixa o app dos testes como o último app do usuário (UserAppInfo da tela grande), uma vez por
 * usuário em cada processo. O próprio usuário pode alterar esse registro pela API.
 * Se não der (sem registro ou sem permissão), a página abre no app atual e o aviso vai ao log.
 * @param {string} org Alias do usuário na CLI
 */
function garantirApp(org) {
    if (appGarantido.has(org)) return;
    appGarantido.add(org);
    try {
        const consultar = (/** @type {string} */ soql) =>
            JSON.parse(runSf(['data', 'query', '--query', `"${soql}"`, '--json'], org, 'consultar o app do usuário')).result.records;
        const [app] = consultar(`SELECT DurableId FROM AppDefinition WHERE DeveloperName = '${APP_DOS_TESTES}'`);
        if (!app) throw new Error(`app ${APP_DOS_TESTES} não encontrado`);
        const userId = JSON.parse(runSf(['org', 'display', 'user', '--json'], org, 'ler o usuário')).result.id;
        const [info] = consultar(`SELECT Id, AppDefinitionId FROM UserAppInfo WHERE UserId = '${userId}' AND FormFactor = 'Large'`);
        if (!info) throw new Error('usuário sem UserAppInfo (nunca abriu um app)');
        if (info.AppDefinitionId === app.DurableId) return;
        runSf(['data', 'update', 'record', '--sobject', 'UserAppInfo', '--record-id', info.Id, '--values', `"AppDefinitionId=${app.DurableId}"`, '--json'], org, 'trocar o app do usuário');
    } catch (error) {
        console.warn(`[garantirApp] ${org} segue no app atual: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * Abre uma página da org via frontdoor e espera um elemento que indique que a
 * Lightning Experience terminou de carregar. A org de teste às vezes trava no boot
 * inicial logo após o redirecionamento do login; sem isso o primeiro fill() consome
 * o timeout inteiro do teste. Como a sessão já está estabelecida nesse ponto, um
 * reload costuma destravar sem precisar refazer o login.
 * @param {import('@playwright/test').Page} page
 * @param {string} path Caminho relativo na org (ex: "lightning/o/Account/new")
 * @param {import('@playwright/test').Locator} readyLocator Elemento que indica a página pronta
 * @param {number} [attemptTimeout] Tempo máximo de espera por tentativa (ms)
 */
async function openLightningPage(page, path, readyLocator, attemptTimeout = 20000) {
    garantirApp(currentProfile().usuario);
    // Esperar só a resposta do servidor (commit). O evento "load" do frontdoor às vezes não chega
    // e o goto consome o timeout do teste inteiro. O readyLocator diz se a página está pronta.
    await page.goto(getOrgLoginUrl(path), { waitUntil: 'commit' });
    try {
        await readyLocator.waitFor({ state: 'visible', timeout: attemptTimeout });
    } catch (error) {
        if (!(error instanceof errors.TimeoutError)) throw error;
        await page.reload({ waitUntil: 'commit' });
        await readyLocator.waitFor({ state: 'visible', timeout: attemptTimeout });
    }
}

/**
 * Seleciona uma opção em um combobox (picklist) do Lightning Experience no padrão
 * lightning-combobox (role=combobox, nome acessível = só o rótulo do campo).
 * @param {import('@playwright/test').Page} page
 * @param {string} label Rótulo (aria-label) do campo combobox
 * @param {string} optionText Texto exato da opção a selecionar
 */
async function selectPicklist(page, label, optionText) {
    const combobox = page.getByRole('combobox', { name: label, exact: true });
    const option = page.getByRole('option', { name: optionText, exact: true });
    // O dropdown às vezes fecha sozinho logo depois de abrir (o formulário ainda está
    // re-renderizando após o campo anterior); sem retry, o clique na opção fica
    // esperando um elemento invisível até estourar o timeout do teste. Cada tentativa
    // reabre o dropdown se ele tiver fechado.
    await expect(async () => {
        if ((await combobox.getAttribute('aria-expanded')) !== 'true') {
            // Em formulários longos, scrollIntoViewIfNeeded costuma alinhar o campo na borda
            // da área rolável, deixando o dropdown sem espaço para renderizar (fica fora da
            // área visível e o clique nunca "pega"). Centralizar evita isso.
            await combobox.evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await combobox.click();
        }
        await option.click({ timeout: 5000 });
    }).toPass({ timeout: 30000 });
}

/**
 * Seleciona uma opção no picklist "botão" usado no formulário compacto de Task
 * (Status/Priority), cujo nome acessível já inclui o valor atual (ex: "Status Not
 * Started"), diferente do padrão lightning-combobox usado nos demais objetos.
 *
 * O papel desse controle mudou entre releases da org: era role=button e passou a ser
 * role=combobox, com o mesmo nome acessível. O locator aceita os dois para a suíte não
 * quebrar numa org que ainda esteja no release anterior.
 * @param {import('@playwright/test').Page} page
 * @param {string} label Rótulo do campo (ex: "Status")
 * @param {string} optionText Texto exato da opção a selecionar
 */
async function selectButtonPicklist(page, label, optionText) {
    const pattern = new RegExp(`^${escapeRegExp(label)}`);
    const control = page.getByRole('combobox', { name: pattern }).or(page.getByRole('button', { name: pattern }));
    await control.click();
    await selectVisibleOption(page, optionText);
    // O nome acessível passa a trazer o valor escolhido: confirma que a seleção "pegou".
    await expect(control).toHaveText(optionText);
}

/** @param {import('@playwright/test').Page} page @param {string} optionText */
async function selectVisibleOption(page, optionText) {
    const option = page.getByRole('option', { name: optionText, exact: true });
    await option.waitFor({ state: 'visible' });
    await option.click();
}

/**
 * Seleciona um registro num campo de lookup (Account Name, Reports To...). O lookup não é um
 * picklist: o campo consulta o servidor conforme se digita e só então oferece as opções. O
 * input tem role=combobox e o rótulo vem do aria-label, como no lightning-combobox, mas a
 * interação é digitar o termo e escolher o resultado.
 *
 * O `exact: true` na opção não é zelo: junto do registro, o dropdown sempre traz uma opção
 * "Show more results for <termo>", que contém o termo digitado. Sem o match exato o locator
 * corresponde às duas e o clique falha por ambiguidade.
 * @param {import('@playwright/test').Page} page
 * @param {string} label Rótulo do campo (ex: "Account Name")
 * @param {string} recordName Nome exato do registro a selecionar
 */
async function selectLookup(page, label, recordName) {
    const lookup = page.getByRole('combobox', { name: label, exact: true });
    const option = page.getByRole('option', { name: recordName, exact: true });
    // A busca vai ao servidor a cada digitação: o dropdown às vezes fecha no meio (o formulário
    // ainda está re-renderizando) ou volta sem o registro numa primeira consulta lenta. Cada
    // tentativa redigita o termo, o que dispara uma busca nova.
    await expect(async () => {
        if (!(await option.isVisible().catch(() => false))) {
            // Como nos picklists: em formulário longo, o campo encostado na borda não deixa
            // espaço para o dropdown renderizar e o clique na opção nunca "pega".
            await lookup.evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await lookup.click();
            // Limpar antes de redigitar: refazer o fill com o texto que já está lá não dispara
            // busca nova, e a tentativa seguinte esperaria um dropdown que não vai abrir.
            await lookup.fill('');
            await lookup.fill(recordName);
            await option.waitFor({ state: 'visible', timeout: 10000 });
        }
        await option.click({ timeout: 5000 });
    }).toPass({ timeout: 45000 });
    // Escolhido o registro, o próprio input passa a exibir o nome dele.
    await expect(lookup).toHaveValue(recordName);
}

/**
 * Marca uma fase na barra de etapas (Path) do registro e espera a confirmação da org.
 *
 * Cada fase do Path é um `role=option`, cujo nome acessível traz o estado antes do nome da
 * fase ("stage complete Qualification") ou só o nome, na fase atual — daí o padrão ancorado
 * no fim. O botão de confirmação e a mensagem mudam por objeto: "Mark as Current Status" e
 * "Status changed successfully." no Lead, "Mark as Current Stage" e "Stage changed
 * successfully." na Opportunity.
 * @param {import('@playwright/test').Page} page
 * @param {{ fase: string, botao: string, mensagem: string }} opcoes
 */
async function markPathStage(page, { fase, botao, mensagem }) {
    await page.getByRole('option', { name: new RegExp(`(^|\\s)${escapeRegExp(fase)}$`) }).click();
    await page.getByRole('button', { name: botao, exact: true }).click();
    await expect(page.getByText(mensagem).first()).toBeVisible({ timeout: 10000 });
}

module.exports = { escapeRegExp, openLightningPage, selectPicklist, selectButtonPicklist, selectLookup, markPathStage };
