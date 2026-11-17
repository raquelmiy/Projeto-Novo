/**
 * Comportamento do Painel de QA.
 *
 * Este arquivo é injetado dentro do <script> de dashboard-template.html pelo build
 * (scripts/painel/build.js). Ele viveu embutido no HTML até passar de 2.000 linhas — e
 * ficar fora do alcance do ESLint. Um erro de sintaxe ali não aparecia em lugar nenhum: o
 * painel abria em branco e o motivo só surgia no console do navegador. Separado, o lint do
 * projeto (e o hook de pre-commit) pegam antes.
 *
 * DATA é substituído pelo build com o conteúdo de painel-dados/dashboard-data.json.
 */
const DATA = "__DASHBOARD_DATA__";

/* ---------------------------------------------------------------------------
 * Modelo derivado
 * ------------------------------------------------------------------------- */
// Cor de cada navegador, atribuída na ordem em que eles aparecem nos dados. Era um mapa fixo
// com dois nomes dentro: qualquer navegador fora da lista caía em cinza, e o nome de um que
// não roda mais continuava no código.
const SERIES = Object.fromEntries((DATA.meta.browsers || []).map((b, i) => [b, `var(--series-${(i % 2) + 1})`]));
const seriesColor = (name) => SERIES[name] || 'var(--ink-muted)';

// A org vem do build (scripts/painel/build.js consulta a org de verdade). Ficava fixa aqui,
// e o chip do topo aparece em toda captura de tela que circula: um valor cravado no template é
// garantia de, um dia, o relatório afirmar a org errada sem ninguém perceber.
const ORG = DATA.meta.org || {};

// Pulado (test.skip/fixme) não é falha nem aprovação: o caso não rodou. Fica fora das taxas e
// dos alertas, e tem filtro próprio. Só as execuções que rodaram decidem o status do caso.
const isSkippedRun = (r) => r.status === 'skipped';
const isFailedRun = (r) => r.status !== 'passed' && !isSkippedRun(r);

function caseStatus(runs) {
  const executadas = runs.filter(r => !isSkippedRun(r));
  if (executadas.length === 0) return 'skipped';
  const failed = executadas.filter(isFailedRun).length;
  if (failed === 0) return 'passed';
  if (failed === executadas.length) return 'failed';
  return 'divergent';
}

// Instável (flaky): falhou na 1ª tentativa e só passou no retry.
const isFlakyRun = (r) => r.status === 'passed' && r.retry > 0;

// Bugs encontrados pela automação (registro manual em bugs.json, embutido pelo build).
const BUGS = Array.isArray(DATA.bugs) ? DATA.bugs : [];

// Rodadas completas (npm run test:e2e sem filtro), para a tendência e o card Rodadas. As
// gravadas antes do campo "completa" contam como completas quando tiveram o maior número de
// execuções entre elas: as demais foram um caso, uma suíte ou um navegador. "fluxos" separa
// as execuções dos fluxos; antes dele, toda rodada era só de fluxos.
const COMPLETE_ROUNDS = (() => {
  const legacyMax = Math.max(0, ...DATA.runs.filter(r => typeof r.completa !== 'boolean').map(r => r.total));
  return DATA.runs.flatMap(r => {
    const full = typeof r.completa === 'boolean' ? r.completa : r.total === legacyMax;
    const flows = r.fluxos || { total: r.total, passed: r.passed };
    // flaky e durationMs entram aqui para a tabela poder mostrar o que realmente varia: a taxa
    // vive em 100% numa suíte saudável, enquanto instabilidade e duração sobem devagar e é onde
    // a suíte apodrece sem ninguém perceber.
    return full && flows.total > 0
      ? [{ date: r.date, total: flows.total, passed: flows.passed, flaky: r.flaky, durationMs: r.durationMs }]
      : [];
  });
})();
const LAST_COMPLETE = COMPLETE_ROUNDS[COMPLETE_ROUNDS.length - 1];

// Resultado antigo: execução anterior à última rodada completa, ou seja, que não rodou nela
// (o caso foi filtrado, renomeado ou apagado do código). Sem rodada completa, nada é antigo.
const STALE_BEFORE = LAST_COMPLETE ? LAST_COMPLETE.date : null;
const isStaleRun = (r) => Boolean(STALE_BEFORE && r.startedAt && r.startedAt < STALE_BEFORE);

// Cada execução é um caso em um perfil (usuário) e um navegador. Os nomes dos perfis vêm na
// ordem de exibição (o padrão primeiro). Com um perfil só, o painel fala só em navegadores.
const PROFILES = DATA.meta.profiles || [];
const MULTI_BROWSER = (DATA.meta.browsers || []).length > 1;
const MULTI_PROFILE = PROFILES.length > 1;
const shortBrowser = (name) => name.replace('Google ', '').replace('Microsoft ', '');
const runLabel = (r) => (MULTI_PROFILE ? `${r.profile} · ${r.browser}` : r.browser);
const runShortLabel = (r) => (MULTI_PROFILE ? `${r.profile} · ${shortBrowser(r.browser)}` : shortBrowser(r.browser));

// O "perfilUsuario" do bugs.json é anterior a este vínculo e foi preenchido à mão: os
// registros existentes trazem o nome do perfil NA ORG ("System Administrator"), não o nome
// que o painel usa ("Admin"). Os três nomes valem — id, nome e perfil na org.
const PERFIL_POR_NOME = new Map();
for (const p of DATA.meta.profileInfo || []) {
  for (const alias of [p.id, p.nome, p.perfilSalesforce]) {
    if (alias) PERFIL_POR_NOME.set(String(alias).trim().toLowerCase(), p.nome);
  }
}

/**
 * O bug cobre esta execução?
 *
 * Sem "perfilUsuario" no bugs.json, o bug vale para o caso inteiro — é o registro de quem
 * roda com um perfil só. Com o perfil declarado, ele vale só para as execuções daquele
 * perfil: um bug aberto porque o SDR falha não pode esconder uma falha nova do Admin no
 * mesmo caso, que é o que acontecia quando o vínculo era só pelo caso.
 *
 * Um valor que não corresponde a nenhum perfil conhecido (texto livre, perfil que saiu do
 * projeto) volta a valer para o caso inteiro: estreitar o bug para nenhuma execução o faria
 * parar de cobrir a falha que ele explica, que é o oposto do que este campo serve.
 * @param {any} bug @param {any} run
 */
function bugCobre(bug, run) {
  const perfil = perfilDoBug(bug);
  return !perfil || perfil === run.profile;
}

/** @param {any} bug O perfil do painel a que o bug se refere, ou '' quando vale para todos. */
function perfilDoBug(bug) {
  return PERFIL_POR_NOME.get(String(bug.perfilUsuario || '').trim().toLowerCase()) || '';
}

function caseModel(suite, c, runs) {
  const records = [];
  runs.forEach(r => r.records.forEach(rec => records.push({ ...rec, project: runLabel(r) })));
  const bugs = BUGS.filter(b => b.caso === `${suite.id}/${c.id}`);
  const abertos = bugs.filter(b => b.status === 'aberto');
  const falhas = runs.filter(isFailedRun);
  return {
    suiteId: suite.id,
    suiteName: suite.name,
    // fluxo = fluxo de negócio (tests/e2e/specs/fluxos); acesso = conferência de permissões (tests/e2e/specs/acesso).
    kind: suite.kind || 'fluxo',
    id: c.id,
    title: c.title,
    // Critério de aceite: o describe interno do caso na spec ("AC2 - Tabela Estado do Usuário").
    criterio: c.criterio || '',
    runs,
    profiles: PROFILES.filter(p => runs.some(r => r.profile === p)),
    status: caseStatus(runs),
    flaky: runs.some(isFlakyRun),
    durationMs: Math.max(...runs.map(r => r.durationMs)),
    lastRunAt: runs.map(r => r.startedAt).filter(Boolean).sort().pop() || null,
    evidenceCount: runs.reduce((n, r) => n + r.evidences.length, 0),
    // O que uma execução do caso documenta. O total (evidenceCount) soma os perfis e cresce com
    // eles: 3 passos em 15 perfis viram 45, número que não diz nada sobre a cobertura do caso.
    evidencePerRun: runs.length ? Math.max(...runs.map(r => r.evidences.length)) : 0,
    records,
    bugs,
    // O bug aberto que explica a falha: o primeiro que cobre alguma execução falha. Com o caso
    // passando, o primeiro aberto do caso — é ele que o painel usa para pedir a confirmação.
    openBug: (falhas.length ? abertos.find(b => falhas.some(r => bugCobre(b, r))) : abertos[0]) || null,
    // Execuções que falharam e nenhum bug aberto cobre: são falha nova, mesmo que o caso já
    // tenha bug registrado em outro perfil.
    falhasSemBug: falhas.filter(r => !abertos.some(b => bugCobre(b, r))).length,
    stale: runs.some(isStaleRun)
  };
}

// Status exibido: um caso que falha por causa de um bug já aberto no bugs.json é "Bug
// conhecido", não uma falha nova. Os alertas e contadores de falha só contam as novas.
//
// "Conhecido" exige que TODA execução falha esteja coberta. Sobrando uma que nenhum bug
// aberto explica, o caso mantém o status real (falhou, ou parcial quando só parte dos perfis
// falhou) e volta para a fila de atenção — senão o painel afirmaria "já sabemos disso" sobre
// uma falha que ninguém viu.
const isFailedCase = (c) => c.status === 'failed' || c.status === 'divergent';
const caseState = (c) => (isFailedCase(c) && c.openBug && !c.falhasSemBug ? 'known' : c.status);
const isNewFailure = (c) => isFailedCase(c) && c.falhasSemBug > 0;

// byProfile: o mesmo caso visto só pelas execuções de um perfil (filtro "Perfil" da tabela).
const CASES = [];
DATA.suites.forEach(suite => {
  suite.cases.forEach(c => {
    const byProfile = {};
    PROFILES.forEach(p => {
      const runs = c.runs.filter(r => r.profile === p);
      if (runs.length) byProfile[p] = caseModel(suite, c, runs);
    });
    CASES.push({ ...caseModel(suite, c, c.runs), byProfile });
  });
});

// Indicadores de resultado contam só os fluxos de negócio: as conferências de acesso têm a
// aba Perfis (e entram no "Precisa de atenção" quando divergem).
const FLOW_CASES = CASES.filter(c => c.kind === 'fluxo');
const ACCESS_CASES = CASES.filter(c => c.kind === 'acesso');
const FLOW_SUITES = DATA.suites.filter(s => (s.kind || 'fluxo') === 'fluxo');
const ALL_RUNS = CASES.flatMap(c => c.runs);
const FLOW_RUNS = FLOW_CASES.flatMap(c => c.runs);
// As taxas contam só o que rodou: um caso pulado não aprova nem reprova.
const SKIPPED_RUNS = FLOW_RUNS.filter(isSkippedRun).length;
const TOTAL_RUNS = FLOW_RUNS.length - SKIPPED_RUNS;
const PASSED_RUNS = FLOW_RUNS.filter(r => r.status === 'passed').length;
// O nº de retries só é gravado desde que o painel passou a medir flakiness; execuções
// anteriores ficam fora dessa conta até rodarem de novo.
const MEASURED_RUNS = FLOW_RUNS.filter(r => !isSkippedRun(r) && typeof r.retry === 'number').length;
const FLAKY_RUNS = FLOW_RUNS.filter(isFlakyRun).length;
const NEW_FAILURES = FLOW_CASES.filter(isNewFailure);
const KNOWN_FAILURES = FLOW_CASES.filter(c => caseState(c) === 'known');

// Pill de um grupo de casos (suíte, perfil): passou; falhou só por bugs conhecidos; ou falhou.
function groupState(cases) {
  if (cases.every(c => c.status === 'skipped')) return 'skipped';
  const semFalha = (c) => c.status === 'passed' || c.status === 'skipped';
  if (cases.every(semFalha)) return 'passed';
  return cases.every(c => semFalha(c) || caseState(c) === 'known') ? 'known' : 'failed';
}
const TOTAL_EVIDENCE = CASES.reduce((n, c) => n + c.evidenceCount, 0);
const TOTAL_DURATION = ALL_RUNS.reduce((n, r) => n + r.durationMs, 0);

