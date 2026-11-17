// @ts-check
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runSf, currentProfile } = require('./sfAuth');

/**
 * Acesso à REST API da org pela Salesforce CLI (`sf api request rest`). Serve para montar massa
 * (o Lead que já existe antes do passo do usuário), conferir o que foi gravado e ler metadados
 * (describe, UI API).
 *
 * Três decisões que valem explicar:
 *
 * 1) A CLI faz a autenticação. O `sf org display` mascara o token de acesso em alguns ambientes,
 *    então não dá para chamar a API direto com ele.
 * 2) O corpo vai num arquivo JSON (`--body @arquivo`), e não na linha de comando: o shell do
 *    Windows estraga acento e aspas ("Formulário do Site").
 * 3) Cada chamada custa ~3s (um processo Node da CLI). O describe fica em cache por objeto,
 *    porque não muda durante a rodada.
 */

// Remove códigos ANSI que o CLI emite mesmo com NO_COLOR em algumas versões.
const stripAnsi = (/** @type {string} */ s) => s.replace(/\x1b\[[0-9;]*m/g, '');

const PASTA_CORPOS = path.join('test-results', 'sf-api');

/** @type {Map<string, string>} alias → versão da API */
const versoes = new Map();
/** @type {Map<string, any>} alias:objeto → describe */
const describes = new Map();

class SfApi {
    /**
     * @param {string} org Alias do usuário na CLI
     * @param {import('@playwright/test').TestInfo} [testInfo] Para anotar a massa criada na limpeza
     */
    constructor(org, testInfo) {
        this.org = org;
        this.testInfo = testInfo;
        if (!versoes.has(org)) {
            const { result } = JSON.parse(runSf(['org', 'display', '--json'], org, 'ler a versão da API'));
            versoes.set(org, result.apiVersion);
        }
        this.base = `/services/data/v${versoes.get(org)}/`;
    }

    /**
     * @param {'GET' | 'POST' | 'PATCH'} metodo
     * @param {string} caminho Relativo a /services/data/vXX.X/, já codificado para URL
     * @param {any} [corpo]
     * @returns {{ status: number, corpo: any }}
     */
    chamar(metodo, caminho, corpo) {
        const args = ['api', 'request', 'rest', `"${this.base}${caminho}"`, '--method', metodo, '--include', '--target-org', this.org];
        if (corpo !== undefined) {
            fs.mkdirSync(PASTA_CORPOS, { recursive: true });
            const arquivo = path.resolve(PASTA_CORPOS, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
            fs.writeFileSync(arquivo, JSON.stringify(corpo), 'utf-8');
            args.push('--body', `"@${arquivo}"`);
        }
        let saida;
        try {
            saida = execFileSync('sf', args, {
                encoding: 'utf-8',
                shell: true,
                maxBuffer: 64 * 1024 * 1024,
                env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
            });
        } catch (error) {
            // Resposta 4xx/5xx: a CLI sai com erro, mas a resposta continua no stdout.
            saida = /** @type {any} */ (error).stdout || '';
        }
        return lerResposta(stripAnsi(String(saida)), `${metodo} ${caminho}`);
    }

    /** @param {string} soql @returns {Promise<any[]>} */
    async consultar(soql) {
        const { status, corpo } = this.chamar('GET', `query?q=${encodeURIComponent(soql)}`);
        if (status !== 200) throw new Error(`Consulta recusada (${status}): ${JSON.stringify(corpo)}\n${soql}`);
        return corpo.records;
    }

    /**
     * Cria um registro. Não lança erro quando a org recusa: o caso negativo precisa da mensagem.
     * O registro criado entra na limpeza do fim da rodada (utils/limpeza.js).
     * @param {string} objeto
     * @param {Record<string, any>} campos
     * @returns {Promise<{ ok: boolean, id?: string, erros: string[] }>}
     */
    async criar(objeto, campos) {
        const { status, corpo } = this.chamar('POST', `sobjects/${objeto}`, campos);
        if (status !== 201) return { ok: false, erros: mensagens(corpo) };
        await this.registrarParaLimpeza(objeto, corpo.id);
        return { ok: true, id: corpo.id, erros: [] };
    }

    /**
     * Cria um registro que é pré-condição do caso: se a org recusar, o caso para aqui.
     * @param {string} objeto
     * @param {Record<string, any>} campos
     * @returns {Promise<string>} Id
     */
    async criarMassa(objeto, campos) {
        const { ok, id, erros } = await this.criar(objeto, campos);
        if (!ok || !id) throw new Error(`Massa de ${objeto} recusada pela org: ${erros.join(' | ')}`);
        return id;
    }

    /**
     * @param {string} objeto
     * @param {string} id
     * @param {Record<string, any>} campos
     * @returns {Promise<{ ok: boolean, erros: string[] }>}
     */
    async atualizar(objeto, id, campos) {
        const { status, corpo } = this.chamar('PATCH', `sobjects/${objeto}/${id}`, campos);
        if (status === 204 || status === 200) return { ok: true, erros: [] };
        return { ok: false, erros: mensagens(corpo) };
    }

    /**
     * Apaga um registro. Uso: massa de teste que sobrou de rodada anterior e atrapalha o caso.
     * @param {string} objeto @param {string} id
     * @returns {Promise<{ ok: boolean, erros: string[] }>}
     */
    async excluir(objeto, id) {
        // O DELETE pelo `api request rest` volta 204 sem corpo e sem cabeçalho legível; o comando
        // de dados da CLI dá um JSON com o resultado.
        try {
            runSf(['data', 'delete', 'record', '--sobject', objeto, '--record-id', id, '--json'], this.org, `apagar ${objeto} ${id}`);
            return { ok: true, erros: [] };
        } catch (error) {
            return { ok: false, erros: [error instanceof Error ? error.message : String(error)] };
        }
    }

    /** @param {string} objeto @param {string} id @param {string[]} campos */
    async ler(objeto, id, campos) {
        const { status, corpo } = this.chamar('GET', `sobjects/${objeto}/${id}?fields=${campos.join(',')}`);
        if (status !== 200) throw new Error(`Leitura de ${objeto} ${id} recusada (${status}): ${JSON.stringify(corpo)}`);
        return corpo;
    }

    /** @param {string} objeto */
    async describe(objeto) {
        const chave = `${this.org}:${objeto}`;
        if (!describes.has(chave)) {
            const { status, corpo } = this.chamar('GET', `sobjects/${objeto}/describe`);
            if (status !== 200) throw new Error(`Describe de ${objeto} recusado (${status}): ${JSON.stringify(corpo)}`);
            describes.set(chave, corpo);
        }
        return describes.get(chave);
    }

    /**
     * GET na UI API (o que a tela do Lightning consulta): valores de picklist por Tipo de
     * Registro, layout por Tipo de Registro.
     * @param {string} caminho Ex.: "ui-api/object-info/Lead/picklist-values/<rtId>/Status"
     */
    async uiApi(caminho) {
        const { status, corpo } = this.chamar('GET', caminho);
        if (status !== 200) throw new Error(`UI API recusou ${caminho} (${status}): ${JSON.stringify(corpo)}`);
        return corpo;
    }

    /**
     * Converte um Lead com Database.convertLead, a mesma regra do botão Converter (validation
     * rules e trigger incluídos). A REST API não tem rota de conversão e a ação padrão
     * convertLead não existe em toda org, então vai por Apex anônimo. Conta, Contato e
     * Oportunidade criados entram na limpeza.
     * @param {string} leadId
     * @param {string} statusConvertido
     * @returns {Promise<{ ok: boolean, erros: string[] }>}
     */
    async converterLead(leadId, statusConvertido) {
        const apex = [
            'Database.LeadConvert conversao = new Database.LeadConvert();',
            `conversao.setLeadId('${leadId}');`,
            `conversao.setConvertedStatus('${statusConvertido.replace(/'/g, "\\'")}');`,
            'Database.LeadConvertResult resultado = Database.convertLead(conversao, false);',
            'if (!resultado.isSuccess()) {',
            "    List<String> erros = new List<String>();",
            '    for (Database.Error erro : resultado.getErrors()) erros.add(erro.getMessage());',
            "    throw new IllegalArgumentException(String.join(erros, ' | '));",
            '}'
        ].join('\n');
        fs.mkdirSync(PASTA_CORPOS, { recursive: true });
        const arquivo = path.resolve(PASTA_CORPOS, `converter-${leadId}.apex`);
        fs.writeFileSync(arquivo, apex, 'utf-8');

        let saida;
        try {
            saida = runSf(['apex', 'run', '--file', `"${arquivo}"`, '--json'], this.org, 'converter o Lead');
        } catch (error) {
            // Exceção no Apex: a CLI sai com erro, mas o motivo está na mensagem.
            return { ok: false, erros: [error instanceof Error ? error.message : String(error)] };
        }
        const { result } = JSON.parse(saida.slice(saida.indexOf('{')));
        if (!result.success) return { ok: false, erros: [result.exceptionMessage || result.compileProblem || 'conversão recusada'] };

        const lead = await this.ler('Lead', leadId, ['ConvertedAccountId', 'ConvertedContactId', 'ConvertedOpportunityId']);
        // Ordem da limpeza: a Oportunidade e o Contato saem antes da Conta.
        await this.registrarParaLimpeza('Opportunity', lead.ConvertedOpportunityId);
        await this.registrarParaLimpeza('Contact', lead.ConvertedContactId);
        await this.registrarParaLimpeza('Account', lead.ConvertedAccountId);
        return { ok: true, erros: [] };
    }

    /** @param {string} objeto @param {string | undefined} id */
    async registrarParaLimpeza(objeto, id) {
        if (!this.testInfo || !id) return;
        await this.testInfo.attach('salesforce-record', {
            body: JSON.stringify({ object: objeto, id }),
            contentType: 'application/json'
        });
    }
}

/**
 * Separa o status HTTP e o corpo JSON da saída do `--include`. A CLI imprime a linha de status,
 * os cabeçalhos e o corpo sem linha em branco entre eles; o corpo é o que começa na primeira
 * linha aberta por "{" ou "[" (nenhum cabeçalho começa assim). Avisos da CLI ("update
 * available") podem vir antes de tudo.
 * @param {string} saida
 * @param {string} chamada Para a mensagem de erro
 */
function lerResposta(saida, chamada) {
    const inicio = saida.search(/^HTTP\/[\d.]+ \d{3}/m);
    if (inicio < 0) throw new Error(`Resposta inesperada da CLI em ${chamada}:\n${saida.slice(0, 500)}`);
    const resposta = saida.slice(inicio);
    const status = Number(resposta.match(/^HTTP\/[\d.]+ (\d{3})/)?.[1]);
    const inicioDoCorpo = resposta.search(/^[[{]/m);
    const texto = inicioDoCorpo < 0 ? '' : resposta.slice(inicioDoCorpo).trim();
    let corpo = null;
    if (texto) {
        try {
            corpo = JSON.parse(texto);
        } catch {
            corpo = texto;
        }
    }
    return { status, corpo };
}

/**
 * Junta as mensagens de erro da REST API, que vêm em formatos diferentes conforme a rota.
 * @param {any} corpo
 * @returns {string[]}
 */
function mensagens(corpo) {
    const lista = Array.isArray(corpo) ? corpo : [corpo];
    return lista.map((erro) => (erro && (erro.message || erro.errorMessage)) || JSON.stringify(erro));
}

/**
 * Abre a REST API como o usuário do perfil em execução.
 * @param {import('@playwright/test').TestInfo} [testInfo]
 * @param {string} [org] Alias da CLI; por padrão, o usuário do perfil em execução
 */
async function abrirApi(testInfo, org) {
    return new SfApi(org || currentProfile().usuario, testInfo);
}

module.exports = { abrirApi, SfApi };
