// @ts-check
const fs = require('fs');
const path = require('path');
const { caseIdFromTitle, slugify, suiteSlugFromFile } = require('../utils/evidence');
const { allProfiles, defaultProfile, profileById, normalizeRun, dimensions } = require('../utils/perfis');
const { buildDashboard } = require('../../../scripts/painel/build');

// Duas naturezas, duas pastas. test-evidence/ é descartável: screenshots e o HTML do painel
// são regerados a cada rodada. painel-dados/ é memória: o resultado acumulado por caso e o
// histórico de rodadas não se recuperam se sumirem, e por isso são versionados.
const EVIDENCE_DIR = 'test-evidence';
const DATA_DIR = 'painel-dados';
const DATA_FILE = path.join(DATA_DIR, 'dashboard-data.json');
const HISTORY_FILE = path.join(DATA_DIR, 'run-history.json');
// Rodadas parciais (um caso, uma suíte) são a maioria esmagadora — num dia de trabalho normal
// passam de quarenta. Com um teto único para os dois tipos, elas enchem a lista e empurram para
// fora justamente as completas, que são as únicas que o gráfico de tendência usa: o histórico
// apagava sozinho o dado que existe para guardar. Por isso cada tipo tem o seu limite.
//
// As completas são raras e pequenas, então cabem muitas. As parciais hoje não alimentam nada no
// painel; ficam só como rastro recente do que foi rodado à mão.
// Quantos resultados anteriores cada execução (caso × projeto) carrega consigo.
//
// Sem isso o painel só sabe o estado de agora, e duas perguntas ficam sem resposta: "esse
// vazamento apareceu ontem ou está aberto há duas semanas?" e "o Chrome é consistentemente mais
// lento neste caso, ou aquela rodada foi atípica?". São dois sintomas da mesma falta.
//
// Dez entradas de ~60 bytes por execução somam dezenas de KB — barato perto do que respondem.
const RUN_HISTORY_MAX = 10;

const HISTORY_MAX_COMPLETE = 200;
const HISTORY_MAX_PARTIAL = 30;


/**
 * Projeto do Playwright em que o teste rodou: o nome ("SDR - Google Chrome") e, do metadata
 * gravado pela playwright.config.js, o perfil e o navegador.
 * @returns {{ name: string, profile: string, browser: string }}
 */
function getProject(test) {
    let suite = test.parent;
    while (suite) {
        const project = typeof suite.project === 'function' ? suite.project() : null;
        if (project && project.name) {
            const meta = project.metadata || {};
            const perfil = profileById(meta.perfil) || defaultProfile();
            return { name: project.name, profile: perfil.nome, browser: meta.navegador || project.name };
        }
        suite = suite.parent;
    }
    return { name: 'N/A', profile: defaultProfile().nome, browser: 'N/A' };
}

// Ordem das execuções de um caso: perfil (o padrão primeiro), depois navegador.
const PROFILE_ORDER = allProfiles().map((p) => p.nome);
const runOrder = (/** @type {any} */ a, /** @type {any} */ b) =>
    PROFILE_ORDER.indexOf(a.profile) - PROFILE_ORDER.indexOf(b.profile) || a.browser.localeCompare(b.browser);

function getCaseId(title) {
    const match = title.match(/^(CT\d+)\s*-\s*(.*)$/);
    return match ? { id: match[1], name: match[2] } : { id: caseIdFromTitle(title), name: title };
}

/**
 * Lê as evidências direto de test-evidence/<suíte>/<caseId>/<projeto>/ (não do attachment
 * copiado pelo Playwright em test-results/, que é limpo a cada execução).
 * @param {string} suiteSlug
 * @param {string} caseId
 * @param {string} projectName
 */
function readEvidenceFiles(suiteSlug, caseId, projectName) {
    const projectSlug = slugify(projectName);
    const dir = path.join(EVIDENCE_DIR, suiteSlug, caseId, projectSlug);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .sort()
        .map((f) => ({
            name: f.replace(/^\d+-/, '').replace(/\.png$/, ''),
            path: [suiteSlug, caseId, projectSlug, f].join('/')
        }));
}

