// @ts-check
/**
 * Monta o dashboard de QA (HTML único e autocontido) a partir dos dados reais
 * gerados pelo reporter da suíte:
 *
 *   painel-dados/dashboard-data.json  → suítes, casos, execuções por navegador
 *   test-evidence/<suíte>/<CT>/<nav>/  → screenshots de evidência
 *
 * As evidências são reduzidas e convertidas em JPEG embutido (data URI) para o
 * arquivo final funcionar sozinho, sem depender da pasta test-evidence.
 *
 * Uso: node scripts/painel/build.js
 *
 * Também roda sozinho ao fim de toda execução do Playwright, chamado pelo
 * reporter (tests/e2e/reporters/dashboard-reporter.js).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { allProfiles, normalizeRun, dimensions } = require('../../tests/e2e/utils/perfis');
const { runSf } = require('../../tests/e2e/utils/sfAuth');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(ROOT, 'test-evidence');
// A memória do painel fica fora de test-evidence/, que é tudo descartável (ver o reporter).
const DATA_FILE = path.join(ROOT, 'painel-dados', 'dashboard-data.json');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');
// Comportamento do painel, injetado no <script> do template. Fica fora do HTML para o
// ESLint do projeto alcançá-lo — erro de sintaxe aqui deixa o painel em branco.
const APP_FILE = path.join(__dirname, 'app.js');
const OUTPUT_FILE = path.join(EVIDENCE_DIR, 'qa-dashboard.html');
const CONFIG_FILE = path.join(ROOT, 'dashboard.config.json');
// Bugs encontrados pela automação. É um registro manual: sozinha, a automação não distingue
// um bug do sistema de uma falha do próprio teste. Opcional.
const BUGS_FILE = path.join(ROOT, 'bugs.json');
// Logo da CodeArt (versão clara, fundo transparente) exibido no cabeçalho escuro do painel.
const LOGO_FILE = path.join(__dirname, 'assets', 'logo-codeart.png');
// Versão quadrada da logo, em um quadro branco arredondado de 64px, usada como ícone da aba.
const FAVICON_FILE = path.join(__dirname, 'assets', 'favicon-codeart.png');

/**
 * Lê dashboard.config.json (projeto e QA responsável exibidos no painel). O arquivo é
 * opcional: sem ele, ou com um campo vazio, o painel só omite aquela informação.
 * @returns {{ projeto: string, qaResponsavel: string }}
 */
/**
 * Dados da org em que os testes rodaram, lidos no momento do build.
 *
 * Isso aparece no cabeçalho do painel, ou seja, em toda captura de tela que circula por e-mail
 * e reunião. Deixar fixo no template é garantir que um dia o relatório vai afirmar a org errada
 * — e ninguém confere um chip.
 *
 * O release sazonal ("Summer '26") sai do próprio endpoint /services/data/ da org: a última
 * entrada da lista é a versão que ela roda. Vir da org é o que importa — uma tabela de
 * "API 67.0 = tal release" guardada aqui envelheceria a cada estação.
 *
 * Nada aqui é obrigatório: se a org não responder (build offline, CI sem sessão), o painel
 * mostra o que deu para ler. Afirmar menos é melhor que afirmar errado.
 */
