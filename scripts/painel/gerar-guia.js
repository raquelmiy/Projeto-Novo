// @ts-check
/**
 * Guia do Usuário por perfil, em HTML autocontido e em PDF, no modelo dos guias da CodeArt:
 * papel timbrado (logo no topo, marca d'água e faixa colorida no rodapé), sumário com página,
 * capítulos numerados e a mesma anatomia de texto em toda funcionalidade.
 *
 * O documento nasce de duas fontes, e a divisão entre elas é a ideia toda:
 *
 *   painel-dados/dashboard-data.json  → PASSOS e TELAS, que vêm da suíte e se atualizam
 *                                       sozinhos a cada rodada
 *   guia-conteudo.json                → TEXTO DE NEGÓCIO (o que é, resultado esperado,
 *                                       regras, exemplos), que só gente sabe escrever
 *
 * Guia escrito à mão inteiro está errado em três meses e ninguém percebe. Guia gerado inteiro
 * não tem contexto e ninguém lê. Aqui cada parte fica com quem a mantém melhor.
 *
 * Uso:
 *   node scripts/painel/gerar-guia.js SDR          um perfil
 *   node scripts/painel/gerar-guia.js              todos os perfis com fluxos
 *   node scripts/painel/gerar-guia.js --esqueleto  lista em guia-conteudo.json os cenários
 *                                                  que ainda não têm texto escrito
 */
const fs = require('fs');
const path = require('path');
const { ehPassoInterno, semMarca } = require('../../tests/e2e/utils/passo');
const { buildThumbnails } = require('./build');
const { noImperativo } = require('./imperativo');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA_FILE = path.join(ROOT, 'painel-dados', 'dashboard-data.json');
const CONTEUDO_FILE = path.join(ROOT, 'guia-conteudo.json');
const EVIDENCE_DIR = path.join(ROOT, 'test-evidence');
const OUT_DIR = path.join(ROOT, 'docs', 'guias');

// As três imagens do papel timbrado, tiradas do cabeçalho e do rodapé do modelo Word.
const PAPEL = {
    logo: path.join(__dirname, 'assets', 'papel-logo.png'),
    fundo: path.join(__dirname, 'assets', 'papel-fundo.png'),
    rodape: path.join(__dirname, 'assets', 'papel-rodape.png')
};

// Medidas do mesmo modelo, em milímetros: margens da página A4, distância do cabeçalho ao
// topo, tamanho do logo e altura da faixa do rodapé.
const FOLHA = {
    topo: 30.1,
    direita: 19.5,
    base: 25.4,
    esquerda: 22.2,
    cabecalho: 12.5,
    logoLargura: 33.9,
    faixa: 6.3
};

// As suítes de conferência de acesso não são fluxo de negócio: viram a tabela de permissões.
const SUITES_DE_ACESSO = ['acesso', 'acesso-tela', 'acesso-conjuntos'];
const OPERACOES = ['ler', 'criar', 'editar', 'excluir'];
const VERBO = { ler: 'consultar', criar: 'criar', editar: 'editar', excluir: 'excluir' };

const esc = (/** @type {any} */ s) =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const plural = (/** @type {number} */ n, /** @type {string} */ um, /** @type {string} */ varios) =>
    `${n} ${n === 1 ? um : varios}`;

const chaveFluxo = (/** @type {string} */ suiteId, /** @type {string} */ casoId) => `${suiteId}::${casoId}`;

/* ---------------------------------------------------------------------------
 * Leitura dos dados
 * ------------------------------------------------------------------------- */

function lerConteudo() {
    if (!fs.existsSync(CONTEUDO_FILE)) {
        throw new Error(
            `Arquivo não encontrado: ${path.relative(ROOT, CONTEUDO_FILE)}\n` +
                'Ele guarda o texto do guia. Sem ele o documento sairia só com passos e telas.'
        );
    }
    return JSON.parse(fs.readFileSync(CONTEUDO_FILE, 'utf-8'));
}

