// @ts-check
/**
 * Completa tests/e2e/test-data/acesso/objetos.json com o que a org tem e a lista ainda não confere:
 *
 *   - os objetos personalizados do projeto (os de pacote gerenciado só com --pacotes);
 *   - os objetos citados em "acesso" ou "campos" de algum perfil (tests/e2e/test-data/perfis).
 *
 * Objeto padrão não é descoberto: a org tem centenas, e só o projeto sabe quais importam.
 * Esses continuam entrando à mão.
 *
 * A lista é um arquivo, e não uma consulta feita a cada rodada, porque o ID do caso (CT0012)
 * é a chave do histórico no painel: precisa ser o mesmo amanhã, e uma descoberta em tempo de
 * execução renumeraria tudo no dia em que alguém criasse um objeto. Aqui o que já está na
 * lista não muda, e o que entra ganha o próximo ID livre.
 *
 * Uso:
 *   node scripts/descobrir-objetos.js             acrescenta o que falta
 *   node scripts/descobrir-objetos.js --simular   só mostra o que acrescentaria
 *   node scripts/descobrir-objetos.js --pacotes   inclui objetos de pacote gerenciado
 */
const fs = require('fs');
const path = require('path');
const { allProfiles, defaultProfile } = require('../tests/e2e/utils/perfis');
const { userAccess } = require('../tests/e2e/utils/acesso');

const FILE = path.join(__dirname, '..', 'tests', 'e2e', 'test-data', 'acesso', 'objetos.json');
const args = process.argv.slice(2);
const SIMULAR = args.includes('--simular');
const PACOTES = args.includes('--pacotes');

// "__c" deixa de fora o que a org cria em volta do objeto (__Share, __History, __Feed) e os
// outros tipos personalizados (__mdt, __e, __x), que não têm permissão de objeto como a matriz.
const ehPersonalizado = (/** @type {any} */ s) => s.custom && !s.customSetting && s.name.endsWith('__c');
// Objeto de pacote gerenciado leva o prefixo do pacote: pacote__Objeto__c.
const ehDePacote = (/** @type {string} */ nome) => /^[A-Za-z0-9]+__.+__c$/.test(nome);

function main() {
    /** @type {Array<{ id: string, objeto: string }>} */
    const lista = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    const naLista = new Set(lista.map((o) => o.objeto));
    // A org como o perfil padrão a vê: é o usuário de referência da suíte Acesso.
    const org = userAccess(defaultProfile().usuario);

    const personalizados = [...org.values()]
        .filter(ehPersonalizado)
        .map((s) => s.name)
        .filter((nome) => PACOTES || !ehDePacote(nome));
    const citados = allProfiles().flatMap((p) => [...Object.keys(p.acesso || {}), ...Object.keys(p.campos || {})]);

    const desconhecidos = [...new Set(citados)].filter((nome) => nome !== '*' && !org.has(nome));
    for (const nome of desconhecidos) {
        console.warn(`Citado em tests/e2e/test-data/perfis, mas não existe na org (ou o perfil padrão não o vê): ${nome}`);
    }

    const novos = [...new Set([...citados, ...personalizados])]
        .filter((nome) => nome !== '*' && org.has(nome) && !naLista.has(nome))
        .sort((a, b) => a.localeCompare(b));
    if (novos.length === 0) {
        console.log(`Nada a acrescentar: os ${lista.length} objetos da lista já cobrem o que foi encontrado.`);
        return;
    }

    let proximo = Math.max(0, ...lista.map((o) => Number(o.id.replace(/\D/g, '')))) + 1;
    for (const objeto of novos) {
        const id = `CT${String(proximo++).padStart(4, '0')}`;
        lista.push({ id, objeto });
        console.log(`${SIMULAR ? 'Acrescentaria' : 'Acrescentado'}: ${id}  ${objeto}  (${org.get(objeto).label})`);
    }
    if (SIMULAR) return;

    // Um objeto por linha, como o arquivo já é escrito.
    const linhas = lista.map((o) => `  { "id": "${o.id}", "objeto": "${o.objeto}" }`);
    fs.writeFileSync(FILE, `[\n${linhas.join(',\n')}\n]\n`, 'utf-8');
    console.log(`${path.relative(process.cwd(), FILE)}: ${lista.length} objetos.`);
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