// Porcentagem que não esconde os extremos: com alguma ocorrência nunca mostra 0%, e sem
// todas nunca mostra 100% (ex.: 299 de 300 seria 99,7% → "100%").
function pct(part, whole) {
  if (!whole || !part) return 0;
  if (part === whole) return 100;
  return Math.min(99, Math.max(1, Math.round((part / whole) * 100)));
}
const SUCCESS_RATE = pct(PASSED_RUNS, TOTAL_RUNS);
const FLAKY_RATE = pct(FLAKY_RUNS, MEASURED_RUNS);

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function fmtSeconds(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
  // Arredonda o total antes de dividir: 119,6s vira "2m 0s", nunca "1m 60s".
  const total = Math.round(s);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// Data sem hora (AAAA-MM-DD). Montada à mão: new Date('2026-09-21') seria meia-noite UTC,
// que no fuso de Brasília ainda é o dia anterior.
function fmtDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.9L2.5 18a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>';
const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';

// O que varia entre as execuções de um mesmo caso. É isso que um resultado "divergente"
// está dizendo: falhou em parte das execuções e passou em outras.
//
// Derivado dos dados, não escrito à mão: a suíte já rodou em dois navegadores e hoje roda em
// um só, e a dica antiga ("navegadores ou perfis") continuou afirmando o que deixou de ser
// verdade. Com uma execução por caso não há como divergir, e o filtro nem aparece.
const DIMENSOES_DIVERGENTES = [
  MULTI_PROFILE && { um: 'perfil', varios: 'perfis' },
  DATA.meta.browsers.length > 1 && { um: 'navegador', varios: 'navegadores' }
].filter(Boolean);
const DIMENSAO_DIVERGENTE = DIMENSOES_DIVERGENTES.map(d => d.um).join(' e ') || null;
// Plural à parte: "perfil" não vira "perfils".
const DIMENSAO_DIVERGENTE_PLURAL = DIMENSOES_DIVERGENTES.map(d => d.varios).join(' e ');

const STATUS_META = {
  passed:    { label: 'Passou',     pill: 'pill-good',     icon: ICON_CHECK, color: 'var(--good)' },
  failed:    { label: 'Falhou',     pill: 'pill-critical', icon: ICON_X,     color: 'var(--critical)' },
  divergent: { label: DIMENSAO_DIVERGENTE ? `Difere por ${DIMENSAO_DIVERGENTE}` : 'Parcial',
               pill: 'pill-warning',  icon: ICON_ALERT, color: 'var(--warning)' },
  skipped:   { label: 'Pulado',     pill: 'pill-neutral',  icon: '',         color: 'var(--ink-muted)' },
  flaky:     { label: 'Instável',   pill: 'pill-warning',  icon: ICON_ALERT, color: 'var(--warning)' },
  // Falhou, mas o motivo já está registrado como bug aberto no bugs.json.
  known:     { label: 'Bug conhecido', pill: 'pill-warning', icon: ICON_ALERT, color: 'var(--warning)' },
  // Não rodou na última rodada completa: o resultado mostrado pode estar desatualizado.
  stale:     { label: 'Resultado antigo', pill: 'pill-neutral', icon: ICON_CLOCK, color: 'var(--ink-muted)' },
  aberto:    { label: 'Aberto',     pill: 'pill-critical', icon: ICON_ALERT, color: 'var(--critical)' },
  corrigido: { label: 'Corrigido',  pill: 'pill-good',     icon: ICON_CHECK, color: 'var(--good)' }
};
// Mensagens de erro do Playwright chegam com códigos de cor do terminal (ex.: "[31m").
// Os códigos de cor ANSI do expect() são caracteres de controle mesmo — é o que se quer encontrar.
// eslint-disable-next-line no-control-regex
const cleanError = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');
function statusPill(status) {
  const m = STATUS_META[status] || STATUS_META.skipped;
  return `<span class="pill ${m.pill}">${m.icon}${m.label}</span>`;
}

/* ---------------------------------------------------------------------------
 * Cabeçalho + resumo executivo
 * ------------------------------------------------------------------------- */
document.getElementById('envChipAlias').textContent = ORG.alias || '—';
document.getElementById('envChipExtra').textContent = ORG.edicao ? `· ${ORG.edicao}` : ``;

// Projeto e QA responsável vêm de dashboard.config.json (via build); campo vazio não aparece.
//
// "Última execução" se lê como "tudo nesta tela é dessa data", e não é: o merge preserva o
// resultado de rodadas anteriores, então convivem aqui casos de hoje e de semanas atrás. Quem
// avisa disso é o item "casos não rodaram na última rodada completa", na fila de atenção, e a
// marca "antigo" na linha de cada caso — o cabeçalho não repete a conta.
const FACTS = [
  ['Projeto', DATA.meta.projeto],
  ['QA responsável', DATA.meta.qaResponsavel],
  ['Última execução', DATA.meta.lastRunAt ? fmtDateTime(DATA.meta.lastRunAt) : ''],
  // Release e commit respondem, numa captura de tela, a pergunta que sempre aparece depois de
  // uma release sazonal do Salesforce: "quebrou por nossa causa ou foi a plataforma?". Sem eles
  // a resposta é sempre "deixa eu conferir". Somem sozinhos quando o dado não foi lido.
  ['Release da org', ORG.release ? ORG.release + (ORG.apiVersion ? ` · API ${ORG.apiVersion}` : '') : ''],
  ['Commit', ORG.commit || '']
].filter(([, value]) => value);
document.getElementById('projectFacts').innerHTML =
  FACTS.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');

// O painel mostra a execução mais recente de cada caso em cada navegador (dados mesclados),
// então os textos falam em "execuções", não em "rodada".
const RATE_TONE = SUCCESS_RATE === 100 ? 'good' : SUCCESS_RATE >= 90 ? 'accent' : 'critical';
const OPEN_BUGS = BUGS.filter(b => b.status === 'aberto').length;
const FIXED_BUGS = BUGS.length - OPEN_BUGS;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Tempo decorrido em vez de carimbo. "25/09/2026, 20:39" obriga o leitor a comparar com
 * o relógio para saber se a tela é de agora ou de três semanas atrás — e é essa a conta
 * que decide se ele confia no que está vendo.
 */
function haQuantoTempo(iso) {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${plural(min, 'minuto', 'minutos')}`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${plural(h, 'hora', 'horas')}`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${plural(d, 'dia', 'dias')}`;
  return `há ${plural(Math.round(d / 30), 'mês', 'meses')}`;
}

// Acima disto o painel deixa de ser um retrato do agora e vira arquivo.
const DIAS_ATE_ENVELHECER = 7;

/**
 * Rodapé: a quem perguntar, de quando é e de qual commit.
 *
 * Saíram os comandos de build ("como regerar" é README, não é informação de toda aba) e
 * o nome da pasta do repositório, que não era link nem era acionável por quem abre o
 * painel publicado. Entrou o que só existia na Visão geral e some quando você troca de
 * aba: projeto, responsável e commit.
 *
 * "Rodada completa há 5 minutos" responde de uma vez as duas perguntas que a data
 * sozinha deixava no ar: quão recente, e rodou a suíte inteira ou só um pedaço.
 */
(function renderFooter() {
  const ident = [DATA.meta.projeto, DATA.meta.qaResponsavel && `QA ${DATA.meta.qaResponsavel}`]
    .filter(Boolean).join(' · ');
  document.getElementById('footerProject').textContent = ident;

  const ultima = DATA.runs[DATA.runs.length - 1];
  const alvo = document.getElementById('footerRun');
  if (!ultima) {
    alvo.textContent = 'Nenhuma rodada registrada';
    return;
  }
  const dias = (Date.now() - new Date(ultima.date).getTime()) / 86400000;
  const tipo = ultima.completa === false ? 'Rodada parcial' : 'Rodada completa';
  const partes = [
    `${tipo} <span class="idade${dias > DIAS_ATE_ENVELHECER ? ' velho' : ''}">${esc(haQuantoTempo(ultima.date))}</span>`,
    ORG.commit ? `commit <code>${esc(ORG.commit)}</code>` : ''
  ].filter(Boolean);
  alvo.innerHTML = partes.join(' · ');
})();

const PROFILE_STATS = PROFILES.map(name => {
  const views = FLOW_CASES.map(c => c.byProfile[name]).filter(Boolean);
  const runs = views.flatMap(c => c.runs).filter(r => !isSkippedRun(r));
  const passed = runs.filter(r => r.status === 'passed').length;
  return { name, views, runs, passed, failed: runs.length - passed, rate: pct(passed, runs.length), state: groupState(views) };
});

const KPI_GROUPS = [
  // Três grupos com papéis distintos, e nenhum card repetindo o vizinho:
  //   Resultado  — o que esta rodada produziu (muda a cada execução)
  //   Alcance    — onde a suíte chega hoje (muda quando se escreve caso ou entra perfil)
  //   Acumulado  — o que a automação já entregou desde o início (só cresce)
  // Misturar os três, como estava, faz um número cumulativo (bugs) ser lido como resultado do dia.
  {
    label: 'Resultado',
    primary: true,
    tiles: [
      { label: 'Taxa de sucesso', value: `${SUCCESS_RATE}<small>%</small>`, cls: `tile-${RATE_TONE}`,
        bar: { pct: TOTAL_RUNS ? (PASSED_RUNS / TOTAL_RUNS) * 100 : 0, color: `var(--${RATE_TONE})` },
        // A taxa conta a tentativa final. Dizer quantas só passaram no retry aqui mesmo evita
        // o "100% verde" convivendo com casos instáveis logo abaixo, que lê como contradição.
        foot: `${PASSED_RUNS} de ${TOTAL_RUNS} execuções dos fluxos aprovadas` +
          (FLAKY_RUNS ? `, ${FLAKY_RUNS} só no retry` : ``) +
          (SKIPPED_RUNS ? ` · ${plural(SKIPPED_RUNS, 'pulada', 'puladas')} fora da conta` : ``) },
      // Falha nova = sem bug aberto registrado. Com ocorrência, o card abre a aba de casos.
      { label: 'Falhas novas', value: NEW_FAILURES.length, cls: NEW_FAILURES.length ? 'tile-critical' : 'tile-good',
        action: NEW_FAILURES.length ? 'failures' : null,
        foot: (NEW_FAILURES.length
          ? `${plural(NEW_FAILURES.length, 'fluxo falhando', 'fluxos falhando')} sem bug registrado · ver casos →`
          : 'Nenhum fluxo falhou sem bug registrado') +
          (KNOWN_FAILURES.length ? ` · ${plural(KNOWN_FAILURES.length, 'falha já registrada como bug', 'falhas já registradas como bug')}` : '') },
      // Instabilidade é o outro lado da taxa de sucesso: um caso que só passou na 2ª tentativa
      // conta como aprovado no número acima, e sem este card ele some da leitura.
      MEASURED_RUNS === 0
        ? { label: 'Taxa de instabilidade', value: '—', foot: 'Medida a partir da próxima execução dos testes' }
        : { label: 'Taxa de instabilidade', value: `${FLAKY_RATE}<small>%</small>`, cls: FLAKY_RUNS === 0 ? 'tile-good' : 'tile-warning',
            bar: { pct: (FLAKY_RUNS / MEASURED_RUNS) * 100, color: 'var(--warning)' },
            action: FLAKY_RUNS === 0 ? null : 'flaky',
            foot: `${FLAKY_RUNS} de ${MEASURED_RUNS} execuções${MEASURED_RUNS < TOTAL_RUNS ? ' medidas' : ''} só passaram no retry` +
              (FLAKY_RUNS ? ' · ver ranking →' : '') }
    ]
  },
  {
    label: 'Alcance',
    tiles: [
      // Um card por perfil é inventário: com 15 perfis conformes são 15 caixas idênticas, e o
      // leitor aprende a pular a seção — deixando de ver justamente no dia em que uma fica
      // vermelha. Um card só mostra diferença, e o número grande é o que se age sobre:
      // quantos perfis falharam. Sem falha, ele mostra o total e confirma que está conforme.
      // O detalhe por perfil vive na aba Perfis, na ficha de cada um.
      ...(MULTI_PROFILE ? [(() => {
        const withFlows = PROFILE_STATS.filter(s => s.runs.length);
        const accessOnly = PROFILES.length - withFlows.length;
        const failing = withFlows.filter(s => s.failed > 0);
        if (failing.length === 0) {
          return { label: 'Perfis', value: PROFILES.length, action: 'perfil-lista', cls: 'tile-good',
            foot: `Todos conformes · ${plural(withFlows.length, 'perfil', 'perfis')} com fluxos` +
              (accessOnly ? `, ${accessOnly} só com conferência de acesso` : '') + ' · ver perfis →' };
        }
        const names = failing.slice(0, 3).map(s => s.name).join(', ') +
          (failing.length > 3 ? ` e mais ${failing.length - 3}` : '');
        return { label: 'Perfis com falha', value: failing.length, action: 'perfil-lista', cls: 'tile-critical',
          bar: { pct: (failing.length / withFlows.length) * 100, color: 'var(--critical)' },
          foot: `de ${withFlows.length} · ${names} · ver perfis →` };
      })()] : []),
      // Duração da rodada: só entra quando existe rodada completa com o dado medido. Enquanto
      // não houver, o tempo somado já vive na seção "Tempo de execução", na aba de casos — um
      // card a mais aqui seria o sétimo, repetindo o que já está em outro lugar.
      ...(COMPLETE_ROUNDS.some(r => r.durationMs)
        ? [(() => {
            const ultima = COMPLETE_ROUNDS.filter(r => r.durationMs).pop();
            return { label: 'Duração da rodada', value: fmtSeconds(ultima.durationMs),
              foot: `Última rodada completa · ${plural(ultima.total, 'execução', 'execuções')} de fluxo` };
          })()]
        : []),
      // Cobertura num card só: dois números separados ("21 fluxos" e "15 conferências") contam
      // a mesma história em dobro e disputam atenção com o resultado.
      //
      // Leva à aba de casos, que é onde os casos contados aqui estão — fluxos e conferências
      // de acesso, as duas coisas. Antes apontava para a aba Perfis, o mesmo destino do card
      // "Perfis" ao lado: dois cards diferentes com o mesmo "ver perfis →" e nada que
      // explicasse por que, já que o número grande aqui é de casos, não de perfis.
      { label: 'Cobertura', value: CASES.length,
        action: 'casos',
        foot: `${plural(FLOW_CASES.length, 'fluxo', 'fluxos')}` +
          (ACCESS_CASES.length ? ` e ${plural(ACCESS_CASES.length, 'conferência de acesso', 'conferências de acesso')}` : '') +
          (MULTI_PROFILE ? ` · em ${plural(PROFILES.length, 'perfil', 'perfis')} e ${plural(DATA.meta.browsers.length, 'navegador', 'navegadores')}`
                         : ` · em ${plural(DATA.meta.browsers.length, 'navegador', 'navegadores')}`) +
          ' · ver casos →' }
    ]
  },
  // Acervo: não é resultado desta rodada, é o que a automação já achou desde que existe. Fica
  // separado porque é argumento ("valeu a pena?"), não status ("o que olho hoje?"). A parte
  // acionável — bug aberto — já aparece em "Precisa de atenção".
  ...(BUGS.length ? [{
    label: 'Acumulado',
    tiles: [
      { label: 'Bugs encontrados pela automação', value: BUGS.length, action: 'bugs',
        cls: OPEN_BUGS ? 'tile-warning' : 'tile-good',
        foot: `${plural(OPEN_BUGS, 'aberto', 'abertos')} · ${plural(FIXED_BUGS, 'corrigido', 'corrigidos')} · ver lista →` }
    ]
  }] : [])
];
// Tempo, execuções e evidências interessam a quem mantém a automação: ficam na seção
// "Tempo de execução", recolhida, e não nos cards do resumo.
document.getElementById('perfFacts').innerHTML = [
  ['Tempo somado', fmtSeconds(TOTAL_DURATION)],
  ['Execuções', `${ALL_RUNS.length} · média de ${fmtSeconds(ALL_RUNS.length ? TOTAL_DURATION / ALL_RUNS.length : 0)}`],
  ['Evidências', `${TOTAL_EVIDENCE} screenshots`]
].map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');

document.getElementById('summaryTiles').innerHTML = KPI_GROUPS.map(g => `
  <div class="kpi-group${g.primary ? ' is-primary' : ''}" style="--n:${g.tiles.length}">
    <span class="kpi-group-label">${esc(g.label)}</span>
    <div class="tiles">${g.tiles.map(t => {
      const link = t.action || t.profile;
      const tag = link ? 'button' : 'div';
      const attrs = t.action ? ` type="button" data-action="${t.action}"`
        : t.profile ? ` type="button" data-profile-tile="${esc(t.profile)}"` : '';
      return `
      <${tag} class="tile ${link ? 'tile-link' : ''} ${t.cls || ''}"${attrs}>
        <span class="tile-label">${esc(t.label)}</span>
        <span class="tile-value tabular">${t.value}</span>
        ${t.bar ? `<span class="tile-bar"><i style="width:${t.bar.pct}%;background:${t.bar.color}"></i></span>` : ''}
        <span class="tile-foot">${esc(t.foot)}</span>
      </${tag}>`;
    }).join('')}
    </div>
  </div>`).join('');

/* ---------------------------------------------------------------------------
 * Visão por suíte
 * ------------------------------------------------------------------------- */
// Só as suítes de fluxo: as de acesso estão na aba Perfis.
const SUITE_STATS = FLOW_SUITES.map(suite => {
  const cases = FLOW_CASES.filter(c => c.suiteId === suite.id);
  const runs = cases.flatMap(c => c.runs).filter(r => !isSkippedRun(r));
  const passed = runs.filter(r => r.status === 'passed').length;
  return {
    id: suite.id,
    name: suite.name,
    cases,
    runs,
    passed,
    state: groupState(cases),
    rate: runs.length ? Math.round((passed / runs.length) * 100) : 0
  };
});

document.getElementById('suiteGrid').innerHTML = SUITE_STATS.map(s => {
  // Falha só de bug conhecido fica laranja: pede acompanhamento, não investigação.
  const color = s.rate === 100 ? 'var(--good)' : s.rate >= 90 || s.state === 'known' ? 'var(--warning)' : 'var(--critical)';
  // Uma bolinha por CASO, não por execução.
  //
  // Execução é a única dimensão do painel que cresce multiplicando: casos × perfis × navegadores.
  // Sete casos de Lead viravam 131 bolinhas só por ligar 15 perfis — seis fileiras de textura em
  // que nada é identificável, dizendo o que o texto ao lado já diz ("7 casos · 131 execuções").
  //
  // Por caso, a faixa tem o tamanho do que você escreveu e cada bolinha é uma coisa nomeável:
  // a dica traz o CT, o título e em quantas execuções ele falhou.
  const dots = s.cases.map(c => {
    const falhas = c.runs.filter(isFailedRun);
    const instavel = c.runs.some(isFlakyRun);
    const cor = c.status === 'skipped' ? 'var(--ink-muted)'
      : falhas.length === 0
      ? (instavel ? 'var(--warning)' : 'var(--good)')
      : (caseState(c) === 'known' ? 'var(--warning)' : 'var(--critical)');
    const detalhe = c.status === 'skipped'
      ? 'pulado: não rodou'
      : falhas.length
      ? `falhou em ${falhas.length} de ${plural(c.runs.length, 'execução', 'execuções')}`
      : instavel
        ? 'passou, mas alguma execução só passou no retry'
        : `${plural(c.runs.length, 'execução', 'execuções')}, todas como esperado`;
    return `<i style="background:${cor}" title="${esc(`${c.id} · ${c.title} — ${detalhe}`)}"></i>`;
  }).join('');
  return `
  <button class="suite-card" data-suite="${esc(s.id)}">
    <div class="suite-card-top">
      <h3>${esc(s.name)}</h3>
      ${statusPill(s.state)}
    </div>
    <div class="suite-stat-row">
      <div class="suite-rate-wrap">
        <span class="suite-rate tabular" style="color:${color}">${s.rate}%</span>
        <span class="suite-rate-label">sucesso</span>
      </div>
      <div class="suite-bar-track"><div class="suite-bar-fill" style="width:${s.rate}%;background:${color}"></div></div>
    </div>
    <div class="suite-case-counts">
      <span><b>${s.cases.length}</b> casos</span>
      <span><b>${s.runs.length}</b> execuções</span>
    </div>
    <div class="suite-card-foot">
      <span class="dotstrip">${dots}</span>
    </div>
  </button>`;
}).join('');

document.querySelectorAll('#suiteGrid .suite-card').forEach(card => {
  card.addEventListener('click', () => {
    document.getElementById('suiteSelect').value = card.dataset.suite;
    filters.suite = card.dataset.suite;
    collapsedGroups.delete(card.dataset.suite);
    renderCases();
    document.getElementById('casos').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ---------------------------------------------------------------------------
 * Tabela de casos
 * ------------------------------------------------------------------------- */
// kind: a tabela mostra os fluxos de negócio por padrão; as conferências de acesso ficam a um
// filtro de distância (e na aba Perfis).
const filters = { search: '', status: 'all', suite: 'all', profile: 'all' };
const expanded = new Set();

const accessSuites = DATA.suites.filter(s => s.kind === 'acesso');
document.getElementById('suiteSelect').insertAdjacentHTML('beforeend',
  FLOW_SUITES.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('') +
  (accessSuites.length
    ? `<optgroup label="Conferências de acesso">${accessSuites.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</optgroup>`
    : ''));


// Filtro de perfil: só aparece com 2+ perfis nos dados.
const profileSelect = document.getElementById('profileSelect');
profileSelect.insertAdjacentHTML('beforeend', PROFILES.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join(''));
profileSelect.hidden = !MULTI_PROFILE;

/**
 * Galeria de evidências do caso, uma aba por execução.
 *
 * Só entram as execuções com miniatura embutida. O build embute evidência de quem falhou, de
 * quem repetiu, dos fluxos negativos e do perfil padrão (scripts/painel/build.js) — com 15
 * perfis, abrir 30 abas onde 26 não têm imagem é ruído puro. As que ficaram de fora continuam
 * com o arquivo em test-evidence/, e a nota abaixo diz isso.
 */
function evidenceGallery(c) {
  const comImagem = c.runs.filter(r => r.evidences.some(ev => ev.src));
  // Nenhuma embutida (build com outra política, ou caso sem evidência): mostra todas, como antes.
  const runs = comImagem.length ? comImagem : c.runs;
  const ocultas = c.runs.length - runs.length;

  const tabs = runs.map((r, i) => `
    <button class="tab" role="tab" data-ev-tab="${i}" aria-selected="${i === 0}">
      <i style="background:${seriesColor(r.browser)}"></i>${esc(runLabel(r))}
      <span style="color:var(--ink-muted)">${r.evidences.length}</span>
    </button>`).join('');

  const panels = runs.map((r, i) => {
    if (!r.evidences.length) return `<div data-ev-panel="${i}" ${i === 0 ? '' : 'hidden'}><p class="empty-note">Nenhuma evidência capturada nesta execução.</p></div>`;
    const shots = r.evidences.map((ev, n) => shotFigure(ev, n, `test-evidence/${ev.path}`)).join('');
    return `<div data-ev-panel="${i}" ${i === 0 ? '' : 'hidden'}><div class="shot-grid">${shots}</div></div>`;
  }).join('');

  const nota = ocultas
    ? `<p class="empty-note">${plural(ocultas, 'execução passou como esperado', 'execuções passaram como esperado')} e não ${ocultas === 1 ? 'teve' : 'tiveram'} evidência embutida.</p>`
    : '';

  return `<div class="ev-gallery"><div class="tabs" role="tablist">${tabs}</div>${panels}${nota}</div>`;

}

// Miniatura clicável (abre no lightbox); sem imagem embutida, fica só a legenda.
function shotFigure(ev, n, filePath) {
  return ev.src
    ? `<figure class="shot" role="button" tabindex="0" data-shot="${esc(ev.src)}" data-cap="${esc(ev.name)}" data-path="${esc(filePath)}">
         <img src="${ev.src}" alt="Evidência: ${esc(ev.name)}" loading="lazy">
         <figcaption><span class="shot-n">${n + 1}.</span>${esc(ev.name)}</figcaption>
       </figure>`
    // Sem miniatura embutida (execução verde em perfil secundário): mostra o caminho, para
    // quem tem a pasta test-evidence/ ao lado saber onde o arquivo está.
    : `<figure class="shot is-off"><figcaption><span class="shot-n">${n + 1}.</span>${esc(ev.name)}
         <span class="shot-path mono">${esc(filePath)}</span></figcaption></figure>`;
}

// Liga as abas de navegador e o lightbox das evidências renderizadas dentro de `root`.
function wireEvidence(root) {
  root.querySelectorAll('[data-ev-tab]').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const scope = tab.closest('.ev-gallery');
      const idx = tab.dataset.evTab;
      scope.querySelectorAll('[data-ev-tab]').forEach(t => t.setAttribute('aria-selected', t === tab));
      scope.querySelectorAll('[data-ev-panel]').forEach(p => { p.hidden = p.dataset.evPanel !== idx; });
    });
  });

  root.querySelectorAll('[data-shot]').forEach(fig => {
    const open = (e) => { e.stopPropagation(); openLightbox(fig.dataset.shot, fig.dataset.cap, fig.dataset.path); };
    fig.addEventListener('click', open);
    fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  });
}

function detailPanel(c) {
  const steps = (c.runs[0]?.steps || []);
  // Passo marcado com passoInterno (tests/e2e/utils/passo.js) executou de verdade, então o
  // painel mostra — ele documenta execução. Quem omite é o guia do usuário, porque ninguém
  // "cancela a edição para limpar a tela" usando o sistema.
  const stepsHtml = steps.length
    ? `<ol class="steps-list">${steps.map(s => {
        const interno = s.startsWith(ROTULO_INTERNO);
        return `<li><span class="step-mark">${ICON_CHECK}</span><span>${esc(s.replace(ROTULO_INTERNO, ''))}${
          interno ? '<span class="step-tag">só no teste</span>' : ''}</span></li>`;
      }).join('')}</ol>`
    : '<p class="empty-note">Este caso não declarou passos nomeados.</p>';

  // Uma linha por execução. Os erros saem da tabela e vão para baixo dela: são poucos (só o
  // que falhou ou repetiu) e longos, então dentro da linha espremeriam todo o resto.
  // Nem "Acesso" nem "Desde" sobreviveram à pergunta "o que esta coluna diz que a linha já
  // não disse?". A conferência de acesso só tem dois desfechos, e os dois já estão na tela:
  // quando confere, a linha diz "Passou"; quando não confere, ela diz "Falhou" e a caixa de
  // erro logo abaixo traz a frase do expect — "a matriz espera X, a org dá Y". A coluna era
  // uma terceira forma de dizer o mesmo. E "Desde" repetia a última execução em toda linha
  // verde, que é o caso normal: só teria notícia numa falha crônica, que é justamente onde
  // o bug conhecido e o histórico do caso já contam a história.

  // O par esperado × encontrado era duas colunas, e eram as duas últimas de oito numa caixa
  // de 485px: a tabela pedia 643px, sem overflow, então o achado da conferência — o único
  // motivo de o caso existir — era o que a borda cortava. Aqui o que importa não são as
  // duas listas lado a lado e sim se elas batem; a matriz inteira vive na ficha do perfil.
  // A coluna só existe quando alguma execução já acumulou histórico.
  const runsHtml = `
    <table class="runs">
      <thead><tr>
        ${MULTI_PROFILE ? '<th>Perfil</th>' : ''}${MULTI_BROWSER ? '<th>Navegador</th>' : ''}<th>Resultado</th>
        <th class="num">Duração</th><th class="num">Tentativas</th>
      </tr></thead>
      <tbody>${c.runs.map(r => `
        <tr>
          ${MULTI_PROFILE ? `<td class="run-prof">${esc(r.profile)}</td>` : ''}
          ${MULTI_BROWSER ? `<td><i style="background:${seriesColor(r.browser)}"></i>${esc(shortBrowser(r.browser))}</td>` : ''}
          <td>${statusPill(r.status === 'passed' ? 'passed' : isSkippedRun(r) ? 'skipped' : 'failed')}${isFlakyRun(r) ? ' ' + statusPill('flaky') : ''}</td>
          <td class="tabular">${fmtSeconds(r.durationMs)}${isStaleRun(r) ? staleTag() : ''}</td>
          <td class="tabular">${typeof r.retry === 'number' ? r.retry + 1 : '—'}</td>
        </tr>`).join('')}</tbody>
    </table>
    ${(() => {
      const comErro = c.runs.filter(r => r.error || (isFlakyRun(r) && r.firstError) || (isSkippedRun(r) && r.skipReason));
      if (!comErro.length) return '';
      return '<div class="run-errors">' + comErro.map(r =>
        `<div><div class="who">${esc(runLabel(r))}</div>` +
        (isSkippedRun(r) && r.skipReason ? `<div class="error-box is-first"><b>Pulado:</b> ${esc(r.skipReason)}</div>` : '') +
        (r.error ? `<div class="error-box">${esc(cleanError(r.error))}</div>` : '') +
        (isFlakyRun(r) && r.firstError
          ? `<div class="error-box is-first"><b>Falhou na 1ª tentativa:</b> ${esc(cleanError(r.firstError))}</div>`
          : '') + '</div>').join('') + '</div>';
    })()}`;

  const bugsHtml = c.bugs.length ? `
      <div class="detail-block">
        <h4>Bugs encontrados</h4>
        <div class="record-list">${c.bugs.map(b => `
          <div class="record-item">
            <span class="record-id">${esc(b.id)}</span>
            <span class="bug-title">${esc(b.titulo)}</span>
            ${statusPill(b.status)}
            <button type="button" class="flag-jump" data-open-bug="${esc(b.id)}">Ver bug</button>
          </div>`).join('')}</div>
      </div>` : '';

  // Agrupado por objeto: com muitos perfis o mesmo caso cria um registro por execução, e uma
  // lista de 30 linhas idênticas esconde o que importa — quantos registros de cada objeto
  // ficaram na org, e quais Ids procurar.
  const porObjeto = new Map();
  for (const rec of c.records) {
    if (!porObjeto.has(rec.object)) porObjeto.set(rec.object, []);
    porObjeto.get(rec.object).push(rec);
  }
  const recordsHtml = c.records.length
    ? [...porObjeto].map(([objeto, recs]) => `
        <div class="rec-group">
          <div class="rec-group-top">
            <span class="record-obj">${esc(objeto)}</span>
            <span>${plural(recs.length, 'registro', 'registros')}</span>
          </div>
          <div class="rec-ids">${recs.map(r => esc(r.id)).join(' · ')}</div>
        </div>`).join('')
    : `<p class="empty-note">Nenhum registro criado por este caso na org.</p>`;

  return `
  <div class="detail-panel">
    <div>
      <div class="detail-block">
        <h4>Passos executados</h4>
        ${stepsHtml}
      </div>
      <div class="detail-block">
        <h4>Evidências capturadas</h4>
        ${evidenceGallery(c)}
      </div>
    </div>
    <div>
      <div class="detail-block">
        <h4>${([MULTI_PROFILE && 'perfil', MULTI_BROWSER && 'navegador'].filter(Boolean).join(' e ') ? 'Execução por ' + [MULTI_PROFILE && 'perfil', MULTI_BROWSER && 'navegador'].filter(Boolean).join(' e ') : 'Execuções')}</h4>
        ${runsHtml}
      </div>
      <div class="detail-block">
        <h4>Massa de teste criada</h4>
        ${recordsHtml}
      </div>
      ${bugsHtml}
    </div>
  </div>`;
}

// Com um perfil selecionado, cada caso é visto só pelas execuções dele (status, duração,
// evidências e detalhe); casos que não rodam nesse perfil saem da lista.
function visibleCases() {
  const q = filters.search.trim().toLowerCase();
  const cases = filters.profile === 'all' ? CASES : CASES.map(c => c.byProfile[filters.profile]).filter(Boolean);
  return cases.filter(c => {
    if (filters.suite !== 'all' && c.suiteId !== filters.suite) return false;
    // "Resultado antigo" é um recorte à parte do status: um caso antigo pode ter passado ou falhado.
    if (filters.status === 'stale' ? !c.stale : filters.status !== 'all' && caseState(c) !== filters.status) return false;
    if (q && !(`${c.id} ${c.title} ${c.suiteName} ${c.criterio}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

// Ordem dentro da tabela: falha nova, parcial (divergente), bug conhecido, instável, passou.
const caseRank = (c) => ({ failed: 0, divergent: 1, known: 2, skipped: 5 }[caseState(c)] ?? (c.flaky ? 3 : 4));
const SUITE_ORDER = [...FLOW_SUITES, ...DATA.suites.filter(s => s.kind === 'acesso')].map(s => s.id);
const TABLE_COLS = 4;

// Grupos recolhidos (por suíte) ficam salvos neste navegador; sem storage, todos abertos.
const GROUPS_KEY = 'qa-dashboard:grupos-recolhidos';
const collapsedGroups = new Set((() => {
  try { return JSON.parse(localStorage.getItem(GROUPS_KEY) || '[]'); } catch { return []; }
})());
function toggleGroup(suiteId) {
  if (collapsedGroups.has(suiteId)) collapsedGroups.delete(suiteId); else collapsedGroups.add(suiteId);
  try {
    localStorage.setItem(GROUPS_KEY, JSON.stringify([...collapsedGroups]));
  } catch {
    // aba anônima ou cookies bloqueados: o painel funciona sem lembrar os grupos
  }
  renderCases();
}

// Marca "antigo" ao lado da data de uma execução que não rodou na última rodada completa.
// Na linha do caso, a data é a da execução mais recente: quando só parte das execuções é
// antiga, a marca diz quantas, e a dica diz quais e quando rodaram.
function staleTag(label = 'antigo', detail = '') {
  const title = `Não rodou na última rodada completa (${fmtDateShort(STALE_BEFORE)})${detail ? `: ${detail}` : ''}. O resultado pode estar desatualizado.`;
  return ` <span class="stale-tag" title="${esc(title)}">${esc(label)}</span>`;
}
function caseStaleTag(c) {
  const old = c.runs.filter(isStaleRun);
  if (!old.length) return '';
  const label = old.length === c.runs.length ? 'antigo' : `${old.length} de ${c.runs.length} antigas`;
  return staleTag(label, old.map(r => `${runShortLabel(r)} em ${fmtDateShort(r.startedAt)}`).join(', '));
}

function caseRow(c, noCriterio = false) {
  const key = `${c.suiteId}::${c.id}`;
  const isOpen = expanded.has(key);
  return `
      <tr class="case-row${noCriterio ? ' in-criterio' : ''}" data-key="${esc(key)}" aria-expanded="${isOpen}">
        <td>
          <div class="td-caso">
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            <div>
              <div class="case-title">${esc(c.title)}</div>
              <div class="case-id mono">${esc(c.id)}</div>
            </div>
          </div>
        </td>
        <td>${statusPill(caseState(c))}${caseState(c) === 'known' ? `<div class="case-id mono">${esc(c.openBug.id)}</div>` : ''}</td>
        <td class="tabular">${c.evidencePerRun}</td>
        <td class="tabular">${fmtDateShort(c.lastRunAt)}${caseStaleTag(c)}</td>
      </tr>
      <tr class="detail-row" data-detail="${esc(key)}" ${isOpen ? '' : 'hidden'}>
        <td colspan="${TABLE_COLS}">${isOpen ? detailPanel(c) : ''}</td>
      </tr>`;
}

// Cabeçalho do grupo: suíte, tamanho, o que pede atenção e a taxa das execuções visíveis.
// nivel 1 = suíte; nivel 2 = critério de aceite dentro da suíte.
function groupRow(g, open, nivel = 1) {
  const runs = g.cases.flatMap(c => c.runs);
  const executadas = runs.filter(r => !isSkippedRun(r));
  const passed = executadas.filter(r => r.status === 'passed').length;
  const rate = pct(passed, executadas.length);
  const state = groupState(g.cases);
  const color = rate === 100 ? 'var(--good-ink)' : state === 'known' || rate >= 90 ? 'var(--warning-ink)' : 'var(--critical-ink)';
  const count = (fn) => g.cases.filter(fn).length;
  const issues = [
    [count(isNewFailure), 'falha nova', 'falhas novas'],
    [count(c => caseState(c) === 'known'), 'bug conhecido', 'bugs conhecidos'],
    [count(c => c.status === 'passed' && c.flaky), 'instável', 'instáveis'],
    [count(c => c.status === 'skipped'), 'pulado', 'pulados'],
    [count(c => c.stale), 'resultado antigo', 'resultados antigos']
  ].filter(([n]) => n).map(([n, one, many]) => plural(n, one, many)).join(' · ');
  return `
      <tr class="group-row${nivel === 2 ? ' is-criterio' : ''}">
        <td colspan="${TABLE_COLS}">
          <button type="button" class="group-toggle" data-group="${esc(g.id)}" aria-expanded="${open}">
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            <span class="group-name">${esc(g.name)}</span>
            <span class="group-meta">${plural(g.cases.length, 'caso', 'casos')} · ${plural(runs.length, 'execução', 'execuções')}</span>
            ${issues ? `<span class="group-issues">${esc(issues)}</span>` : ''}
            <span class="group-end">
              <span class="group-rate tabular" style="color:${color}">${executadas.length ? rate + '%' : '—'}</span>
              ${statusPill(state)}
            </span>
          </button>
        </td>
      </tr>`;
}

function renderCases() {
  const rows = visibleCases();
  const body = document.getElementById('casesBody');

  // Suíte > critério de aceite > cenários. As suítes com falha vêm antes. Os critérios seguem
  // a ordem da spec (pelo menor CT de cada um), que é a ordem dos ACs no card. Dentro de cada
  // critério, as falhas primeiro.
  const bySuite = new Map();
  rows.forEach(c => { if (!bySuite.has(c.suiteId)) bySuite.set(c.suiteId, []); bySuite.get(c.suiteId).push(c); });
  const porId = (a, b) => a.id.localeCompare(b.id, undefined, { numeric: true });
  const groups = [...bySuite].map(([id, cases]) => {
    const porCriterio = new Map();
    [...cases].sort(porId).forEach(c => {
      if (!porCriterio.has(c.criterio)) porCriterio.set(c.criterio, []);
      porCriterio.get(c.criterio).push(c);
    });
    const criterios = [...porCriterio].map(([nome, doCriterio]) => ({
      id: `${id}::${nome}`,
      name: nome || 'Sem critério',
      cases: doCriterio.sort((a, b) => caseRank(a) - caseRank(b) || porId(a, b))
    }));
    return { id, name: cases[0].suiteName, cases, criterios, worst: Math.min(...cases.map(caseRank)) };
  }).sort((a, b) => a.worst - b.worst || SUITE_ORDER.indexOf(a.id) - SUITE_ORDER.indexOf(b.id));
  // Com busca ativa, os grupos abrem para mostrar o que casou.
  const searching = filters.search.trim() !== '';

  // Suíte sem critério nenhum (casos soltos, direto no describe): sem o nível do meio.
  const corpoDaSuite = (g) => (g.criterios.length === 1 && !g.criterios[0].cases[0].criterio
    ? g.criterios[0].cases.map(caseRow).join('')
    : g.criterios.map(cr => {
        const aberto = searching || !collapsedGroups.has(cr.id);
        return groupRow(cr, aberto, 2) + (aberto ? cr.cases.map(c => caseRow(c, true)).join('') : '');
      }).join(''));

  body.innerHTML = groups.length ? groups.map(g => {
    const open = searching || !collapsedGroups.has(g.id);
    return groupRow(g, open) + (open ? corpoDaSuite(g) : '');
  }).join('') : `<tr><td colspan="${TABLE_COLS}" style="padding:26px 14px"><span class="empty-note">Nenhum caso corresponde aos filtros.</span></td></tr>`;

  document.getElementById('filterCount').textContent = `${rows.length} de ${plural(CASES.length, 'caso', 'casos')}`;

  body.querySelectorAll('.group-toggle').forEach(btn => {
    btn.addEventListener('click', () => toggleGroup(btn.dataset.group));
  });

  body.querySelectorAll('tr.case-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const key = tr.dataset.key;
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      renderCases();
    });
  });

  wireEvidence(body);

  body.querySelectorAll('[data-open-bug]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openBug(btn.dataset.openBug); });
  });
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  filters.search = e.target.value; renderCases();
});
document.getElementById('suiteSelect').addEventListener('change', (e) => {
  filters.suite = e.target.value;
  renderCases();
});
// Todo filtro de status só aparece quando tem o que filtrar. O de divergência seguia outra
// regra — sumia com um perfil só, mas ficava visível com 2+ perfis mesmo sem nenhum caso
// divergindo. Filtro que devolve lista vazia ensina o leitor a ignorar a faixa inteira.
//
// Conta pelo mesmo critério do filtro (caseState sobre CASES): um caso que diverge mas cuja
// falha já é bug conhecido conta como "known", e é isso que a lista devolveria.
const DIVERGENT_CASES = CASES.filter(c => caseState(c) === 'divergent');
const chipDivergente = document.querySelector('#statusChips [data-status="divergent"]');
chipDivergente.hidden = !DIMENSAO_DIVERGENTE || DIVERGENT_CASES.length === 0;
if (!chipDivergente.hidden) {
  chipDivergente.textContent = STATUS_META.divergent.label;
  chipDivergente.title = `Passou em parte dos ${DIMENSAO_DIVERGENTE_PLURAL} e falhou em outros`;
}
document.querySelector('#statusChips [data-status="known"]').hidden = KNOWN_FAILURES.length === 0;
document.querySelector('#statusChips [data-status="skipped"]').hidden = !CASES.some(c => c.status === 'skipped');
const STALE_CASES = CASES.filter(c => c.stale);
document.querySelector('#statusChips [data-status="stale"]').hidden = STALE_CASES.length === 0;
// A legenda segue o chip, que já se esconde na linha acima. Explicar a marca "antigo"
// quando nada na tela está marcado gasta uma linha de subtítulo ensinando um conceito que
// o leitor não vai encontrar em lugar nenhum.
if (STALE_CASES.length) {
  document.getElementById('freshNote').textContent =
    ` Execuções anteriores à última rodada completa (${fmtDateShort(STALE_BEFORE)}) aparecem marcadas como "antigo".`;
}

