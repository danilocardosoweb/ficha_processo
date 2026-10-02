# Fonte de verdade do planejamento e da IA

Esta versão do AluPilot registra as premissas fornecidas para o motor de
planejamento e para os analistas de IA.

| Documento | Papel no sistema |
| --- | --- |
| `planning-spec.md` | Regra principal do negócio e do motor determinístico. |
| `parametros-e-pendencias.md` | Parâmetros, status de confirmação e pendências operacionais. |
| `AGENTS.md` | Regras de implementação e validação para o código. |

O contrato executável está em `src/modules/planning/source-of-truth.ts`.
Ele expõe a versão da especificação, os documentos usados pelo pacote de IA e
as pendências que precisam aparecer como limitação, nunca como fato.

## Regra de interpretação

- `CONFIRMADO`: pode ser usado pelo motor.
- `SUGERIDO`: pode ser usado apenas como ponto de partida identificado.
- `PENDENTE`: não autoriza decisão automática; deve aparecer na análise como
dado a confirmar.

Os cenários Original, Material, Produtividade e Balanceado estão documentados
em `PLANNING_SCENARIOS.md`. A Simplificada é o baseline imutável; os demais
cenários usam o mesmo snapshot e simulador físico, mudando somente a função
objetivo.

O plano oficial segue determinístico. IA interpreta o resultado calculado e
propõe cenários de simulação; não cria regra, disponibilidade ou capacidade.
