// @ts-check
/**
 * Registra um bug em bugs.json a partir de uma falha que a automação já capturou.
 *
 * O registro manual é o gargalo do fluxo de bugs: o modelo tem vinte campos e metade deles já
 * está no painel — o cenário, o perfil, o navegador, os passos, a mensagem de erro, a massa
 * criada, as telas. Copiar isso à mão de cinco lugares é o que faz o registro ficar para
 * depois, e "depois" costuma ser nunca.
 *
 * A divisão é a mesma do guia do usuário: a máquina preenche o que ela mediu, a pessoa escreve
 * o que só ela sabe — o que deveria ter acontecido, o impacto e a gravidade. O script não
 * decide o que é defeito: ele lista as falhas e você escolhe qual delas virou bug.
 *
 * Uso:
 *   node scripts/novo-bug.js                  escolhe uma falha e pergunta o resto
 *   node scripts/novo-bug.js --listar         só mostra as falhas candidatas
 *   node scripts/novo-bug.js --esqueleto      grava o rascunho da falha mais recente,
 *   node scripts/novo-bug.js --esqueleto task/CT0004     com <preencher> no que falta
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { ehPassoInterno, semMarca } = require('../tests/e2e/utils/passo');
const { readBugs, readOrgInfo } = require('./painel/build');

const ROOT = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'painel-dados', 'dashboard-data.json');
const BUGS_FILE = path.join(ROOT, 'bugs.json');
const PREENCHER = '<preencher>';

const PRIORIDADES = ['Alta', 'Média', 'Baixa'];

// eslint-disable-next-line no-control-regex
const semCores = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

/** @param {any} run Rótulo da execução como o painel a nomeia: "Admin · Google Chrome". */
const rotulo = (run) => [run.profile, run.browser].filter(Boolean).join(' · ');