// Tabela filtrada por um status, a partir de outro ponto do painel (ex.: "Precisa de atenção").
function showCasesWithStatus(status) {
  filters.status = status;
  filters.suite = 'all'; filters.search = ''; filters.profile = 'all';
  document.getElementById('searchInput').value = '';
  document.getElementById('suiteSelect').value = 'all';
  profileSelect.value = 'all';
  document.querySelectorAll('#statusChips .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.status === status));
  openView('casos');
  renderCases();
  document.getElementById('casos').scrollIntoView({ block: 'start' });
}
profileSelect.addEventListener('change', (e) => {
  filters.profile = e.target.value; renderCases();
});
document.querySelectorAll('#statusChips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    filters.status = chip.dataset.status;
    document.querySelectorAll('#statusChips .chip').forEach(c => c.setAttribute('aria-pressed', c === chip));
    renderCases();
  });
});

/* ---------------------------------------------------------------------------
 * Faixa de alerta (falhas / divergências)
 * ------------------------------------------------------------------------- */
// Instáveis que passaram no fim: não contam como falha, mas pedem atenção.
const UNSTABLE = FLOW_CASES.filter(c => c.status === 'passed' && c.flaky);
const caseKey = (c) => `${c.suiteId}::${c.id}`;
const failedRunsLabel = (c) => c.runs.filter(isFailedRun).map(runShortLabel).join(', ');

// As execuções falhas que nenhum bug aberto explica: é o que o alerta precisa nomear, para
// não mandar o leitor procurar a novidade no meio das falhas já registradas.
const uncoveredRuns = (c) =>
  c.runs.filter(r => isFailedRun(r) && !c.bugs.some(b => b.status === 'aberto' && bugCobre(b, r)));

// Itens de alerta, usados na faixa da aba de casos e no "Precisa de atenção" da Visão geral.
function newFailureItem(c) {
  const novas = uncoveredRuns(c);
  // Caso com bug aberto em outro perfil: sem dizer isso, o leitor vê o bug ligado ao caso e
  // conclui que a falha já está registrada — que é exatamente o engano que esta fila evita.
  const ressalva = c.openBug
    ? `<span class="flag-suite">${esc(c.openBug.id)} está aberto para o perfil ${esc(perfilDoBug(c.openBug))} e não cobre esta falha</span>`
    : '';
  return `
      <div class="flag-item ${c.status === 'divergent' ? 'is-flaky' : ''}">
        ${statusPill(c.status)}
        <span class="flag-title">${esc(c.title)}</span>
        <span class="flag-suite">Falhou em ${esc(novas.map(runShortLabel).join(', ') || failedRunsLabel(c))}</span>
        ${ressalva}
        <span class="flag-suite mono">${esc(c.suiteName)} · ${esc(c.id)}</span>
        <button class="flag-jump" data-jump="${esc(caseKey(c))}">Abrir detalhe</button>
      </div>`;
}
function knownBugItem(c) {
  return `
      <div class="flag-item is-flaky">
        ${statusPill('known')}
        <span class="flag-title">${esc(c.title)}</span>
        <span class="flag-suite">Falha já registrada: <span class="mono">${esc(c.openBug.id)}</span> ${esc(c.openBug.titulo)}</span>
        <span class="flag-suite mono">${esc(c.suiteName)} · ${esc(c.id)}</span>
        <button class="flag-jump" data-open-bug="${esc(c.openBug.id)}">Ver bug</button>
      </div>`;
}
function unstableItem(c) {
  return `
      <div class="flag-item is-flaky">
        ${statusPill('flaky')}
        <span class="flag-title">${esc(c.title)}</span>
        <span class="flag-suite">Só passou no retry: ${esc(c.runs.filter(isFlakyRun).map(runShortLabel).join(', '))}</span>
        <span class="flag-suite mono">${esc(c.suiteName)} · ${esc(c.id)}</span>
        <button class="flag-jump" data-jump="${esc(caseKey(c))}">Abrir detalhe</button>
      </div>`;
}
function clearItem(title, detail) {
  return `<div class="flag-item is-clear">
       ${statusPill('passed')}
       <span class="flag-title">${esc(title)}</span>
       <span class="flag-suite mono">${esc(detail)}</span>
     </div>`;
}

// Faixa da aba de casos: falhas novas primeiro, depois as de bug conhecido e os instáveis.
document.getElementById('flagStrip').innerHTML = NEW_FAILURES.length || KNOWN_FAILURES.length || UNSTABLE.length
  ? NEW_FAILURES.map(newFailureItem).join('') + KNOWN_FAILURES.map(knownBugItem).join('') + UNSTABLE.map(unstableItem).join('')
  : clearItem('Nenhuma falha, falha parcial ou instabilidade', `${TOTAL_RUNS} execuções verdes`);

/* ---------------------------------------------------------------------------
 * Bugs encontrados pela automação
 * ------------------------------------------------------------------------- */
const CASE_BY_KEY = new Map(CASES.map(c => [`${c.suiteId}/${c.id}`, c]));
const BUG_BY_ID = new Map(BUGS.map(b => [b.id, b]));

// Prioridade: a urgência de corrigir, que é o que ordena a lista de bugs.
const PRIORITY_TONE = { Alta: 'var(--critical)', 'Média': 'var(--warning)', Baixa: 'var(--ink-muted)' };
const PRIORITY_RANK = { Alta: 0, 'Média': 1, Baixa: 2 };

// Só links http(s): um "javascript:" vindo do bugs.json não pode virar href.
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

// Título no formato do registro de bug: "[Área] Resumo do problema".
function bugTitle(b) {
  const area = b.area || CASE_BY_KEY.get(b.caso)?.suiteName || '';
  return area && !b.titulo.startsWith('[') ? `[${area}] ${b.titulo}` : b.titulo;
}

// Pill neutra com um ponto de cor, para não competir com o status do bug.
function tonePill(text, tone) {
  return `<span class="pill pill-neutral"><i style="background:${tone}"></i>${esc(text)}</span>`;
}

function textBlock(title, value) {
  return `
    <div class="detail-block">
      <h4>${esc(title)}</h4>
      ${value ? `<p class="bug-text">${esc(value)}</p>` : '<p class="empty-note">Não informado.</p>'}
    </div>`;
}

// rows: [rótulo, html já escapado]; valor vazio vira "Não informado".
function metaBlock(title, rows) {
  return `
    <div class="detail-block">
      <h4>${esc(title)}</h4>
      <div class="run-card meta-list">
        ${rows.map(([label, html]) => `
          <div class="row"><span>${esc(label)}</span>${html ? `<span>${html}</span>` : '<span class="not-set">Não informado</span>'}</div>`).join('')}
      </div>
    </div>`;
}

function outcomeList(items) {
  return items.length
    ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '<p class="empty-note">Não informado.</p>';
}

// Evidências anexadas ao bug (bugs.json) + as capturadas pela automação no cenário vinculado.
function bugEvidenceBlock(b, c) {
  const images = b.evidencias.filter(e => e.kind === 'image');
  const others = b.evidencias.filter(e => e.kind !== 'image');
  const otherItem = (e) => e.kind === 'link' && safeUrl(e.url)
    ? `<div class="record-item"><span class="record-obj">Link</span><a href="${esc(safeUrl(e.url))}" target="_blank" rel="noopener noreferrer">${esc(e.name)} ↗</a></div>`
    : `<div class="record-item"><span class="record-obj">Arquivo</span><span class="record-id">${esc(e.path || e.name)}</span><span class="record-br">não embutido no painel</span></div>`;
  const attached = b.evidencias.length ? `
      <p class="ev-sub">Anexadas ao bug</p>
      ${images.length ? `<div class="ev-shots"><div class="shot-grid">${images.map((e, n) => shotFigure(e, n, e.path)).join('')}</div></div>` : ''}
      ${others.length ? `<div class="record-list">${others.map(otherItem).join('')}</div>` : ''}` : '';
  const automation = c && c.evidenceCount > 0 ? `
      <p class="ev-sub">Capturadas pela automação no cenário ${esc(c.id)}</p>
      ${evidenceGallery(c)}` : '';
  return `
    <div class="detail-block">
      <h4>Evidências</h4>
      ${attached || automation ? attached + automation : '<p class="empty-note">Nenhuma evidência anexada.</p>'}
    </div>`;
}

