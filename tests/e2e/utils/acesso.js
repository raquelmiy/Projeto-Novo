// @ts-check
const { runSf } = require('./sfAuth');
const { OPERACOES } = require('./perfis');

const API_VERSION = '67.0';

/** @type {Map<string, Map<string, any>>} alias → (objeto → entrada do describeGlobal) */
const cache = new Map();

/**
 * Permissões do usuário em todos os objetos, numa chamada só: o describeGlobal da API REST
 * responde como o usuário autenticado, então queryable/createable/updateable/deletable já
 * refletem o perfil dele. Objeto sem acesso nenhum não aparece na lista.
 * O resultado fica em cache por usuário durante a execução.
 * @param {string} alias usuário na Salesforce CLI
 */
function userAccess(alias) {
    const cached = cache.get(alias);
    if (cached) return cached;
    const out = runSf(['api', 'request', 'rest', `/services/data/v${API_VERSION}/sobjects`], alias, 'consultar as permissões');
    const body = JSON.parse(out.slice(out.indexOf('{')));
    const byName = new Map(body.sobjects.map((/** @type {any} */ s) => [s.name, s]));
    cache.set(alias, byName);
    return byName;
}

/**
 * O que o usuário pode fazer no objeto, nos termos da matriz (ler, criar, editar, excluir).
 * @param {Map<string, any>} access resultado de userAccess
 * @param {string} objeto nome de API do objeto
 */
function accessOf(access, objeto) {
    const s = access.get(objeto);
    if (!s) return [];
    const can = { ler: s.queryable, criar: s.createable, editar: s.updateable, excluir: s.deletable };
    return OPERACOES.filter((op) => can[/** @type {keyof typeof can} */ (op)]);
}

/** @type {Map<string, any[]>} "alias objeto" → campos do describe */
const describeCache = new Map();

/**
 * Campos do objeto como o usuário os enxerga: o describe responde como o usuário autenticado,
 * então campo oculto para ele nem aparece na lista. Falha se o usuário não lê o objeto.
 * @param {string} alias usuário na Salesforce CLI
 * @param {string} objeto nome de API do objeto
 * @returns {any[]}
 */
function describeFields(alias, objeto) {
    const key = `${alias} ${objeto}`;
    const cached = describeCache.get(key);
    if (cached) return cached;
    const out = runSf(
        ['api', 'request', 'rest', `/services/data/v${API_VERSION}/sobjects/${objeto}/describe`],
        alias,
        `ler os campos de ${objeto}`
    );
    const fields = JSON.parse(out.slice(out.indexOf('{'))).fields;
    describeCache.set(key, fields);
    return fields;
}

// Criar conta como editar: há campo que só se preenche na criação (o lado mestre de um
// mestre-detalhe, por exemplo), e para a matriz ele é editável.
const nivelDoCampo = (/** @type {any} */ f) => (f.updateable || f.createable ? 'editar' : 'ler');

/**
 * Tipo do campo, numa chave curta que o painel traduz (CAMPO_TIPO, em scripts/painel/app.js).
 *
 * O "type" do describe sozinho engana em três casos, que são justamente os que explicam por
 * que um campo não se edita ou se comporta diferente: fórmula e numeração automática vêm com
 * o tipo do valor ("currency", "string"), e o relacionamento vem só como "reference", sem
 * dizer para onde aponta nem se é mestre-detalhe.
 * @param {any} f campo do describe
 */
function tipoDoCampo(f) {
    if (f.autoNumber) return 'autonumber';
    if (f.calculated) return `formula:${f.type}`;
    if (f.type === 'reference') {
        const alvo = (f.referenceTo || []).join(', ');
        // No mestre-detalhe o filho some junto com o pai; é o que o describe marca como cascata.
        return `${f.cascadeDelete ? 'masterdetail' : 'reference'}${alvo ? ':' + alvo : ''}`;
    }
    if (f.type === 'textarea') {
        if (f.extraTypeInfo === 'richtextarea') return 'richtext';
        return f.length > 255 ? 'longtext' : 'textarea';
    }
    return f.type;
}

