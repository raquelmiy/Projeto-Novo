// @ts-check
const { test } = require('@playwright/test');

// Marca que separa o passo que o usuário dá do passo que só o teste dá. Fica no título do
// step, que é o único lugar que atravessa o reporter e chega no dashboard-data.json.
const ROTULO_INTERNO = '[interno] ';

/**
 * Passo que existe por causa do teste, não do usuário: limpar a tela, preparar massa, voltar
 * ao estado inicial. Ninguém "cancela a edição para limpar a tela" usando o sistema — isso é
 * o teste se organizando.
 *
 * O painel continua mostrando o passo, porque ele documenta execução e o passo executou de
 * verdade. O guia do usuário (scripts/painel/gerar-guia.js) pula.
 *
 * @param {string} titulo
 * @param {() => Promise<any>} fn
 */
function passoInterno(titulo, fn) {
    return test.step(ROTULO_INTERNO + titulo, fn);
}

/** @param {string} titulo */
const ehPassoInterno = (titulo) => String(titulo).startsWith(ROTULO_INTERNO);

/** @param {string} titulo */
const semMarca = (titulo) => String(titulo).replace(ROTULO_INTERNO, '');

module.exports = { passoInterno, ehPassoInterno, semMarca, ROTULO_INTERNO };