// O bug que este repete, e os que repetiram este: a corrente de reincidência, nos dois
// sentidos. Quem abre o BUG-002 precisa chegar no BUG-001 (o que resolveu da última vez), e
// quem abre o BUG-001 precisa saber que ele voltou.
const bugAnterior = (b) => (b.regressaoDe ? BUG_BY_ID.get(b.regressaoDe) : null) || null;
const bugsQueRepetiram = (b) => BUGS.filter(x => x.regressaoDe === b.id);

function bugLink(b) {
  return `<button type="button" class="flag-jump is-inline" data-open-bug="${esc(b.id)}">${esc(b.id)} ${esc(b.titulo)}</button>`;
}

// O registro do bug como seções, na ordem em que vai para o Jira. Campo vazio fica de fora:
// no painel "Não informado" avisa quem preenche o bugs.json; no card do Jira é só ruído.
// Tipos de corpo: 'text' (parágrafo), 'ol'/'ul' (lista de textos) e 'campos' ([rótulo, valor]).
function bugJiraSections(b) {
  const c = CASE_BY_KEY.get(b.caso);
  const anterior = bugAnterior(b);
  const campos = [
    ['Ambiente', b.ambiente],
    ['Dispositivo', b.dispositivo],
    ['Navegador', b.navegador],
    ['Perfil do usuário', b.perfilUsuario],
    ['Frequência', b.frequencia],
    ['Prioridade', b.prioridade],
    ['Encontrado em', b.encontradoEm ? fmtDay(b.encontradoEm) : ''],
    ['Caso automatizado', c ? `${c.suiteName} · ${c.id}` : b.caso],
    ['Registro', safeUrl(b.linkRegistro)],
    ['Repete', anterior ? `${anterior.id} ${anterior.titulo}` : '']
  ].filter(([, v]) => v);
  // As imagens não vão junto com o texto: a seção lista o que colar ou anexar logo abaixo dela.
  const evidencias = [
    ...b.evidencias.map(e => (e.kind === 'link' && safeUrl(e.url) ? `${e.name}: ${e.url}` : e.path || e.name)),
    ...(c && c.evidenceCount > 0 ? [`${plural(c.evidenceCount, 'captura', 'capturas')} da automação no cenário ${c.id} (painel de QA)`] : [])
  ];
  return [
    { title: 'Descrição', kind: 'text', body: b.descricao },
    { title: 'Passos para reprodução', kind: 'ol', body: b.passos },
    { title: 'Resultado esperado', kind: 'ul', body: b.resultadoEsperado },
    { title: 'Resultado encontrado', kind: 'ul', body: b.resultadoEncontrado },
    { title: 'Impacto', kind: 'text', body: b.impacto },
    { title: 'Ambiente de teste', kind: 'campos', body: campos },
    { title: 'Massa de teste', kind: 'text', body: b.massaDeTeste },
    { title: 'Evidências', kind: 'ul', body: evidencias }
  ].filter(s => s.body && s.body.length);
}

// Versão formatada: é a que o editor do Jira usa ao colar (títulos, listas e negrito chegam prontos).
function bugJiraHtml(b) {
  return bugJiraSections(b).map(s => {
    const corpo = s.kind === 'text' ? `<p>${esc(s.body).replace(/\n/g, '<br>')}</p>`
      : s.kind === 'campos' ? `<ul>${s.body.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join('')}</ul>`
      : `<${s.kind}>${s.body.map(i => `<li>${esc(i)}</li>`).join('')}</${s.kind}>`;
    return `<h3>${esc(s.title)}</h3>${corpo}`;
  }).join('');
}

// Versão em Markdown, para onde só entra texto puro (o editor do Jira também converte ao colar).
function bugJiraText(b) {
  return bugJiraSections(b).map(s => {
    const corpo = s.kind === 'text' ? s.body
      : s.kind === 'campos' ? s.body.map(([k, v]) => `- **${k}:** ${v}`).join('\n')
      : s.body.map((i, n) => `${s.kind === 'ol' ? `${n + 1}.` : '-'} ${i}`).join('\n');
    return `### ${s.title}\n\n${corpo}`;
  }).join('\n\n');
}

/**
 * Copia nos dois formatos de uma vez: quem cola escolhe o que entende.
 * O painel costuma ser aberto como arquivo local, onde a Clipboard API nem sempre está
 * liberada; o evento "copy" é o caminho que funciona nesses casos.
 * @param {string} html @param {string} text
 */
async function copyRich(html, text) {
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' })
    })]);
    return true;
  } catch {
    const onCopy = (/** @type {ClipboardEvent} */ e) => {
      e.clipboardData?.setData('text/html', html);
      e.clipboardData?.setData('text/plain', text);
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    const ok = document.execCommand('copy');
    document.removeEventListener('copy', onCopy);
    return ok;
  }
}

/**
 * Junta as capturas numa imagem só, empilhadas e com a legenda de cada uma.
 * A área de transferência leva uma imagem por vez, e o editor do Jira descarta as que vêm
 * embutidas no texto colado: uma folha única é o que chega ao card com um Ctrl+V.
 * As cores são fixas (fundo claro) porque a imagem vai para fora do painel.
 * @param {HTMLElement[]} shots @returns {Promise<Blob>}
 */
async function evidenceSheet(shots) {
  const imgs = await Promise.all(shots.map(fig => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = fig.dataset.shot;
  })));
  const PAD = 16;
  const CAP = 34;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...imgs.map(i => i.naturalWidth)) + PAD * 2;
  canvas.height = imgs.reduce((h, i) => h + CAP + i.naturalHeight + PAD, PAD);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 15px Outfit, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#d0d5dd';
  let y = PAD;
  imgs.forEach((img, n) => {
    ctx.fillStyle = '#1f2937';
    ctx.fillText(`${n + 1}. ${shots[n].dataset.cap}`, PAD, y + CAP / 2 - 4);
    y += CAP;
    ctx.drawImage(img, PAD, y);
    ctx.strokeRect(PAD + 0.5, y + 0.5, img.naturalWidth - 1, img.naturalHeight - 1);
    y += img.naturalHeight + PAD;
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('canvas vazio'))), 'image/png');
  });
}

// Imagem não tem o caminho alternativo do evento "copy": sem Clipboard API, não copia.
async function copyImage(blob) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

// Botões "Copiar título", "Copiar descrição" e "Copiar evidências" do detalhe do bug.
function wireBugCopy(root, b) {
  root.querySelectorAll('[data-copy-bug]').forEach(btn => {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      const titulo = bugTitle(b);
      // Só as capturas à vista: com mais de uma execução, vale a aba aberta na galeria.
      const shots = [...root.querySelectorAll('.shot[data-shot]')].filter(fig => fig.offsetParent);
      const ok = btn.dataset.copyBug === 'titulo' ? await copyRich(esc(titulo), titulo)
        : btn.dataset.copyBug === 'evidencias' ? await copyImage(evidenceSheet(shots))
        : await copyRich(bugJiraHtml(b), bugJiraText(b));
      btn.textContent = ok ? 'Copiado ✓' : 'Não foi possível copiar';
      setTimeout(() => { btn.textContent = label; }, 2000);
    });
  });
}

