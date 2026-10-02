# Sala de controle — versão inicial

Atualização: a sala agora inclui uma rodada manual de cinco agentes reais com skills próprias e ferramentas limitadas. Consulte PLANNING_AGENTS.md para o funcionamento atual. As limitações abaixo descrevem o primeiro canvas por regras; monitoramento contínuo e operações reais autônomas continuam ausentes.

Local: Carga Máquina → Central de Decisões → Sala de controle.

## O que funciona

- Canvas responsivo com cinco funções e um painel de programação simplificada; alternativa em lista e diálogo ampliado.
- Uma ordem selecionada é compartilhada entre as orientações das cinco funções. Busca por ferramenta, ordem ou prensa, preservando a sequência de cada prensa.
- Contagens usam a simulação atual: atraso previsto, impedimento por ordem, aquecimento sem liberação cadastrada e status em produção.
- Recursos, horários e mensagens vêm do motor existente. Nenhum relógio promove uma previsão a execução real.
- Conferência e teste de troca abrem o fluxo existente com a ordem selecionada, mantendo validação, motivo e permissão de aplicação. Persistência segue o salvamento de cenário existente.
- Atalhos abrem as telas operacionais existentes. Abrir não encaminha, inicia, aprova ou encerra uma ordem.

## Limites explícitos

Não há agentes de IA autônomos, colaboração em tempo real, registro de recebimento de tarefa ou apontamentos de qualidade carregados nesta visão. Painéis usam assistentes por regras, sem inventar conclusões, responsáveis individuais ou temperatura. As linhas são relações de responsabilidade, não comprovação de execução. As posições são organizadas, sem arraste livre nesta primeira versão.

## Validação manual

1. Abra uma carga e a nova aba. Confira contagem e ordem das ferramentas por prensa.
2. Selecione uma ordem no painel 6 e clique em cada função: o código e os horários devem permanecer os da mesma ordem.
3. Busque uma ferramenta e limpe a busca; nenhuma ordem deve desaparecer da simulação.
4. Abra a conferência, teste uma troca com motivo e compare horários antes de aplicar. Sem aplicação, a sequência permanece igual.
5. Confira lista, canvas, tela ampla e navegação por teclado; feche os diálogos sem perder a ordem em foco.
6. Sem ordens, deve aparecer orientação de carga vazia. Sem autorização de ajuste, a aplicação da troca continua protegida.

Próxima etapa: validar com usuários da fábrica antes de integrar registros colaborativos e recebimento de tarefas. Esses registros exigem trilha de auditoria, permissões e tratamento de alterações simultâneas.
