// @ts-check
const { activeProfiles, defaultProfile } = require('./perfis');
const { runSf } = require('./sfAuth');

// Perfis padrão do Salesforce: o nome volta no idioma de quem consulta.
const MESMO_PERFIL = [['system administrator', 'administrador do sistema']];

/** @param {string} a @param {string} b */
function mesmoPerfil(a, b) {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    return x === y || MESMO_PERFIL.some((par) => par.includes(x) && par.includes(y));
}

/**
 * Antes da rodada: confere se o usuário de cada perfil ativo tem o perfil Salesforce esperado
 * ("perfilSalesforce" em test-data/perfis/<id>.json).
 *
 * Sem isso, um alias autenticado com o usuário errado passa despercebido. Em 04/11/2026 o secret
 * do SDR no CI foi gerado com a sessão do admin aberta no navegador: os testes "do SDR" rodaram
 * como administrador, e os que esperam recusa falharam sem motivo aparente.
 */
module.exports = async function conferirPerfis() {
    const erros = [];
    // O SDR não lê o objeto Profile: o perfil de cada usuário é consultado pelo alias do padrão.
    const admin = defaultProfile().usuario;
    for (const perfil of activeProfiles()) {
        if (!perfil.perfilSalesforce) continue;
        try {
            const { id, username } = JSON.parse(runSf(['org', 'display', 'user', '--json'], perfil.usuario, 'ler o usuário')).result;
            const consulta = `SELECT Profile.Name FROM User WHERE Id = '${id}'`;
            const [usuario] = JSON.parse(runSf(['data', 'query', '--query', `"${consulta}"`, '--json'], admin, 'ler o perfil')).result.records;
            const atual = usuario?.Profile?.Name ?? '(sem perfil)';
            if (!mesmoPerfil(atual, perfil.perfilSalesforce)) {
                erros.push(`${perfil.id}: o alias ${perfil.usuario} está logado como ${username}, com o perfil "${atual}". Esperado: "${perfil.perfilSalesforce}".`);
            }
        } catch (error) {
            erros.push(`${perfil.id}: não foi possível conferir o alias ${perfil.usuario}: ${error instanceof Error ? error.message : error}`);
        }
    }
    if (erros.length) {
        throw new Error(`Usuário com perfil errado. Refazer o login do alias (no CI, o secret PROJETO_AMBIENTE_<PERFIL>):\n- ${erros.join('\n- ')}`);
    }
};