function bugDetail(b) {
  const c = CASE_BY_KEY.get(b.caso);
  const link = safeUrl(b.linkRegistro);
  const anterior = bugAnterior(b);
  const voltouComo = bugsQueRepetiram(b);
  const temImagem = b.evidencias.some(e => e.src) || Boolean(c && c.runs.some(r => r.evidences.some(ev => ev.src)));
  const corrente =anterior || voltouComo.length ? `
      <div class="detail-block">
        <h4>Reincidência</h4>
        <div class="record-list">
          ${anterior ? `<div class="record-item"><span class="record-obj">Repete</span>${bugLink(anterior)}</div>` : ''}
          ${voltouComo.map(x => `<div class="record-item"><span class="record-obj">Voltou como</span>${bugLink(x)}</div>`).join('')}
        </div>
      </div>` : '';
  return `
  <div class="bug-actions">
    <button type="button" class="flag-jump" data-copy-bug="titulo">Copiar título</button>
    <button type="button" class="flag-jump" data-copy-bug="descricao">Copiar descrição para o Jira</button>
    ${temImagem ? '<button type="button" class="flag-jump" data-copy-bug="evidencias" title="Copia as capturas visíveis abaixo como uma imagem só">Copiar evidências</button>' : ''}  </div>
  <div class="bug-detail">
    <div>
      ${textBlock('Descrição', b.descricao)}
      <div class="detail-block">
        <h4>Passos para reprodução</h4>
        ${b.passos.length ? `<ol class="bug-steps">${b.passos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : '<p class="empty-note">Não informado.</p>'}
      </div>
      <div class="detail-block bug-outcomes">
        <div class="bug-outcome"><h4>Resultado esperado</h4>${outcomeList(b.resultadoEsperado)}</div>
        <div class="bug-outcome is-found"><h4>Resultado encontrado</h4>${outcomeList(b.resultadoEncontrado)}</div>
      </div>
      ${textBlock('Impacto', b.impacto)}
      ${corrente}
      ${bugEvidenceBlock(b, c)}
    </div>
    <div>
      ${metaBlock('Classificação', [
        ['Tipo', esc(b.tipo)],
        ['Status', statusPill(b.status)],
        ['Prioridade', b.prioridade ? tonePill(b.prioridade, PRIORITY_TONE[b.prioridade]) : ''],
        ['Frequência', esc(b.frequencia)],
        ['Encontrado em', b.encontradoEm ? esc(fmtDay(b.encontradoEm)) : ''],
        // Só faz sentido num bug fechado: num aberto, a linha diria "Não informado" todo dia.
        ...(b.status === 'corrigido' ? [['Corrigido em', b.corrigidoEm ? esc(fmtDay(b.corrigidoEm)) : '']] : [])
      ])}
      ${metaBlock('Ambiente de teste', [
        ['Ambiente', esc(b.ambiente)],
        ['Dispositivo', esc(b.dispositivo)],
        // Navegador só se aplica a Desktop: num bug de Mobile sem navegador, a linha some.
        ...(b.dispositivo === 'Mobile' && !b.navegador ? [] : [['Navegador', esc(b.navegador)]]),
        ['Perfil do usuário', esc(b.perfilUsuario)]
      ])}
      <div class="detail-block">
        <h4>Massa de teste</h4>
        ${b.massaDeTeste ? `<p class="bug-text">${esc(b.massaDeTeste)}</p>` : '<p class="empty-note">Não informado.</p>'}
        ${link ? `<div class="record-list" style="margin-top:8px"><div class="record-item"><span class="record-obj">Registro</span><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)} ↗</a></div></div>` : ''}
      </div>
    </div>
  </div>`;
}

function renderBugs() {
  const list = document.getElementById('bugList');
  // Defeito que volta depois de corrigido é sinal de processo, não de código: a contagem fica
  // no alto da aba, onde a lista sozinha não contaria (os dois registros parecem independentes).
  const reincidentes = BUGS.filter(b => bugAnterior(b)).length;
  const nota = document.getElementById('bugsReincidencia');
  if (nota) nota.textContent = reincidentes ? ` ${plural(reincidentes, 'defeito voltou', 'defeitos voltaram')} depois de corrigido.` : '';
  if (BUGS.length === 0) {
    list.innerHTML = '<p class="empty-note">Nenhum bug registrado pela automação. Cadastre em bugs.json.</p>';
    return;
  }
  const rank = (b) => PRIORITY_RANK[b.prioridade] ?? 3;
  list.innerHTML = BUGS
    .slice()
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'aberto' ? -1 : 1) || rank(a) - rank(b) || b.encontradoEm.localeCompare(a.encontradoEm))
    .map((b, i) => {
      const linked = CASE_BY_KEY.get(b.caso);
      const where = linked ? `${linked.suiteName} · ${linked.id}` : b.caso;
      return `
      <article class="bug-item ${b.status === 'corrigido' ? 'is-fixed' : ''}" data-bug="${esc(b.id)}">
        <button type="button" class="bug-head" aria-expanded="false" aria-controls="bug-body-${i}">
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          <span class="bug-head-main">
            <span class="bug-head-title"><span class="mono bug-id">${esc(b.id)}</span> ${esc(bugTitle(b))}</span>
            <span class="bug-head-meta">
              <span class="pills">
                ${statusPill(b.status)}
                ${b.prioridade ? tonePill(`Prioridade: ${b.prioridade}`, PRIORITY_TONE[b.prioridade]) : ''}
              </span>
              ${b.encontradoEm ? `<span>Encontrado em ${esc(fmtDay(b.encontradoEm))}</span>` : ''}
              ${idadeDoBug(b) ? `<span>${esc(idadeDoBug(b))}</span>` : ''}
              ${b.status === 'corrigido' && b.corrigidoEm ? `<span>corrigido em ${esc(fmtDay(b.corrigidoEm))}</span>` : ''}
              ${bugAnterior(b) ? `<span>repete ${esc(b.regressaoDe)}</span>` : ''}
              ${where ? `<span class="mono">${esc(where)}</span>` : ''}
            </span>
          </span>
        </button>
        <div class="bug-body" id="bug-body-${i}" hidden></div>
      </article>`;
    }).join('');

  list.querySelectorAll('.bug-item').forEach(item => {
    item.querySelector('.bug-head').addEventListener('click', () => toggleBug(item));
  });
}

// O detalhe só é montado na primeira vez que o bug abre (as evidências pesam no DOM).
function toggleBug(item, open) {
  const head = item.querySelector('.bug-head');
  const body = item.querySelector('.bug-body');
  const isOpen = open ?? head.getAttribute('aria-expanded') !== 'true';
  if (isOpen && !body.dataset.ready) {
    body.innerHTML = bugDetail(BUG_BY_ID.get(item.dataset.bug));
    body.dataset.ready = '1';
    wireBugCopy(body, BUG_BY_ID.get(item.dataset.bug));
    wireEvidence(body);
    // O bloco de reincidência traz botões para os bugs da corrente.
    wireAlerts(body);
  }
  head.setAttribute('aria-expanded', String(isOpen));
  body.hidden = !isOpen;
}

// "Ver bug", no detalhe de um caso: abre a aba de bugs com aquele bug expandido.
function openBug(id) {
  openView('bugs');
  const item = [...document.querySelectorAll('.bug-item')].find(el => el.dataset.bug === id);
  if (!item) return;
  toggleBug(item, true);
  item.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// "Abrir detalhe", na faixa de alertas: abre e expande o caso na tabela de casos.
function jumpToCase(key) {
  openView('casos');
  expanded.add(key);
  filters.status = 'all'; filters.suite = 'all'; filters.search = ''; filters.profile = 'all';
  // A tabela já mostra os dois tipos; basta abrir o grupo do caso.
  collapsedGroups.delete(key.split('::')[0]);
  document.getElementById('searchInput').value = '';
  document.getElementById('suiteSelect').value = 'all';
  profileSelect.value = 'all';
  document.querySelectorAll('#statusChips .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.status === 'all'));
  renderCases();
  document.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Card de um perfil (Visão geral e aba Perfis): abre a tabela de casos filtrada por ele.
function openCasesForProfile(profile) {
  filters.profile = profile;
  profileSelect.value = profile;
  renderCases();
  setView('casos');
  document.getElementById('casos').scrollIntoView({ block: 'start' });
}
document.querySelectorAll('[data-profile-tile]').forEach(btn => {
  btn.addEventListener('click', () => openCasesForProfile(btn.dataset.profileTile));
});

// Atalhos dos itens de alerta (faixa de casos e "Precisa de atenção").
function wireAlerts(root) {
  root.querySelectorAll('[data-jump]').forEach(btn => btn.addEventListener('click', () => jumpToCase(btn.dataset.jump)));
  root.querySelectorAll('[data-open-bug]').forEach(btn => btn.addEventListener('click', () => openBug(btn.dataset.openBug)));
  root.querySelectorAll('[data-filter-status]').forEach(btn => btn.addEventListener('click', () => showCasesWithStatus(btn.dataset.filterStatus)));
  root.querySelectorAll('[data-open-view]').forEach(btn => btn.addEventListener('click', () => {
    openView(btn.dataset.openView);
    if (btn.dataset.scroll) document.getElementById(btn.dataset.scroll)?.scrollIntoView({ block: 'start' });
  }));
}
wireAlerts(document.getElementById('flagStrip'));

/* ---------------------------------------------------------------------------
 * Perfis e matriz de acesso
 * ---------------------------------------------------------------------------
 * A suíte Acesso (tests/e2e/specs/acesso) roda um caso por objeto em cada perfil e anexa
 * { objeto, esperado, encontrado } à execução (run.access). Quando o perfil lê o objeto,
 * vem junto run.access.campos: o acesso campo a campo (fieldAccess, em utils/acesso.js).
 * Rótulo, tipo e natureza dos campos são do objeto e ficam no caso (case.campos), uma vez só.
 */
// Prefixo que tests/e2e/utils/passo.js coloca no passo que só existe por causa do teste.
const ROTULO_INTERNO = '[interno] ';
const ACCESS_OPS = [['ler', 'Ler'], ['criar', 'Criar'], ['editar', 'Editar'], ['excluir', 'Excluir']];
const PROFILE_INFO = new Map((DATA.meta.profileInfo || []).map(p => [p.nome, p]));
const ACCESS_SUITE = DATA.suites.find(s => s.id === 'acesso');
const ACCESS_ROWS = (ACCESS_SUITE?.cases || []).map(c => ({
  objeto: c.title,
  caseId: c.id,
  info: c.campos || {},
  key: `acesso::${c.id}`,
  byProfile: Object.fromEntries(c.runs.map(r => [r.profile, r]))
}));
const ACCESS_PROFILES = PROFILES.filter(p => ACCESS_ROWS.some(row => row.byProfile[p]));
// A suíte Acesso na tela (tests/e2e/specs/acesso/acesso-tela) confere os objetos principais na interface.
const SCREEN_SUITE = DATA.suites.find(s => s.id === 'acesso-tela');
const SCREEN_BY_OBJECT = new Map((SCREEN_SUITE?.cases || []).map(c => [c.title, { key: `acesso-tela::${c.id}`, runs: c.runs }]));
// A suíte Conjuntos de permissão (tests/e2e/specs/acesso/acesso-conjuntos) tem um caso só, rodado em
// todo perfil: run.conjuntos = { esperado, encontrado } diz do que o acesso do usuário é feito
// além do perfil.
const PS_SUITE = DATA.suites.find(s => s.id === 'acesso-conjuntos');
const PS_CASE = PS_SUITE && PS_SUITE.cases[0];
const PS_BY_PROFILE = Object.fromEntries(((PS_CASE && PS_CASE.runs) || []).map(r => [r.profile, r]));
// Conferências que falharam (pela API e na tela): permissão diferente da matriz, ou erro antes
// de ler as permissões.
const ACCESS_FAILURES = [
  ...Object.values(PS_BY_PROFILE)
    .filter(isFailedRun)
    .map(r => ({ objeto: 'Conjuntos de permissão', key: `acesso-conjuntos::${PS_CASE.id}`, run: r, via: 'conjuntos' })),
  ...ACCESS_ROWS.flatMap(row => ACCESS_PROFILES
    .map(p => row.byProfile[p])
    .filter(r => r && isFailedRun(r))
    .map(r => ({ objeto: row.objeto, key: row.key, run: r, via: 'api' }))),
  ...[...SCREEN_BY_OBJECT].flatMap(([objeto, s]) => s.runs
    .filter(isFailedRun)
    .map(r => ({ objeto, key: s.key, run: r, via: 'tela' })))
];
const SHOW_PROFILES_TAB = MULTI_PROFILE || ACCESS_ROWS.length > 0 || SCREEN_BY_OBJECT.size > 0 || !!PS_CASE;

function accessState(access, op) {
  const expected = access.esperado.includes(op);
  const found = access.encontrado.includes(op);
  if (expected === found) return found ? 'yes' : 'no';
  return expected ? 'blocked' : 'granted';
}

// O que divergiu, operação por operação, no vocabulário de onde foi conferido.
function divergenceText(access, via) {
  const where = via === 'tela' ? { blocked: 'a tela não mostra', granted: 'a tela mostra' } : { blocked: 'a org bloqueia', granted: 'a org permite' };
  return ACCESS_OPS.map(([op, label]) => [label, accessState(access, op)])
    .filter(([, state]) => state === 'blocked' || state === 'granted')
    .map(([label, state]) => `${label}: a matriz ${state === 'blocked' ? 'permite' : 'bloqueia'}, mas ${where[state]}`)
    .join(' · ');
}

// Tabela de perfis (aba Perfis, acima de PROFILE_TILES_MAX perfis).
const profileFilter = { search: '' };
function renderProfileTable() {
  const rows = PROFILE_STATS.map(s => ({
    ...s,
    info: PROFILE_INFO.get(s.name),
    checked: ACCESS_ROWS.filter(row => row.byProfile[s.name]).length,
    accessFailures: ACCESS_FAILURES.filter(f => f.run.profile === s.name).length,
    flaky: s.views.some(c => c.flaky)
  }));
  const rank = (r) => (r.state === 'failed' ? 0 : r.accessFailures ? 1 : r.state === 'known' ? 2 : r.flaky ? 3 : 4);
  const rateKey = (r) => (r.runs.length ? r.rate : 101);
  rows.sort((a, b) => rank(a) - rank(b) || rateKey(a) - rateKey(b) || a.name.localeCompare(b.name));
  const q = profileFilter.search.trim().toLowerCase();
  const visible = rows.filter(r => !q || `${r.name} ${r.info?.perfilSalesforce || ''}`.toLowerCase().includes(q));

  const box = document.getElementById('profileCards');
  box.className = 'profile-table';
  box.innerHTML = `
    ${rows.length > 8 ? `
      <div class="filter-row">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input id="profileSearch" type="text" placeholder="Buscar perfil…" value="${esc(profileFilter.search)}" />
        </div>
        <span class="filter-count">${visible.length} de ${rows.length} perfis</span>
      </div>` : ''}
    <div class="table-card">
      <div class="table-scroll">
        <table class="profiles">
          <thead><tr><th>Perfil</th><th>Status dos fluxos</th><th>Sucesso</th><th>Execuções</th><th>Acesso</th></tr></thead>
          <tbody>${visible.length ? visible.map(r => {
            const color = r.rate === 100 ? 'var(--good)' : r.rate >= 90 || r.state === 'known' ? 'var(--warning)' : 'var(--critical)';
            const access = r.checked === 0
              ? '<span class="not-set">Sem matriz</span>'
              : r.accessFailures
                ? `<span class="pill pill-critical">${ICON_X}${plural(r.accessFailures, 'divergência', 'divergências')}</span>`
                : `<span class="pill pill-good">${ICON_CHECK}Conforme</span>`;
            return `
            <tr data-profile-row="${esc(r.name)}">
              <td>
                <button type="button" class="pf-open" data-profile-card="${esc(r.name)}">${esc(r.name)}</button>
                ${r.info?.perfilSalesforce ? `<div class="pf-org">${esc(r.info.perfilSalesforce)}</div>` : ''}
              </td>
              <td>${!r.runs.length ? '<span class="not-set">Sem fluxos</span>' : statusPill(r.state) + (r.flaky && r.state === 'passed' ? ` ${statusPill('flaky')}` : '')}</td>
              <td>${!r.runs.length ? '<span class="not-set">—</span>' : `<span class="pf-rate"><b class="tabular" style="color:${color}">${r.rate}%</b><span class="pf-bar"><i style="width:${r.runs.length ? (r.passed / r.runs.length) * 100 : 0}%;background:${color}"></i></span></span>`}</td>
              <td class="tabular">${!r.runs.length ? '<span class="not-set">—</span>' : `${r.passed} de ${r.runs.length}${r.failed ? ` · <span class="pf-fail">${plural(r.failed, 'falhou', 'falharam')}</span>` : ''}<div class="pf-org">${plural(r.views.length, 'fluxo', 'fluxos')}</div>`}</td>
              <td>${access}</td>
            </tr>`;
          }).join('') : `<tr><td colspan="5"><span class="empty-note">Nenhum perfil corresponde à busca.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;

  box.querySelectorAll('tr[data-profile-row]').forEach(tr => {
    tr.addEventListener('click', () => abrirFicha(tr.dataset.profileRow));
  });
  const search = document.getElementById('profileSearch');
  if (search) {
    search.addEventListener('input', (e) => {
      profileFilter.search = e.target.value;
      renderProfileTable();
      const again = document.getElementById('profileSearch');
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    });
  }
  document.querySelector('#perfis .section-sub').textContent =
    'Cada perfil roda a suíte com um usuário próprio na org. Os perfis com problema vêm primeiro; clique em um para abrir a ficha dele.';
}

/* ---------------------------------------------------------------------------
 * Ficha do perfil: o perfil como unidade, não o cenário. Responde "o que este
 * usuário consegue e o que ele é impedido de fazer?", que é a pergunta de uma
 * revisão de permissão — e a que a lista de casos, filtrada por perfil, não responde.
 * ------------------------------------------------------------------------- */
let fichaAberta = null;
let fichaComparar = '';

// Execuções gravadas antes de esperado() (tests/e2e/utils/expectativa.js) não têm o campo:
// valem como "permitido", que era a regra implícita quando todo caso só rodava onde funciona.
const runEsperado = (r) => (r && r.esperado === 'negado' ? 'negado' : 'permitido');

const FICHA_PILL = {
  ok: ['pill-good', 'Executa'],
  barrado: ['pill-neutral', 'Bloqueado'],
  falha: ['pill-critical', 'Falhou'],
  vazamento: ['pill-warning', 'Não bloqueou']
};
const fichaPill = (estado) => `<span class="pill ${FICHA_PILL[estado][0]}">${FICHA_PILL[estado][1]}</span>`;

/** Cruza status com o esperado: "passou" significa coisas opostas num fluxo negativo. */
function fichaEstado(caso, perfil) {
  const view = caso.byProfile[perfil];
  if (!view || !view.runs.length || view.status === 'skipped') return null;
  const esperado = runEsperado(view.runs[0]);
  const falhou = view.runs.some(isFailedRun);
  return {
    caso, esperado, view,
    estado: !falhou ? (esperado === 'negado' ? 'barrado' : 'ok')
                    : (esperado === 'negado' ? 'vazamento' : 'falha'),
    erro: (view.runs.find(isFailedRun) || {}).error
  };
}

/** Divergências da matriz de acesso deste perfil, no par esperado × encontrado. */
function fichaAcesso(perfil) {
  const linhas = [];
  for (const row of ACCESS_ROWS) {
    const run = row.byProfile[perfil];
    if (!run || !run.access) continue;
    const { esperado = [], encontrado = [] } = run.access;
    for (const op of OPERACOES_FICHA) {
      const e = esperado.includes(op), f = encontrado.includes(op);
      if (e !== f) linhas.push({ objeto: row.objeto, op, tipo: e ? 'falta' : 'extra' });
    }
  }
  return linhas;
}
const OPERACOES_FICHA = ['ler', 'criar', 'editar', 'excluir'];

/* Acesso por campo. São três estados e não dois: a permissão de campo do Salesforce só tem
 * leitura e edição, e "lê mas não edita" numa coluna só se lê mais rápido que dois ✓/– . */
const CAMPO_NIVEL = { editar: 'Edita', ler: 'Só leitura', oculto: 'Oculto' };
const CAMPO_ORDEM = ['oculto', 'ler', 'editar'];
const CAMPO_NATUREZA = { sistema: 'campo de sistema', leitura: 'ninguém edita' };
/* Tipo do campo, com o nome que o Salesforce dá a ele na tela. A chave vem de tipoDoCampo
 * (utils/acesso.js): o tipo do describe, com "formula:<tipo>" para fórmula e
 * "reference:<objeto>" / "masterdetail:<objeto>" para relacionamento. */
const CAMPO_TIPO = {
  string: 'Texto', textarea: 'Área de texto', longtext: 'Área de texto longo', richtext: 'Rich text',
  encryptedstring: 'Texto criptografado', picklist: 'Lista de opções',
  multipicklist: 'Lista de opções (seleção múltipla)', combobox: 'Lista de opções com texto',
  boolean: 'Caixa de seleção', currency: 'Moeda', double: 'Número', int: 'Número', long: 'Número',
  percent: 'Porcentagem', date: 'Data', datetime: 'Data/Hora', time: 'Hora', email: 'Email',
  phone: 'Telefone', url: 'URL', id: 'ID', address: 'Endereço', location: 'Geolocalização',
  autonumber: 'Numeração automática', base64: 'Arquivo', anyType: 'Qualquer tipo',
  reference: 'Pesquisa', masterdetail: 'Mestre-detalhe', formula: 'Fórmula'
};
function campoTipo(chave) {
  if (!chave) return '';
  const [tipo, ...resto] = chave.split(':');
  const detalhe = resto.join(':');
  const nome = CAMPO_TIPO[tipo] || tipo;
  if (!detalhe) return nome;
  // O detalhe da fórmula é o tipo do valor; o do relacionamento, o objeto de destino.
  return `${nome} (${tipo === 'formula' ? CAMPO_TIPO[detalhe] || detalhe : detalhe})`;
}
const campoNivel = (n) => `<span class="cp-nivel cp-${n}">${CAMPO_NIVEL[n]}</span>`;
const campoMais = (d) => CAMPO_ORDEM.indexOf(d.encontrado) > CAMPO_ORDEM.indexOf(d.esperado);

/**
 * Campos de um objeto (linha de ACCESS_ROWS) para um perfil, a partir de run.access.campos.
 * Devolve null quando a execução não levantou campos: perfil sem leitura no objeto, ou dado
 * gravado antes disso.
 *
 * "destaque" é o que a ficha mostra sem ninguém pedir. Um objeto tem dezenas de campos e
 * quase todos seguem a regra: com regra declarada, importa o que diverge e o que foi
 * declarado pelo nome; sem regra, o que o perfil tem a menos do que poderia ter.
 */
function camposDoObjeto(row, perfil) {
  const run = row.byProfile[perfil];
  const c = run && run.access && run.access.campos;
  if (!c || !c.encontrado) return null;
  const regra = c.regra || null;
  const divergencias = new Map((c.divergencias || []).map(d => [d.campo, d]));
  const editavel = ['criar', 'editar'].some(op => (run.access.encontrado || []).includes(op));
  const nomes = new Set([...Object.keys(c.encontrado), ...Object.keys(regra || {})]);
  nomes.delete('*');

  const itens = [...nomes].map(nome => {
    const encontrado = c.encontrado[nome] || 'oculto';
    const natureza = (row.info.natureza || {})[nome] || '';
    const explicito = !!regra && nome in regra;
    // O "*" não alcança o campo de sistema, que o perfil não controla.
    const coberto = explicito || (!!regra && !!regra['*'] && natureza !== 'sistema');
    const d = divergencias.get(nome);
    return {
      nome, encontrado, natureza, explicito,
      rotulo: (row.info.rotulos || {})[nome] || nome,
      tipo: campoTipo((row.info.tipos || {})[nome]),
      esperado: d ? d.esperado : coberto ? encontrado : null,
      diverge: !!d,
      restrito: !coberto && (encontrado === 'oculto' || (encontrado === 'ler' && !natureza && editavel))
    };
  });
  const peso = (i) => (i.diverge ? 0 : i.explicito ? 1 : i.restrito ? 2 : 3);
  itens.sort((a, b) => peso(a) - peso(b) || a.rotulo.localeCompare(b.rotulo));
  return {
    itens, regra, editavel,
    // Dado gravado antes de o tipo existir não tem a coluna: vazia, ela só ocuparia espaço.
    comTipo: itens.some(i => i.tipo),
    divergentes: itens.filter(i => i.diverge),
    destaque: itens.filter(i => i.diverge || i.explicito || i.restrito)
  };
}

/**
 * Conjuntos de permissão do usuário deste perfil, a partir de run.conjuntos. null quando a
 * suíte não rodou nele. O estado cruza o atribuído com o declarado em "conjuntos": sem
 * declaração é inventário, e nada diverge.
 */
function conjuntosDoPerfil(perfil) {
  const c = PS_BY_PROFILE[perfil] && PS_BY_PROFILE[perfil].conjuntos;
  if (!c) return null;
  const esperado = c.esperado || null;
  const encontrado = c.encontrado || [];
  const itens = [
    ...encontrado.map(i => ({ ...i, estado: !esperado ? 'inventario' : esperado.includes(i.nome) ? 'ok' : 'sobrando' })),
    ...(esperado || []).filter(nome => !encontrado.some(i => i.nome === nome))
      .map(nome => ({ nome, rotulo: nome, tipo: '', estado: 'faltando' }))
  ];
  return { itens, declarado: !!esperado, divergentes: itens.filter(i => i.estado === 'sobrando' || i.estado === 'faltando') };
}
const CONJUNTO_ESTADO = {
  ok: ['pill-good', 'Declarado', ''],
  sobrando: ['pill-warning', 'Não declarado', 'atribuído ao usuário, mas fora de "conjuntos"'],
  faltando: ['pill-critical', 'Não atribuído', 'declarado em "conjuntos", mas o usuário não tem']
};
const conjuntoPill = (estado) => (CONJUNTO_ESTADO[estado] ? `<span class="pill ${CONJUNTO_ESTADO[estado][0]}">${CONJUNTO_ESTADO[estado][1]}</span>` : '');
const conjuntoTipo = (i) => (i.tipo === 'grupo' ? 'grupo de conjuntos' : 'conjunto de permissão');

// Conjuntos divergentes de uma execução, em uma frase ("Precisa de atenção").
function conjuntosDivergentesTexto(perfil) {
  const c = conjuntosDoPerfil(perfil);
  if (!c || !c.divergentes.length) return '';
  const nomes = (estado) => c.divergentes.filter(i => i.estado === estado).map(i => i.nome).join(', ');
  return [nomes('sobrando') && `atribuído sem estar declarado: ${nomes('sobrando')}`,
    nomes('faltando') && `declarado e não atribuído: ${nomes('faltando')}`].filter(Boolean).join(' · ');
}

/** Objetos em que algum campo deste perfil difere do declarado. */
function fichaCamposDivergentes(perfil) {
  return ACCESS_ROWS
    .map(row => ({ objeto: row.objeto, itens: (camposDoObjeto(row, perfil) || { divergentes: [] }).divergentes }))
    .filter(o => o.itens.length);
}

// Quantos campos uma linha de resumo nomeia antes de virar "e mais N".
const CAMPOS_NO_RESUMO = 4;
function resumoDeCampos(itens, frase) {
  const resto = itens.length - CAMPOS_NO_RESUMO;
  return itens.slice(0, CAMPOS_NO_RESUMO).map(frase).join(' · ') + (resto > 0 ? ` · e mais ${resto}` : '');
}

// Campos divergentes de uma execução da suíte Acesso, em uma frase ("Precisa de atenção").
function camposDivergentesTexto(run) {
  const divs = (run.access && run.access.campos && run.access.campos.divergencias) || [];
  if (!divs.length) return '';
  return `${plural(divs.length, 'campo diferente', 'campos diferentes')} da matriz: ` +
    resumoDeCampos(divs, d => `${d.campo} (${CAMPO_NIVEL[d.encontrado].toLowerCase()})`);
}

function fichaDados(perfil) {
  const itens = FLOW_CASES.map(c => fichaEstado(c, perfil)).filter(Boolean);
  const conformes = itens.filter(i => i.estado === 'ok' || i.estado === 'barrado');
  return {
    nome: perfil,
    info: PROFILE_INFO.get(perfil),
    itens,
    permitidos: itens.filter(i => i.esperado === 'permitido'),
    negados: itens.filter(i => i.esperado === 'negado'),
    divergencias: itens.filter(i => i.estado === 'falha' || i.estado === 'vazamento'),
    acesso: fichaAcesso(perfil),
    campos: fichaCamposDivergentes(perfil),
    conjuntos: conjuntosDoPerfil(perfil),
    taxa: pct(conformes.length, itens.length)
  };
}

/*
 * Cenários do perfil, agrupados por suíte.
 *
 * A lista plana respondia bem com 7 cenários e deixa de responder com 100: são 97 linhas
 * verdes idênticas escondendo as 3 que importam, e o leitor rola até desistir. A suíte é a
 * unidade em que o QA já pensa (é como a aba Casos agrupa), então ela vira a linha — 100
 * cenários viram ~8 grupos, e o número em cada um responde sem abrir.
 *
 * Quem abre sozinho é só o grupo com problema. O resto começa fechado: quem vem à ficha
 * para uma revisão de permissão quer ver o que destoa, não conferir inventário.
 */
const fichaGrupoInvertido = new Set();
let fichaBusca = '';

// Filtro de cenário da ficha. Só aparece quando a lista deixa de caber na cabeça.
const FICHA_MIN_BUSCA = 12;
const fichaVisivel = (i) => {
  const q = fichaBusca.trim().toLowerCase();
  return !q || `${i.caso.title} ${i.caso.id} ${i.caso.suiteName}`.toLowerCase().includes(q);
};

/**
 * @param {any[]} itens cenários já filtrados por expectativa (permitidos ou negados)
 * @param {string} prefixo separa os grupos dos dois blocos, que podem ter a mesma suíte
 * @param {{ok:string, ruim1:string, ruimN:string, vazio:string}} rotulos
 */
function fichaGrupos(itens, prefixo, rotulos) {
  if (!itens.length) return `<p class="fic-vazio">${esc(rotulos.vazio)}</p>`;
  const buscando = !!fichaBusca.trim();
  const grupos = new Map();
  for (const i of itens) {
    const k = prefixo + '::' + i.caso.suiteId;
    if (!grupos.has(k)) grupos.set(k, { nome: i.caso.suiteName, itens: [] });
    grupos.get(k).itens.push(i);
  }
  const blocos = [];
  for (const [k, g] of grupos) {
    const vis = g.itens.filter(fichaVisivel);
    if (!vis.length) continue;
    const ruins = g.itens.filter(i => i.estado === 'falha' || i.estado === 'vazamento').length;
    // Abre sozinho o grupo com problema, e qualquer um durante a busca (esconder o
    // resultado atrás de mais um clique anula o motivo de ter buscado).
    const padrao = ruins > 0 || buscando;
    const aberto = fichaGrupoInvertido.has(k) ? !padrao : padrao;
    blocos.push(`
      <div class="fic-grupo">
        <button type="button" class="group-toggle fic-grupo-head" data-fic-grupo="${esc(k)}" aria-expanded="${aberto}">
          <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
          <span class="group-name">${esc(g.nome)}</span>
          <span class="group-meta">${plural(vis.length, 'cenário', 'cenários')}${
            vis.length !== g.itens.length ? ` de ${g.itens.length}` : ''}</span>
          <span class="group-end">${ruins
            ? `<span class="pill pill-critical">${plural(ruins, rotulos.ruim1, rotulos.ruimN)}</span>`
            : `<span class="pill pill-good">${esc(rotulos.ok)}</span>`}</span>
        </button>
        ${aberto ? `<div class="fic-grupo-body">${vis.map(fichaLinha).join('')}</div>` : ''}
      </div>`);
  }
  return blocos.join('') || '<p class="fic-vazio">Nenhum cenário corresponde à busca.</p>';
}

/** Busca única para os dois blocos de cenário: eles respondem à mesma pergunta. */
function fichaBlocoBusca(f) {
  if (f.itens.length <= FICHA_MIN_BUSCA) return '';
  const achou = f.itens.filter(fichaVisivel).length;
  return `
    <div class="filter-row fic-busca">
      <div class="search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="fichaBusca" type="text" placeholder="Buscar cenário, suíte ou CT…" value="${esc(fichaBusca)}" />
      </div>
      <span class="filter-count">${achou} de ${plural(f.itens.length, 'cenário', 'cenários')}</span>
    </div>`;
}

const fichaLinha = (i) => `
  <div class="fic-linha">
    <span class="t">${esc(i.caso.title)}<small>${esc(i.caso.suiteName + ' · ' + i.caso.id)}${
      // Só a primeira linha: a mensagem do expect() traz o diff inteiro, que estoura a linha.
      i.erro ? ' · ' + esc(i.erro.split('\n')[0]) : ''}</small></span>
    ${fichaPill(i.estado)}
  </div>`;

function fichaBlocoDivergencias(f) {
  const conjuntosRuins = f.conjuntos ? f.conjuntos.divergentes : [];
  if (!f.divergencias.length && !f.acesso.length && !f.campos.length && !conjuntosRuins.length) {
    return `<div class="fic-bloco"><h3>Divergências</h3>
      <p class="fic-vazio">Nenhuma. Tudo que este perfil faz e deixa de fazer confere com a matriz.</p></div>`;
  }
  const acessos = f.acesso.map(d => `
    <div class="fic-linha">
      <span class="t">${esc(d.objeto)} · ${esc(d.op)}<small>${d.tipo === 'falta'
        ? 'a matriz permite, mas a org bloqueia' : 'a matriz bloqueia, mas a org permite'}</small></span>
      <span class="pill ${d.tipo === 'falta' ? 'pill-critical' : 'pill-warning'}">${d.tipo === 'falta' ? 'Acesso a menos' : 'Acesso a mais'}</span>
    </div>`).join('');
  // Um item por objeto, não por campo: uma regra errada no "*" diverge em quarenta campos de
  // uma vez, e quarenta linhas iguais empurrariam para fora da tela o que é de outra natureza.
  const campos = f.campos.map(o => {
    const mais = o.itens.filter(campoMais).length;
    const [cls, rotulo] = mais === o.itens.length ? ['pill-warning', 'Acesso a mais']
      : mais === 0 ? ['pill-critical', 'Acesso a menos'] : ['pill-critical', 'Acesso diferente'];
    return `
    <div class="fic-linha">
      <span class="t">${esc(o.objeto)} · ${plural(o.itens.length, 'campo', 'campos')}<small>${esc(resumoDeCampos(o.itens,
        i => `${i.nome}: a matriz diz ${CAMPO_NIVEL[i.esperado].toLowerCase()}, a org dá ${CAMPO_NIVEL[i.encontrado].toLowerCase()}`))}</small></span>
      <span class="pill ${cls}">${rotulo}</span>
    </div>`;
  }).join('');
  return `<div class="fic-bloco alerta"><h3>Divergências</h3>
    <div class="fic-sub">O que este perfil faz diferente do que a matriz manda.</div>
    ${f.divergencias.map(fichaLinha).join('')}${acessos}${campos}${conjuntosRuins.map(i => `
    <div class="fic-linha">
      <span class="t">${esc(i.rotulo)}<small>${esc(CONJUNTO_ESTADO[i.estado][2])}</small></span>
      ${conjuntoPill(i.estado)}
    </div>`).join('')}</div>`;
}

function fichaBlocoNegados(f) {
  if (f.negados.length) {
    return `<div class="fic-bloco"><h3>O que este perfil deve ser impedido de fazer</h3>
      <div class="fic-sub">Fluxos negativos: o caso passa quando a org bloqueia. É a prova de que a trava existe.</div>
      ${fichaGrupos(f.negados, 'neg', { ok: 'Todos bloqueados', ruim1: 'não bloqueou',
        ruimN: 'não bloquearam', vazio: 'Nenhum cenário declara bloqueio para este perfil.' })}</div>`;
  }
  return `<div class="fic-bloco"><h3>O que este perfil deve ser impedido de fazer</h3>
    <p class="fic-vazio">Nenhum cenário declara bloqueio esperado para este perfil ainda.
    Um caso declara isso com <span class="mono">esperado({ '*': 'permitido', ${esc((f.info && f.info.id) || 'perfil')}: 'negado' })</span>
    (<span class="mono">tests/e2e/utils/expectativa.js</span>). Sem isso, a conferência de bloqueio
    fica só na suíte Acesso, que vê permissão de objeto mas não o comportamento da tela.</p></div>`;
}

/**
 * Composição do acesso: o perfil e os conjuntos de permissão somados a ele.
 *
 * Tudo o que a ficha mostra abaixo é o acesso efetivo, que a API devolve já somado. Este bloco
 * diz de que partes a soma é feita — sem ele, um acesso a mais que vem de um conjunto parece
 * erro do perfil, e quem vai corrigir procura no lugar errado.
 */
function fichaBlocoConjuntos(f) {
  if (!f.conjuntos) return '';
  const linhas = f.conjuntos.itens.map(i => `
    <div class="fic-linha">
      <span class="t">${esc(i.rotulo)}<small>${i.estado === 'faltando' ? esc(CONJUNTO_ESTADO.faltando[2])
        : `<span class="mono">${esc(i.nome)}</span> · ${conjuntoTipo(i)}`}</small></span>
      ${conjuntoPill(i.estado)}
    </div>`).join('');
  const nota = !f.conjuntos.itens.length
    ? `Nenhum conjunto de permissão atribuído: todo o acesso deste usuário vem do perfil.${
        f.conjuntos.declarado ? ' É o que está declarado.' : ''}`
    : f.conjuntos.declarado ? ''
    : 'Nada aqui é conferido: não há <span class="mono">conjuntos</span> declarado para este perfil.';
  return `<div class="fic-bloco"><h3>Composição do acesso</h3>
    <div class="fic-sub">O acesso deste usuário é a soma do perfil com os conjuntos de permissão atribuídos a ele.</div>
    <div class="fic-linha">
      <span class="t">${esc((f.info && f.info.perfilSalesforce) || f.nome)}<small>perfil na org</small></span>
      <span class="pill pill-neutral">Perfil</span>
    </div>
    ${linhas}
    ${nota ? `<p class="fic-vazio">${nota}</p>` : ''}</div>`;
}

// Marcas da matriz de acesso, na ficha. São os mesmos quatro estados que a suíte Acesso
// produz — o par esperado × encontrado — e a mesma legenda que a seção antiga usava.
const FICHA_ACESSO = {
  yes: { cls: 'ac-yes', mark: '✓', label: 'Permitido, como na matriz' },
  no: { cls: 'ac-no', mark: '–', label: 'Bloqueado, como na matriz' },
  blocked: { cls: 'ac-diff', mark: '✗', label: 'A matriz permite, mas a org bloqueia' },
  granted: { cls: 'ac-diff', mark: '!', label: 'A matriz bloqueia, mas a org permite' }
};

// Estado dos campos na ficha: objetos abertos fora do padrão, os que mostram todos os campos
// e a busca de cada um.
const fichaObjetoInvertido = new Set();
const fichaCamposTodos = new Set();
const fichaCampoBusca = {};
// A busca de campo só aparece quando a lista deixa de caber no olho.
const CAMPO_MIN_BUSCA = 12;

/** Os campos de um objeto, dentro da linha dele na matriz. */
function fichaCampos(objeto, campos) {
  const todos = fichaCamposTodos.has(objeto);
  const q = todos ? (fichaCampoBusca[objeto] || '').trim().toLowerCase() : '';
  const base = todos ? campos.itens : campos.destaque;
  const vis = base.filter(i => !q || `${i.rotulo} ${i.nome} ${i.tipo}`.toLowerCase().includes(q));
  const comRegra = !!campos.regra;

  const linhas = vis.map(i => `
    <tr${i.diverge ? ' class="cp-diff"' : ''}>
      <td class="cp-nome">${esc(i.rotulo)}<small class="mono">${esc(i.nome)}${
        i.natureza ? ` · ${CAMPO_NATUREZA[i.natureza]}` : ''}</small></td>
      ${campos.comTipo ? `<td class="cp-tipo">${esc(i.tipo) || '<span class="not-set">—</span>'}</td>` : ''}
      ${comRegra ? `<td>${i.esperado ? campoNivel(i.esperado) : '<span class="not-set">sem regra</span>'}</td>` : ''}
      <td>${campoNivel(i.encontrado)}</td>
      <td class="cp-fim">${!i.diverge ? '' : campoMais(i)
        ? '<span class="pill pill-warning">Acesso a mais</span>'
        : '<span class="pill pill-critical">Acesso a menos</span>'}</td>
    </tr>`).join('');

  const explica = comRegra
    ? `Os campos que divergem da matriz e os declarados em <span class="mono">campos.${esc(objeto)}</span>.`
    : !campos.editavel
      ? 'Este perfil não cria nem edita o objeto, então todo campo visível é só leitura. Aqui, os que ele nem vê.'
      : `Os campos que este perfil não vê ou não edita. Nada aqui é conferido: não há
         <span class="mono">campos.${esc(objeto)}</span> declarado para ele.`;
  const vazio = todos ? 'Nenhum campo corresponde à busca.'
    : comRegra ? 'Nenhum campo diverge da matriz.'
    : campos.editavel ? 'Nenhuma restrição: este perfil vê todos os campos e edita todos os editáveis.'
    : 'Nenhum campo oculto para este perfil.';

  // O que ficou de fora da lista curta, em números: quem não abre "todos" ainda sabe o tamanho.
  const fora = todos ? [] : campos.itens.filter(i => !campos.destaque.includes(i));
  const contagem = CAMPO_ORDEM.slice().reverse()
    .map(n => [fora.filter(i => i.encontrado === n).length, CAMPO_NIVEL[n].toLowerCase()])
    .filter(([n]) => n).map(([n, rotulo]) => `${n} ${rotulo}`).join(', ');

  return `
    <div class="cp-caixa">
      <div class="cp-barra">
        <span class="cp-explica">${todos ? `Todos os ${campos.itens.length} campos do objeto.` : explica}</span>
        ${todos && campos.itens.length > CAMPO_MIN_BUSCA ? `
          <div class="search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="text" data-fic-campo-busca="${esc(objeto)}" placeholder="Buscar campo ou tipo…" value="${esc(fichaCampoBusca[objeto] || '')}" />
          </div>` : ''}
        <button type="button" class="cp-alternar" data-fic-campos-todos="${esc(objeto)}">${
          todos ? 'Só o que importa' : `Ver todos os ${campos.itens.length} campos`}</button>
      </div>
      ${vis.length ? `
        <table class="campos">
          <thead><tr><th>Campo</th>${campos.comTipo ? '<th>Tipo</th>' : ''}${comRegra ? '<th>Matriz</th>' : ''}<th>Na org</th><th></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>` : `<p class="fic-vazio">${vazio}</p>`}
      ${fora.length ? `<p class="cp-resto">Mais ${plural(fora.length, 'campo', 'campos')} fora desta lista: ${contagem}.</p>` : ''}
    </div>`;
}

/**
 * Matriz de acesso deste perfil: um objeto por linha, uma operação por coluna.
 *
 * A matriz completa (todos os perfis de uma vez) saiu do painel: com 15 perfis eram 60 colunas
 * de rolagem horizontal, e ela ainda aparecia duas vezes na mesma aba. Aqui é de um perfil só,
 * e a comparação com um segundo cobre a pergunta "por que esses dois se comportam diferente?".
 *
 * Os campos entram dentro da linha do objeto, e não como uma segunda matriz: campo só tem
 * sentido dentro do objeto dele, e onze objetos com sessenta campos cada um, lado a lado,
 * seriam a parede de células que esta ficha já deixou de ser. Abre sozinho só o objeto com
 * campo divergente.
 */
function fichaBlocoAcesso(f) {
  if (ACCESS_ROWS.length === 0) {
    return `<div class="fic-bloco"><h3>Acesso por objeto</h3>
      <p class="fic-vazio">Nenhuma conferência de acesso registrada. Rode
      <span class="mono">npx playwright test tests/e2e/specs/acesso</span>.</p></div>`;
  }

  const linhas = ACCESS_ROWS.map(row => {
    const run = row.byProfile[f.nome];
    const cels = OPERACOES_FICHA.map(op => {
      if (!run) return '<td class="ac-none" title="Não conferido neste perfil">·</td>';
      if (!run.access) return '<td class="ac-diff" title="A conferência falhou antes de ler as permissões">?</td>';
      const m = FICHA_ACESSO[accessState(run.access, op)];
      return `<td class="${m.cls}" title="${esc(m.label)}">${m.mark}<span class="visually-hidden">${esc(m.label)}</span></td>`;
    }).join('');
    const campos = camposDoObjeto(row, f.nome);
    if (!campos) return `<tr><td class="ac-obj">${esc(row.objeto)}</td>${cels}</tr>`;

    const padrao = campos.divergentes.length > 0;
    const aberto = fichaObjetoInvertido.has(row.objeto) ? !padrao : padrao;
    const restritos = campos.itens.filter(i => i.restrito).length;
    const resumo = plural(campos.itens.length, 'campo', 'campos') + (campos.divergentes.length
      ? ` · <b class="cp-ruim">${plural(campos.divergentes.length, 'diferente', 'diferentes')} da matriz</b>`
      : campos.regra ? ' · conforme' : restritos ? ` · ${plural(restritos, 'restrito', 'restritos')}` : '');
    return `
      <tr${aberto ? ' class="is-aberto"' : ''}>
        <td class="ac-obj">
          <button type="button" class="cp-toggle" data-fic-campos="${esc(row.objeto)}" aria-expanded="${aberto}">
            <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            ${esc(row.objeto)}
          </button>
          <span class="case-id">${resumo}</span>
        </td>${cels}
      </tr>
      ${aberto ? `<tr class="cp-row"><td colspan="${OPERACOES_FICHA.length + 1}">${fichaCampos(row.objeto, campos)}</td></tr>` : ''}`;
  }).join('');
  const temCampos = ACCESS_ROWS.some(row => camposDoObjeto(row, f.nome));

  const legenda = Object.values(FICHA_ACESSO)
    .map(m => `<span><i class="${m.cls}">${m.mark}</i>${esc(m.label)}</span>`)
    .join('');

  return `<div class="fic-bloco"><h3>Acesso por objeto</h3>
    <div class="fic-sub">Conferido pela API com o próprio usuário do perfil, comparado com a matriz em
      <span class="mono">tests/e2e/test-data/perfis</span>.${temCampos ? ' Clique em um objeto para ver os campos dele.' : ''}</div>
    <div class="table-scroll"><table class="access">
      <thead><tr><th class="ac-obj">Objeto</th>${OPERACOES_FICHA.map(op => `<th>${esc(op)}</th>`).join('')}</tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>
    <div class="access-legend">${legenda}</div></div>`;
}

function fichaBlocoComparacao(a, b) {
  const casos = [];
  for (const ia of a.itens) {
    const ib = b.itens.find(x => x.caso.suiteId === ia.caso.suiteId && x.caso.id === ia.caso.id);
    const eb = ib ? ib.estado : null;
    if (ia.estado !== eb) casos.push({ caso: ia.caso, ea: ia.estado, eb });
  }
  for (const ib of b.itens) {
    if (!a.itens.some(x => x.caso.suiteId === ib.caso.suiteId && x.caso.id === ib.caso.id)) {
      casos.push({ caso: ib.caso, ea: null, eb: ib.estado });
    }
  }
  const celula = (e) => (e ? fichaPill(e) : '<span class="not-set">não se aplica</span>');

  const objs = [];
  for (const row of ACCESS_ROWS) {
    const ra = row.byProfile[a.nome], rb = row.byProfile[b.nome];
    if (!ra || !rb || !ra.access || !rb.access) continue;
    const ea = (ra.access.encontrado || []).join(', '), eb = (rb.access.encontrado || []).join(', ');
    if (ea !== eb) objs.push({ objeto: row.objeto, ea, eb });
  }

  // Campo a campo, só onde os dois perfis diferem. Campo ausente de um lado é campo que
  // aquele perfil não vê.
  const cmpCampos = [];
  for (const row of ACCESS_ROWS) {
    const ca = camposDoObjeto(row, a.nome), cb = camposDoObjeto(row, b.nome);
    if (!ca || !cb) continue;
    const mb = new Map(cb.itens.map(i => [i.nome, i]));
    const nomes = new Set([...ca.itens, ...cb.itens].map(i => i.nome));
    const ma = new Map(ca.itens.map(i => [i.nome, i]));
    const difs = [...nomes].map(nome => ({
      nome,
      ea: (ma.get(nome) || { encontrado: 'oculto' }).encontrado,
      eb: (mb.get(nome) || { encontrado: 'oculto' }).encontrado
    })).filter(d => d.ea !== d.eb).sort((x, y) => x.nome.localeCompare(y.nome));
    if (difs.length) cmpCampos.push({ objeto: row.objeto, difs });
  }
  const parDeNiveis = (d) => `${CAMPO_NIVEL[d.ea].toLowerCase()} → ${CAMPO_NIVEL[d.eb].toLowerCase()}`;
  // Quando muitos campos mudam do mesmo jeito (um perfil edita o objeto, o outro só lê),
  // nomear um por um repete dezenas de vezes o que a linha do objeto, logo acima, já disse:
  // eles viram uma contagem, e só as mudanças raras aparecem pelo nome.
  const resumoDaDiferenca = (difs) => {
    const porPar = new Map();
    for (const d of difs) porPar.set(parDeNiveis(d), [...(porPar.get(parDeNiveis(d)) || []), d.nome]);
    return [...porPar].sort((x, y) => x[1].length - y[1].length)
      .map(([par, nomes]) => nomes.length > CAMPOS_NO_RESUMO ? `${nomes.length} campos: ${par}` : nomes.map(n => `${n}: ${par}`).join(' · '))
      .join(' · ');
  };

  // Cenário e objeto respondem a perguntas diferentes — o que o perfil FAZ de diferente e o
  // que ele PODE de diferente — e vinham na mesma lista corrida, onde "Excluir um Lead" e
  // "Account" pareciam itens do mesmo tipo. O rótulo separa as duas leituras.
  const grupos = [];
  if (casos.length) {
    grupos.push({
      rotulo: 'Cenários',
      linhas: casos.map(c => `
      <div class="fic-linha">
        <span class="t">${esc(c.caso.title)}<small>${esc(c.caso.suiteName + ' · ' + c.caso.id)}</small></span>
        <span class="fic-dif">${celula(c.ea)}<span class="fic-seta">→</span>${celula(c.eb)}</span>
      </div>`).join('')
    });
  }
  if (objs.length) {
    grupos.push({
      rotulo: 'Acesso por objeto',
      linhas: objs.map(o => `
      <div class="fic-linha">
        <span class="t">${esc(o.objeto)}</span>
        <span class="fic-dif"><b>${esc(o.ea || 'nenhum')}</b><span class="fic-seta">→</span><b>${esc(o.eb || 'nenhum')}</b></span>
      </div>`).join('')
    });
  }

  // Vem primeiro entre os grupos de acesso: é a causa, e as linhas de objeto e campo são o efeito.
  const atribuidos = (f) => (f.conjuntos ? f.conjuntos.itens.filter(i => i.estado !== 'faltando') : null);
  const ca = atribuidos(a), cb = atribuidos(b);
  if (ca && cb) {
    const soDeUm = [
      ...ca.filter(i => !cb.some(x => x.nome === i.nome)).map(i => ({ i, tem: a.nome })),
      ...cb.filter(i => !ca.some(x => x.nome === i.nome)).map(i => ({ i, tem: b.nome }))
    ];
    if (soDeUm.length) {
      grupos.push({
        rotulo: 'Conjuntos de permissão',
        linhas: soDeUm.map(({ i, tem }) => `
      <div class="fic-linha">
        <span class="t">${esc(i.rotulo)}<small><span class="mono">${esc(i.nome)}</span> · ${conjuntoTipo(i)}</small></span>
        <span class="fic-dif"><b>só ${esc(tem)} tem</b></span>
      </div>`).join('')
      });
    }
  }
  if (cmpCampos.length) {
    grupos.push({
      rotulo: 'Acesso por campo',
      linhas: cmpCampos.map(o => `
      <div class="fic-linha">
        <span class="t">${esc(o.objeto)}<small>${esc(resumoDaDiferenca(o.difs))}</small></span>
        <span class="fic-dif"><b>${plural(o.difs.length, 'campo', 'campos')}</b></span>
      </div>`).join('')
    });
  }

  return `<div class="fic-bloco"><h3>${esc(a.nome)} → ${esc(b.nome)}</h3>
    <div class="fic-sub">Só o que muda entre os dois. Em revisão de permissão, é esta a pergunta:
      por que dois perfis parecidos se comportam diferente?</div>
    ${grupos.map((g, i) => `<div class="fic-cmp-grupo${i === 0 ? ' is-primeiro' : ''}">${g.rotulo}</div>${g.linhas}`).join('')}
    ${!grupos.length ? '<p class="fic-vazio">Os dois perfis se comportam de forma idêntica em tudo que foi testado.</p>' : ''}</div>`;
}

function renderFicha() {
  const caixa = document.getElementById('profileFicha');
  const lista = document.getElementById('profileCards');
  if (!fichaAberta) {
    caixa.hidden = true;
    lista.hidden = false;
    return;
  }
  const f = fichaDados(fichaAberta);
  const divergencias = f.divergencias.length + f.acesso.length + f.campos.length +
    (f.conjuntos ? f.conjuntos.divergentes.length : 0);
  const outros = PROFILES.filter(p => p !== fichaAberta);

  caixa.innerHTML = `
    <div class="fic-top">
      <button type="button" class="fic-voltar" id="fichaVoltar">← Todos os perfis</button>
      <span class="fic-nome">${esc(f.nome)}</span>
      ${f.info && f.info.perfilSalesforce ? `<span class="fic-sf">${esc(f.info.perfilSalesforce)}</span>` : ''}
      ${outros.length ? `<span class="fic-cmp">Comparar com
        <select class="select-suite" id="fichaCmp"><option value="">—</option>
        ${outros.map(p => `<option value="${esc(p)}"${p === fichaComparar ? ' selected' : ''}>${esc(p)}</option>`).join('')}
        </select></span>` : ''}
    </div>
    <div class="fic-nums">
      <span class="fic-num"><b style="color:${f.taxa === 100 ? 'var(--good-ink)' : 'var(--critical-ink)'}">${f.taxa}%</b><span>conformes</span></span>
      <span class="fic-num"><b>${f.itens.length}</b><span>cenários se aplicam</span></span>
      <span class="fic-num"><b>${f.permitidos.length}</b><span>deve conseguir</span></span>
      <span class="fic-num"><b>${f.negados.length}</b><span>deve ser barrado</span></span>
      <span class="fic-num"><b style="color:${divergencias ? 'var(--critical-ink)' : 'var(--good-ink)'}">${divergencias}</b><span>divergências</span></span>
    </div>
    ${fichaComparar && PROFILES.includes(fichaComparar)
      ? fichaBlocoComparacao(f, fichaDados(fichaComparar))
      : `${fichaBlocoDivergencias(f)}
         ${fichaBlocoConjuntos(f)}
         ${fichaBlocoBusca(f)}
         <div class="fic-bloco"><h3>O que este perfil deve conseguir fazer</h3>
           <div class="fic-sub">${plural(f.permitidos.length, 'cenário', 'cenários')} em que a matriz diz que ele executa, por suíte.</div>
           ${fichaGrupos(f.permitidos, 'perm', { ok: 'Todos executam', ruim1: 'falhou', ruimN: 'falharam',
             vazio: 'Nenhum fluxo roda neste perfil.' })}</div>
         ${fichaBlocoNegados(f)}
         ${fichaBlocoAcesso(f)}`}
    <button type="button" class="fic-voltar" data-ficha-casos="${esc(f.nome)}">Ver todos os casos deste perfil na aba Casos →</button>`;

  caixa.hidden = false;
  lista.hidden = true;

  document.getElementById('fichaVoltar').addEventListener('click', () => {
    fichaAberta = null; fichaComparar = '';
    renderFicha();
    document.querySelector('#perfis .section-head').scrollIntoView({ block: 'start' });
  });
  const cmp = document.getElementById('fichaCmp');
  if (cmp) cmp.addEventListener('change', (e) => { fichaComparar = e.target.value; renderFicha(); });
  caixa.querySelectorAll('[data-ficha-casos]').forEach(b =>
    b.addEventListener('click', () => openCasesForProfile(b.dataset.fichaCasos)));
  caixa.querySelectorAll('[data-fic-grupo]').forEach(b =>
    b.addEventListener('click', () => {
      const k = b.dataset.ficGrupo;
      if (fichaGrupoInvertido.has(k)) fichaGrupoInvertido.delete(k); else fichaGrupoInvertido.add(k);
      renderFicha();
    }));
  const alternar = (attr, conjunto) =>
    caixa.querySelectorAll(`[${attr}]`).forEach(b =>
      b.addEventListener('click', () => {
        const k = b.getAttribute(attr);
        if (conjunto.has(k)) conjunto.delete(k); else conjunto.add(k);
        renderFicha();
      }));
  alternar('data-fic-campos', fichaObjetoInvertido);
  alternar('data-fic-campos-todos', fichaCamposTodos);
  caixa.querySelectorAll('[data-fic-campo-busca]').forEach(input =>
    input.addEventListener('input', (e) => {
      const objeto = input.dataset.ficCampoBusca;
      fichaCampoBusca[objeto] = e.target.value;
      renderFicha();
      const outra = [...caixa.querySelectorAll('[data-fic-campo-busca]')].find(i => i.dataset.ficCampoBusca === objeto);
      outra.focus();
      outra.setSelectionRange(outra.value.length, outra.value.length);
    }));
  const busca = document.getElementById('fichaBusca');
  if (busca) {
    busca.addEventListener('input', (e) => {
      fichaBusca = e.target.value;
      renderFicha();
      // renderFicha refaz o campo: sem devolver o cursor, a digitação para na primeira letra.
      const outra = document.getElementById('fichaBusca');
      outra.focus();
      outra.setSelectionRange(outra.value.length, outra.value.length);
    });
  }
}

function abrirFicha(perfil) {
  fichaAberta = perfil;
  fichaComparar = '';
  fichaBusca = '';
  fichaGrupoInvertido.clear();
  fichaObjetoInvertido.clear();
  fichaCamposTodos.clear();
  for (const k of Object.keys(fichaCampoBusca)) delete fichaCampoBusca[k];
  renderFicha();
}

function renderProfiles() {
  const tab = document.getElementById('tab-perfis');
  tab.hidden = !SHOW_PROFILES_TAB;
  if (!SHOW_PROFILES_TAB) return;

  // Lista sempre, com qualquer número de perfis. O card por perfil saiu por dois motivos.
  // Ele gastava uma caixa grande para repetir os mesmos seis números de cada perfil, o que
  // vira rolagem já no quinto. E o layout trocava sozinho ao passar de quatro: a aba virava
  // outra aba no dia em que o projeto crescesse, sem ninguém ter pedido. Uma forma só,
  // ordenada por quem tem problema, se lê igual com 2 e com 15.
  renderProfileTable();

  // A matriz completa (todos os perfis × todos os objetos) saiu daqui. Ela aparecia duas vezes
  // na mesma aba — como seção própria e dentro da ficha — e era a peça que não sobrevivia à
  // escala: 15 perfis × 4 operações dão 60 colunas de rolagem horizontal.
  //
  // O acesso por objeto agora vive só na ficha do perfil (fichaBlocoAcesso), onde é de um perfil
  // de cada vez e tem a comparação com um segundo. As divergências continuam em dois lugares que
  // já existiam: "Precisa de atenção", na Visão geral, e o bloco Divergências da própria ficha.

  document.querySelectorAll('#view-perfis [data-jump]').forEach(btn => {
    btn.addEventListener('click', () => jumpToCase(btn.dataset.jump));
  });

  const badge = document.getElementById('profilesBadge');
  badge.textContent = String(ACCESS_FAILURES.length);
  badge.title = plural(ACCESS_FAILURES.length, 'objeto com acesso diferente da matriz', 'objetos com acesso diferente da matriz');
  badge.hidden = ACCESS_FAILURES.length === 0;
}

/* ---------------------------------------------------------------------------
 * Duração por suíte e navegador
 * ------------------------------------------------------------------------- */
// Legenda de navegadores do gráfico de duração, montada a partir do que realmente rodou.
// Ficava fixa no HTML e nomeava navegadores que a suíte já não roda.
function preencherLegendasDeNavegador() {
  const el = document.getElementById("legendaDuracao");
  if (!el) return;
  // Com um navegador só a legenda não distingue ninguém: fica vazia.
  el.innerHTML = DATA.meta.browsers.length > 1
    ? DATA.meta.browsers.map(b => `<span class="key"><i style="background:${seriesColor(b)}"></i>${esc(b)}</span>`).join("")
    : "";
}

function renderDuration() {
  const groups = SUITE_STATS.map(s => {
    const byBrowser = DATA.meta.browsers.map(b => {
      const runs = s.runs.filter(r => r.browser === b);
      return { browser: b, avg: runs.length ? runs.reduce((n, r) => n + r.durationMs, 0) / runs.length : 0 };
    });
    return { name: s.name, cases: s.cases.length, byBrowser };
  });

  const max = Math.max(...groups.flatMap(g => g.byBrowser.map(b => b.avg)), 1);

  document.getElementById('durRows').innerHTML = groups.map(g => `
    <div class="dur-group">
      <div class="name"><span>${esc(g.name)}</span><span>${g.cases} caso${g.cases === 1 ? '' : 's'}</span></div>
      <div class="dur-bars">
        ${g.byBrowser.map(b => `
          <div class="dur-row">
            <span>${esc(shortBrowser(b.browser))}</span>
            <div class="dur-track"><div class="dur-fill" style="width:${(b.avg / max) * 100}%;background:${seriesColor(b.browser)}"></div></div>
            <span class="dur-val tabular">${fmtSeconds(b.avg)}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');

  const slowest = [...FLOW_CASES].sort((a, b) => b.durationMs - a.durationMs)[0];
  // Só soma os fluxos, enquanto o KPI "Tempo somado" soma todas as execuções. Com um
  // navegador os dois viram o mesmo total com escopos diferentes, e o leitor conclui que
  // o painel se contradiz. Com dois ou mais, comparar navegadores é o motivo de existir.
  const totals =
    DATA.meta.browsers.length > 1
      ? DATA.meta.browsers
          .map(b => {
            const runs = FLOW_RUNS.filter(r => r.browser === b);
            return `<b>${esc(b)}</b> ${fmtSeconds(runs.reduce((n, r) => n + r.durationMs, 0))}`;
          })
          .join(' · ')
      : '';

  // O porquê de não subir o workers é conhecimento bom, mas não é leitura deste gráfico:
  // fica a um hover de distância em vez de ocupar três linhas em toda abertura da seção.
  const WORKERS_TIP = 'Cada worker abre uma sessão própria na org. Subir muito arrisca o limite de sessões simultâneas.';

  document.getElementById('durCallout').innerHTML = [
    `Caso mais lento: <b>${esc(slowest.title)}</b> (${esc(slowest.suiteName)} · ${esc(slowest.id)}) com ${fmtSeconds(slowest.durationMs)}`,
    totals && `Por navegador: ${totals}`,
    DATA.meta.workers && `<b title="${esc(WORKERS_TIP)}">workers: ${DATA.meta.workers}</b>`
  ].filter(Boolean).join(' · ');
}

/* ---------------------------------------------------------------------------
 * Casos que mais oscilam
 * ------------------------------------------------------------------------- */
// Quantos casos o ranking mostra: é uma lista de trabalho, não um inventário.
const OSC_MAX = 10;
const OSC_STATE = {
  passed: { label: 'Passou', color: 'var(--good)' },
  flaky: { label: 'Só passou no retry', color: 'var(--warning)' },
  failed: { label: 'Falhou', color: 'var(--critical)' }
};
const oscState = (e) => (e.status !== 'passed' ? 'failed' : e.retry > 0 ? 'flaky' : 'passed');

// A linha do tempo de uma execução (caso × perfil × navegador), da mais antiga à atual.
function oscillationOf(r) {
  // Pulada não é virada: o caso não rodou naquela vez.
  const seq = [...(r.historico || []), { date: r.startedAt, status: r.status, retry: r.retry }].filter(e => !isSkippedRun(e));
  // Virada: o resultado mudou de uma execução para a seguinte, em qualquer sentido.
  const viradas = seq.filter((e, i) => i > 0 && (e.status === 'passed') !== (seq[i - 1].status === 'passed')).length;
  const retries = seq.filter(e => oscState(e) === 'flaky').length;
  return { run: r, seq, viradas, retries, score: viradas + retries };
}

// Uma virada sozinha não é oscilação: é um defeito que apareceu, ou um que foi corrigido, e a
// fila de atenção já cuida dos dois. Entra no ranking quem virou duas vezes ou precisou de retry.
//
// O caso vale pela sua pior execução, e não pela soma dos perfis: somando, um cenário que quebrou
// e foi consertado em quinze perfis passaria na frente de um que oscila de verdade em um só.
const OSCILLATING = FLOW_CASES
  .map(c => {
    const runs = c.runs.map(oscillationOf).filter(o => o.viradas >= 2 || o.retries >= 1).sort((a, b) => b.score - a.score);
    return runs.length ? { c, runs, worst: runs[0] } : null;
  })
  .filter(Boolean)
  .sort((a, b) => b.worst.score - a.worst.score || b.runs.length - a.runs.length);

function renderOscillation() {
  const todas = FLOW_RUNS.map(oscillationOf);
  const janela = Math.max(...todas.map(o => o.seq.length), 1);
  // Histórico gravado antes de o retry ser guardado: ali só dá para ver a virada.
  const semRetry = todas.some(o => o.seq.slice(0, -1).some(e => typeof e.retry !== 'number'));

  document.getElementById('oscSub').textContent = OSCILLATING.length
    ? `${plural(OSCILLATING.length, 'caso mudou', 'casos mudaram')} de resultado mais de uma vez ou só ${OSCILLATING.length === 1 ? 'passou' : 'passaram'} no retry.`
    : 'Nenhum caso oscilou nas execuções guardadas.';
  document.getElementById('oscHint').textContent =
    `Viradas de resultado entre execuções seguidas, mais as vezes em que o caso só passou no retry. Considera até ${janela} execuções de cada caso em cada perfil.`;
  document.getElementById('oscLegend').innerHTML = Object.values(OSC_STATE)
    .map(s => `<span class="key"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('');

  const strip = (o) => `<span class="osc-strip" role="img" aria-label="${esc(o.seq.map(e => OSC_STATE[oscState(e)].label).join(', '))}">${
    o.seq.map(e => `<i style="background:${OSC_STATE[oscState(e)].color}" title="${esc(fmtDateTime(e.date))} · ${esc(OSC_STATE[oscState(e)].label)}"></i>`).join('')}</span>`;

  const rows = document.getElementById('oscRows');
  rows.innerHTML = !OSCILLATING.length
    ? `<p class="osc-empty">Nenhum caso virou de resultado duas vezes nem precisou de retry. Uma virada sozinha fica de fora: é defeito que apareceu ou que foi corrigido.</p>`
    : `<table class="runs osc-table">
        <thead><tr><th class="num">#</th><th>Caso</th><th class="num">Oscilações</th><th>Histórico, da mais antiga à atual</th><th></th></tr></thead>
        <tbody>${OSCILLATING.slice(0, OSC_MAX).map(({ c, runs, worst }, i) => {
          const partes = [
            worst.viradas && plural(worst.viradas, 'virada', 'viradas'),
            worst.retries && plural(worst.retries, 'retry', 'retries')
          ].filter(Boolean).join(' · ');
          const outras = runs.slice(1).map(o => runShortLabel(o.run));
          // Um bug registrado explica a sequência de falhas: sem dizer isso, o leitor trata como
          // teste frágil um caso que só acompanhou um defeito do sistema.
          const bugs = c.bugs.length ? ` · bug registrado: ${c.bugs.map(b => b.id).join(', ')}` : '';
          return `
          <tr>
            <td class="tabular">${i + 1}</td>
            <td class="osc-case"><b>${esc(c.title)}</b><span><span class="mono">${esc(c.suiteName)} · ${esc(c.id)}</span>${esc(bugs)}</span></td>
            <td class="tabular"><span class="osc-score">${worst.score}</span><span class="osc-where">${esc(partes)}</span></td>
            <td>${strip(worst)}<span class="osc-where">${esc(runShortLabel(worst.run))}${outras.length ? ` · também em ${esc(outras.join(', '))}` : ''}</span></td>
            <td><button class="flag-jump" data-jump="${esc(caseKey(c))}">Abrir detalhe</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  wireAlerts(rows);

  document.getElementById('oscCallout').innerHTML = [
    OSCILLATING.length > OSC_MAX && `Mostrando os ${OSC_MAX} que mais oscilam, de ${OSCILLATING.length}`,
    OSCILLATING.length && 'Uma virada sozinha fica de fora: é defeito que apareceu ou que foi corrigido',
    semRetry && 'O retry das execuções mais antigas não foi guardado: nelas só a virada conta'
  ].filter(Boolean).join(' · ');
  document.getElementById('oscCallout').hidden = !document.getElementById('oscCallout').innerHTML;
}

/* ---------------------------------------------------------------------------
 * Lightbox de evidência
 * ------------------------------------------------------------------------- */
let lightbox = null;
function openLightbox(src, caption, filePath) {
  closeLightbox();
  lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML = `
    <button class="lightbox-close" aria-label="Fechar">${ICON_X}</button>
    <img src="${src}" alt="${esc(caption)}">
    <div class="lightbox-cap"><span>${esc(caption)}</span><span class="mono">${esc(filePath)}</span></div>`;
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox || e.target.closest('.lightbox-close')) closeLightbox(); });
  document.body.appendChild(lightbox);
  document.addEventListener('keydown', onEsc);
}
function closeLightbox() {
  if (!lightbox) return;
  lightbox.remove(); lightbox = null;
  document.removeEventListener('keydown', onEsc);
}
function onEsc(e) { if (e.key === 'Escape') closeLightbox(); }