/**
 * Extrai os IDs de registro do Salesforce anexados via captureRecordId()
 * (tests/e2e/utils/recordId.js) durante a execução do caso.
 * @param {any} result
 */
function readRecords(result) {
    return (result.attachments || [])
        .filter((a) => a.name === 'salesforce-record')
        .map((a) => {
            try {
                return JSON.parse(a.body ? Buffer.from(a.body).toString('utf-8') : '{}');
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

/** Suítes já gravadas em disco. Vazio em projeto novo ou com DASHBOARD_RESET=1. */
function readPreviousSuites() {
    if (process.env.DASHBOARD_RESET === '1') return [];
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')).suites || [];
    } catch {
        // Sem arquivo ainda, ou ilegível: a rodada define a linha de base.
        return [];
    }
}

/**
 * Rodada completa: executou todo par caso × perfil × navegador que o painel já conhece.
 *
 * A regra anterior lia process.argv atrás de filtro. Ela media a LINHA DE COMANDO, não o
 * que de fato rodou — e errava nos dois casos mais comuns de rodar tudo: o ▶ do VS Code
 * (a extensão passa os caminhos dos arquivos) e `playwright test tests/e2e` (a pasta é um
 * argumento posicional). Nos dois, 61 de 61 execuções entravam no histórico como parciais
 * e ficavam de fora da tendência.
 *
 * Medir cobertura também dispensa acompanhar as flags da CLI do Playwright, que mudam de
 * versão para versão.
 *
 * Efeito colateral conhecido: um caso apagado do código continua nos dados acumulados e
 * nunca mais é coberto, então nenhuma rodada volta a ser completa. O aviso no terminal
 * nomeia o par que faltou, e DASHBOARD_RESET=1 refaz a linha de base.
 * @param {Array<any>} previous suítes já gravadas
 * @param {Array<any>} atuais suítes desta rodada
 * @returns {{ completa: boolean, faltando: string[] }}
 */
function medirCobertura(previous, atuais) {
    const pares = (/** @type {Array<any>} */ suites) => {
        const out = new Set();
        for (const suite of suites) {
            for (const caso of suite.cases || []) {
                for (const run of caso.runs || []) {
                    out.add(`${suite.id}/${caso.id} · ${run.profile} · ${run.browser}`);
                }
            }
        }
        return out;
    };
    const rodados = pares(atuais);
    const faltando = [...pares(previous)].filter((k) => !rodados.has(k));
    return { completa: faltando.length === 0, faltando };
}

/**
 * Anexo JSON que um teste de tests/e2e/specs/acesso deixa para o painel. Sem o anexo, null.
 * @param {any} result
 * @param {string} name
 */
function readJsonAttachment(result, name) {
    const attachment = (result.attachments || []).find((a) => a.name === name && a.body);
    if (!attachment) return null;
    try {
        return JSON.parse(Buffer.from(attachment.body).toString('utf-8'));
    } catch {
        return null;
    }
}

/**
 * Resultado da conferência de acesso (suíte Acesso): { objeto, esperado, encontrado },
 * anexado pelo teste como "acesso". Nos demais testes, null.
 *
 * Quando o usuário lê o objeto, vem também "campos", do anexo "acesso-campos":
 * { regra, encontrado, rotulos, tipos, natureza, divergencias } (fieldAccess, em utils/acesso.js).
 * Rótulo, tipo e natureza saem da execução e vão para o caso (fieldInfoOf).
 * @param {any} result
 */
function readAccess(result) {
    const access = readJsonAttachment(result, 'acesso');
    const campos = access && readJsonAttachment(result, 'acesso-campos');
    return campos ? { ...access, campos } : access;
}

/**
 * Rótulo, tipo e natureza dos campos de um objeto, reunidos das execuções do caso.
 *
 * São do objeto, não do perfil: gravados em cada execução, o mesmo "Annual Revenue" se
 * repetia uma vez por perfil, e eram dois terços do que os campos ocupam no arquivo. Aqui
 * ficam uma vez por caso, que na suíte Acesso é um objeto.
 * @param {Array<any>} runs execuções do caso nesta rodada
 * @returns {{ rotulos: Record<string, string>, tipos: Record<string, string>, natureza: Record<string, string> } | null}
 */
function fieldInfoOf(runs) {
    const comCampos = runs.map((r) => r.access && r.access.campos).filter(Boolean);
    if (comCampos.length === 0) return null;
    return {
        rotulos: Object.assign({}, ...comCampos.map((c) => c.rotulos)),
        tipos: Object.assign({}, ...comCampos.map((c) => c.tipos)),
        natureza: Object.assign({}, ...comCampos.map((c) => c.natureza))
    };
}

/**
 * O "access" que fica na execução: o que é do perfil. Rótulo, tipo e natureza vão para o caso.
 * @param {any} access
 */
function runAccess(access) {
    if (!access.campos) return access;
    const { rotulos, tipos, natureza, ...campos } = access.campos;
    return { ...access, campos };
}

/**
 * As mensagens do expect() vêm com códigos ANSI de cor (\x1b[31m…), que no terminal viram
 * cor e no HTML do painel viram lixo visível. Um timeout não tem cor nenhuma, então isso só
 * aparece quando uma asserção falha — que é justamente quando a mensagem mais importa.
 * @param {string | null} s
 */
const stripAnsi = (s) => (typeof s === 'string' ? s.replace(/\x1b\[[0-9;]*m/g, '') : s);

/**
 * Desfecho esperado do caso neste perfil, declarado pelo teste com esperado()
 * (tests/e2e/utils/expectativa.js). Um caso que não declara nada vale como "permitido":
 * a esmagadora maioria dos cenários só roda onde deveria funcionar.
 *
 * A anotação é empurrada em tempo de execução, então vem no result; versões mais
 * antigas do Playwright só a expõem no test, e a busca cobre os dois.
 * @param {any} test
 * @param {any} result
 * @returns {'permitido' | 'negado'}
 */
function readExpected(test, result) {
    const annotations = [...(result.annotations || []), ...(test.annotations || [])];
    const found = annotations.find((a) => a && a.type === 'esperado');
    return found && found.description === 'negado' ? 'negado' : 'permitido';
}

/**
 * Nome da suíte: o describe externo mais curto do arquivo. Um arquivo pode ter um describe
 * externo por perfil ("Lead - Captação de Leads (PROJ-01)" e "... (PROJ-01) - SDR"): o
 * mais curto é o nome comum, e o resto vira critério do caso.
 * @param {string[]} externos
 * @returns {string}
 */
function nomeDaSuite(externos) {
    const nomes = externos.filter(Boolean);
    return nomes.length ? nomes.reduce((a, b) => (b.length < a.length ? b : a)) : '';
}

/**
 * Critério de aceite do caso: os describes abaixo do externo ("AC2 - Tabela Estado do
 * Usuário"). Sem describe interno, a parte do externo que sobra além do nome da suíte
 * ("SDR"). Caso solto, direto na suíte: vazio, e o painel mostra como "Sem critério".
 * @param {string[]} describes do mais externo ao mais interno
 * @param {string} suiteName
 * @returns {string}
 */
function criterioDoCaso(describes, suiteName) {
    const [externo = '', ...internos] = describes;
    if (internos.length) return internos.join(' › ');
    if (externo && externo !== suiteName && externo.startsWith(suiteName)) {
        return externo.slice(suiteName.length).replace(/^\s*[-–:]\s*/, '').trim();
    }
    return externo === suiteName ? '' : externo;
}

/**
 * Motivo de um caso pulado: a descrição do test.skip() ou test.fixme(). O painel mostra o
 * motivo no detalhe, para separar "pulou porque falta perfil" de "pulou porque a org não serve".
 * @param {any} test
 * @param {any} result
 * @returns {string | null}
 */
function readSkipReason(test, result) {
    if (result.status !== 'skipped') return null;
    const annotations = [...(result.annotations || []), ...(test.annotations || [])];
    const found = annotations.find((a) => a && (a.type === 'skip' || a.type === 'fixme'));
    if (!found) return null;
    return found.description || (found.type === 'fixme' ? 'Marcado como fixme.' : null);
}

/**
 * Em quais perfis este caso DEVERIA rodar, segundo as tags dele.
 *
 * É a mesma regra do profileGrep (tests/e2e/utils/perfis.js): o caso roda no perfil cuja tag
 * ele carrega e, quando não carrega tag de perfil nenhuma, só no perfil padrão.
 *
 * Sem isso o painel não distingue duas coisas bem diferentes: "este caso não se aplica a esse
 * perfil" (normal, é a matriz esparsa) e "deveria ter rodado e não rodou" (lacuna de cobertura,
 * que merece alerta). Um caso que não rodou simplesmente não existe nos dados, e o silêncio
 * das duas situações é idêntico.
 * @param {any} test
 * @returns {string[]} nomes dos perfis
 */
function readAplicavel(test) {
    const tags = Array.isArray(test.tags) ? test.tags : [];
    const perfis = allProfiles();
    const temTagDePerfil = perfis.some((p) => tags.includes(`@${p.id}`));
    return perfis.filter((p) => tags.includes(`@${p.id}`) || (!temTagDePerfil && p.padrao)).map((p) => p.nome);
}

class DashboardReporter {
    constructor() {
        /** @type {Array<any>} */
        this.results = [];
        this.startedAt = new Date();
        /** @type {number | null} */
        this.workers = null;
    }

    /**
     * O Playwright entrega aqui a configuração já resolvida. O painel explica a duração da
     * suíte citando o paralelismo, e esse número precisa vir daqui: escrito à mão no template
     * ele vira afirmação falsa no dia em que a config mudar — e ninguém confere uma legenda.
     * @param {any} config
     */
    onBegin(config) {
        this.workers = typeof config?.workers === 'number' ? config.workers : null;
    }

    /**
     * @param {any} test
     * @param {any} result
     */
    onTestEnd(test, result) {
        const { id, name } = getCaseId(test.title);
        // Os describes do caso, do mais externo ao mais interno. O externo dá o nome da suíte;
        // os internos, o critério de aceite (ver criterioDoCaso).
        /** @type {string[]} */
        const describes = [];
        for (let s = test.parent; s && s.type === 'describe'; s = s.parent) describes.unshift(s.title);
        const describeTitle = describes[0] || '';
        const suiteSlug = suiteSlugFromFile(test.location.file);
        const { name: project, profile, browser } = getProject(test);
        const evidences = readEvidenceFiles(suiteSlug, id, project);

        this.results.push({
            caseId: id,
            name,
            suite: describeTitle,
            describes,
            suiteSlug,
            // Suítes de tests/e2e/specs/acesso conferem permissões; as demais são fluxos de negócio.
            suiteKind: path.basename(path.dirname(test.location.file)) === 'acesso' ? 'acesso' : 'fluxo',
            project,
            profile,
            browser,
            status: result.status,
            duration: result.duration,
            retry: result.retry,
            startedAt: result.startTime instanceof Date ? result.startTime.toISOString() : null,
            error: result.error ? stripAnsi(result.error.message) : null,
            skipReason: readSkipReason(test, result),
            evidences,
            records: readRecords(result),
            access: readAccess(result),
            // Só na suíte Conjuntos de permissão: { esperado, encontrado }.
            conjuntos: readJsonAttachment(result, 'conjuntos'),
            // "permitido" ou "negado": o que o caso afirmava neste perfil. O painel cruza
            // isso com o status para separar "está barrado, e deve estar" de uma falha real.
            esperado: readExpected(test, result),
            // Perfis em que este caso deveria rodar, lidos das tags.
            aplicavel: readAplicavel(test),
            steps: (result.steps || []).filter((s) => s.category === 'test.step').map((s) => s.title)
        });
    }

    /**
     * Acumula o resultado agregado desta rodada em painel-dados/run-history.json
     * (card "Rodadas" do painel).
     * @param {number} total
     * @param {number} passed
     * @param {number} flaky execuções que só passaram no retry
     * @param {{ total: number, passed: number, skipped?: number }} fluxos o mesmo, só das execuções de fluxos (sem as puladas)
     *   (a tendência do painel não mistura as conferências de acesso)
     * @param {number} durationMs quanto a rodada levou, de ponta a ponta
     * @param {boolean} completa se cobriu todo par que o painel já conhecia
     */
    appendRunHistory(total, passed, flaky, fluxos, durationMs, completa) {
        /** @type {Array<any>} */
        let history = [];
        try {
            history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        } catch {
            history = [];
        }
        history.push({ date: this.startedAt.toISOString(), total, passed, flaky, completa, fluxos, durationMs });
        // Entradas gravadas antes do campo "completa" entram como completas: são antigas, poucas,
        // e descartá-las por omissão de um campo que não existia na época seria perder histórico real.
        const completas = history.filter((r) => r.completa !== false);
        const parciais = history.filter((r) => r.completa === false);
        history = [...completas.slice(-HISTORY_MAX_COMPLETE), ...parciais.slice(-HISTORY_MAX_PARTIAL)].sort((a, b) =>
            String(a.date).localeCompare(String(b.date))
        );
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
        return history;
    }

    /**
     * Mescla as suítes desta rodada com as já registradas em dashboard-data.json.
     *
     * Rodar um cenário isolado (ou filtrar por perfil ou navegador) traz só uma fatia
     * dos resultados; sem mesclar, o painel perderia todo o resto. A substituição é
     * feita no menor grão que uma rodada consegue produzir — suíte + caso + projeto
     * (perfil × navegador) — então rodar só o CT0001 no SDR - Google Chrome atualiza
     * exatamente essa execução e preserva os outros perfis, navegadores e casos.
     *
     * Execuções gravadas antes dos perfis entram como do perfil padrão (normalizeRun).
     *
     * Para regerar do zero (ex: depois de remover um caso do código), rode com
     * DASHBOARD_RESET=1 ou apague painel-dados/dashboard-data.json.
     * @param {Array<any>} suites suítes desta rodada
     * @param {Array<any>} previous suítes já em disco (readPreviousSuites)
     * @returns {Array<any>} suítes mescladas com o que já estava em disco
     */
    mergeSuites(suites, previous) {
        if (!previous.length) return suites;

        const merged = new Map(
            previous.map((s) => [s.id, { ...s, cases: s.cases.map((c) => ({ ...c, runs: c.runs.map(normalizeRun) })) }])
        );

        for (const suite of suites) {
            const target = merged.get(suite.id);
            if (!target) {
                merged.set(suite.id, suite);
                continue;
            }
            // O nome exibido vem do describe e pode ter sido renomeado.
            target.name = suite.name;
            target.kind = suite.kind;

            const casesById = new Map(target.cases.map((c) => [c.id, { ...c, runs: [...c.runs] }]));
            for (const testCase of suite.cases) {
                const existing = casesById.get(testCase.id);
                if (!existing) {
                    casesById.set(testCase.id, testCase);
                    continue;
                }
                existing.title = testCase.title;
                existing.criterio = testCase.criterio;
                // A aplicabilidade vem das tags do código: a rodada mais recente manda, mesmo
                // que tenha sido parcial — se uma tag mudou, é essa a verdade nova.
                existing.aplicavel = testCase.aplicavel;
                // Rótulos e tipos se somam: uma rodada parcial, de um perfil que não vê um
                // campo, não pode apagar o nome dele. A natureza é do objeto e vale a mais recente.
                if (testCase.campos) {
                    existing.campos = {
                        rotulos: { ...(existing.campos && existing.campos.rotulos), ...testCase.campos.rotulos },
                        tipos: { ...(existing.campos && existing.campos.tipos), ...testCase.campos.tipos },
                        natureza: testCase.campos.natureza
                    };
                }
                // Cada projeto (perfil × navegador) é uma entrada: a desta rodada substitui a anterior.
                const runsByProject = new Map(existing.runs.map((r) => [r.project, r]));
                for (const run of testCase.runs) {
                    // O merge é o ponto em que o resultado velho encontra o novo: é aqui, e só
                    // aqui, que dá para empilhar o passado sem guardar a rodada inteira.
                    const anterior = runsByProject.get(run.project);
                    if (anterior) {
                        run.historico = [
                            ...(anterior.historico || []),
                            // O retry entra para o ranking de casos que oscilam: "passou" no
                            // histórico não diz se foi de primeira ou só na segunda tentativa.
                            {
                                date: anterior.startedAt,
                                status: anterior.status,
                                durationMs: anterior.durationMs,
                                retry: anterior.retry
                            }
                        ].slice(-RUN_HISTORY_MAX);
                    }
                    runsByProject.set(run.project, run);
                }
                existing.runs = [...runsByProject.values()].sort(runOrder);
            }
            target.cases = [...casesById.values()];
        }

        return [...merged.values()];
    }

    async onEnd() {
        // 'playwright test --list' e filtros que não encontram nenhum teste também disparam
        // onEnd. Sem esta guarda, a rodada vazia entraria no histórico como 0/0 (um ponto de
        // 0%) e o painel seria remontado sem nenhum caso novo.
        if (this.results.length === 0) {
            console.log('Nenhum teste executado: painel e histórico mantidos como estavam.');
            return;
        }

        const finishedAt = new Date();

        // Para o resumo, cada caso (suíte + projeto + CT) conta uma vez só, pelo resultado
        // da ÚLTIMA tentativa (o retry que passou não deve aparecer como falha no total).
        // O erro da 1ª tentativa é guardado à parte: num caso instável (flaky) ele é a única
        // pista do que falhou, já que a tentativa final passou.
        /** @type {Map<string, any>} */
        const finalByKey = new Map();
        /** @type {Map<string, string | null>} */
        const firstErrorByKey = new Map();
        const keyOf = (/** @type {any} */ r) => `${r.suiteSlug}::${r.project}::${r.caseId}`;
        for (const r of this.results) {
            const key = keyOf(r);
            const current = finalByKey.get(key);
            if (!current || r.retry >= current.retry) finalByKey.set(key, r);
            if (r.retry === 0) firstErrorByKey.set(key, r.error);
        }
        const finalResults = [...finalByKey.values()];
        const total = finalResults.length;
        const passed = finalResults.filter((r) => r.status === 'passed').length;
        // Flaky: falhou na 1ª tentativa e só passou no retry.
        const flaky = finalResults.filter((r) => r.status === 'passed' && r.retry > 0).length;

        // Agrupa por suíte (um arquivo de spec) e, dentro de cada uma, por caso de teste
        // (CTxxxx), reunindo as execuções em cada projeto (perfil × navegador). Agrupar pelo
        // describe imediato quebrava as suítes com um describe por critério de aceite: todos
        // os grupos tinham o mesmo id (o do arquivo) e o merge os fundia numa suíte só, com o
        // nome do último critério.
        /** @type {Map<string, Map<string, any[]>>} */
        const bySuite = new Map();
        for (const r of finalResults) {
            const byCase = bySuite.get(r.suiteSlug) ?? new Map();
            bySuite.set(r.suiteSlug, byCase);
            const runs = byCase.get(r.caseId) ?? [];
            byCase.set(r.caseId, runs);
            runs.push(r);
        }

        /* ---------------------------------------------------------------
         * dashboard-data.json — estrutura consumida pelo dashboard de QA.
         * Cada caso carrega uma execução por projeto (runs[]): cada perfil e
         * navegador em que o caso roda.
         * ------------------------------------------------------------- */
        const suitesForDashboard = [...bySuite.entries()].map(([suiteSlug, byCase]) => {
            const { suiteKind } = [...byCase.values()][0][0];
            const suiteName = nomeDaSuite([...byCase.values()].map((runs) => runs[0].suite)) || suiteSlug;
            const cases = [...byCase.entries()].map(([caseId, runs]) => ({
                id: caseId,
                title: runs[0].name,
                criterio: criterioDoCaso(runs[0].describes || [], suiteName),
                // Vem das tags, não das execuções: é o que o caso deveria cobrir, não o que cobriu.
                aplicavel: runs[0].aplicavel || [],
                // Só na suíte Acesso: { rotulos, tipos, natureza } dos campos do objeto.
                ...(fieldInfoOf(runs) ? { campos: fieldInfoOf(runs) } : {}),
                runs: runs
                    .slice()
                    .sort(runOrder)
                    .map((r) => ({
                        project: r.project,
                        profile: r.profile,
                        browser: r.browser,
                        status: r.status,
                        esperado: r.esperado,
                        durationMs: r.duration,
                        startedAt: r.startedAt,
                        error: r.error,
                        ...(r.skipReason ? { skipReason: r.skipReason } : {}),
                        steps: r.steps,
                        evidences: r.evidences,
                        records: r.records,
                        // Só na suíte Acesso: { objeto, esperado, encontrado, campos? }.
                        ...(r.access ? { access: runAccess(r.access) } : {}),
                        ...(r.conjuntos ? { conjuntos: r.conjuntos } : {}),
                        // Nº de retries usados até o resultado final (0 = resolveu de primeira).
                        retry: r.retry,
                        firstError: r.retry > 0 ? (firstErrorByKey.get(keyOf(r)) ?? null) : null
                    }))
            }));
            return { id: suiteSlug, name: suiteName, kind: suiteKind, cases };
        });

        const flowResults = finalResults.filter((r) => r.suiteKind === 'fluxo');
        const previous = readPreviousSuites();
        const { completa, faltando } = medirCobertura(previous, suitesForDashboard);
        if (!completa) {
            // Dizer QUAL par faltou evita a dúvida de sempre: foi filtro meu, ou sobrou um
            // caso fantasma nos dados de um cenário que já saiu do código?
            const amostra = faltando.slice(0, 3).join('; ') + (faltando.length > 3 ? '; …' : '');
            console.log(
                `Rodada parcial: ${faltando.length} ${faltando.length === 1 ? 'execução conhecida não rodou' : 'execuções conhecidas não rodaram'} (${amostra}).`
            );
        }
        const history = this.appendRunHistory(
            total,
            passed,
            flaky,
            // Pulados (test.skip/fixme) ficam fora do total da tendência: não rodaram, então não
            // aprovam nem reprovam. O número vai à parte, para a rodada não parecer menor sem motivo.
            {
                total: flowResults.filter((r) => r.status !== 'skipped').length,
                passed: flowResults.filter((r) => r.status === 'passed').length,
                skipped: flowResults.filter((r) => r.status === 'skipped').length
            },
            finishedAt.getTime() - this.startedAt.getTime(),
            completa
        );
        const mergedSuites = this.mergeSuites(suitesForDashboard, previous);

        const dashboardData = {
            meta: {
                lastRunAt: finishedAt.toISOString(),
                // Paralelismo real desta rodada, para o painel não precisar afirmar um número.
                workers: this.workers,
                // União dos navegadores e perfis presentes nos dados mesclados: uma rodada filtrada
                // por projeto não pode sumir com a coluna do outro navegador ou perfil no painel.
                ...dimensions(mergedSuites)
            },
            runs: history,
            suites: mergedSuites
        };
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(DATA_FILE, JSON.stringify(dashboardData, null, 2), 'utf-8');
        console.log(`Dados do dashboard gerados em: ${DATA_FILE}`);

        await this.rebuildDashboard();
    }

    /**
     * Remonta test-evidence/qa-dashboard.html com os dados desta rodada, para o painel
     * local nunca ficar para trás (~10s: gera os thumbnails num Chrome headless).
     * Desligue com DASHBOARD_BUILD=0. Uma falha aqui não derruba a execução dos testes:
     * o painel é acessório, e o build pode ser refeito com "node scripts/painel/build.js".
     */
    async rebuildDashboard() {
        if (process.env.DASHBOARD_BUILD === '0') return;
        try {
            const { outputFile, sizeMb } = await buildDashboard();
            console.log(`Painel de QA atualizado em: ${outputFile} (${sizeMb} MB)`);
        } catch (error) {
            console.warn(`Painel de QA não foi atualizado: ${error instanceof Error ? error.message : error}`);
        }
    }
}

module.exports = DashboardReporter;
