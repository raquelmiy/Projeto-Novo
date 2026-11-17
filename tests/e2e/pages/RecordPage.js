// @ts-check
const { openLightningPage } = require('../utils/lightning');
const { fillTextFields, saveRecord } = require('../utils/recordForm');

// Rótulo do botão segue o idioma do usuário (inglês ou português).
const BOTAO_SALVAR = /^(Save|Salvar)$/;

/**
 * Página de registro de qualquer objeto Salesforce: o formulário padrão do Lightning é o mesmo
 * para todos, e os campos são preenchidos pelo rótulo (utils/recordForm.js).
 * Objeto sem comportamento próprio usa esta classe direto: new RecordPage(page, 'Account', pronto).
 * Objeto com regra própria (conversão, fase, tela customizada) ganha uma classe que estende esta.
 */
class RecordPage {
    /**
     * @param {import('@playwright/test').Page} page
     * @param {string} objeto Nome de API do objeto (ex: "Lead", "Account")
     * @param {import('@playwright/test').Locator} formularioPronto Elemento que só aparece
     *   quando o formulário de novo registro terminou de carregar (um campo obrigatório)
     */
    constructor(page, objeto, formularioPronto) {
        this.page = page;
        this.objeto = objeto;
        this.formularioPronto = formularioPronto;
    }

    async abrirNovo() {
        await openLightningPage(this.page, `lightning/o/${this.objeto}/new`, this.formularioPronto);
    }

    /** @param {Record<string, string>} campos Rótulo do campo → valor */
    async preencher(campos) {
        await fillTextFields(this.page, campos);
    }

    /**
     * @param {import('@playwright/test').TestInfo} testInfo
     * @param {{ titulo: string, evidencia: string }} opcoes titulo: o nome do registro salvo
     */
    async salvar(testInfo, opcoes) {
        await saveRecord(this.page, testInfo, opcoes);
    }

    /**
     * Só clica em Salvar, sem esperar a página do registro. Para quando o caso confere o
     * resultado por outro caminho (ex.: o registro vai para outro dono e sai da visão do usuário).
     */
    async clicarSalvar() {
        await this.page.getByRole('button', { name: BOTAO_SALVAR }).click();
    }
}

module.exports = { RecordPage };