/* ---------------------------------------------------------------------------
 * Atualizar painel — publica um qa-dashboard.html novo como versão deste artefato
 * ---------------------------------------------------------------------------
 * Só aparece dentro do claude.ai, para quem pode editar o artefato. O arquivo
 * escolhido é o fragmento gerado por scripts/painel/build.js; antes de publicar,
 * ele é envolvido no mesmo esqueleto de documento que a publicação normal usa.
 */
const PANEL_MARKER = 'name="generator" content="qa-dashboard"';
const DATA_NEEDLE = 'const DATA' + ' = ';
const PUBLISH_LIMIT_BYTES = 16 * 1024 * 1024;
const DOC_SKELETON =
  '<!doctype html><html><head><meta charset=utf8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}' +
  'html{scroll-padding-top:env(safe-area-inset-top,0px)}' +
  'body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}' +
  'img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';

const upd = {
  artifact: null,
  pending: null,
  root: document.getElementById('updater'),
  pick: document.getElementById('updaterPick'),
  file: document.getElementById('updaterFile'),
  strip: document.getElementById('updaterStrip'),
  msg: document.getElementById('updaterMsg'),
  confirm: document.getElementById('updaterConfirm'),
  repick: document.getElementById('updaterRepick'),
  cancel: document.getElementById('updaterCancel')
};

