// @ts-check
// Suíte Conjuntos de permissão: lista os conjuntos de permissão (e grupos) atribuídos ao
// usuário de cada perfil e confere contra o declarado em "conjuntos" no JSON do perfil
// (tests/e2e/test-data/perfis). Sem "conjuntos" declarado, o caso só faz o inventário.
//
// O acesso efetivo que a suíte Acesso confere é o perfil somado a esses conjuntos. Este caso
// diz de onde vem o que o perfil sozinho não explica. O painel lê o anexo "conjuntos".
const { test, expect } = require('../../fixtures/baseTest');
const { currentProfile } = require('../../utils/sfAuth');
const { allProfiles, defaultProfile } = require('../../utils/perfis');
const { assignedPermissionSets } = require('../../utils/acesso');

const TODOS_OS_PERFIS = allProfiles().map((p) => `@${p.id}`);

test.describe('Conjuntos de permissão', () => {
    test('CT0001 - Conjuntos de permissão do usuário', { tag: TODOS_OS_PERFIS }, async ({}, testInfo) => {
        const perfil = currentProfile();
        const esperado = perfil.conjuntos;
        /** @type {Array<{ nome: string, rotulo: string, tipo: string }>} */
        let encontrado = [];

        await test.step(`1. Listar os conjuntos de permissão atribuídos ao usuário do perfil ${perfil.nome}`, async () => {
            // Ler atribuições exige ver a configuração da org: quem consulta é o usuário do perfil padrão.
            encontrado = assignedPermissionSets(perfil.usuario, defaultProfile().usuario);
            await testInfo.attach('conjuntos', {
                body: JSON.stringify({ esperado, encontrado }),
                contentType: 'application/json'
            });
        });

        if (!esperado) return;

        await test.step(`2. Confirmar os conjuntos declarados: ${esperado.join(', ') || 'nenhum'}`, async () => {
            expect(encontrado.map((c) => c.nome).sort(), `conjuntos de ${perfil.nome}`).toEqual([...esperado].sort());
        });
    });
});
