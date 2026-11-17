// @ts-check
/**
 * Desfecho esperado de um caso no perfil em que ele está rodando.
 *
 * Um mesmo cenário pode ser legítimo em um perfil e proibido em outro: o Vendedor cria
 * Pedido, o Consulta não. Nos dois casos o teste PASSA quando a org se comporta como a
 * regra manda — o que muda é o que ele afirma. Sem registrar qual era a expectativa, o
 * painel vê só "passou" e não consegue distinguir "faz porque pode" de "está barrado,
 * como deveria": fatos opostos com a mesma cor.
 *
 * Uso no teste:
 *
 *   const alvo = esperado({ '*': 'permitido', consulta: 'negado', atendimento: 'negado' });
 *   if (alvo === 'negado') {
 *       await expectSemAcao(page, 'New');
 *       return;
 *   }
 *   // ... fluxo normal
 *
 * O painel cruza esta anotação com o status final e chega nos quatro estados da matriz:
 *
 *   passou + permitido → faz, e pode fazer
 *   passou + negado    → está barrado, e deve estar
 *   falhou + permitido → deveria fazer e não faz      (falha funcional)
 *   falhou + negado    → deveria estar barrado e não está  (vazamento de permissão)
 */
const { test } = require('@playwright/test');
const { currentProfile } = require('./sfAuth');

/** @typedef {'permitido' | 'negado'} Desfecho */

/**
 * Declara o desfecho esperado no perfil em execução e registra na anotação "esperado".
 *
 * A chave "*" vale para todo perfil não citado, então um cenário que só é proibido em
 * dois perfis descreve só esses dois — não uma tabela de 15 linhas para manter à mão.
 * @param {Partial<Record<string, Desfecho>> & { '*'?: Desfecho }} porPerfil
 * @returns {Desfecho}
 */
function esperado(porPerfil) {
    const { id, nome } = currentProfile();
    const valor = porPerfil[id] ?? porPerfil['*'] ?? 'permitido';
    if (valor !== 'permitido' && valor !== 'negado') {
        throw new Error(`esperado(): valor inválido "${valor}" para o perfil ${nome} — use "permitido" ou "negado".`);
    }
    test.info().annotations.push({ type: 'esperado', description: valor });
    return valor;
}

module.exports = { esperado };
