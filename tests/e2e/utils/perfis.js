// @ts-check
/**
 * Perfis de usuário em que a suíte roda. Cada arquivo em tests/e2e/test-data/perfis/<id>.json é um perfil:
 *
 *   {
 *     "nome": "SDR",                  nome exibido no painel e nos projetos do Playwright
 *     "perfilSalesforce": "SDR",      perfil do usuário na org (documentação)
 *     "usuario": "NovaOrg-SDR",       alias na Salesforce CLI do usuário que tem esse perfil
 *     "padrao": true,                 opcional: o perfil que roda os testes sem tag de perfil
 *     "acesso": {                     opcional: matriz de acesso conferida pela suíte Acesso
 *       "Lead": ["ler", "criar", "editar"],
 *       "*": ["ler"]                  vale para os objetos que não aparecem na matriz
 *     },
 *     "campos": {                     opcional: acesso a campos, conferido pela suíte Acesso
 *       "Lead": {
 *         "AnnualRevenue": "ler",     editar, ler ou oculto
 *         "*": "editar"               opcional: vale para os campos que não aparecem na lista
 *       }
 *     },
 *     "conjuntos": ["Aprovador"]      opcional: conjuntos de permissão (e grupos) que o usuário
 *   }                                 deve ter, pelo nome de API. [] = nenhum
 *
 * O <id> (nome do arquivo) é a tag do perfil: um teste com { tag: '@sdr' } roda no perfil sdr.
 */
const fs = require('fs');
const path = require('path');

const PROFILES_DIR = path.join(__dirname, '..', 'test-data', 'perfis');

// Operações da matriz de acesso, na ordem de exibição.
const OPERACOES = ['ler', 'criar', 'editar', 'excluir'];
// Acesso a um campo, do menor para o maior.
const NIVEIS_DE_CAMPO = ['oculto', 'ler', 'editar'];

/**
 * @typedef {{ id: string, nome: string, perfilSalesforce: string, usuario: string, padrao: boolean,
 *   acesso: Record<string, string[]> | null, campos: Record<string, Record<string, string>> | null,
 *   conjuntos: string[] | null }} Perfil
 */

/**
 * @param {unknown} acesso
 * @param {string} label
 * @returns {Record<string, string[]> | null}
 */
function readAccessMatrix(acesso, label) {
    if (acesso === undefined) return null;
    if (!acesso || typeof acesso !== 'object' || Array.isArray(acesso)) {
        throw new Error(`${label}: "acesso" precisa ser um objeto, ex.: { "Lead": ["ler", "criar"], "*": ["ler"] }.`);
    }
    for (const [objeto, ops] of Object.entries(acesso)) {
        if (!Array.isArray(ops) || ops.some((op) => !OPERACOES.includes(op))) {
            throw new Error(`${label}: "acesso.${objeto}" precisa ser uma lista com ${OPERACOES.join(', ')}.`);
        }
    }
    return /** @type {Record<string, string[]>} */ (acesso);
}

/**
 * @param {unknown} campos
 * @param {string} label
 * @returns {Record<string, Record<string, string>> | null}
 */
function readFieldMatrix(campos, label) {
    if (campos === undefined) return null;
    const exemplo = 'ex.: { "Lead": { "AnnualRevenue": "ler", "*": "editar" } }';
    if (!campos || typeof campos !== 'object' || Array.isArray(campos)) {
        throw new Error(`${label}: "campos" precisa ser um objeto, ${exemplo}.`);
    }
    for (const [objeto, regra] of Object.entries(campos)) {
        if (!regra || typeof regra !== 'object' || Array.isArray(regra)) {
            throw new Error(`${label}: "campos.${objeto}" precisa ser um objeto, ${exemplo}.`);
        }
        for (const [campo, nivel] of Object.entries(regra)) {
            if (!NIVEIS_DE_CAMPO.includes(nivel)) {
                throw new Error(`${label}: "campos.${objeto}.${campo}" precisa ser ${NIVEIS_DE_CAMPO.join(', ')}.`);
            }
        }
    }
    return /** @type {Record<string, Record<string, string>>} */ (campos);
}

/**
 * @param {unknown} conjuntos
 * @param {string} label
 * @returns {string[] | null}
 */
function readPermissionSets(conjuntos, label) {
    if (conjuntos === undefined) return null;
    if (!Array.isArray(conjuntos) || conjuntos.some((nome) => typeof nome !== 'string' || !nome.trim())) {
        throw new Error(`${label}: "conjuntos" precisa ser uma lista de nomes de API, ex.: ["Aprovador_Desconto"].`);
    }
    return conjuntos.map((nome) => nome.trim());
}

/** @type {Perfil[] | null} */
let cache = null;

/**
 * Todos os perfis cadastrados: o padrão primeiro, depois em ordem de nome.
 * SF_TARGET_ORG, quando definido, troca o usuário do perfil padrão (compatível com o uso antigo).
 * @returns {Perfil[]}
 */
