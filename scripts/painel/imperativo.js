// @ts-check
/**
 * Passo de teste → passo de guia.
 *
 * O título do test.step é escrito no infinitivo ("Acessar o formulário de novo Lead"), que é
 * como se descreve o que um teste faz. O guia fala com o leitor, e no modelo da CodeArt todo
 * passo vem no imperativo e com ponto final ("Acesse a aba Leads."). Em vez de manter dois
 * textos para o mesmo passo, este módulo conjuga o que a suíte já escreveu.
 *
 * Não é um conjugador da língua inteira: cobre o vocabulário de quem descreve uso de tela, com
 * as irregularidades que aparecem nele. Verbo fora das tabelas cai na regra regular.
 */

// Imperativo de "você", que é o presente do subjuntivo na 3ª pessoa.
const IRREGULARES = {
    dar: 'dê',
    estar: 'esteja',
    ir: 'vá',
    ser: 'seja',
    ter: 'tenha',
    manter: 'mantenha',
    obter: 'obtenha',
    conter: 'contenha',
    reter: 'retenha',
    deter: 'detenha',
    ver: 'veja',
    rever: 'reveja',
    prever: 'preveja',
    vir: 'venha',
    intervir: 'intervenha',
    ler: 'leia',
    reler: 'releia',
    trazer: 'traga',
    saber: 'saiba',
    poder: 'possa',
    querer: 'queira',
    perder: 'perca',
    valer: 'valha',
    caber: 'caiba',
    haver: 'haja',
    medir: 'meça',
    ouvir: 'ouça',
    servir: 'sirva',
    dormir: 'durma',
    rir: 'ria',
    sorrir: 'sorria',
    prevenir: 'previna',
    pôr: 'ponha',
    mediar: 'medeie',
    intermediar: 'intermedeie'
};

// Terminação → terminação. A ordem importa: a mais específica vem antes ("eguir" antes de
// "guir", "fazer" antes de "er"). As três últimas linhas são a regra regular.
const TERMINACOES = [
    ['fazer', 'faça'],
    ['dizer', 'diga'],
    ['por', 'ponha'],
    ['eguir', 'iga'],
    ['pedir', 'peça'],
    ['cobrir', 'cubra'],
    ['vestir', 'vista'],
    ['vertir', 'virta'],
    ['gredir', 'grida'],
    ['entir', 'inta'],
    ['erir', 'ira'],
    ['etir', 'ita'],
    ['air', 'aia'],
    ['ear', 'eie'],
    ['car', 'que'],
    ['gar', 'gue'],
    ['çar', 'ce'],
    ['cer', 'ça'],
    ['ger', 'ja'],
    ['gir', 'ja'],
    ['guir', 'ga'],
    ['guer', 'ga'],
    ['ar', 'e'],
    ['er', 'a'],
    ['ir', 'a']
];

// Verbos que o gerador reconhece no MEIO do passo ("Salvar e confirmar…"). A primeira palavra
// do passo é verbo por convenção do projeto; a do meio não é — "telefone e celular" também
// termina em "ar" —, então ali só se conjuga o que está nesta lista ou na de irregulares.
const VERBOS_DE_TELA = new Set(
    (
        'abrir acessar adicionar agendar aguardar alterar alternar anexar apagar aplicar aprovar arrastar ' +
        'associar ativar atribuir atualizar avançar baixar buscar cancelar carregar clicar colar compartilhar ' +
        'concluir conferir confirmar consultar continuar converter copiar corrigir criar definir deixar ' +
        'desabilitar desativar desmarcar digitar editar encerrar entrar enviar escolher excluir expandir ' +
        'exportar fazer fechar filtrar finalizar habilitar importar incluir informar iniciar inserir limpar ' +
        'localizar marcar mencionar mudar navegar observar ordenar pesquisar preencher procurar prosseguir ' +
        'publicar reabrir recolher registrar rejeitar relacionar remover repetir responder retornar revisar ' +
        'rolar sair salvar seguir selecionar soltar submeter substituir tentar tocar trocar usar utilizar ' +
        'validar verificar vincular visualizar voltar'
    ).split(' ')
);

const ehInfinitivo = (/** @type {string} */ v) => v !== 'por' && /^[a-zà-ú]+(ar|er|ir|por|pôr)$/.test(v);

/** @param {string} verbo infinitivo, em minúsculas */
function conjugar(verbo) {
    if (IRREGULARES[verbo]) return IRREGULARES[verbo];
    for (const [de, para] of TERMINACOES) {
        if (verbo.endsWith(de)) return verbo.slice(0, -de.length) + para;
    }
    return verbo;
}

// "selecioná-la" é "selecionar" + "a": o infinitivo perde o "r" e ganha acento antes do pronome.
const ENCLISE = /^(.+?)(á|ê|i|í)-l([oa]s?)$/;
const VOGAL_DO_INFINITIVO = { á: 'ar', ê: 'er', i: 'ir', í: 'ir' };

/**
 * @param {string} palavra uma palavra do passo, com a pontuação colada que tiver
 * @param {boolean} exigirConhecido só conjuga verbo das listas (palavra do meio do passo)
 */
function conjugarPalavra(palavra, exigirConhecido) {
    const [, miolo, pontuacao] = /^(.*?)([.,;:!?)]*)$/.exec(palavra) || [];
    const minuscula = miolo.toLowerCase();

    const enclise = ENCLISE.exec(minuscula);
    const infinitivo = enclise ? enclise[1] + VOGAL_DO_INFINITIVO[enclise[2]] : minuscula;
    if (!ehInfinitivo(infinitivo)) return palavra;
    if (exigirConhecido && !VERBOS_DE_TELA.has(infinitivo) && !IRREGULARES[infinitivo]) return palavra;

    let conjugado = conjugar(infinitivo) + (enclise ? '-' + enclise[3] : '');
    if (miolo[0] !== minuscula[0]) conjugado = conjugado[0].toUpperCase() + conjugado.slice(1);
    return conjugado + pontuacao;
}

/**
 * "Reabrir o registro em edição e validar que o Email persistiu" →
 * "Reabra o registro em edição e valide que o Email persistiu."
 *
 * Conjuga o verbo que abre o passo e os que vêm depois de "e"/"ou". O que vem logo depois de
 * outro verbo continua no infinitivo, como no português: "Tente salvar".
 *
 * @param {string} passo
 */
function noImperativo(passo) {
    const palavras = String(passo).trim().split(/\s+/);
    const texto = palavras
        .map((palavra, i) => {
            if (i === 0) return conjugarPalavra(palavra, false);
            return /^(e|ou)$/i.test(palavras[i - 1]) ? conjugarPalavra(palavra, true) : palavra;
        })
        .join(' ');
    return /[.!?:;]$/.test(texto) ? texto : texto + '.';
}

module.exports = { noImperativo, conjugar };