function lerDados() {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(
            `Sem dados do painel (${path.relative(ROOT, DATA_FILE)}). Rode a suíte antes: npm run test:e2e`
        );
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

/**
 * Casos com execução falha, da mais recente para a mais antiga.
 *
 * O painel guarda a última execução de cada caso em cada perfil, então toda falha que está
 * aqui é o estado atual daquele cenário — não é preciso limitar à última rodada, e é bom que
 * não seja: falha vista ontem e registrada hoje continua na lista.
 * @param {any} data
 */
function falhasAbertas(data) {
    const itens = [];
    for (const suite of data.suites) {
        for (const caso of suite.cases) {
            const falhas = caso.runs
                .filter((/** @type {any} */ r) => r.status !== 'passed')
                .sort((/** @type {any} */ a, /** @type {any} */ b) =>
                    String(b.startedAt).localeCompare(String(a.startedAt))
                );
            if (falhas.length) itens.push({ suite, caso, falhas, quando: falhas[0].startedAt || '' });
        }
    }
    return itens.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
}

/** @param {string} iso */
const dia = (iso) =>
    iso
        ? new Date(iso).toLocaleString('pt-BR', {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
          })
        : '—';

/**
 * Com que frequência o cenário falha, lido do histórico que cada execução carrega.
 * Sem histórico, a falha de agora é tudo que se sabe: "Aconteceu 1 vez".
 * @param {any} run
 */
function frequencia(run) {
    const anteriores = (run.historico || []).slice(-3);
    if (!anteriores.length) return 'Aconteceu 1 vez';
    return anteriores.every((/** @type {any} */ h) => h.status !== 'passed') ? 'Sempre reproduz' : 'Às vezes';
}

/**
 * O que deveria ter acontecido, quando o próprio teste diz.
 *
 * Um expect com mensagem — expect(x, 'A org deveria recusar…') — abre o erro com essa frase e
 * só depois traz o cabeçalho do matcher. É essa forma que se procura: sem o "expect(" logo
 * abaixo, a primeira linha é erro técnico (timeout, seletor) e não diz nada sobre o esperado.
 * Em "deveria X, mas Y" só o X é expectativa; o Y já é o resultado encontrado.
 * @param {any} run
 * @returns {string}
 */
function esperadoDoTeste(run) {
    const linhas = semCores(run.error || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    if (linhas.length < 2 || !linhas[1].startsWith('expect(')) return '';
    const frase = linhas[0]
        .replace(/^Error:\s*/, '')
        .split(/,\s+mas\s/)[0]
        .trim();
    if (!frase || frase.startsWith('expect(')) return '';
    return /[.!?]$/.test(frase) ? frase : `${frase}.`;
}

/**
 * Link do primeiro registro que a execução criou, para abrir na org o ponto em que ela parou.
 * Sem a URL da instância (build offline, CLI sem sessão) o campo fica vazio, como antes.
 * @param {any} run @param {Record<string, any>} org
 */
function linkDoRegistro(run, org) {
    const id = (run.records || [])[0]?.id;
    return id && org.instanceUrl ? new URL(`/${id}`, org.instanceUrl).href : '';
}

/** Próximo id livre, no formato dos que já existem (BUG-001). @param {Array<any>} bugs */
function proximoId(bugs) {
    const maior = bugs.reduce((n, b) => {
        const m = /(\d+)\s*$/.exec(String(b.id));
        return m ? Math.max(n, Number(m[1])) : n;
    }, 0);
    return `BUG-${String(maior + 1).padStart(3, '0')}`;
}

/**
 * O rascunho do registro: tudo que sai dos dados, com PREENCHER no que depende de gente.
 * @param {{suite: any, caso: any, falhas: any[]}} alvo
 * @param {Array<any>} bugs
 * @param {Record<string, any>} org
 */
function rascunho({ suite, caso, falhas }, bugs, org) {
    const run = falhas[0];
    const perfisDoCaso = new Set(caso.runs.map((/** @type {any} */ r) => r.profile));
    const perfisComFalha = [...new Set(falhas.map((r) => r.profile))];
    // Só declara o perfil quando a falha é de um perfil e o caso roda em mais de um: é aí que
    // o campo serve para o painel não esconder a falha de outro perfil atrás deste bug. Com
    // todos falhando, o bug é do caso inteiro e o campo fica vazio de propósito.
    const perfilUsuario = perfisDoCaso.size > 1 && perfisComFalha.length === 1 ? perfisComFalha[0] : '';
    const passos = (run.steps || []).filter((/** @type {string} */ s) => !ehPassoInterno(s)).map(semMarca);
    const encontrado = semCores(run.error || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 2);
    const massa = (run.records || []).map((/** @type {any} */ r) => `${r.object} ${r.id}`).join('; ');
    const esperado = esperadoDoTeste(run);
    const ambiente = [org.nome || org.alias, org.edicao].filter(Boolean).join(' (') + (org.edicao ? ')' : '');

    return {
        id: proximoId(bugs),
        titulo: PREENCHER,
        area: suite.name,
        tipo: 'Bug',
        // A prioridade só aceita valores da lista, então o rascunho a deixa vazia em vez de
        // marcá-la com PREENCHER: vazio é válido e aparece no painel como "Não informado",
        // enquanto um texto qualquer derrubaria o build.
        prioridade: '',
        status: 'aberto',
        caso: `${suite.id}/${caso.id}`,
        regressaoDe: '',
        encontradoEm: new Date().toLocaleDateString('sv-SE'),
        massaDeTeste: massa,
        ambiente,
        dispositivo: 'Desktop',
        perfilUsuario,
        navegador: [...new Set(falhas.map((r) => r.browser))].join(' e '),
        linkRegistro: linkDoRegistro(run, org),
        frequencia: frequencia(run),
        descricao: PREENCHER,
        passos,
        resultadoEsperado: [esperado || PREENCHER],
        resultadoEncontrado: encontrado.length ? encontrado : [PREENCHER],
        impacto: PREENCHER,
        evidencias: (run.evidences || []).map((/** @type {any} */ e) => `test-evidence/${e.path}`)
    };
}

/**
 * Bug anterior ligado ao mesmo cenário: candidato a regressão. O corrigido vem primeiro —
 * defeito que volta depois de fechado é o caso que interessa marcar.
 * @param {Array<any>} bugs @param {string} caso
 */
function candidatoRegressao(bugs, caso) {
    const ligados = bugs.filter((b) => b.caso === caso);
    return ligados.find((b) => b.status === 'corrigido') || ligados[0] || null;
}

/** @param {Record<string, any>} bug */
function mostrarRascunho(bug) {
    const linhas = [
        ['caso', bug.caso],
        ['perfil', bug.perfilUsuario || '(todos os perfis do caso)'],
        ['navegador', bug.navegador],
        ['ambiente', bug.ambiente],
        ['encontrado em', bug.encontradoEm],
        ['frequência', bug.frequencia],
        ['passos', `${bug.passos.length} do cenário`],
        ['resultado esperado', bug.resultadoEsperado[0] || '—'],
        ['resultado encontrado', bug.resultadoEncontrado[0] || '—'],
        ['massa de teste', bug.massaDeTeste || '—'],
        [
            'evidências',
            bug.evidencias.length ? `${bug.evidencias.length} ${bug.evidencias.length > 1 ? 'telas' : 'tela'}` : '—'
        ],
        ['link do registro', bug.linkRegistro || '—'],
        ['regressão de', bug.regressaoDe || '—']
    ];
    console.log(`\n${bug.id}  [${bug.area}] ${bug.titulo}`);
    for (const [k, v] of linhas) console.log(`  ${k.padEnd(22)}${v}`);
}

/**
 * Grava o bug e confere com as mesmas regras do build. Se o registro não passar, desfaz:
 * bugs.json é memória da equipe e não pode ficar num estado que derruba a próxima rodada.
 * @param {Record<string, any>} bug
 */
function gravar(bug) {
    const antes = fs.existsSync(BUGS_FILE) ? fs.readFileSync(BUGS_FILE, 'utf-8') : '[]';
    const lista = JSON.parse(antes);
    lista.push(bug);
    fs.writeFileSync(BUGS_FILE, `${JSON.stringify(lista, null, 2)}\n`, 'utf-8');
    try {
        readBugs();
    } catch (error) {
        fs.writeFileSync(BUGS_FILE, antes, 'utf-8');
        throw new Error(
            `O registro não passou na validação do build e nada foi gravado:\n${error instanceof Error ? error.message : error}`
        );
    }
}

/** @param {Array<any>} itens */
function listar(itens) {
    if (!itens.length) {
        console.log('Nenhuma falha nos dados do painel. Nada a registrar — o que é uma boa notícia.');
        return;
    }
    console.log('\nFalhas nos dados do painel:\n');
    itens.forEach((it, i) => {
        const quem = [...new Set(it.falhas.map((/** @type {any} */ r) => rotulo(r)))].join(', ');
        console.log(`  ${i + 1}) ${it.suite.name} · ${it.caso.id}  ${it.caso.title}`);
        console.log(`     ${quem} · ${dia(it.quando)}`);
    });
}

async function interativo(itens, bugs, org) {
    if (!process.stdin.isTTY) {
        throw new Error('Sem terminal interativo. Use: node scripts/novo-bug.js --esqueleto <suíte>/<CT>');
    }
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const perguntar = async (/** @type {string} */ q, /** @type {string} */ padrao = '') => {
        const resposta = (await rl.question(padrao ? `${q} [${padrao}] > ` : `${q} > `)).trim();
        return resposta || padrao;
    };
    const lista = async (/** @type {string} */ titulo) => {
        console.log(`${titulo} (um por linha, Enter vazio termina)`);
        const itensLidos = [];
        for (;;) {
            const linha = (await rl.question('  > ')).trim();
            if (!linha) break;
            itensLidos.push(linha);
        }
        return itensLidos;
    };
    const escolher = async (/** @type {string} */ q, /** @type {string[]} */ opcoes, padrao = '') => {
        for (;;) {
            const r = (await perguntar(`${q} [${opcoes.join('/')}]${padrao ? ` (Enter: ${padrao})` : ''}`)) || padrao;
            const achou = opcoes.find((o) => o.toLowerCase().startsWith(r.toLowerCase()) && r);
            if (achou) return achou;
            console.log(`  responda com uma das opções: ${opcoes.join(', ')}`);
        }
    };

    try {
        listar(itens);
        const escolha = Number(await perguntar('\nQual delas virou defeito do sistema? (número, Enter para sair)'));
        if (!escolha || !itens[escolha - 1]) {
            console.log('Nada registrado.');
            return null;
        }
        const alvo = itens[escolha - 1];
        const bug = rascunho(alvo, bugs, org);

        const anterior = candidatoRegressao(bugs, bug.caso);
        if (anterior) {
            console.log(
                `\n${alvo.suite.name} · ${alvo.caso.id} já teve o ${anterior.id} (${anterior.status}): ${anterior.titulo}`
            );
            const r = await perguntar('É o mesmo defeito voltando? [s/N]', 'N');
            if (/^s/i.test(r)) bug.regressaoDe = anterior.id;
        }

        // Defeito que volta é o mesmo defeito: o que a pessoa escreveu da outra vez vira o
        // padrão de cada pergunta. A descrição fica de fora — ela conta por que voltou, e isso
        // é justamente o que mudou.
        const base = bug.regressaoDe && anterior ? anterior : null;
        const sugerido = base ? base.resultadoEsperado : bug.resultadoEsperado.filter((i) => i !== PREENCHER);

        console.log('');
        bug.titulo = await perguntar('Título (uma linha)', base ? base.titulo : '');
        bug.descricao = await perguntar('Descrição: o que acontece');
        if (sugerido.length) {
            console.log(`Resultado esperado sugerido (${base ? `do ${base.id}` : 'tirado do teste'}):`);
            for (const item of sugerido) console.log(`  - ${item}`);
        }
        const digitado = await lista(
            sugerido.length ? 'Enter vazio mantém a sugestão; para trocar, escreva' : 'O que deveria acontecer?'
        );
        bug.resultadoEsperado = digitado.length ? digitado : sugerido;
        bug.impacto = await perguntar('Impacto para o usuário', base ? base.impacto : '');
        bug.prioridade = await escolher('Prioridade', PRIORIDADES, base ? base.prioridade : '');

        mostrarRascunho(bug);
        const ok = await perguntar('\nGravar em bugs.json? [S/n]', 'S');
        if (!/^s/i.test(ok)) {
            console.log('Nada registrado.');
            return null;
        }
        return bug;
    } finally {
        rl.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(
            String(fs.readFileSync(__filename, 'utf-8'))
                .split('Uso:')[1]
                .split('*/')[0]
                .replace(/^\s*\*/gm, '')
        );
        return;
    }

    const data = lerDados();
    const itens = falhasAbertas(data);
    if (args.includes('--listar') || args.includes('-l')) {
        listar(itens);
        return;
    }
    if (!itens.length) {
        console.log('Nenhuma falha nos dados do painel. Nada a registrar — o que é uma boa notícia.');
        return;
    }

    const bugs = readBugs();
    const org = await readOrgInfo();

    let bug = null;
    const iEsqueleto = args.findIndex((a) => a === '--esqueleto');
    if (iEsqueleto >= 0) {
        const pedido = args[iEsqueleto + 1];
        const alvo = pedido ? itens.find((it) => `${it.suite.id}/${it.caso.id}` === pedido) : itens[0];
        if (!alvo) throw new Error(`Não achei falha no caso "${pedido}". Veja as candidatas com --listar.`);
        bug = rascunho(alvo, bugs, org);
        const anterior = candidatoRegressao(bugs, bug.caso);
        if (anterior) {
            console.log(
                `Atenção: ${anterior.id} (${anterior.status}) já aponta para este cenário. Se for o mesmo defeito, preencha "regressaoDe": "${anterior.id}".`
            );
        }
        mostrarRascunho(bug);
    } else {
        bug = await interativo(itens, bugs, org);
    }
    if (!bug) return;

    gravar(bug);
    const faltando = Object.entries(bug)
        .filter(([, v]) => v === PREENCHER || (Array.isArray(v) && v.includes(PREENCHER)))
        .map(([k]) => k);
    const vazios = ['prioridade'].filter((k) => !bug[k]);
    console.log(`\n${bug.id} gravado em bugs.json.`);
    if (faltando.length || vazios.length) {
        console.log(`Falta escrever: ${[...faltando, ...vazios].join(', ')}.`);
    }
    console.log('Para o painel mostrar: node scripts/painel/build.js');
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