async function readOrgInfo() {
    const alias = (allProfiles().find((p) => p.padrao) || {}).usuario || '';
    const info = {};

    // O commit não depende da org: diz qual versão do código produziu estes resultados, que é
    // metade da resposta para "isso quebrou por nossa causa ou foi a plataforma?".
    try {
        info.commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        // fora de um repositório git, ou git indisponível
    }
    if (!alias) return info;
    info.alias = alias;

    // A URL da instância vem da CLI; o token dela vem mascarado de propósito, e é bom que venha:
    // a parte autenticada fica na CLI, que já sabe renovar a sessão, e nenhum token passa por
    // este código nem pelo log do build.
    let instanceUrl = '';
    try {
        instanceUrl = JSON.parse(runSf(['org', 'display', '--json'], alias, 'localizar a instância da org')).result.instanceUrl;
    } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        console.warn(`Instância da org não lida; o painel mostra só o alias. (${motivo.split(/\r?\n/)[0]})`);
    }

    // Sai junto para o scripts/novo-bug.js montar o link do registro que a falha deixou na org.
    if (instanceUrl) info.instanceUrl = instanceUrl;

    // /services/data/ é público (não pede autenticação): lista todas as versões da API com o
    // rótulo sazonal, e a última é a que a org está rodando.
    if (instanceUrl) {
        try {
            const resposta = await fetch(new URL('/services/data/', instanceUrl));
            if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
            // A lista termina com um apelido ("Latest Release", url /services/data/latest) que
            // repete a última versão sem o rótulo sazonal; só as entradas /vNN.N têm o release.
            const versoes = (await resposta.json()).filter((v) => /\/v\d+\.\d+$/.test(v.url));
            const atual = versoes[versoes.length - 1];
            info.release = atual.label;
            info.apiVersion = atual.version;
        } catch (error) {
            const motivo = error instanceof Error ? error.message : String(error);
            console.warn(`Release da org não lido. (${motivo.split(/\r?\n/)[0]})`);
        }
    }

    // Nome e edição pela CLI, que carrega a sessão autenticada.
    try {
        // As aspas são obrigatórias: runSf roda com shell: true, que concatena os argumentos
        // sem escapar, e a query se despedaça nos espaços (mesma armadilha do createRecordAs).
        const out = runSf(
            ['data', 'query', '--query', '"SELECT Name, OrganizationType, InstanceName FROM Organization"', '--json'],
            alias,
            'ler os dados da org'
        );
        const r = JSON.parse(out.slice(out.indexOf('{'))).result.records[0];
        info.nome = r.Name;
        info.edicao = r.OrganizationType;
        info.instancia = r.InstanceName;
    } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        console.warn(`Nome e edição da org não lidos. (${motivo.split(/\r?\n/)[0]})`);
    }

    return info;
}

function readConfig() {
    if (!fs.existsSync(CONFIG_FILE)) return { projeto: '', qaResponsavel: '' };
    let config;
    try {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (error) {
        throw new Error(`dashboard.config.json inválido: ${error instanceof Error ? error.message : error}`);
    }
    return {
        projeto: String(config.projeto ?? '').trim(),
        qaResponsavel: String(config.qaResponsavel ?? '').trim()
    };
}

// Largura/qualidade do thumbnail embutido — mantém o HTML final bem abaixo do
// limite de tamanho do artefato mesmo com ~80 screenshots.
const THUMB_WIDTH = 980;
const THUMB_QUALITY = 0.62;

// Tipo MIME das imagens que o build sabe embutir (as evidências da automação são PNG; as
// anexadas a um bug podem vir de qualquer ferramenta de captura).
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/**
 * Converte as imagens de evidência em JPEG reduzido usando o próprio canvas do
 * navegador (evita dependência de biblioteca de imagem no projeto).
 * @param {string[]} absPaths
 * @returns {Promise<Map<string, string>>} caminho absoluto → data URI
 */
async function buildThumbnails(absPaths) {
    const out = new Map();
    if (absPaths.length === 0) return out;

    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');

    for (const absPath of absPaths) {
        if (!fs.existsSync(absPath)) continue;

        const type = IMAGE_TYPES[path.extname(absPath).toLowerCase()] || 'image/png';
        const source = `data:${type};base64,${fs.readFileSync(absPath).toString('base64')}`;
        const thumb = await page.evaluate(
            async ({ source, width, quality }) => {
                const img = new Image();
                img.src = source;
                await img.decode();

                const scale = Math.min(1, width / img.naturalWidth);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);

                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                return canvas.toDataURL('image/jpeg', quality);
            },
            { source, width: THUMB_WIDTH, quality: THUMB_QUALITY }
        );

        out.set(absPath, thumb);
    }

    await browser.close();
    return out;
}

// Valores aceitos nos campos de classificação do bug (os mesmos do modelo de registro de bug
// da equipe). A comparação ignora maiúsculas e acentos, e o painel exibe a forma escrita aqui.
const BUG_OPTIONS = {
    prioridade: ['Alta', 'Média', 'Baixa'],
    dispositivo: ['Mobile', 'Desktop'],
    frequencia: ['Sempre reproduz', 'Às vezes', 'Aconteceu 1 vez']
};

const fold = (/** @type {string} */ s) =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
const text = (/** @type {unknown} */ v) => String(v ?? '').trim();

/**
 * Lista de itens de texto (passos, resultados). Aceita uma lista ou um texto com um item por
 * linha, e tira a numeração/marcador colados do modelo ("1.", "2)", "*", "-").
 * @param {unknown} value
 * @returns {string[]}
 */
function textList(value) {
    const items = Array.isArray(value) ? value.map(text) : text(value).split(/\r?\n/);
    return items.map((item) => item.trim().replace(/^(\d+[.)]|[-*•])\s*/, '')).filter(Boolean);
}

