// @ts-check
/**
 * CPF e CNPJ (numérico e alfanumérico) válidos e inválidos para a massa de teste.
 *
 * O documento é gerado a cada caso, e não fixado no código: a regra de duplicidade recusa um
 * CPF/CNPJ que já exista em outro Lead, e a massa de um caso que falhou fica na org para
 * investigação (utils/limpeza.js). Um CPF fixo faria a rodada seguinte falhar por duplicidade.
 *
 * Dígito verificador: módulo 11, como na Receita Federal. No CNPJ alfanumérico, cada caractere
 * vale o código ASCII menos 48 (0 a 9 continuam 0 a 9; A vale 17, B vale 18...).
 */

const DIGITOS = '0123456789';
const ALFANUMERICOS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** @param {string} alfabeto @param {number} tamanho */
function sortear(alfabeto, tamanho) {
    let texto = '';
    for (let i = 0; i < tamanho; i++) texto += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    return texto;
}

/** @param {string} base @param {number} pesoInicial */
function dvCpf(base, pesoInicial) {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

/** @param {string} corpo */
function dvCnpj(corpo) {
    let soma = 0;
    let peso = 2;
    for (let i = corpo.length - 1; i >= 0; i--) {
        soma += (corpo.charCodeAt(i) - 48) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

/** CPF válido, só os 11 dígitos. */
function gerarCpf() {
    let base;
    do {
        base = sortear(DIGITOS, 9);
    } while (/^(\d)\1+$/.test(base)); // sem sequência repetida (111.111.111-xx)
    const dv1 = dvCpf(base, 10);
    return base + dv1 + dvCpf(base + dv1, 11);
}

/**
 * CNPJ válido, só os 14 caracteres.
 * @param {{ alfanumerico?: boolean }} [opcoes] alfanumerico: as 12 primeiras posições com letras
 */
function gerarCnpj({ alfanumerico = false } = {}) {
    let corpo;
    do {
        corpo = sortear(alfanumerico ? ALFANUMERICOS : DIGITOS, 12);
        // O alfanumérico precisa de pelo menos uma letra, senão é só um CNPJ numérico.
    } while (alfanumerico ? !/[A-Z]/.test(corpo) : /^(\d)\1+$/.test(corpo));
    const dv1 = dvCnpj(corpo);
    return corpo + dv1 + dvCnpj(corpo + dv1);
}

/** @param {string} cpf 11 dígitos → 000.000.000-00 */
const mascararCpf = (cpf) => `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

/** @param {string} cnpj 14 caracteres → 00.000.000/0000-00 */
const mascararCnpj = (cnpj) =>
    `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;

/**
 * Mesmo documento com o último dígito verificador trocado: formato certo, validação errada.
 * @param {string} documento sem máscara
 */
function comDvErrado(documento) {
    const ultimo = Number(documento.slice(-1));
    return documento.slice(0, -1) + ((ultimo + 1) % 10);
}

module.exports = { gerarCpf, gerarCnpj, mascararCpf, mascararCnpj, comDvErrado };
