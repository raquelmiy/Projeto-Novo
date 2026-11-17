// @ts-check
// Suíte Acesso na tela: confere, na interface, o que cada perfil vê nos objetos principais
// (lista, botão Novo, Editar e Excluir no registro) contra a matriz declarada no JSON do perfil
// (tests/e2e/test-data/perfis). Objetos: os de tests/e2e/test-data/acesso/objetos.json com
// "tela": true, com o mesmo ID da suíte Acesso.
//
// Editar e Excluir precisam de um registro aberto. Sem nenhum visível, o caso cria um como o
// próprio usuário do perfil, com os campos de "massa" do objetos.json, e ele entra na limpeza.
// Sem "massa", ou se o perfil não pode criar, o caso é pulado com o motivo.
//
// A suíte Acesso confere a permissão pela API; esta, o que a tela oferece. O layout pode
// esconder um botão que a permissão libera, e só esta suíte vê isso. O painel lê o anexo "acesso"
// e mostra a divergência como "a tela mostra" ou "a tela não mostra".
const { test, expect } = require('../../fixtures/baseTest');
const { currentProfile, runSf } = require('../../utils/sfAuth');
const { allProfiles, expectedAccess, OPERACOES } = require('../../utils/perfis');
const { captureEvidence } = require('../../utils/evidence');
const { passoInterno } = require('../../utils/passo');
const { createRecordAs } = require('../../utils/acesso');
const { AcessoTelaPage } = require('../../pages/AcessoTelaPage');
const OBJETOS = require('../../test-data/acesso/objetos.json').filter((/** @type {any} */ o) => o.tela);

const TODOS_OS_PERFIS = allProfiles().map((p) => `@${p.id}`);

/**
 * Um registro do objeto que o usuário enxerga, o mais recente. Sem nenhum, null.
 * @param {string} alias
 * @param {string} objeto
 */
function registroVisivel(alias, objeto) {
    const soql = `"SELECT Id FROM ${objeto} ORDER BY LastModifiedDate DESC LIMIT 1"`;
    const saida = runSf(['data', 'query', '--query', soql, '--json'], alias, `procurar um registro de ${objeto}`);
    const [registro] = JSON.parse(saida.slice(saida.indexOf('{'))).result.records;
    return registro ? registro.Id : null;
}

test.describe('Acesso na tela', () => {
    for (const { id, objeto, massa } of OBJETOS) {
        test(`${id} - ${objeto}`, { tag: TODOS_OS_PERFIS }, async ({ page }, testInfo) => {
            const perfil = currentProfile();
            const esperado = expectedAccess(perfil, objeto);
            const tela = new AcessoTelaPage(page);
            /** @type {Record<string, boolean>} */
            const visto = { ler: false, criar: false, editar: false, excluir: false };

            await test.step(`1. Abrir a lista de ${objeto} e procurar o botão Novo`, async () => {
                Object.assign(visto, await tela.abrirLista(objeto));
                await captureEvidence(page, testInfo, 'lista');
            });

            if (visto.ler) {
                let registro = registroVisivel(perfil.usuario, objeto);
                if (!registro && massa && visto.criar) {
                    await passoInterno(`Criar um registro de ${objeto} para abrir`, async () => {
                        registro = createRecordAs(perfil.usuario, objeto, massa);
                        await testInfo.attach('salesforce-record', {
                            body: JSON.stringify({ object: objeto, id: registro }),
                            contentType: 'application/json'
                        });
                    });
                }
                // Sem registro não há onde procurar Editar e Excluir: a conferência ficaria pela
                // metade, e meia conferência passaria como acesso negado.
                test.skip(!registro, `Nenhum registro de ${objeto} visível para ${perfil.nome}: Editar e Excluir não têm onde ser conferidos.`);

                await test.step(`2. Abrir um registro de ${objeto} e procurar Editar e Excluir`, async () => {
                    Object.assign(visto, await tela.abrirRegistro(objeto, /** @type {string} */ (registro)));
                    await captureEvidence(page, testInfo, 'registro');
                });
            }

            const encontrado = OPERACOES.filter((op) => visto[op]);
            await testInfo.attach('acesso', { body: JSON.stringify({ objeto, esperado, encontrado }), contentType: 'application/json' });

            await test.step(`3. Confirmar o que a matriz declara: ${esperado.join(', ') || 'nenhum'}`, async () => {
                expect(encontrado, `o que a tela de ${objeto} oferece a ${perfil.nome}`).toEqual(esperado);
            });
        });
    }
});
