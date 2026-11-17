// @ts-check
// Suíte Acesso: confere, pela API, o que cada perfil pode fazer em cada objeto (ler, criar,
// editar, excluir) e o acesso a cada campo, contra a matriz declarada no JSON do perfil
// (tests/e2e/test-data/perfis). Um caso por objeto de tests/e2e/test-data/acesso/objetos.json.
//
// O painel lê os anexos "acesso" e "acesso-campos" e monta a matriz da aba Perfis. O título do
// caso é o nome de API do objeto: é por ele que o painel cruza esta suíte com a de tela.
//
// Roda em todo perfil (cada caso leva a tag de todos) e só no primeiro navegador: a API não
// depende de navegador (playwright.config.js).
const { test, expect } = require('../../fixtures/baseTest');
const { currentProfile } = require('../../utils/sfAuth');
const { allProfiles, defaultProfile, expectedAccess, expectedFields } = require('../../utils/perfis');
const { userAccess, accessOf, fieldAccess, fieldDivergences } = require('../../utils/acesso');
const OBJETOS = require('../../test-data/acesso/objetos.json');

const TODOS_OS_PERFIS = allProfiles().map((p) => `@${p.id}`);

/**
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {string} nome
 * @param {any} conteudo
 */
const anexar = (testInfo, nome, conteudo) =>
    testInfo.attach(nome, { body: JSON.stringify(conteudo), contentType: 'application/json' });

test.describe('Acesso', () => {
    for (const { id, objeto } of OBJETOS) {
        test(`${id} - ${objeto}`, { tag: TODOS_OS_PERFIS }, async ({}, testInfo) => {
            const perfil = currentProfile();
            const esperado = expectedAccess(perfil, objeto);
            /** @type {string[]} */
            let encontrado = [];
            /** @type {Array<{ campo: string, esperado: string, encontrado: string }>} */
            let divergencias = [];

            await test.step(`1. Consultar o que o usuário do perfil ${perfil.nome} pode fazer em ${objeto}`, async () => {
                encontrado = accessOf(userAccess(perfil.usuario), objeto);
                await anexar(testInfo, 'acesso', { objeto, esperado, encontrado });
            });

            // Sem leitura no objeto, o describe é recusado e não há campo para conferir.
            if (encontrado.includes('ler')) {
                await test.step(`2. Consultar o acesso do perfil a cada campo de ${objeto}`, async () => {
                    const campos = fieldAccess(perfil.usuario, objeto, defaultProfile().usuario);
                    const regra = expectedFields(perfil, objeto);
                    const editavel = encontrado.includes('criar') || encontrado.includes('editar');
                    divergencias = regra ? fieldDivergences(regra, campos, editavel) : [];
                    await anexar(testInfo, 'acesso-campos', { regra, ...campos, divergencias });
                });
            }

            await test.step(`3. Confirmar o acesso ao objeto declarado na matriz: ${esperado.join(', ') || 'nenhum'}`, async () => {
                expect(encontrado, `acesso de ${perfil.nome} a ${objeto}`).toEqual(esperado);
            });

            await test.step('4. Confirmar o acesso aos campos declarado no perfil', async () => {
                expect(divergencias, `campos de ${objeto} diferentes do declarado para ${perfil.nome}`).toEqual([]);
            });
        });
    }
});
