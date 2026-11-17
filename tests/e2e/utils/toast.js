// @ts-check

/**
 * Fecha o toast de notificação, se estiver visível, pois ele encobre botões
 * de ação do registro (Edit, Convert, Save...). Não falha se já tiver sumido.
 * @param {import('@playwright/test').Page} page
 */
async function closeToast(page) {
    await page
        .locator('button.toastClose')
        .click({ timeout: 5000 })
        .catch(() => {});
}

module.exports = { closeToast };