/**
 * Lê bugs.json: uma lista de bugs, com os campos do modelo de registro de bug da equipe.
 * Só "id", "titulo" e "status" são obrigatórios; o painel mostra "Não informado" no resto.
 *
 * - id, titulo: identificação. O painel exibe "[area] titulo";
 * - status: "aberto" ou "corrigido";
 * - area: módulo afetado (ex.: "Task"). Vazio: usa o nome da suíte do caso vinculado;
 * - tipo: padrão "Bug";
 * - prioridade: Alta / Média / Baixa (urgência de corrigir);
 * - caso: cenário onde o bug ocorreu, no formato "<suíte>/<CT>" (ex.: "lead/CT0005"), onde a
 *   suíte é o nome do arquivo de spec sem ".suite.spec.js";
 * - regressaoDe: id de um bug anterior que este defeito repete (ex.: "BUG-001");
 * - encontradoEm: data em que a automação encontrou o bug (AAAA-MM-DD);
 * - corrigidoEm: data em que a correção foi confirmada (AAAA-MM-DD);
 * - massaDeTeste, ambiente, dispositivo (Mobile / Desktop), perfilUsuario, navegador,
 *   linkRegistro (URL do registro no Salesforce);
 * - frequencia: Sempre reproduz / Às vezes / Aconteceu 1 vez;
 * - descricao, impacto: texto livre;
 * - passos, resultadoEsperado, resultadoEncontrado: lista de textos (ou um texto, um item por linha);
 * - evidencias: lista de prints/vídeos. Cada item é uma URL (ex.: vídeo no Drive) ou o caminho
 *   de uma imagem a partir da raiz do projeto (ex.: "test-evidence/bugs/BUG-001/tela.png"),
 *   que o build embute no painel.
 * @returns {Array<Record<string, any>>}
 */
function readBugs() {
    if (!fs.existsSync(BUGS_FILE)) return [];
    let bugs;
    try {
        bugs = JSON.parse(fs.readFileSync(BUGS_FILE, 'utf-8'));
    } catch (error) {
        throw new Error(`bugs.json inválido: ${error instanceof Error ? error.message : error}`);
    }
    if (!Array.isArray(bugs)) throw new Error('bugs.json precisa ser uma lista: [ ... ].');
    const seen = new Set();
    return bugs.map((bug, i) => {
        const label = `bugs.json, item ${i + 1}${bug && bug.id ? ` (${bug.id})` : ''}`;
        if (!bug || !bug.id || !bug.titulo) throw new Error(`${label}: "id" e "titulo" são obrigatórios.`);
        const id = text(bug.id);
        if (seen.has(id)) throw new Error(`${label}: o id "${id}" já foi usado em outro bug.`);
        seen.add(id);
        const status = text(bug.status).toLowerCase();
        if (status !== 'aberto' && status !== 'corrigido') {
            throw new Error(`${label}: "status" deve ser "aberto" ou "corrigido".`);
        }
        if (text(bug.regressaoDe) === id) {
            throw new Error(`${label}: "regressaoDe" aponta para o próprio bug.`);
        }

        /** @param {keyof typeof BUG_OPTIONS} field */
        const option = (field) => {
            const value = text(bug[field]);
            if (!value) return '';
            const match = BUG_OPTIONS[field].find((o) => fold(o) === fold(value));
            if (match) return match;
            const allowed = BUG_OPTIONS[field].map((o) => `"${o}"`);
            throw new Error(`${label}: "${field}" deve ser ${allowed.slice(0, -1).join(', ')} ou ${allowed.at(-1)}.`);
        };

        const evidencias = bug.evidencias ?? [];
        if (!Array.isArray(evidencias)) throw new Error(`${label}: "evidencias" precisa ser uma lista: [ ... ].`);

        return {
            id,
            titulo: text(bug.titulo),
            status,
            area: text(bug.area),
            tipo: text(bug.tipo) || 'Bug',
            prioridade: option('prioridade'),
            caso: text(bug.caso),
            // Id de um bug anterior que este defeito repete. O painel liga os dois nos dois
            // sentidos e conta a reincidência — defeito que volta é sinal de processo, não de
            // código, e sem o vínculo essa informação só existe na cabeça de quem registrou.
            regressaoDe: text(bug.regressaoDe),
            encontradoEm: text(bug.encontradoEm),
            // Gravado pelo scripts/fechar-bug.js quando a correção é confirmada. Sem ele, um bug
            // corrigido não diz quanto tempo ficou aberto nem quando parou de doer.
            corrigidoEm: text(bug.corrigidoEm),
            massaDeTeste: text(bug.massaDeTeste),
            ambiente: text(bug.ambiente),
            dispositivo: option('dispositivo'),
            perfilUsuario: text(bug.perfilUsuario),
            navegador: text(bug.navegador),
            linkRegistro: text(bug.linkRegistro),
            frequencia: option('frequencia'),
            descricao: text(bug.descricao),
            passos: textList(bug.passos),
            resultadoEsperado: textList(bug.resultadoEsperado),
            resultadoEncontrado: textList(bug.resultadoEncontrado),
            impacto: text(bug.impacto),
            evidencias: evidencias.map(text).filter(Boolean)
        };
    });
}