/**
 * Acesso do usuário a cada campo do objeto: editar, ler ou oculto.
 *
 * O usuário de referência (o do perfil padrão) responde duas perguntas que o describe do
 * próprio usuário não responde. Quais campos existem e ele não vê: oculto não vem na lista.
 * E quais ninguém edita (fórmula, numeração automática, auditoria): sem isso, CreatedDate
 * apareceria como restrição do perfil. Se a referência não responder, sobra o que o describe
 * do usuário declara, e os ocultos ficam de fora.
 *
 * natureza: "sistema" para o campo que o perfil não controla (sem permissão de campo, como Id
 * e os obrigatórios); "leitura" para o que tem permissão de campo mas ninguém edita.
 * @param {string} alias usuário na Salesforce CLI
 * @param {string} objeto nome de API do objeto
 * @param {string} referencia alias do usuário de referência
 * @returns {{ encontrado: Record<string, string>, rotulos: Record<string, string>, tipos: Record<string, string>, natureza: Record<string, string> }}
 */
function fieldAccess(alias, objeto, referencia) {
    const proprios = describeFields(alias, objeto);
    /** @type {any[] | null} */
    let base = alias === referencia ? proprios : null;
    if (!base) {
        try {
            base = describeFields(referencia, objeto);
        } catch {
            // Referência sem sessão ou sem acesso ao objeto: segue só com o describe do usuário.
        }
    }

    /** @type {Record<string, string>} */
    const encontrado = {};
    /** @type {Record<string, string>} */
    const rotulos = {};
    /** @type {Record<string, string>} */
    const tipos = {};
    /** @type {Record<string, string>} */
    const natureza = {};
    for (const f of proprios) {
        encontrado[f.name] = nivelDoCampo(f);
        rotulos[f.name] = f.label;
        tipos[f.name] = tipoDoCampo(f);
    }
    for (const f of base || []) {
        if (f.name in encontrado) continue;
        encontrado[f.name] = 'oculto';
        rotulos[f.name] = f.label;
        tipos[f.name] = tipoDoCampo(f);
    }
    for (const f of base || proprios) {
        if (!f.permissionable) natureza[f.name] = 'sistema';
        else if (base ? nivelDoCampo(f) === 'ler' : f.calculated || f.autoNumber) natureza[f.name] = 'leitura';
    }
    return { encontrado, rotulos, tipos, natureza };
}

/**
 * Campos em que a org difere do que o perfil declara.
 *
 * O describe devolve o acesso efetivo, que é o menor entre o do campo e o do objeto. Por isso
 * "editar" vale como "ler" onde editar é impossível: no objeto que o usuário não cria nem
 * edita, e no campo que ninguém edita. E o "*" não alcança o campo de sistema, que o perfil
 * não controla; declarado pelo nome, ele é conferido como qualquer outro.
 * @param {Record<string, string>} regra campo → editar, ler ou oculto, com "*" opcional
 * @param {{ encontrado: Record<string, string>, natureza: Record<string, string> }} campos resultado de fieldAccess
 * @param {boolean} editavel se o usuário cria ou edita o objeto
 * @returns {Array<{ campo: string, esperado: string, encontrado: string }>}
 */
function fieldDivergences(regra, campos, editavel) {
    const nomes = new Set([...Object.keys(campos.encontrado), ...Object.keys(regra)]);
    nomes.delete('*');
    const divergencias = [];
    for (const campo of nomes) {
        let esperado = regra[campo] ?? (campos.natureza[campo] === 'sistema' ? undefined : regra['*']);
        if (!esperado) continue;
        if (esperado === 'editar' && (!editavel || campos.natureza[campo])) esperado = 'ler';
        const encontrado = campos.encontrado[campo] ?? 'oculto';
        if (esperado !== encontrado) divergencias.push({ campo, esperado, encontrado });
    }
    return divergencias;
}