function lerPapel() {
    const papel = {};
    for (const [nome, arquivo] of Object.entries(PAPEL)) {
        if (!fs.existsSync(arquivo)) throw new Error(`Imagem do papel timbrado não encontrada: ${arquivo}`);
        papel[nome] = `data:image/png;base64,${fs.readFileSync(arquivo).toString('base64')}`;
    }
    return papel;
}

/**
 * Passos como o guia os dá ao leitor: sem os de higiene do teste, renumerados e no imperativo.
 *
 * A renumeração não é enfeite. O número vem escrito à mão no título do test.step, então fura
 * sempre que um passo roda dentro de laço ou quando um passo interno sai do meio da lista.
 * @param {string[]} steps
 */
const passosDeUsuario = (steps) =>
    (steps || [])
        .filter((s) => !ehPassoInterno(s))
        .map((s) => semMarca(s).replace(/^\s*\d+\.\s*/, ''))
        .filter(Boolean)
        .map(noImperativo);

const execucaoDe = (/** @type {any} */ caso, /** @type {string} */ perfil) =>
    (caso.runs || []).find((/** @type {any} */ r) => r.profile === perfil) || null;

/**
 * Separa o que entra no guia do que não entra.
 *
 * Fluxo que falhou na última execução fica de fora: documentar como se funcionasse é pior que
 * não documentar, porque o leitor tenta seguir e não consegue. O aviso sai no terminal — quem
 * precisa saber é o QA, não o cliente que recebe o PDF.
 */
function separarFluxos(data, perfil, conteudo) {
    const areas = [];
    const negados = [];
    const forasDoAr = [];

    for (const suite of data.suites) {
        if (SUITES_DE_ACESSO.includes(suite.id)) continue;
        const fluxos = [];
        for (const caso of suite.cases || []) {
            const run = execucaoDe(caso, perfil);
            if (!run) continue;
            const item = {
                area: suite.name,
                caso,
                run,
                passos: passosDeUsuario(run.steps),
                texto: (conteudo.fluxos || {})[chaveFluxo(suite.id, caso.id)] || {}
            };
            if (run.status !== 'passed') forasDoAr.push(item);
            else if (run.esperado === 'negado') negados.push(item);
            else fluxos.push(item);
        }
        if (fluxos.length) areas.push({ nome: suite.name, fluxos });
    }
    return { areas, negados, forasDoAr };
}

/** A matriz de acesso do perfil, dita em verbo de negócio. */
function permissoes(data, perfil) {
    const suite = data.suites.find((/** @type {any} */ s) => s.id === 'acesso');
    if (!suite) return [];
    const linhas = [];
    for (const caso of suite.cases || []) {
        const run = execucaoDe(caso, perfil);
        if (!run || !run.access) continue;
        const encontrado = run.access.encontrado || [];
        linhas.push({
            objeto: caso.title,
            pode: OPERACOES.filter((op) => encontrado.includes(op)).map((op) => VERBO[op]),
            naoPode: OPERACOES.filter((op) => !encontrado.includes(op)).map((op) => VERBO[op])
        });
    }
    return linhas;
}

/* ---------------------------------------------------------------------------
 * Montagem do documento
 * ------------------------------------------------------------------------- */

/**
 * Numeração do documento: capítulos ("3. Lead"), seções ("3.1 Criar um Lead") e imagens
 * ("Imagem 12 — Tela de Início"). São contadores do documento inteiro, e por isso vivem fora
 * das funções de bloco. Todo título emitido fica anotado, na ordem, para o sumário.
 */