/**
 * Resolve as evidências anexadas a um bug: URL vira link; imagem local é embutida como
 * thumbnail; outro arquivo local (ex.: vídeo) não cabe no painel e fica só com o caminho.
 * @param {Record<string, any>} bug
 * @param {Map<string, string>} thumbs caminho absoluto → data URI
 */
function resolveBugEvidences(bug, thumbs) {
    return bug.evidencias.map((/** @type {string} */ ref) => {
        if (/^https?:\/\//i.test(ref)) {
            const last = ref.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() || ref;
            let name = last;
            try {
                name = decodeURIComponent(last);
            } catch {
                // "%" solto na URL: mostra o trecho como veio.
            }
            return { kind: 'link', name, url: ref };
        }
        const shown = ref.replace(/\\/g, '/');
        const name = path.basename(shown).replace(/\.[^.]+$/, '');
        if (!IMAGE_TYPES[path.extname(ref).toLowerCase()]) return { kind: 'file', name, path: shown };
        return { kind: 'image', name, path: shown, src: thumbs.get(path.resolve(ROOT, ref)) || null };
    });
}

/**
 * Avisa, sem interromper o build, sobre bugs que o painel não consegue exibir por inteiro.
 * @param {Array<Record<string, any>>} bugs
 * @param {Array<any>} suites
 */