function allProfiles() {
    if (cache) return cache;
    const files = fs.readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json'));
    const profiles = files.map((file) => {
        const id = path.basename(file, '.json');
        const label = `tests/e2e/test-data/perfis/${file}`;
        if (!/^[a-z0-9-]+$/.test(id)) {
            throw new Error(`${label}: o nome do arquivo vira a tag do perfil e só aceita letras minúsculas, números e "-".`);
        }
        let data;
        try {
            data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, file), 'utf-8'));
        } catch (error) {
            throw new Error(`${label} inválido: ${error instanceof Error ? error.message : error}`);
        }
        if (!data.nome || !data.usuario) throw new Error(`${label}: "nome" e "usuario" são obrigatórios.`);
        return {
            id,
            nome: String(data.nome).trim(),
            perfilSalesforce: String(data.perfilSalesforce ?? '').trim(),
            usuario: String(data.usuario).trim(),
            padrao: data.padrao === true,
            acesso: readAccessMatrix(data.acesso, label),
            campos: readFieldMatrix(data.campos, label),
            conjuntos: readPermissionSets(data.conjuntos, label)
        };
    });

    const defaults = profiles.filter((p) => p.padrao);
    if (defaults.length !== 1) {
        throw new Error(`tests/e2e/test-data/perfis: exatamente um perfil precisa de "padrao": true (hoje: ${defaults.length}).`);
    }
    if (process.env.SF_TARGET_ORG) defaults[0].usuario = process.env.SF_TARGET_ORG;

    cache = profiles.sort((a, b) => Number(b.padrao) - Number(a.padrao) || a.nome.localeCompare(b.nome));
    return cache;
}

/**
 * Perfis que esta execução roda. PERFIS=admin,sdr limita a lista (o CI usa isso para rodar só
 * os perfis que têm usuário autenticado); sem a variável, roda todos.
 * @returns {Perfil[]}
 */
function activeProfiles() {
    const wanted = (process.env.PERFIS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (wanted.length === 0) return allProfiles();
    const unknown = wanted.filter((id) => !allProfiles().some((p) => p.id === id));
    if (unknown.length) throw new Error(`PERFIS: perfil não encontrado em tests/e2e/test-data/perfis: ${unknown.join(', ')}.`);
    return allProfiles().filter((p) => wanted.includes(p.id));
}

const defaultProfile = () => /** @type {Perfil} */ (allProfiles().find((p) => p.padrao));
const profileById = (/** @type {string} */ id) => allProfiles().find((p) => p.id === id);

/** Nome do projeto do Playwright: "SDR - Google Chrome". */
const projectName = (/** @type {Perfil} */ perfil, /** @type {string} */ browser) => `${perfil.nome} - ${browser}`;

/**
 * Filtro de testes do projeto de um perfil: os testes com a tag dele e, no perfil padrão,
 * também os que não têm tag de perfil nenhuma.
 * @param {Perfil} perfil
 */
function profileGrep(perfil) {
    const own = `@${perfil.id}\\b`;
    if (!perfil.padrao) return new RegExp(own);
    const anyProfileTag = allProfiles().map((p) => p.id).join('|');
    return new RegExp(`${own}|^(?!.*@(?:${anyProfileTag})\\b)`);
}

/**
 * O que a matriz do perfil diz que ele pode fazer no objeto, na ordem de OPERACOES.
 * @param {Perfil} perfil
 * @param {string} objeto
 */
function expectedAccess(perfil, objeto) {
    const ops = perfil.acesso?.[objeto] ?? perfil.acesso?.['*'] ?? [];
    return OPERACOES.filter((op) => ops.includes(op));
}

/**
 * O que o perfil declara para os campos do objeto: campo → editar, ler ou oculto, com "*"
 * opcional para os demais. Sem declaração para o objeto, null: os campos são só inventariados.
 * @param {Perfil} perfil
 * @param {string} objeto
 */
function expectedFields(perfil, objeto) {
    return perfil.campos?.[objeto] ?? null;
}

/**
 * Execuções gravadas antes dos perfis não têm "profile": todas rodaram com o usuário padrão.
 * Recebem o perfil padrão e o nome de projeto novo, para a próxima rodada substituí-las.
 * @param {any} run
 */
function normalizeRun(run) {
    if (run.profile) return run;
    return { ...run, profile: defaultProfile().nome, browser: run.project, project: projectName(defaultProfile(), run.project) };
}

/**
 * Navegadores e perfis presentes nos dados, na ordem de exibição do painel.
 * @param {Array<any>} suites
 */
function dimensions(suites) {
    const runs = suites.flatMap((s) => s.cases.flatMap((/** @type {any} */ c) => c.runs));
    const order = allProfiles().map((p) => p.nome);
    const rank = (/** @type {string} */ name) => (order.includes(name) ? order.indexOf(name) : order.length);
    return {
        browsers: [...new Set(runs.map((r) => r.browser))].sort(),
        profiles: [...new Set(runs.map((r) => r.profile))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    };
}

module.exports = {
    OPERACOES,
    NIVEIS_DE_CAMPO,
    allProfiles,
    activeProfiles,
    defaultProfile,
    profileById,
    projectName,
    profileGrep,
    expectedAccess,
    expectedFields,
    normalizeRun,
    dimensions
};
