// @ts-check
// O test das suítes (README, regra 1): o caso pulado também recebe as anotações de bug.
const { test } = require('../fixtures/baseTest');

/**
 * Cenário só com o corpo: pré-condição, passos e resultado esperado, sem ação nem verificação.
 * Serve para a história que ainda não está na org ou tem dúvida aberta com o PO.
 *
 * O test.fixme() da primeira linha pula o caso. O painel mostra o motivo
 * (reporters/dashboard-reporter.js). Os passos ficam no corpo como documentação do cenário.
 *
 * Uso na suíte: test(...cenario('CT0001 - ...', { ... })).
 * A função devolve os argumentos do test(), e não chama o test(): o painel e as evidências usam o
 * arquivo onde o test() foi chamado como id da suíte (utils/evidence.js, suiteSlugFromFile).
 *
 * Para ativar o caso: trocar test(...cenario()) por um test() normal, conferir na org os rótulos e
 * os nomes de API (README, regra 4) e escrever a ação e a verificação de cada passo.
 *
 * @param {string} titulo "CTxxxx - descrição"
 * @param {{ ca: string, motivo: string, dado: string, passos: string[], esperado: string }} cenario
 * @returns {[string, { annotation: { type: string, description: string } }, () => Promise<void>]}
 */
function cenario(titulo, { ca, motivo, dado, passos, esperado }) {
    return [
        titulo,
        { annotation: { type: 'criterio', description: ca } },
        async () => {
            test.fixme(true, motivo);
            await test.step(`Pré-condição: ${dado}`, async () => {});
            for (const [i, passo] of passos.entries()) {
                await test.step(`${i + 1}. ${passo}`, async () => {});
            }
            await test.step(`Resultado esperado: ${esperado}`, async () => {});
        }
    ];
}

/**
 * Motivo de um caso que espera a resposta do PO.
 * @param {string} duvida Ex.: "D1"
 * @param {string} texto
 */
const pendente = (duvida, texto) => `Pendente de esclarecimento (${duvida}): ${texto}`;

module.exports = { cenario, pendente };
