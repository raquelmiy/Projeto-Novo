// @ts-check
// Teste de fumaça: confirma que o Playwright alcança a org antes de rodar as suítes de fluxo.

const { test, expect } = require('../../fixtures/baseTest');
const { openLightningPage } = require('../../utils/lightning');
const { currentProfile, runSf } = require('../../utils/sfAuth');
const { captureEvidence } = require('../../utils/evidence');

test.describe('Conexão com a org', () => {
    test('CT0001 - Abrir a Lightning Experience com o usuário do perfil', async ({ page }, testInfo) => {
        const { usuario } = currentProfile();

        await test.step('1. Confirmar que a Salesforce CLI tem sessão válida para o usuário', async () => {
            const { result } = JSON.parse(runSf(['org', 'display', '--json'], usuario, 'consultar a sessão'));
            expect(result.connectedStatus ?? 'Connected', `Status da conexão de "${usuario}"`).toBe('Connected');
            expect(result.instanceUrl).toMatch(/^https:\/\//);
        });

        await test.step('2. Abrir a página inicial da Lightning Experience', async () => {
            // O nome do botão segue o idioma do usuário: a org pode estar em inglês ou em português.
            const appLauncher = page.getByRole('button', { name: /^(App Launcher|Iniciador de aplicativos)$/ });
            await openLightningPage(page, 'lightning/page/home', appLauncher);
        });

        await test.step('3. Confirmar que a sessão está no domínio Lightning', async () => {
            await expect(page).toHaveURL(/\.lightning\.force\.com\/lightning\//);
            await captureEvidence(page, testInfo, 'home-lightning');
        });
    });
});
