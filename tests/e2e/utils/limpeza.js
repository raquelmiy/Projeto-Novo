// @ts-check
/**
 * Limpeza da massa de teste criada na org.
 *
 * Três decisões que valem explicar, porque nenhuma é óbvia:
 *
 * 1) Apaga só o que passou. Registro de teste que falhou é evidência: o painel mostra o Id
 *    para você abrir na org e ver o estado em que a coisa parou (foi assim que o BUG-001
 *    virou reprodutível). Apagar isso destrói a prova junto com o lixo.
 *
 * 2) Apaga em lote, no fim da rodada — não em cada afterEach. Cada comando `sf` sobe um
 *    processo Node de ~3s; numa suíte de 3.000 execuções isso somaria horas só de limpeza.
 *    O afterEach apenas anota num arquivo (custo zero) e o teardown faz uma chamada bulk
 *    por objeto.
 *
 * 3) Apaga como o usuário padrão (admin), e não como o usuário do perfil. O perfil do teste
 *    pode não ter permissão de excluir — num fluxo negativo é exatamente o que se está
 *    provando. Quem limpa precisa ser quem pode.
 *
 * Ligação: `test.afterEach(registrarParaLimpeza)` em cada suíte, e `globalTeardown` na
 * playwright.config.js apontando para este arquivo.
 */
const fs = require('fs');
const path = require('path');
const { runSf } = require('./sfAuth');
const { defaultProfile } = require('./perfis');

// test-results/ já é ignorado pelo git e limpo pelo Playwright a cada rodada.
const ARQUIVO = path.join('test-results', 'massa-para-limpar.json');

/**
 * Anota os registros criados por um teste que passou, para o teardown apagar depois.
 * Os Ids vêm dos anexos `salesforce-record` que os testes já gravam com captureRecordId()
 * ou testInfo.attach() — nenhuma mudança é necessária nos casos existentes.
 * O primeiro parâmetro precisa ser a desestruturação literal {}: o Playwright lê o texto da
 * função para descobrir quais fixtures ela pede, e recusa um parâmetro nomeado.
 * @param {{}} _fixtures
 * @param {import('@playwright/test').TestInfo} testInfo
 */
async function registrarParaLimpeza({}, testInfo) {
    // Falhou (ou passou onde deveria falhar): a massa fica na org para investigação.
    if (testInfo.status !== testInfo.expectedStatus) return;

    const registros = testInfo.attachments
        .filter((a) => a.name === 'salesforce-record' && a.body)
        .map((a) => {
            try {
                return JSON.parse(a.body.toString('utf-8'));
            } catch {
                return null;
            }
        })
        .filter((r) => r && r.object && r.id);

    if (registros.length === 0) return;

    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    /** @type {Array<{ object: string, id: string }>} */
    let fila = [];
    try {
        fila = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
    } catch {
        // primeira anotação da rodada
    }
    fila.push(...registros);
    fs.writeFileSync(ARQUIVO, JSON.stringify(fila), 'utf-8');
}

/**
 * No GitHub Actions, mostra um aviso no resumo da execução. A limpeza não derruba a rodada,
 * então sem isso a falha só aparece no meio do log e a execução fica verde.
 * Fora do CI, não faz nada: o console.warn já basta.
 * @param {string} titulo
 * @param {string} mensagem
 */
function avisarNoCi(titulo, mensagem) {
    if (process.env.GITHUB_ACTIONS !== 'true') return;
    // O comando de workflow ocupa uma linha só: quebras e "%" precisam de escape.
    const escapar = (/** @type {string} */ s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const tituloSeguro = escapar(titulo).replace(/:/g, '%3A').replace(/,/g, '%2C');
    console.log(`::warning title=${tituloSeguro}::${escapar(mensagem)}`);
}

/**
 * Apaga em lote todos os registros anotados na rodada, agrupados por objeto.
 * Uma falha aqui não derruba a rodada: limpeza é higiene, não resultado de teste.
 */
async function limparMassa() {
    /** @type {Array<{ object: string, id: string }>} */
    let fila = [];
    try {
        fila = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
    } catch {
        return; // nada criado, ou nenhum teste passou
    }
    if (fila.length === 0) return;

    const admin = defaultProfile().usuario;
    /** @type {Map<string, Set<string>>} */
    const porObjeto = new Map();
    for (const { object, id } of fila) {
        if (!porObjeto.has(object)) porObjeto.set(object, new Set());
        porObjeto.get(object).add(id);
    }

    for (const [objeto, ids] of porObjeto) {
        // Um caso que exclui o próprio registro (o fluxo de exclusão) deixa na fila um Id que já
        // não existe. O bulk recusa o lote inteiro por causa dele e reporta uma falha que não é
        // falha. Perguntar antes o que sobrou custa uma consulta e evita esse alarme.
        let lista = [...ids];
        try {
            const where = lista.map((id) => `'${id}'`).join(',');
            const soql = `"SELECT Id FROM ${objeto} WHERE Id IN (${where})"`;
            const out = runSf(['data', 'query', '--query', soql, '--json'], admin, `conferir ${objeto}`);
            const vivos = new Set(JSON.parse(out.slice(out.indexOf('{'))).result.records.map((r) => r.Id));
            lista = lista.filter((id) => vivos.has(id));
        } catch {
            // Sem a conferência, tenta apagar tudo: o pior caso é o alarme de antes.
        }
        if (lista.length === 0) continue;
        const csv = path.join('test-results', `limpar-${objeto}.csv`);
        // O `sf data delete bulk` presume a quebra de linha do sistema (CRLF no Windows, LF no
        // Linux do CI) e recusa o arquivo que não bate ("LineEnding is invalid on user data").
        // O CSV sai sempre com CRLF e o formato vai explícito, para valer nos dois.
        fs.writeFileSync(csv, ['Id', ...lista].join('\r\n') + '\r\n', 'utf-8');
        try {
            runSf(
                ['data', 'delete', 'bulk', '--sobject', objeto, '--file', csv, '--line-ending', 'CRLF', '--wait', '10'],
                admin,
                `apagar ${objeto}`
            );
            console.log(`Limpeza: ${lista.length} ${objeto}(s) apagados.`);
        } catch (error) {
            // Registro já excluído pelo próprio teste (o fluxo de exclusão, por exemplo) cai aqui.
            const motivo = error instanceof Error ? error.message : String(error);
            console.warn(`Limpeza de ${objeto} não concluída: ${motivo}`);
            avisarNoCi(`Limpeza de ${objeto} não concluída`, `${lista.length} registro(s) ficaram na org. ${motivo}`);
        }
    }

    fs.rmSync(ARQUIVO, { force: true });
}

// A playwright.config.js aponta globalTeardown para este arquivo, e o Playwright chama o
// module.exports como função. O registrarParaLimpeza vai como propriedade para as suítes.
module.exports = limparMassa;
module.exports.registrarParaLimpeza = registrarParaLimpeza;
module.exports.limparMassa = limparMassa;
