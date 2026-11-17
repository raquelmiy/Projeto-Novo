// @ts-check
// Exemplo da IT do framework (seção 4.6, "Criar o primeiro teste"), no padrão do repositório:
// criar a massa pela API → validar na tela → conferir pela API → excluir a massa.
//
// Diferenças em relação ao código da IT:
//   - a API vem da fixture sfApi (utils/sfApi.js), autenticada pela Salesforce CLI, e não do jsforce;
//   - o login é o do perfil em execução (utils/sfAuth.js), sem usuário e senha no .env;
//   - a exclusão da massa é automática: o que o sfApi cria entra na limpeza do fim da rodada
//     (utils/limpeza.js). Se o caso falhar, o registro fica na org para investigação.
//
// Sem tag de perfil, o caso roda só no perfil padrão (test-data/perfis, "padrao": true).
// Copiar este arquivo para specs/fluxos/<Objeto>/ ao criar a primeira suíte do projeto.

const { test, expect } = require('../../fixtures/baseTest');
const { openLightningPage } = require('../../utils/lightning');
const { captureEvidence } = require('../../utils/evidence');

test.describe('Exemplo - Lead', () => {
    test('CT0001 - Exibir Lead criado na tela de detalhe', async ({ page, sfApi }, testInfo) => {
        // Massa identificável ("Automacao QA") e única por execução.
        const sobrenome = `Automacao QA ${Date.now()}`;
        const empresa = 'Codeart Teste';
        /** @type {string} */
        let leadId = '';

        await test.step('Pré-condição: existe um Lead criado pela API', async () => {
            leadId = await sfApi.criarMassa('Lead', { LastName: sobrenome, Company: empresa });
        });

        await test.step('1. Abrir o registro do Lead', async () => {
            const nome = page.getByText(sobrenome).first();
            await openLightningPage(page, `lightning/r/Lead/${leadId}/view`, nome);
        });

        await test.step('2. Conferir que o nome do Lead é exibido', async () => {
            await expect(page.getByText(sobrenome).first()).toBeVisible();
            await captureEvidence(page, testInfo, 'lead-detalhe');
        });

        await test.step('3. Conferir pela API o que foi gravado', async () => {
            const lead = await sfApi.ler('Lead', leadId, ['LastName', 'Company']);
            expect(lead.LastName).toBe(sobrenome);
            expect(lead.Company).toBe(empresa);
        });
    });
});
