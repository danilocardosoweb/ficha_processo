# Parâmetros e pendências do planejamento

O contrato executável é `src/modules/planning/source-of-truth.ts`.

## Confirmados

- Turno: 06:30–16:10.
- Meta conjunta: 25.000 kg por turno.
- Meta: 1.300 kg/h.
- Aquecimento padrão: 240 minutos.
- Pedido pequeno: 300 kg.
- Look ahead: profundidade 4, largura 5 e até 5 candidatos por prensa.
- Fornos: 3 por prensa, com 7 posições cada.

## Sugeridos

- Orçamento máximo de busca: 5.000 nós.
- Horizonte de planejamento: 48 horas.
- Janela congelada: 60 minutos.
- Fuso horário: America/Sao_Paulo.
- Base sugerida para a meta de produtividade: `PER_PRESS_GROSS`, com as
  visões técnica, operacional, por prensa líquida e total das prensas sempre
  calculadas em paralelo.

## Pendentes

- Limite máximo de espera depois do aquecimento.
- Possibilidade formal de dividir OPs.
- Matriz definitiva ferramenta → BO e substituições de carcaça.
- Capacidade por turno de mão de obra.
- Custo/tempo real de mudança de liga, sucata e limpeza.
- Confirmação operacional do significado de 1.300 kg/h (`PER_PRESS_GROSS`,
  `PER_PRESS_NET` ou `TOTAL_GROSS`).
- Registro estruturado de `DEAD_CYCLE`, mão de obra e paradas planejadas ou não
  planejadas para não estimar esses minutos a partir de texto livre.

Itens pendentes devem aparecer como necessidade de confirmação. O motor não
deve criar valores silenciosos para fazê-los parecer disponíveis.