function showStrip(tone, html, actions) {
  upd.strip.dataset.tone = tone;
  upd.msg.innerHTML = html;
  upd.confirm.hidden = !actions.includes('confirm');
  upd.repick.hidden = !actions.includes('repick');
  upd.cancel.hidden = !actions.includes('cancel');
  [upd.confirm, upd.repick, upd.cancel].forEach(b => { b.disabled = false; });
  upd.strip.hidden = false;
}

function closeStrip() {
  upd.pending = null;
  upd.strip.hidden = true;
  upd.file.value = '';
}

function chooseFile() {
  upd.file.value = '';
  upd.file.click();
}

// Extrai os dados embutidos pelo build; null quando o arquivo não é um painel gerado por ele.
function readPanelFile(text) {
  const src = text.replace(/^\uFEFF/, ''); // BOM de arquivo salvo no Windows
  if (!src.slice(0, 2048).includes(PANEL_MARKER)) return null;
  const at = src.indexOf(DATA_NEEDLE);
  if (at < 0) return null;
  const from = at + DATA_NEEDLE.length;
  const len = src.slice(from).search(/;\r?\n/);
  if (len < 0) return null;
  try {
    const data = JSON.parse(src.slice(from, from + len));
    if (!data || !data.meta || !Array.isArray(data.suites) || !Array.isArray(data.runs)) return null;
    return { html: /^\s*<!doctype/i.test(src) ? src : DOC_SKELETON + src, data };
  } catch {
    return null;
  }
}

function describePanel(d) {
  const runs = d.suites.flatMap(s => s.cases.flatMap(c => c.runs));
  const cases = d.suites.reduce((n, s) => n + s.cases.length, 0);
  const passed = runs.filter(r => r.status === 'passed').length;
  const pulados = runs.filter(isSkippedRun).length;
  return `execução de <b>${esc(fmtDateTime(d.meta.lastRunAt))}</b> · ${cases} casos · ` +
    `${passed} de ${runs.length - pulados} execuções passaram${pulados ? ` (${pulados} puladas)` : ''} · ${d.runs.length} rodada${d.runs.length === 1 ? '' : 's'} no histórico`;
}

upd.pick.addEventListener('click', chooseFile);
upd.repick.addEventListener('click', chooseFile);
upd.cancel.addEventListener('click', closeStrip);

upd.file.addEventListener('change', async () => {
  const f = upd.file.files && upd.file.files[0];
  if (!f) return;
  const name = `<span class="mono">${esc(f.name)}</span>`;
  if (f.size > PUBLISH_LIMIT_BYTES) {
    showStrip('critical', `${name} tem ${(f.size / 1048576).toFixed(1)} MB e o limite de publicação é 16 MB. ` +
      `Reduza o THUMB_QUALITY em <span class="mono">scripts/painel/build.js</span> e gere o painel de novo.`, ['repick', 'cancel']);
    return;
  }
  const panel = readPanelFile(await f.text());
  if (!panel) {
    upd.pending = null;
    showStrip('critical', `${name} não é um Painel de QA gerado pelo build. ` +
      `Escolha o <span class="mono">test-evidence/qa-dashboard.html</span>.`, ['repick', 'cancel']);
    return;
  }
  upd.pending = panel;
  const current = DATA.meta.lastRunAt || '';
  const incoming = panel.data.meta.lastRunAt || '';
  if (incoming < current) {
    showStrip('warning', `${name}: ${describePanel(panel.data)}. Essa execução é <b>anterior</b> à do painel atual ` +
      `(${esc(fmtDateTime(current))}): publicar volta o painel no tempo.`, ['confirm', 'repick', 'cancel']);
  } else if (incoming === current) {
    showStrip('info', `${name}: ${describePanel(panel.data)}. É a mesma execução que o painel já mostra.`, ['confirm', 'repick', 'cancel']);
  } else {
    showStrip('info', `${name}: ${describePanel(panel.data)}.`, ['confirm', 'repick', 'cancel']);
  }
});