function criarRoteiro() {
    const titulos = [];
    let capitulo = 0;
    let secao = 0;
    let imagem = 0;

    const titulo = (tag, nivel, texto) => {
        const id = `t${titulos.length + 1}`;
        titulos.push({ id, nivel, texto });
        return `<${tag} id="${id}">${esc(texto)}</${tag}>`;
    };

    return {
        titulos,
        capitulo(texto) {
            capitulo += 1;
            secao = 0;
            return titulo('h2', 1, `${capitulo}. ${texto}`);
        },
        secao(texto) {
            secao += 1;
            return titulo('h3', 2, `${capitulo}.${secao} ${texto}`);
        },
        /** Subtítulo sem número dentro de uma seção ("Exemplo de Reporte"). */
        rotulo(texto) {
            return titulo('h4', 3, texto);
        },
        figura(src, legenda) {
            if (!src) return '';
            imagem += 1;
            return `<figure>
              <figcaption>Imagem ${imagem}${legenda ? ' — ' + esc(legenda) : ''}</figcaption>
              <img src="${src}" alt="${esc(legenda || 'Imagem ' + imagem)}">
            </figure>`;
        }
    };
}

// O modelo escreve o rótulo em negrito e o texto na mesma linha: "O que é: A Visita é…".
const blocoRotulado = (rotulo, texto, classe = '') =>
    texto ? `<p${classe ? ` class="${classe}"` : ''}><b>${esc(rotulo)}:</b> ${esc(texto)}</p>` : '';

const blocoResultado = (texto) => blocoRotulado('Resultado esperado', texto, 'res');

const blocoDestaque = (rotulo, texto) =>
    texto ? `<p class="aviso"><b>${esc(rotulo)}:</b> ${esc(texto)}</p>` : '';

