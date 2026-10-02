# Cenários de programação determinísticos

## Princípio

A Simplificada é a sequência recebida da empresa. Ela é preservada como
**Original / Cenário 0** e nunca é alterada pelo otimizador. Todos os cenários
partem do mesmo snapshot de ordens, turnos, indisponibilidades, recursos,
fornos, BOs, carcaças e saldo de tarugo.

## Perfis

| Perfil | Objetivo | Não muda |
| --- | --- | --- |
| Original | Simular a Simplificada importada. | A sequência original. |
| Material | Reduzir barras, sobras, campanhas quebradas, troca de liga e setup conhecidos. | Restrições físicas. |
| Produtividade | Atingir mais turnos com >= 25.000 kg e >= 1.300 kg/h. | Restrições físicas. |
| Balanceado | Conciliar metas, prazo, recursos, material e estabilidade. | Restrições físicas. |

`DELIVERY_PRIORITY` está previsto no contrato, mas não é apresentado como
cenário principal nesta etapa.

## Busca e comparação

Cada perfil executa uma busca determinística com largura e profundidade
configuradas em `source-of-truth.ts`. Cada nó é recalculado pelo simulador
operacional; não há LLM, aleatoriedade ou limite baseado em tempo de CPU.

Hard constraints eliminam preferência: uma programação com bloqueio físico não
vence apenas por ter maior volume. Itens bloqueados são devolvidos com motivo e
previsão calculada de disponibilidade quando houver.

O comparador calcula deltas contra o Original no motor: produção, kg/h, trocas
de liga, setup, ociosidade e término. A recomendação só escolhe cenários que
passam pelos portões físicos e registra os trade-offs relevantes.

## Parâmetros confirmados

- Turno de referência: 06:30–16:10.
- Meta conjunta: 25.000 kg por turno.
- Meta de produtividade: 1.300 kg/h.
- Look ahead: profundidade 4 e largura 5.

Pendências, como custo real de troca de liga, mão de obra e limite máximo após
aquecimento, continuam visíveis e não recebem valores inventados.