upd.confirm.addEventListener('click', async () => {
  if (!upd.pending || !upd.artifact) return;
  [upd.confirm, upd.repick, upd.cancel].forEach(b => { b.disabled = true; });
  upd.msg.textContent = 'Publicando… o painel recarrega sozinho com a versão nova.';
  try {
    await upd.artifact.publish(upd.pending.html);
    upd.msg.textContent = 'Publicado. Recarregando…';
  } catch (err) {
    const code = err && err.code;
    if (code === 'conflict') {
      showStrip('warning', 'Outra versão do painel acabou de ser publicada. A página está recarregando para ela.', []);
    } else if (['not_writer', 'not_granted', 'not_declared', 'consent_required', 'capability_disabled', 'capability_removed'].includes(code)) {
      upd.root.hidden = true;
      showStrip('critical', 'Sua conta pode ver este painel, mas não pode editá-lo. Peça para quem é dono do painel atualizar.', ['cancel']);
    } else if (code === 'too_large') {
      showStrip('critical', 'O arquivo passa do limite de publicação de 16 MB.', ['repick', 'cancel']);
    } else if (code === 'invalid_content' || code === 'transform_error') {
      showStrip('critical', 'A publicação recusou o arquivo. Gere o painel de novo com ' +
        '<span class="mono">node scripts/painel/build.js</span> e escolha o arquivo novo.', ['repick', 'cancel']);
    } else if (code === 'rate_limited') {
      showStrip('warning', 'Muitas publicações em sequência. Aguarde um minuto e clique em Publicar de novo.', ['confirm', 'cancel']);
    } else {
      showStrip('critical', 'A publicação falhou por um problema temporário. Clique em Publicar para tentar de novo.', ['confirm', 'cancel']);
    }
  }
});

async function initUpdater() {
  // Fora do claude.ai (o .html aberto direto do disco) não existe window.claude.
  if (!window.claude || typeof window.claude.use !== 'function') return;
  const [artifact, user] = await Promise.all([window.claude.use('artifact'), window.claude.use('user')]);
  if (!artifact) return;
  // canEdit() dispensa declaração; sem a capability user, a própria publicação decide.
  if (user && !(await user.canEdit())) return;
  upd.artifact = artifact;
  upd.root.hidden = false;
}

/* ---------------------------------------------------------------------------
 * Precisa de atenção (Visão geral)
 * ---------------------------------------------------------------------------
 * Tudo o que pede ação, em ordem: falhas novas, divergências de acesso, bugs abertos e
 * casos instáveis. Um fluxo que falha por um bug aberto aparece uma vez só, no item do bug.
 */
function accessFailureItem({ objeto, run, via }) {
  if (via === 'conjuntos') {
    return `
      <div class="flag-item">
        ${statusPill('failed')}
        <span class="flag-title">Conjuntos de permissão: ${esc(run.profile)}</span>
        <span class="flag-suite">${esc(conjuntosDivergentesTexto(run.profile) || 'a conferência falhou antes de ler os conjuntos')}</span>
        <button class="flag-jump" data-open-view="perfis" data-scroll="matriz">Ver perfis</button>
      </div>`;
  }
  const what = run.access
    ? [divergenceText(run.access, via), camposDivergentesTexto(run)].filter(Boolean).join(' · ') || 'a conferência falhou depois de ler as permissões'
    : 'a conferência falhou antes de ler as permissões';
  return `
      <div class="flag-item">
        ${statusPill('failed')}
        <span class="flag-title">Acesso: ${esc(run.profile)} em ${esc(objeto)}${via === 'tela' ? ' (na tela)' : ''}</span>
        <span class="flag-suite">${esc(what)}</span>
        <button class="flag-jump" data-open-view="perfis" data-scroll="matriz">Ver matriz</button>
      </div>`;
}

// Há quanto tempo o bug está aberto. Na fila de atenção, um bug de ontem e um de três meses
// se pareciam; o dado já existia em "encontradoEm" e só não estava sendo dito.
function idadeDoBug(b) {
  if (b.status !== 'aberto' || !b.encontradoEm) return '';
  // "encontradoEm" é uma data, sem hora: contar as horas desde o meio-dia daria "aberto há 8
  // horas" num bug registrado hoje de manhã. No dia em que foi encontrado, a idade é "hoje".
  if (b.encontradoEm >= new Date().toLocaleDateString('sv-SE')) return 'aberto hoje';
  return `aberto ${haQuantoTempo(`${b.encontradoEm}T12:00:00`)}`;
}

function openBugItem(b) {
  const c = CASES.find(x => `${x.suiteId}/${x.id}` === b.caso);
  // Só as execuções que este bug cobre: com um perfil declarado, a falha de outro perfil no
  // mesmo caso não é dele — ela tem o próprio item, como falha nova.
  const cobertas = c ? c.runs.filter(r => bugCobre(b, r)) : [];
  const falhando = cobertas.filter(isFailedRun);
  // Teste ligado ao bug passando: provável correção, falta confirmar e marcar como corrigido.
  const fixed = cobertas.some(r => r.status === 'passed') && falhando.length === 0;
  const onde = c ? `o teste ${c.suiteName} · ${c.id}` : '';
  const where = !c ? 'sem cenário da automação vinculado'
    : !cobertas.length ? `${onde} não rodou no perfil ${perfilDoBug(b)}`
      : fixed ? `${onde} passou na última execução: confirme a correção e marque como corrigido`
        : `${onde} ainda falha (${falhando.map(runShortLabel).join(', ')})`;
  const anterior = bugAnterior(b);
  const contexto = [idadeDoBug(b), anterior ? `repete ${anterior.id}` : '', where].filter(Boolean).join(' · ');
  return `
      <div class="flag-item ${fixed ? 'is-info' : 'is-flaky'}">
        ${statusPill('aberto')}
        <span class="flag-title"><span class="mono bug-id">${esc(b.id)}</span> ${esc(b.titulo)}</span>
        <span class="flag-suite">${esc(contexto)}</span>
        <button class="flag-jump" data-open-bug="${esc(b.id)}">Ver bug</button>
      </div>`;
}

// Um item só para todos os resultados antigos: eles pedem uma rodada completa, não um por um.
function staleItem() {
  const sample = STALE_CASES.slice(0, 3).map(c => `${c.suiteName} · ${c.id}`).join(', ');
  const more = STALE_CASES.length > 3 ? ` e mais ${STALE_CASES.length - 3}` : '';
  return `
      <div class="flag-item is-info">
        ${statusPill('stale')}
        <span class="flag-title">${plural(STALE_CASES.length, 'caso não rodou', 'casos não rodaram')} na última rodada completa (${esc(fmtDateShort(STALE_BEFORE))})</span>
        <span class="flag-suite">${esc(sample + more)}. Se algum foi apagado ou renomeado no código, rode a suíte completa com DASHBOARD_RESET=1.</span>
        <button class="flag-jump" data-filter-status="stale">Ver casos</button>
      </div>`;
}

function renderAttention() {
  const openBugs = BUGS.filter(b => b.status === 'aberto');
  const items = [
    ...NEW_FAILURES.map(newFailureItem),
    ...ACCESS_FAILURES.map(accessFailureItem),
    ...openBugs.map(openBugItem),
    ...UNSTABLE.map(unstableItem),
    ...(STALE_CASES.length ? [staleItem()] : [])
  ];
  const list = document.getElementById('attentionList');
  list.innerHTML = items.length
    ? items.join('')
    : clearItem('Nada precisa de atenção', 'Nenhuma falha nova, divergência de acesso ou bug aberto');
  wireAlerts(list);

  const parts = [
    NEW_FAILURES.length && plural(NEW_FAILURES.length, 'falha nova', 'falhas novas'),
    ACCESS_FAILURES.length && plural(ACCESS_FAILURES.length, 'divergência de acesso', 'divergências de acesso'),
    openBugs.length && plural(openBugs.length, 'bug aberto', 'bugs abertos'),
    UNSTABLE.length && plural(UNSTABLE.length, 'caso instável', 'casos instáveis'),
    STALE_CASES.length && plural(STALE_CASES.length, 'resultado antigo', 'resultados antigos')
  ].filter(Boolean);
  // Com a fila vazia o resumo fica vazio também: o card logo abaixo já diz "Nada precisa de
  // atenção" e lista o que foi conferido. Um "tudo em ordem" aqui seria a terceira vez que a
  // mesma frase aparece na mesma faixa da tela. O resumo existe para contar o que há, não
  // para anunciar que não há nada.
  document.getElementById('attentionSum').textContent = parts.join(' · ');
}

/* ---------------------------------------------------------------------------
 * Tendência: taxa de sucesso dos fluxos por rodada completa (Visão geral)
 * ---------------------------------------------------------------------------
 * Uma série só: linha de 2px na cor da série 1, marcadores com anel da cor da superfície,
 * rótulo só no último ponto, cursor vertical + tooltip no hover e no teclado (setas), e a
 * mesma informação em tabela.
 */
function renderTrend() {
  const box = document.getElementById('trendChart');
  const tableBox = document.getElementById('trendTable');
  const rounds = COMPLETE_ROUNDS.map(r => ({ ...r, rate: pct(r.passed, r.total) }));
  document.getElementById('trendMeta').textContent = rounds.length
    ? `${plural(rounds.length, 'rodada completa', 'rodadas completas')} · última em ${fmtDateShort(rounds[rounds.length - 1].date)}`
    : '';
  if (rounds.length === 0) {
    box.innerHTML = '<p class="empty-note">Nenhuma rodada completa registrada ainda. Rode <span class="mono">npm run test:e2e</span>.</p>';
    tableBox.closest('details').hidden = true;
    return;
  }

  // Abaixo deste número de pontos, a linha some e fica a tabela.
  //
  // Uma linha entre dois ou três pontos desenha uma trajetória que não foi medida, e ainda por
  // cima esconde o que mais importa comparar: o denominador. Uma rodada de 100% sobre 28
  // execuções e outra de 97% sobre 58 não são a mesma suíte, mas o gráfico as liga como se
  // fossem — a subida aparente é a base mudando, não a qualidade.
  //
  // A tabela mostra os mesmos dados sem interpretar nada, com o nº de execuções ao lado da taxa.
  // Quando houver histórico que sustente uma curva, a linha volta sozinha.
  const MIN_PONTOS_PARA_LINHA = 6;
  if (rounds.length < MIN_PONTOS_PARA_LINHA) {
    renderTrendTable(tableBox, rounds);
    const detalhes = tableBox.closest('details');
    detalhes.hidden = false;
    detalhes.open = true;
    detalhes.querySelector('summary').textContent = 'Rodadas completas registradas';
    box.innerHTML =
      '<p class="empty-note">' +
      plural(rounds.length, 'rodada completa registrada', 'rodadas completas registradas') +
      '. A linha de tendência aparece a partir de ' + MIN_PONTOS_PARA_LINHA +
      ': com menos pontos ela sugeriria uma trajetória que ainda não foi medida.</p>';
    return;
  }

  const W = Math.max(280, box.clientWidth || 600);
  const H = 190;
  const m = { top: 14, right: 44, bottom: 26, left: 40 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;
  // Eixo a partir de um múltiplo de 20 abaixo do pior ponto: uma queda de 100% para 90% aparece.
  const yMin = Math.min(80, Math.max(0, Math.floor((Math.min(...rounds.map(r => r.rate)) - 5) / 20) * 20));
  const ticks = [yMin, yMin + (100 - yMin) / 2, 100];
  const x = (i) => m.left + (rounds.length === 1 ? pw / 2 : (i / (rounds.length - 1)) * pw);
  const y = (v) => m.top + (1 - (v - yMin) / (100 - yMin)) * ph;
  const pts = rounds.map((r, i) => [x(i), y(r.rate)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const base = y(yMin).toFixed(1);
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${base} L${pts[0][0].toFixed(1)},${base} Z`;
  const last = rounds[rounds.length - 1];
  const dateLabel = (r) => new Date(r.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const xLabels = rounds.length === 1 ? [0] : [0, rounds.length - 1];

  box.innerHTML = `
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
      ${ticks.map(t => `<line class="grid" x1="${m.left}" x2="${W - m.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>
        <text class="tick" x="${m.left - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${t}%</text>`).join('')}
      ${xLabels.map(i => `<text class="tick" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${rounds.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'}">${dateLabel(rounds[i])}</text>`).join('')}
      ${rounds.length > 1 ? `<path class="area" d="${area}"/><path class="line" d="${line}"/>` : ''}
      <line class="cross" x1="0" x2="0" y1="${m.top}" y2="${m.top + ph}" visibility="hidden"/>
      ${pts.map(([px, py], i) => `<circle class="dot" data-i="${i}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4"/>`).join('')}
      <text class="end-label" x="${(pts[pts.length - 1][0] + 9).toFixed(1)}" y="${(pts[pts.length - 1][1] + 4).toFixed(1)}">${last.rate}%</text>
      <rect class="hit" x="${m.left - 12}" y="0" width="${pw + 24}" height="${H}" fill="transparent"/>
    </svg>
    <div class="trend-tip" hidden><b></b><span></span></div>
    ${rounds.length === 1 ? '<p class="empty-note">Só uma rodada completa registrada: a linha aparece a partir da segunda.</p>' : ''}`;
  box.tabIndex = 0;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Taxa de sucesso por rodada completa: ${rounds.length} rodadas, a última com ${last.rate}%. Use as setas para percorrer.`);

  const svg = box.querySelector('svg');
  const cross = svg.querySelector('.cross');
  const dots = [...svg.querySelectorAll('.dot')];
  const tip = box.querySelector('.trend-tip');
  let active = -1;
  function show(i) {
    active = Math.max(0, Math.min(rounds.length - 1, i));
    const [px, py] = pts[active];
    const r = rounds[active];
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    dots.forEach((d, k) => d.classList.toggle('is-active', k === active));
    // Rótulos vindos dos dados entram por textContent, nunca por innerHTML.
    tip.querySelector('b').textContent = `${r.rate}%`;
    tip.querySelector('span').textContent = `${r.passed} de ${r.total} aprovadas · ${fmtDateTime(r.date)}`;
    tip.hidden = false;
    const left = Math.max(0, Math.min(W - tip.offsetWidth, px - tip.offsetWidth / 2));
    tip.style.transform = `translate(${left}px, ${Math.max(0, py - tip.offsetHeight - 12)}px)`;
  }
  function hide() {
    active = -1;
    cross.setAttribute('visibility', 'hidden');
    dots.forEach(d => d.classList.remove('is-active'));
    tip.hidden = true;
  }
  const nearest = (clientX) => {
    const sx = clientX - svg.getBoundingClientRect().left;
    let best = 0;
    pts.forEach(([px], i) => { if (Math.abs(px - sx) < Math.abs(pts[best][0] - sx)) best = i; });
    return best;
  };
  svg.querySelector('.hit').addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.querySelector('.hit').addEventListener('pointerleave', hide);
  box.onfocus = () => show(active < 0 ? rounds.length - 1 : active);
  box.onblur = hide;
  box.onkeydown = (e) => {
    const next = { ArrowLeft: active - 1, ArrowRight: active + 1, Home: 0, End: rounds.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    show(next);
  };

  renderTrendTable(tableBox, rounds);
}

/**
 * Tabela das rodadas completas: a mesma informação da linha, com o nº de execuções ao lado da
 * taxa. É o que permite ver que duas rodadas não são comparáveis quando a base mudou.
 * @param {HTMLElement} tableBox
 * @param {Array<{date: string, passed: number, total: number, rate: number}>} rounds
 */
function renderTrendTable(tableBox, rounds) {
  // Coluna cheia de traço é coluna que ainda não deveria existir: cada uma só aparece
  // quando alguma rodada tem o dado.
  const temFlaky = rounds.some(r => typeof r.flaky === 'number');
  const temDur = rounds.some(r => r.durationMs);
  tableBox.innerHTML = `
    <table>
      <thead><tr><th>Rodada</th><th>Aprovadas</th><th>Execuções</th><th>Taxa</th>${temFlaky ? '<th>Instáveis</th>' : ''}${temDur ? '<th>Duração</th>' : ''}</tr></thead>
      <tbody>${rounds.slice().reverse().map(r => `
        <tr><td class="tabular">${esc(fmtDateTime(r.date))}</td><td class="tabular">${r.passed}</td><td class="tabular">${r.total}</td><td class="tabular">${r.rate}%</td>${temFlaky ? `<td class="tabular">${typeof r.flaky === 'number' ? r.flaky : '—'}</td>` : ''}${temDur ? `<td class="tabular">${r.durationMs ? fmtSeconds(r.durationMs) : '—'}</td>` : ''}</tr>`).join('')}
      </tbody>
    </table>`;
}

let trendResize = null;
window.addEventListener('resize', () => {
  clearTimeout(trendResize);
  trendResize = setTimeout(renderTrend, 150);
});

/* ---------------------------------------------------------------------------
 * Abas: Visão geral × Suítes e casos × Perfis × Bugs
 * ------------------------------------------------------------------------- */
// A aba Perfis só existe com 2+ perfis ou com matriz de acesso conferida.
const VIEWS = ['geral', 'casos', ...(SHOW_PROFILES_TAB ? ['perfis'] : []), 'bugs'];
// Âncoras antigas de seção continuam abrindo a aba certa.
const HASH_TO_VIEW = {
  geral: 'geral', resumo: 'geral', tendencia: 'geral', duracao: 'geral',
  casos: 'casos', suites: 'casos', oscilacao: 'casos', perfis: 'perfis', matriz: 'perfis', bugs: 'bugs'
};
const VIEW_KEY = 'qa-dashboard:aba';

function setView(view, { remember = true } = {}) {
  if (!VIEWS.includes(view)) view = 'geral';
  VIEWS.forEach(v => {
    const on = v === view;
    const tab = document.getElementById(`tab-${v}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(`view-${v}`).hidden = !on;
  });
  try {
    if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
  } catch {
    // sem permissão de histórico (arquivo local em alguns navegadores)
  }
  if (remember) {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // ver acima: sem armazenamento, a aba só não é lembrada
    }
  }
  // O gráfico de tendência se mede pela largura da aba, que só existe com ela visível.
  if (view === 'geral') renderTrend();
}

function openView(view) {
  const current = VIEWS.find(v => !document.getElementById(`view-${v}`).hidden);
  setView(view);
  if (view !== current) window.scrollTo({ top: 0 });
}

document.querySelectorAll('.view-tab').forEach(tab => {
  tab.addEventListener('click', () => openView(tab.dataset.view));
});
// Teclado no padrão de abas: setas alternam, Home/End vão às pontas.
document.querySelector('.view-tabs').addEventListener('keydown', (e) => {
  const i = VIEWS.indexOf(document.activeElement?.dataset?.view);
  if (i < 0) return;
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: VIEWS.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const view = VIEWS[(next + VIEWS.length) % VIEWS.length];
  openView(view);
  document.getElementById(`tab-${view}`).focus();
});
window.addEventListener('hashchange', () => {
  const view = HASH_TO_VIEW[location.hash.slice(1)];
  if (view) setView(view);
});

// Badge na aba de casos: quantos casos têm falha ou divergência.
const casesBadge = document.getElementById('casesBadge');
// Só falhas novas: um bug conhecido já tem o badge da aba Bugs.
casesBadge.textContent = String(NEW_FAILURES.length);
casesBadge.title = `${plural(NEW_FAILURES.length, 'fluxo', 'fluxos')} com falha nova`;
casesBadge.hidden = NEW_FAILURES.length === 0;

// Badge na aba de bugs: só os abertos (os corrigidos não pedem ação).
const bugsBadge = document.getElementById('bugsBadge');
bugsBadge.textContent = String(OPEN_BUGS);
bugsBadge.title = plural(OPEN_BUGS, 'bug aberto', 'bugs abertos');
bugsBadge.hidden = OPEN_BUGS === 0;

// Cards da Visão geral que levam a outra aba: falhas e instáveis ficam na faixa de alertas
// (seção de casos); bugs têm aba própria. O valor é a âncora de destino, usada duas vezes —
// para escolher a aba (HASH_TO_VIEW) e como id do elemento a rolar.
//
// Havia aqui um `perfis: 'matriz'`, de quando a matriz de acesso era uma seção própria. Ela
// virou o bloco de acesso dentro da ficha do perfil, o id "matriz" deixou de existir e a
// entrada passou a só abrir a aba Perfis — o mesmo que 'perfil-lista' já fazia. Saiu junto
// com o último card que a usava.
const ACTION_TARGET = { failures: 'casos', flaky: 'oscilacao', casos: 'casos', bugs: 'bugs', 'perfil-lista': 'perfis' };
document.querySelectorAll('[data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = ACTION_TARGET[btn.dataset.action];
    setView(HASH_TO_VIEW[target]);
    const destino = document.getElementById(target);
    // Seção recolhida (o ranking de oscilação): chegar nela fechada obrigaria a um segundo clique.
    const recolhida = destino?.querySelector(':scope > details');
    if (recolhida) recolhida.open = true;
    destino?.scrollIntoView({ block: 'start' });
  });
});

function initViews() {
  const target = location.hash.slice(1);
  let saved = null;
  try {
    saved = localStorage.getItem(VIEW_KEY);
  } catch {
    // sem armazenamento: abre na aba padrão
  }
  setView(HASH_TO_VIEW[target] || saved || 'geral', { remember: false });
  if (HASH_TO_VIEW[target] && target !== HASH_TO_VIEW[target]) document.getElementById(target)?.scrollIntoView();
}

/* ------------------------------------------------------------------------- */
renderCases();
renderBugs();
renderProfiles();
renderAttention();
preencherLegendasDeNavegador();
renderOscillation();
renderDuration();
initViews();
initUpdater();