const blocoPassos = (passos) =>
    passos && passos.length ? `<ol>${passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : '';

const blocoLista = (itens) => `<ul>${itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

const blocoExemplo = (ex) =>
    ex && ex.situacao
        ? `<div class="recuo"><p><b>Exemplo Prático</b></p>
           <p><b>Situação:</b> ${esc(ex.situacao)}</p>
           ${ex.fazer && ex.fazer.length ? `<p><b>O que fazer:</b></p>${blocoLista(ex.fazer)}` : ''}</div>`
        : '';

const blocoTabela = (colunas, linhas) =>
    `<table class="dados"><thead><tr>${colunas.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
       <tbody>${linhas.map((l) => `<tr>${l.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

// Nome da evidência quando ninguém escreveu a legenda: "formulario-preenchido" não é legenda.
const legendaPadrao = (nome) => {
    const texto = String(nome).replace(/[-_]+/g, ' ').trim();
    return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** Blocos livres dos capítulos escritos à mão (capitulosIniciais / capitulosFinais). */
function renderBlocos(blocos, roteiro, telas) {
    return (blocos || [])
        .map((b) => {
            if (b.sub) return roteiro.secao(b.sub);
            if (b.rotulo) return roteiro.rotulo(b.rotulo);
            if (b.texto) return `<p>${esc(b.texto)}</p>`;
            if (b.oQueE) return blocoRotulado('O que é', b.oQueE);
            if (b.quandoUtilizar) return blocoRotulado('Quando utilizar', b.quandoUtilizar);
            if (b.lista) return blocoLista(b.lista);
            if (b.passos) return blocoPassos(b.passos);
            if (b.resultado) return blocoResultado(b.resultado);
            if (b.importante) return blocoDestaque('Importante', b.importante);
            if (b.atencao) return blocoDestaque('Atenção', b.atencao);
            if (b.exemplo) return blocoExemplo(b.exemplo);
            if (b.tabela) return blocoTabela(b.tabela.colunas, b.tabela.linhas);
            // Ficha de pares "rótulo: valor", como o exemplo de reporte do modelo.
            if (b.campos) {
                return `<div class="recuo">${b.campos.map(([r, v]) => blocoRotulado(r, v)).join('')}</div>`;
            }
            if (b.links) {
                return b.links
                    .map(
                        (g) => `<div class="recuo links"><p class="grupo">${esc(g.grupo)}</p>
                      ${g.itens
                          .map((i) => `<p><b>${esc(i.texto)}:</b> <a href="${esc(i.url)}">${esc(i.url)}</a></p>`)
                          .join('')}</div>`
                    )
                    .join('');
            }
            // Imagem avulsa de capítulo escrito à mão: caminho relativo à raiz do projeto.
            if (b.imagem) return roteiro.figura(telas.get(path.resolve(ROOT, b.imagem)), b.legenda);
            return '';
        })
        .join('');
}

/** Uma funcionalidade, na anatomia fixa do modelo. */
function renderFluxo(f, roteiro, telas) {
    const t = f.texto || {};
    const legendas = t.legendas || {};
    return `${roteiro.secao(t.titulo || f.caso.title)}
      ${blocoRotulado('O que é', t.oQueE)}
      ${blocoRotulado('Quando utilizar', t.quandoUtilizar)}
      ${blocoPassos(f.passos)}
      ${blocoResultado(t.resultadoEsperado)}
      ${blocoDestaque('Importante', t.importante)}
      ${blocoDestaque('Atenção', t.atencao)}
      ${blocoExemplo(t.exemploPratico)}
      ${(f.run.evidences || [])
          .map((ev) =>
              roteiro.figura(telas.get(path.join(EVIDENCE_DIR, ev.path)), legendas[ev.name] || legendaPadrao(ev.name))
          )
          .join('')}`;
}

/**
 * @param {any} dados
 * @param {number[] | null} paginas página de cada título, na ordem do roteiro; null na primeira
 *   passada, quando o PDF ainda não existe para se saber onde cada título caiu
 */
function montarHtml({ perfil, info, conteudo, areas, negados, perms, telas, papel }, paginas) {
    const roteiro = criarRoteiro();
    const titulo = `${conteudo.titulo || 'Guia do Usuário'} — ${conteudo.subtitulo || ''} ${perfil}`
        .replace(/\s+/g, ' ')
        .trim();
    const intro = conteudo.introducao || {};

    // O corpo é montado antes do sumário porque é ele que diz quais títulos existem.
    const corpo = `
      ${(conteudo.capitulosIniciais || [])
          .map((c) => roteiro.capitulo(c.titulo) + renderBlocos(c.blocos, roteiro, telas))
          .join('')}

      ${perms.length
          ? `${roteiro.capitulo('O que o seu perfil acessa')}
             <p>O seu acesso no Salesforce é definido pelo perfil <b>${esc((info && info.perfilSalesforce) || perfil)}</b>.
             A tabela abaixo mostra o que ele permite em cada tipo de registro.</p>
             ${blocoTabela(
                 ['Registro', 'Você pode', 'Você não pode'],
                 perms.map((p) => [p.objeto, p.pode.join(', ') || '—', p.naoPode.join(', ') || '—'])
             )}`
          : ''}

      ${areas
          .map((a) => roteiro.capitulo(a.nome) + a.fluxos.map((f) => renderFluxo(f, roteiro, telas)).join(''))
          .join('')}

      ${negados.length
          ? `${roteiro.capitulo('O que o seu perfil não faz')}
             <p>As ações abaixo são bloqueadas pelo sistema para o seu perfil. Estão aqui para
             você saber que o bloqueio é intencional, e não uma falha.</p>
             ${negados
                 .map(
                     // "bloqueado" e não "oQueE": o texto do fluxo é o mesmo para todos os
                     // perfis, e o que descreve o bloqueio para um perfil seria mentira no
                     // guia de outro, que consegue fazer a mesma ação.
                     (f) =>
                         roteiro.secao((f.texto || {}).titulo || f.caso.title) +
                         `<p>${esc((f.texto || {}).bloqueado || 'Esta ação não está disponível para o seu perfil.')}</p>`
                 )
                 .join('')}`
          : ''}

      ${(conteudo.capitulosFinais || [])
          .map((c) => roteiro.capitulo(c.titulo) + renderBlocos(c.blocos, roteiro, telas))
          .join('')}`;

    const sumario = roteiro.titulos
        .map(
            (t, i) => `<a class="n${t.nivel}" href="#${t.id}"><span>${esc(t.texto)}</span><i></i>
              <b>${paginas ? paginas[i] : ''}</b></a>`
        )
        .join('');

    // O logo fica centrado entre as margens, que não são iguais dos dois lados.
    const logoEsquerda = FOLHA.esquerda + (210 - FOLHA.esquerda - FOLHA.direita - FOLHA.logoLargura) / 2;

    const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>
  /* A margem da página é zero de propósito: marca d'água, logo e faixa do rodapé sangram até
     a borda do papel, e o Chromium corta o que sai da área de conteúdo. Quem dá a margem ao
     texto são as linhas vazias do thead/tfoot de .folha, que o navegador repete a cada página. */
  @page { size: A4; margin: 0; }
  :root { --marinho:#303E47; --azul:#6AC0ED; --amarelo:#FBD615; --cinza:#F2F2F1; --texto:#1c232b; }
  * { box-sizing: border-box; }
  html { background:#e6e8eb; }
  body { margin:0; color:var(--texto); font:11pt/1.3 Calibri, Carlito, "Segoe UI", Arial, sans-serif; }

  .papel { position:relative; width:210mm; max-width:100%; margin:8mm auto; background:#fff; }
  .papel-fundo { display:none; }
  .papel-logo { display:block; width:${FOLHA.logoLargura}mm; margin:0 auto; padding-top:${FOLHA.cabecalho}mm;
    box-sizing:content-box; }
  .papel-faixa { display:block; width:100%; height:${FOLHA.faixa}mm; }
  .folha { width:100%; border-collapse:collapse; }
  .folha > * > tr > td { padding:0; }
  .margem-topo { height:${(FOLHA.topo - FOLHA.cabecalho - 11.8).toFixed(1)}mm; }
  .margem-base { height:${FOLHA.base}mm; }
  .miolo { padding:0 ${FOLHA.direita}mm 0 ${FOLHA.esquerda}mm; }

  h1 { font-size:20pt; font-weight:700; color:var(--marinho); margin:0 0 8pt; line-height:1.15; }
  h2 { font-size:15pt; font-weight:700; color:var(--marinho); margin:18pt 0 9pt; padding-bottom:3pt;
       border-bottom:1.25pt solid var(--marinho); }
  h3 { font-size:12pt; font-weight:700; color:#3A4F63; margin:13pt 0 6pt; }
  h4 { font-size:11pt; font-weight:700; margin:10pt 0 5pt; }
  h2, h3, h4, figcaption { break-after:avoid; page-break-after:avoid; }
  p { margin:0 0 6pt; }
  ul, ol { margin:0 0 6pt; padding-left:20pt; }
  li { margin-bottom:3pt; padding-left:2pt; }
  a { color:#0563C1; }

  /* O resultado esperado alinha com o texto dos passos, não com os números. */
  .res { margin-left:20pt; }
  .recuo { margin:0 0 8pt 20pt; }
  .recuo p { margin-bottom:4pt; }
  .links { break-inside:avoid; }
  .links .grupo { font-weight:700; color:#3A4F63; margin-top:8pt; }
  .links a { word-break:break-all; }

  .aviso { margin:6pt 0 8pt; padding:3pt 8pt; background:#FFF4CC; border-left:3pt solid var(--amarelo);
    font-style:italic; break-inside:avoid; }

  table.dados { width:100%; border-collapse:collapse; margin:4pt 0 10pt; break-inside:avoid; }
  table.dados th, table.dados td { text-align:left; padding:2pt 6pt; border:.75pt solid var(--marinho);
    vertical-align:top; }
  table.dados th { background:var(--marinho); color:#fff; font-weight:700; }
  table.dados tbody tr:nth-child(even) td { background:var(--cinza); }
  table.dados td:first-child { font-weight:700; }

  /* Legenda ACIMA da imagem e as duas no mesmo bloco: no modelo a legenda anuncia a tela, e
     separá-las na quebra de página deixa uma imagem órfã sem dizer do que ela é. */
  figure { margin:6pt 0 10pt; break-inside:avoid; page-break-inside:avoid; }
  figure img { display:block; max-width:100%; max-height:200mm; border:1px solid #000; }

  .sumario { break-before:page; break-after:page; }
  .sumario .cabeca { font-size:16pt; font-weight:400; color:var(--marinho); border:0; margin:0 0 6pt; padding:0; }
  .sumario a { display:flex; align-items:baseline; color:var(--texto); text-decoration:none;
    font-weight:700; padding:2.5pt 0; }
  .sumario a.n2 { padding-left:5mm; }
  .sumario a.n3 { padding-left:10mm; }
  .sumario a i { flex:1; margin:0 2pt; border-bottom:1pt dotted var(--texto); transform:translateY(-2.5pt); }
  .sumario a b { font-weight:700; }

  /* Na tela o documento é uma folha só, corrida. No papel o timbrado se repete em toda página:
     position:fixed é o que o Chromium reimprime a cada folha. */
  @media print {
    html, .papel { background:none; }
    .papel { width:auto; margin:0; }
    .papel-fundo { display:block; position:fixed; top:0; left:0; width:210mm; height:297mm; z-index:-1; }
    .papel-logo { position:fixed; top:${FOLHA.cabecalho}mm; left:${logoEsquerda.toFixed(2)}mm; margin:0; padding:0; }
    .papel-faixa { position:fixed; left:0; bottom:0; width:210mm; }
    .margem-topo { height:${FOLHA.topo}mm; }
  }
</style></head>
<body>
  <div class="papel">
    <img class="papel-fundo" src="${papel.fundo}" alt="">
    <img class="papel-logo" src="${papel.logo}" alt="CodeArt">
    <table class="folha">
      <thead><tr><td><div class="margem-topo"></div></td></tr></thead>
      <tfoot><tr><td><div class="margem-base"></div></td></tr></tfoot>
      <tbody><tr><td><div class="miolo">
        <h1>${esc(titulo)}</h1>
        ${intro.texto ? `<p>${esc(intro.texto)}</p>` : ''}
        ${intro.encontrara && intro.encontrara.length
            ? `<p>Ao longo deste material você encontrará:</p>${blocoLista(intro.encontrara)}`
            : ''}
        ${intro.fechamento ? `<p>${esc(intro.fechamento)}</p>` : ''}

        <nav class="sumario"><h2 class="cabeca">Sumário</h2>${sumario}</nav>
        ${corpo}
      </div></td></tr></tbody>
    </table>
    <img class="papel-faixa" src="${papel.rodape}" alt="">
  </div>
</body></html>`;

    return { html, titulos: roteiro.titulos };
}

/* ---------------------------------------------------------------------------
 * PDF
 * ------------------------------------------------------------------------- */

/**
 * Em que página do PDF caiu cada título do documento, na ordem em que aparecem.
 *
 * O navegador não conta a quem monta o HTML onde as páginas quebraram, mas grava no PDF os
 * marcadores (o painel de navegação do leitor), um por título e cada um com a página de
 * destino. O Chromium escreve esses objetos em texto puro, então dá para lê-los direto do
 * arquivo, sem trazer uma biblioteca de PDF para o projeto só por causa do sumário.
 * @param {Buffer} pdf
 */
function paginasDosTitulos(pdf) {
    const objetos = new Map();
    for (const m of pdf.toString('latin1').matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
        // O título sai fora: é texto livre e pode conter qualquer coisa parecida com uma chave.
        objetos.set(m[1], m[2].replace(/\/Title\s*(\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)/, ''));
    }
    const ref = (id, chave) => (new RegExp(`/${chave}\\s*(\\d+) 0 R`).exec(objetos.get(id) || '') || [])[1];
    const achar = (tipo) => ([...objetos].find(([, o]) => new RegExp(`/Type\\s*/${tipo}\\b`).test(o)) || [])[0];

    const marcadores = achar('Outlines');
    const catalogo = achar('Catalog');
    if (!marcadores || !catalogo) return [];

    // As páginas ficam numa árvore: com muitas folhas, um nó /Pages aponta para outros.
    const paginas = [];
    (function folhas(id) {
        const filhos = /\/Kids\s*\[([^\]]*)\]/.exec(objetos.get(id) || '');
        if (!filhos) return void paginas.push(id);
        for (const filho of filhos[1].matchAll(/(\d+) 0 R/g)) folhas(filho[1]);
    })(ref(catalogo, 'Pages'));

    // Os marcadores também são árvore (título dentro de título); em profundidade, primeiro o
    // filho e depois o irmão, saem na ordem do texto.
    const destinos = [];
    (function percorrer(id) {
        for (; id; id = ref(id, 'Next')) {
            const pagina = (/\/Dest\s*\[\s*(\d+) 0 R/.exec(objetos.get(id) || '') || [])[1];
            destinos.push(paginas.indexOf(pagina) + 1);
            percorrer(ref(id, 'First'));
        }
    })(ref(marcadores, 'First'));
    return destinos;
}

/** @param {import('@playwright/test').Page} page */
async function imprimir(page, html, arquivo) {
    await page.setContent(html, { waitUntil: 'load' });
    return page.pdf({
        path: arquivo,
        format: 'A4',
        printBackground: true,
        // Os marcadores só são gravados em PDF marcado (tagged); as duas opções andam juntas.
        tagged: true,
        outline: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        // Do cabeçalho do navegador só se usa o número da página, que é a única coisa do
        // timbrado que o HTML não sabe escrever sozinho.
        displayHeaderFooter: true,
        headerTemplate: `<div style="width:100%;font:10pt Arial,sans-serif;color:#000;text-align:right;
            padding:8mm ${FOLHA.direita}mm 0 0;"><span class="pageNumber"></span></div>`,
        footerTemplate: '<span></span>'
    });
}

/**
 * Gera o PDF em duas passadas: a primeira só para descobrir em que página cada título caiu,
 * a segunda já com o sumário preenchido. O sumário ocupa o mesmo espaço nas duas — o número
 * entra numa linha que já existe —, então a paginação não muda entre uma e outra.
 */
async function gerarPdf(page, dados, arquivo) {
    const rascunho = montarHtml(dados, null);
    const destinos = paginasDosTitulos(await imprimir(page, rascunho.html, undefined));

    // Os dois primeiros marcadores são o título do documento e o cabeçalho "Sumário".
    const paginas = destinos.slice(2);
    const sumarioLido = paginas.length === rascunho.titulos.length && paginas.every((p) => p > 0);
    const { html } = montarHtml(dados, sumarioLido ? paginas : null);
    await imprimir(page, html, arquivo);
    return { html, sumarioLido };
}

/* ---------------------------------------------------------------------------
 * Esqueleto: a lista de cenários que ainda não têm texto
 * ------------------------------------------------------------------------- */

function gerarEsqueleto(data, conteudo) {
    const fluxos = conteudo.fluxos || {};
    let novos = 0;
    for (const suite of data.suites) {
        if (SUITES_DE_ACESSO.includes(suite.id)) continue;
        for (const caso of suite.cases || []) {
            const chave = chaveFluxo(suite.id, caso.id);
            if (fluxos[chave]) continue;
            const run = (caso.runs || [])[0] || {};
            fluxos[chave] = {
                titulo: caso.title,
                oQueE: '',
                resultadoEsperado: '',
                importante: '',
                legendas: Object.fromEntries((run.evidences || []).map((ev) => [ev.name, '']))
            };
            novos += 1;
        }
    }
    conteudo.fluxos = fluxos;
    fs.writeFileSync(CONTEUDO_FILE, JSON.stringify(conteudo, null, 2) + '\n', 'utf-8');
    const vazios = Object.values(fluxos).filter((f) => !f.oQueE).length;
    console.log(`Esqueleto: ${plural(novos, 'cenário novo', 'cenários novos')} em ${path.relative(ROOT, CONTEUDO_FILE)}.`);
    console.log(`${plural(vazios, 'cenário está', 'cenários estão')} sem texto — preencha "oQueE" e "resultadoEsperado".`);
}

/* ------------------------------------------------------------------------- */

async function main() {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(`Arquivo não encontrado: ${DATA_FILE}\nRode "npx playwright test" antes de gerar o guia.`);
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const conteudo = lerConteudo();

    if (process.argv.includes('--esqueleto')) return gerarEsqueleto(data, conteudo);

    const papel = lerPapel();
    const pedido = process.argv.slice(2).find((a) => !a.startsWith('--'));
    const disponiveis = data.meta.profiles || [];
    const perfis = pedido ? disponiveis.filter((p) => p.toLowerCase() === pedido.toLowerCase()) : disponiveis;
    if (pedido && !perfis.length) {
        throw new Error(`Perfil "${pedido}" não tem resultado gravado. Disponíveis: ${disponiveis.join(', ')}`);
    }

    // Uma passada de imagem para todos os perfis: abrir o navegador custa segundos. Entram as
    // telas dos fluxos e as imagens dos capítulos escritos à mão.
    const caminhos = new Set();
    for (const c of [...(conteudo.capitulosIniciais || []), ...(conteudo.capitulosFinais || [])]) {
        for (const b of c.blocos || []) if (b.imagem) caminhos.add(path.resolve(ROOT, b.imagem));
    }
    for (const perfil of perfis) {
        for (const a of separarFluxos(data, perfil, conteudo).areas) {
            for (const f of a.fluxos) for (const ev of f.run.evidences || []) caminhos.add(path.join(EVIDENCE_DIR, ev.path));
        }
    }
    console.log(`Preparando ${plural(caminhos.size, 'imagem', 'imagens')}…`);
    const telas = await buildThumbnails([...caminhos]);

    const { chromium } = require('@playwright/test');
    const browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    fs.mkdirSync(OUT_DIR, { recursive: true });

    for (const perfil of perfis) {
        const { areas, negados, forasDoAr } = separarFluxos(data, perfil, conteudo);
        const base = path.join(OUT_DIR, `guia-${perfil.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
        const { html, sumarioLido } = await gerarPdf(
            page,
            {
                perfil,
                info: (data.meta.profileInfo || []).find((/** @type {any} */ p) => p.nome === perfil),
                conteudo,
                areas,
                negados,
                telas,
                papel,
                perms: permissoes(data, perfil)
            },
            base + '.pdf'
        );
        fs.writeFileSync(base + '.html', html, 'utf-8');

        const mb = (fs.statSync(base + '.pdf').size / 1024 / 1024).toFixed(2);
        const totalFluxos = areas.reduce((n, a) => n + a.fluxos.length, 0);
        const semTexto = areas.flatMap((a) => a.fluxos).filter((f) => !(f.texto || {}).oQueE).length;
        console.log(
            `${perfil}: ${plural(totalFluxos, 'fluxo', 'fluxos')}` +
                (negados.length ? `, ${plural(negados.length, 'bloqueio', 'bloqueios')}` : '') +
                ` → ${path.relative(ROOT, base)}.pdf (${mb} MB)`
        );
        if (!sumarioLido) {
            console.warn('  ! sumário saiu sem o número das páginas: os marcadores do PDF não foram lidos');
        }
        if (semTexto) {
            console.warn(
                `  ! ${plural(semTexto, 'fluxo saiu', 'fluxos saíram')} só com os passos: falta o texto em guia-conteudo.json`
            );
        }
        for (const f of forasDoAr) {
            console.warn(`  ! fora do guia: ${f.area} · ${f.caso.id} "${f.caso.title}" — falhou na última execução`);
        }
    }

    await browser.close();
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