/** @type {Map<string, string>} alias → username na org */
const usernameCache = new Map();

/** @param {string} alias usuário na Salesforce CLI */
function usernameOf(alias) {
    const cached = usernameCache.get(alias);
    if (cached) return cached;
    const username = JSON.parse(runSf(['org', 'display', '--json'], alias, 'identificar o usuário')).result.username;
    usernameCache.set(alias, username);
    return username;
}

/**
 * Conjuntos de permissão e grupos de conjuntos atribuídos ao usuário, em ordem de rótulo.
 * O perfil também é uma atribuição (um conjunto "do perfil") e fica de fora: aqui entra só o
 * que foi somado a ele.
 *
 * Quem consulta é o usuário de referência (o do perfil padrão): ler atribuições exige ver a
 * configuração da org, que um perfil de negócio normalmente não tem.
 *
 * O grupo entra como uma unidade, sem abrir os conjuntos de dentro: ele pode ter um conjunto
 * de silenciamento que retira permissões, e a soma já calculada pelo Salesforce é a do grupo.
 * @param {string} alias usuário na Salesforce CLI
 * @param {string} referencia alias do usuário de referência
 * @returns {Array<{ nome: string, rotulo: string, tipo: 'conjunto' | 'grupo' }>}
 */
function assignedPermissionSets(alias, referencia) {
    const query =
        'SELECT PermissionSet.Name, PermissionSet.Label, PermissionSet.NamespacePrefix, PermissionSet.IsOwnedByProfile, ' +
        'PermissionSetGroup.DeveloperName, PermissionSetGroup.MasterLabel, PermissionSetGroup.NamespacePrefix ' +
        `FROM PermissionSetAssignment WHERE Assignee.Username = '${usernameOf(alias)}' AND IsActive = true`;
    // As aspas são obrigatórias: runSf roda com shell: true e a query se despedaça nos espaços.
    const out = runSf(['data', 'query', '--query', `"${query}"`, '--json'], referencia, `ler os conjuntos de permissão de ${alias}`);
    const comPrefixo = (/** @type {string | null} */ prefixo, /** @type {string} */ nome) => (prefixo ? `${prefixo}__${nome}` : nome);
    return JSON.parse(out.slice(out.indexOf('{')))
        .result.records.filter((/** @type {any} */ r) => !r.PermissionSet.IsOwnedByProfile)
        .map((/** @type {any} */ r) =>
            r.PermissionSetGroup
                ? {
                      nome: comPrefixo(r.PermissionSetGroup.NamespacePrefix, r.PermissionSetGroup.DeveloperName),
                      rotulo: r.PermissionSetGroup.MasterLabel,
                      tipo: 'grupo'
                  }
                : { nome: comPrefixo(r.PermissionSet.NamespacePrefix, r.PermissionSet.Name), rotulo: r.PermissionSet.Label, tipo: 'conjunto' }
        )
        .sort((/** @type {any} */ a, /** @type {any} */ b) => a.rotulo.localeCompare(b.rotulo));
}

/**
 * Cria um registro pela API como o usuário `alias` e devolve o Id. Os valores entram entre
 * aspas simples na CLI: use só letras, números, espaços, "-" e ":" neles.
 * @param {string} alias usuário na Salesforce CLI (vira o dono do registro)
 * @param {string} objeto nome de API do objeto
 * @param {Record<string, string>} fields campo → valor
 * @returns {string}
 */
function createRecordAs(alias, objeto, fields) {
    const values = Object.entries(fields)
        .map(([field, value]) => `${field}='${value}'`)
        .join(' ');
    const out = runSf(
        ['data', 'create', 'record', '--sobject', objeto, '--values', `"${values}"`, '--json'],
        alias,
        `criar ${objeto}`
    );
    return JSON.parse(out).result.id;
}

module.exports = { userAccess, accessOf, fieldAccess, fieldDivergences, assignedPermissionSets, createRecordAs };
