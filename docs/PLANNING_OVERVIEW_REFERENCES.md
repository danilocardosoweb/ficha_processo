# Visão macro da programação

## Diagnóstico

O fluxo anterior abria uma ferramenta por vez e exigia um seletor longo. Ele servia para conferir uma ordem, mas não para comparar prensas e identificar problemas na carga inteira.

## Referências pesquisadas no GitHub

- vis-timeline: intervalos em escala temporal, agrupamento, navegação e zoom. https://github.com/visjs/vis-timeline
- Frappe Gantt: apresentação de tarefas ao longo do tempo e navegação por períodos. https://github.com/frappe/gantt
- frePPLe: planejamento da produção com restrições e atenção aos gargalos. https://github.com/frePPLe/frepple

São referências de interação, não comparação medida de desempenho. Não foi copiado código nem instalado pacote desses projetos. A implementação é local e usa os resultados do simulador existente.

## Implementação

- Todas as prensas usam o mesmo início e a mesma escala.
- Abertura em toda a carga; aproximação em janelas de 24 ou 8 horas, com anterior/próximo.
- Barras representam preparação até saída, incluindo pausas de calendário. Não representam só produção líquida.
- Filtros reduzem a opacidade, preservando o contexto. A tabela lista as ordens correspondentes em toda a carga.
- Impedimento e atraso simultâneos continuam visíveis. Azul significa previsão, não liberação.
- Recursos agrupados por ordens afetadas, sem contar duas vezes a mesma ordem.
- Selecionar uma ordem abre resumo. Conferir/testar troca abre o fluxo detalhado sem substituir a visão geral.
- Tela ampla preserva filtros e período. Não há alteração de duração por arrastar bordas: horários continuam vindo do motor.
- Ajustes existentes mantêm motivo e recálculo; aprovação continua separada.

## Verificação

Testes cobrem recorte temporal, alertas simultâneos, deduplicação por recurso e regressões do simulador. A validação visual autenticada exige login; não foi contornada a autenticação.
