// @ts-check
/**
 * Fecha um bug: confere que o cenário ligado a ele voltou a passar e marca como corrigido.
 *
 * O painel avisa quando o teste de um bug aberto volta a passar, mas não fecha nada sozinho —
 * teste passar não prova correção, e "passou uma vez" não é a mesma afirmação que "o defeito
 * foi resolvido". Fechar continua sendo um ato de quem confirma; o que este script faz é
 * transformar esse ato em uma verificação, em vez de uma edição de arquivo à mão.
 *
 * Por isso ele se recusa a fechar um bug cujo cenário ainda falha: seria registrar como
 * resolvido algo que a automação está dizendo, naquele momento, que não está.
 *
 * Uso:
 *   node scripts/fechar-bug.js BUG-003            fecha, se o cenário tiver passado
 *   node scripts/fechar-bug.js --listar           mostra os bugs abertos e o estado de cada um
 *   node scripts/fechar-bug.js BUG-003 --forcar   fecha mesmo sem a confirmação da automação
 */
const fs = require('fs');
const path = require('path');
const { allProfiles } = require('../tests/e2e/utils/perfis');
const { readBugs } = require('./painel/build');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'painel-dados', 'dashboard-data.json');
const BUGS_FILE = path.join(ROOT, 'bugs.json');

/**
 * O perfil do painel a que o bug se refere, ou '' quando ele vale para o caso inteiro.
 * Mesma regra do painel: valem o id, o nome exibido e o nome do perfil na org, e um valor
 * que não corresponde a perfil nenhum faz o bug valer para todas as execuções.
 * @param {Record<string, any>} bug
 */
function perfilDoBug(bug) {
    const procurado = String(bug.perfilUsuario || '')
        .trim()
        .toLowerCase();
    if (!procurado) return '';
    const achado = allProfiles().find((p) =>
        [p.id, p.nome, p.perfilSalesforce].some((alias) => String(alias || '').toLowerCase() === procurado)
    );
    return achado ? achado.nome : '';
}

function lerDados() {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(
            `Sem dados do painel (${path.relative(ROOT, DATA_FILE)}). Rode a suíte antes: npm run test:e2e`
        );
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

/**
 * O estado do cenário ligado ao bug, do ponto de vista dele.
 * @param {Record<string, any>} bug
 * @param {any} data
 */
function estadoDoCenario(bug, data) {
    if (!bug.caso) return { situacao: 'sem-caso', texto: 'o bug não aponta para nenhum cenário' };
    let caso = null;
    for (const suite of data.suites) {
        const achado = suite.cases.find((/** @type {any} */ c) => `${suite.id}/${c.id}` === bug.caso);
        if (achado) caso = { suite, caso: achado };
    }
    if (!caso) return { situacao: 'sem-caso', texto: `o caso "${bug.caso}" não está nos dados do painel` };

    const perfil = perfilDoBug(bug);
    const cobertas = caso.caso.runs.filter((/** @type {any} */ r) => !perfil || r.profile === perfil);
    const onde = `${caso.suite.name} · ${caso.caso.id}`;
    if (!cobertas.length) {
        return { situacao: 'sem-execucao', texto: `${onde} não rodou no perfil ${perfil}` };
    }
    const falhando = cobertas.filter((/** @type {any} */ r) => r.status !== 'passed');
    if (falhando.length) {
        const quem = falhando.map((/** @type {any} */ r) => `${r.profile} · ${r.browser}`).join(', ');
        return { situacao: 'falhando', texto: `${onde} ainda falha (${quem})` };
    }
    const quando = cobertas
        .map((/** @type {any} */ r) => r.startedAt)
        .filter(Boolean)
        .sort()
        .pop();
    return {
        situacao: 'passou',
        texto: `${onde} passou${quando ? ` em ${new Date(quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}`
    };
}

/** @param {Array<any>} bugs @param {any} data */
function listar(bugs, data) {
    const abertos = bugs.filter((b) => b.status === 'aberto');
    if (!abertos.length) {
        console.log('Nenhum bug aberto. Nada a fechar.');
        return;
    }
    console.log('\nBugs abertos:\n');
    for (const bug of abertos) {
        const { situacao, texto } = estadoDoCenario(bug, data);
        const marca = situacao === 'passou' ? 'pronto para fechar' : 'não confirmado';
        console.log(`  ${bug.id}  ${bug.titulo}`);
        console.log(`     ${marca} — ${texto}`);
    }
    console.log('\nPara fechar: node scripts/fechar-bug.js <ID>');
}

/**
 * Grava o fechamento e confere o arquivo com as mesmas regras do build; se não passar, desfaz.
 * @param {string} id
 */
function fechar(id) {
    const antes = fs.readFileSync(BUGS_FILE, 'utf-8');
    const lista = JSON.parse(antes);
    const alvo = lista.find((/** @type {any} */ b) => String(b.id).toLowerCase() === id.toLowerCase());
    alvo.status = 'corrigido';
    alvo.corrigidoEm = new Date().toLocaleDateString('sv-SE');
    fs.writeFileSync(BUGS_FILE, `${JSON.stringify(lista, null, 2)}\n`, 'utf-8');
    try {
        readBugs();
    } catch (error) {
        fs.writeFileSync(BUGS_FILE, antes, 'utf-8');
        throw new Error(
            `O arquivo não passou na validação do build e nada foi gravado:\n${error instanceof Error ? error.message : error}`
        );
    }
    return alvo;
}

function main() {
    const args = process.argv.slice(2);
    const forcar = args.includes('--forcar');
    const id = args.find((a) => !a.startsWith('--'));
    const bugs = readBugs();
    const data = lerDados();

    if (args.includes('--listar') || args.includes('-l') || !id) {
        listar(bugs, data);
        return;
    }

    const bug = bugs.find((b) => String(b.id).toLowerCase() === id.toLowerCase());
    if (!bug) {
        throw new Error(`Não achei "${id}" no bugs.json. Os abertos aparecem com --listar.`);
    }
    if (bug.status === 'corrigido') {
        console.log(`${bug.id} já está corrigido${bug.corrigidoEm ? ` desde ${bug.corrigidoEm}` : ''}. Nada a fazer.`);
        return;
    }

    const { situacao, texto } = estadoDoCenario(bug, data);
    if (situacao !== 'passou' && !forcar) {
        console.error(`Não dá para confirmar a correção do ${bug.id}: ${texto}.`);
        console.error('Rode o cenário de novo, ou use --forcar se a correção foi verificada por fora da automação.');
        process.exitCode = 1;
        return;
    }

    const fechado = fechar(bug.id);
    console.log(`${fechado.id} marcado como corrigido em ${fechado.corrigidoEm}.`);
    console.log(
        situacao === 'passou'
            ? `Confirmado pela automação: ${texto}.`
            : `Sem confirmação da automação: ${texto} (--forcar).`
    );
    console.log('Para o painel mostrar: node scripts/painel/build.js');
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
