// @ts-check
const { execFileSync } = require('child_process');
const { test } = require('@playwright/test');
const { defaultProfile, profileById } = require('./perfis');

// Remove códigos ANSI que o CLI emite mesmo em modo --json quando FORCE_COLOR está setado
const stripAnsi = (/** @type {string} */ s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/**
 * Perfil do projeto em execução ("SDR - Google Chrome" → sdr), lido do metadata que a
 * playwright.config.js grava em cada projeto. Fora de um teste, vale o perfil padrão.
 */
function currentProfile() {
    let id;
    try {
        id = test.info().project.metadata.perfil;
    } catch {
        // fora de um teste (ex.: script avulso): sem projeto
    }
    return (id && profileById(id)) || defaultProfile();
}

/**
 * Roda um comando da Salesforce CLI como o usuário `org` e devolve o stdout.
 * Na falha, explica qual usuário/perfil e como autenticá-lo.
 * @param {string[]} args argumentos do sf, sem --target-org
 * @param {string} org alias do usuário na CLI
 * @param {string} what o que o comando fazia, para a mensagem de erro
 */
function runSf(args, org, what) {
    try {
        return stripAnsi(
            execFileSync('sf', [...args, '--target-org', org], {
                encoding: 'utf-8',
                shell: true,
                maxBuffer: 64 * 1024 * 1024,
                env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
            })
        );
    } catch (error) {
        // Com --json, o motivo vem no stdout mesmo quando o comando falha.
        let reason = error instanceof Error ? error.message : String(error);
        try {
            reason = JSON.parse(stripAnsi(/** @type {any} */ (error).stdout)).message || reason;
        } catch {
            // stdout sem JSON: fica a mensagem do processo
        }
        throw new Error(
            `Não foi possível ${what} de "${org}" (perfil ${currentProfile().nome}): ${reason}\n` +
                `Se o usuário não estiver autenticado na Salesforce CLI, rode: sf org login web --alias ${org}`
        );
    }
}

/**
 * Gera uma URL de login autenticada (frontdoor) usando a sessão já
 * autorizada pelo Salesforce CLI, evitando lidar com usuário/senha/MFA no teste.
 * O usuário é o do perfil do projeto em execução (tests/e2e/test-data/perfis).
 * @param {string} [path] Caminho relativo a abrir após o login (ex: "lightning/o/Lead/new")
 * @param {string} [targetOrg] Alias ou username na CLI; por padrão, o usuário do perfil em execução
 */
function getOrgLoginUrl(path, targetOrg) {
    const org = targetOrg || currentProfile().usuario;
    const args = ['org', 'open', '--url-only', '--json'];
    if (path) {
        args.push('--path', path);
    }
    const { result } = JSON.parse(runSf(args, org, 'gerar o login'));
    return result.url;
}

module.exports = { getOrgLoginUrl, currentProfile, runSf };
