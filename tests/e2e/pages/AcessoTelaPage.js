// @ts-check
const { openLightningPage } = require('../utils/lightning');
const { closeToast } = require('../utils/toast');

// Rótulos seguem o idioma do usuário (inglês ou português).
// Na lista, o botão de criação em português é "Criar"; "Novo" fica para versões antigas.
const BOTAO_NOVO = /^(New|Criar|Novo)$/;
const BOTAO_EDITAR = /^(Edit|Editar)$/;
const BOTAO_EXCLUIR = /^(Delete|Excluir)$/;
const BOTAO_MAIS_ACOES = /^(Show more actions|Mostrar mais ações)$/;
const SEM_ACESSO = /Insufficient Privileges|Privilégios insuficientes|don't have access|não tem acesso|não tem permissão/i;

/**
 * O que a interface mostra ao usuário de um objeto: se a lista abre (ler), se há o botão Novo
 * (criar) e se o registro oferece Editar e Excluir, como botão ou no menu de mais ações.
 *
 * Isso pode diferir da permissão do perfil: o layout esconde botão, a lista não aparece no app.
 * É essa diferença que a suíte de tela pega e a de API não vê.
 */
class AcessoTelaPage {
    /** @param {import('@playwright/test').Page} page */
    constructor(page) {
        this.page = page;
    }

    /**
     * Abre a lista do objeto.
     * @param {string} objeto
     * @returns {Promise<{ ler: boolean, criar: boolean }>}
     */
    async abrirLista(objeto) {
        // O seletor de modo de exibição aparece mesmo com a lista vazia ("Nada para ver aqui"),
        // quando ainda não há tabela.
        const lista = this.page.getByRole('button', { name: /^(Select a List View|Selecionar um modo de exibição de lista)/ }).first();
        const semAcesso = this.page.getByText(SEM_ACESSO).first();
        await openLightningPage(this.page, `lightning/o/${objeto}/list`, lista.or(semAcesso));
        const ler = await lista.isVisible();
        const criar = ler && (await this.page.getByRole('button', { name: BOTAO_NOVO }).first().isVisible());
        return { ler, criar };
    }

    /**
     * Abre o registro e procura Editar e Excluir, também no menu de mais ações.
     * @param {string} objeto
     * @param {string} id
     * @returns {Promise<{ editar: boolean, excluir: boolean }>}
     */
    async abrirRegistro(objeto, id) {
        // Página pronta = título do registro. O menu "Mostrar mais ações" não serve: some quando
        // todas as ações cabem no cabeçalho (o SDR, sem Excluir, só tem Editar, Clonar e Converter).
        const titulo = this.page.getByRole('main').getByRole('heading', { level: 1 }).first();
        const semAcesso = this.page.getByText(SEM_ACESSO).first();
        await openLightningPage(this.page, `lightning/r/${objeto}/${id}/view`, titulo.or(semAcesso));
        await closeToast(this.page);
        // As ações chegam depois do título. Sem nenhuma (perfil só de leitura), segue após a espera.
        const algumaAcao = this.page.getByRole('button', { name: BOTAO_EDITAR })
            .or(this.page.getByRole('button', { name: BOTAO_MAIS_ACOES }))
            .first();
        await algumaAcao.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});

        const editar = await this.acaoVisivel(BOTAO_EDITAR);
        const excluir = await this.acaoVisivel(BOTAO_EXCLUIR);
        return { editar, excluir };
    }

    /**
     * A ação aparece como botão no cabeçalho do registro ou dentro de "Mostrar mais ações".
     * @param {RegExp} nome
     */
    async acaoVisivel(nome) {
        if (await this.page.getByRole('button', { name: nome }).first().isVisible()) return true;
        const maisAcoes = this.page.getByRole('button', { name: BOTAO_MAIS_ACOES }).first();
        if (!(await maisAcoes.isVisible())) return false;
        await maisAcoes.click();
        const item = this.page.getByRole('menuitem', { name: nome }).first();
        const visivel = await item.isVisible({ timeout: 3000 }).catch(() => false);
        await this.page.keyboard.press('Escape');
        return visivel;
    }
}

module.exports = { AcessoTelaPage };