function warnBugIssues(bugs, suites) {
    const caseKeys = new Set(suites.flatMap((s) => s.cases.map((/** @type {any} */ c) => `${s.id}/${c.id}`)));
    const bugIds = new Set(bugs.map((b) => b.id));
    for (const bug of bugs) {
        if (bug.caso && !caseKeys.has(bug.caso)) {
            console.warn(`bugs.json (${bug.id}): o caso "${bug.caso}" não está nos dados da automação.`);
        }
        if (bug.regressaoDe && !bugIds.has(bug.regressaoDe)) {
            console.warn(`bugs.json (${bug.id}): "regressaoDe" aponta para "${bug.regressaoDe}", que não existe no arquivo.`);
        }
        for (const ref of bug.evidencias) {
            if (/^https?:\/\//i.test(ref)) continue;
            if (!IMAGE_TYPES[path.extname(ref).toLowerCase()]) {
                console.warn(`bugs.json (${bug.id}): "${ref}" não é imagem e não é embutido no painel. Para vídeo, use um link.`);
            } else if (!fs.existsSync(path.resolve(ROOT, ref))) {
                console.warn(`bugs.json (${bug.id}): evidência não encontrada: ${ref}`);
            }
        }
    }
}

/**
 * Monta test-evidence/qa-dashboard.html a partir de dashboard-data.json.
 * @returns {Promise<{ outputFile: string, sizeMb: string, embedded: number, total: number }>}
 */
async function buildDashboard() {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(`Arquivo não encontrado: ${DATA_FILE}\nRode "npx playwright test" antes de montar o dashboard.`);
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    // Execuções gravadas antes dos perfis entram como do perfil padrão. Suítes gravadas antes do
    // campo "kind" são de acesso quando vêm de tests/e2e/specs/acesso (ids acesso, acesso-tela).
    for (const suite of data.suites) {
        suite.kind ??= /^acesso(-|$)/.test(suite.id) ? 'acesso' : 'fluxo';
        for (const testCase of suite.cases) testCase.runs = testCase.runs.map(normalizeRun);
    }
    Object.assign(data.meta, readConfig(), dimensions(data.suites));
    // Perfil na org de cada perfil da suíte, para a aba Perfis (o alias da CLI não entra no painel).
    data.meta.profileInfo = allProfiles().map((p) => ({ id: p.id, nome: p.nome, perfilSalesforce: p.perfilSalesforce }));
    data.meta.org = await readOrgInfo();
    const bugs = readBugs();
    warnBugIssues(bugs, data.suites);

    // O painel é publicado como artifact: um arquivo único, com teto de 16 MB. O que se embute
    // cresce com casos × perfis × navegadores, e é isso que estoura o limite primeiro — não o
    // número de casos. Print de execução verde, num perfil secundário, não tem leitor: ninguém
    // abre evidência do que passou como esperado. Entram no HTML:
    //   - execuções que falharam ou só passaram no retry (é onde se investiga)
    //   - fluxos negativos (esperado: negado), onde o print é a prova de que a trava existe
    //   - o perfil padrão, como referência do caminho feliz
    // As demais ficam só com o caminho do arquivo, que o painel mostra no lugar da miniatura.
    const PERFIL_PADRAO = (allProfiles().find((p) => p.padrao) || {}).nome;
    const deveEmbutir = (run) =>
        run.status !== 'passed' || run.retry > 0 || run.esperado === 'negado' || run.profile === PERFIL_PADRAO;

    const absPaths = [];
    for (const suite of data.suites) {
        for (const testCase of suite.cases) {
            for (const run of testCase.runs) {
                if (!deveEmbutir(run)) continue;
                for (const evidence of run.evidences) absPaths.push(path.join(EVIDENCE_DIR, evidence.path));
            }
        }
    }
    for (const bug of bugs) {
        for (const ref of bug.evidencias) {
            if (IMAGE_TYPES[path.extname(ref).toLowerCase()] && !/^https?:\/\//i.test(ref)) {
                absPaths.push(path.resolve(ROOT, ref));
            }
        }
    }

    console.log(`Gerando ${absPaths.length} thumbnails de evidência…`);
    const thumbs = await buildThumbnails(absPaths);

    let embedded = 0;
    for (const suite of data.suites) {
        for (const testCase of suite.cases) {
            for (const run of testCase.runs) {
                run.evidences = run.evidences.map((evidence) => {
                    const src = thumbs.get(path.join(EVIDENCE_DIR, evidence.path));
                    if (src) embedded += 1;
                    return { name: evidence.name, path: evidence.path, src: src || null };
                });
            }
        }
    }
    data.bugs = bugs.map((bug) => {
        const evidencias = resolveBugEvidences(bug, thumbs);
        embedded += evidencias.filter((e) => e.src).length;
        return { ...bug, evidencias };
    });

    if (!fs.existsSync(LOGO_FILE)) throw new Error(`Logo não encontrado: ${LOGO_FILE}`);
    const logo = `data:image/png;base64,${fs.readFileSync(LOGO_FILE).toString('base64')}`;
    if (!fs.existsSync(FAVICON_FILE)) throw new Error(`Ícone não encontrado: ${FAVICON_FILE}`);
    const favicon = `data:image/png;base64,${fs.readFileSync(FAVICON_FILE).toString('base64')}`;

    // Troca por função: com texto, o replace interpretaria "$&", "$1"... vindos de mensagens de erro.
    const template = fs.readFileSync(TEMPLATE_FILE, 'utf-8');
    const html = template
        .replace('__LOGO_CODEART__', () => logo)
        .replace('__FAVICON_CODEART__', () => favicon)
        // Os dados entram no app, e o app no template: o placeholder do DATA mora em
        // app.js desde que o comportamento saiu do HTML.
        .replace('__DASHBOARD_APP__', () =>
            fs.readFileSync(APP_FILE, 'utf-8').replace('"__DASHBOARD_DATA__"', () => JSON.stringify(data).replace(/</g, '\\u003c'))
        );

    fs.writeFileSync(OUTPUT_FILE, html, 'utf-8');

    const sizeMb = (Buffer.byteLength(html, 'utf-8') / 1024 / 1024).toFixed(2);
    return { outputFile: OUTPUT_FILE, sizeMb, embedded, total: absPaths.length };
}

// buildThumbnails é reaproveitado pelo gerador do guia do usuário (gerar-guia.js): o mesmo
// tratamento de imagem para as telas que entram no documento.
// readBugs sai daqui para o scripts/novo-bug.js validar o registro que acabou de montar com
// as mesmas regras do build: a validação precisa ser uma só, senão o script grava um bug que
// derruba o build na próxima rodada.
module.exports = { buildDashboard, buildThumbnails, readConfig, readOrgInfo, readBugs };

if (require.main === module) {
    buildDashboard()
        .then(({ outputFile, sizeMb, embedded, total }) => {
            console.log(`Evidências embutidas: ${embedded}/${total}`);
            console.log(`Dashboard gerado em: ${outputFile} (${sizeMb} MB)`);
        })
        .catch((error) => {
            console.error(error.message || error);
            process.exit(1);
        });
}
