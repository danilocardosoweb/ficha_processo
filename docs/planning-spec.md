# Especificação do motor de programação

## Fonte principal

O motor recebe a Simplificada como referência operacional, normaliza as OPs e
captura um snapshot único de turnos, recursos, forno, BO, carcaça, tarugo,
produtividade, paradas e horas extras. A mesma entrada, configuração e perfil
devem produzir a mesma saída.

## Cenários

O cenário `ORIGINAL` reproduz a Simplificada. `MATERIAL_EFFICIENCY`,
`MAX_THROUGHPUT` e `BALANCED` executam busca determinística sobre o mesmo
snapshot. `DELIVERY_PRIORITY` está reservado para expansão posterior.

Nenhum cenário pode alterar a carteira, a sequência original ou o estado real.
Todo candidato passa pelo simulador global das prensas, incluindo recursos
compartilhados e tempo. Hard constraints eliminam candidatos; regras temporais
calculam espera e início viável; preferências entram somente na pontuação.

Quando o PCP aprova um cenário, ele não sobrescreve a Simplificada importada.
O sistema registra uma **sequência de trabalho** versionada, separada por
prensa, e a marca como a sequência operacional ativa. A sequência original
continua disponível para comparação e auditoria. Ordens que já começaram ficam
congeladas na prensa e na posição atuais; somente ordens ainda não iniciadas
podem receber a nova posição calculada.

O PCP pode solicitar um ajuste manual na tela de produção somente após uma
liberação autenticada por senha e com motivo obrigatório. A movimentação é
sempre limitada às prensas permitidas para o usuário e reindexa cada prensa de
forma independente; uma ordem em produção nunca pode ser movida. Ao aplicar o
ajuste, o sistema grava o antes/depois na auditoria e marca a Carga Máquina
para recalcular horários, forno, esperas e recursos antes de iniciar a
produção.

## Objetivos confirmados

- Turno de referência: 06:30 a 16:10.
- Produção conjunta das prensas: pelo menos 25.000 kg por turno.
- Produtividade média: pelo menos 1.300 kg/h.

As metas são objetivo de otimização, não permissão para violar disponibilidade,
forno, BO, carcaça, ferramenta, material ou ordem já iniciada.

## Revezamento e capacidade de mesa

Entre **11:00 e 13:30**, a operação trabalha com equipe reduzida. O motor
deve preferir ferramentas com até **2 furos** nessa janela, podendo usar um
limite configurável de até 4 furos quando a operação confirmar capacidade de
mesa e colaboradores. Ferramentas acima do limite são uma **preferência com
penalização**, e não uma restrição obrigatória: só permanecem no período se
não houver alternativa viável sem prejudicar recursos físicos, ordens
iniciadas, material ou prazos. A explicação do cenário deve registrar cada
ocorrência e o motivo da permanência.

## Produtividade e contabilidade do tempo

O motor não trata a meta de 1.300 kg/h como OEE genérico. Ele calcula, para
cada janela de turno e para o total da carga:

- **produtividade técnica:** kg líquidos / horas de `EXTRUSION_TIME`;
- **produtividade operacional:** kg líquidos / horas de extrusão + preparação +
  esperas classificadas;
- **PER_PRESS_GROSS:** kg líquidos / horas calendarizadas das prensas
  participantes no turno (base sugerida atual para comparar a meta);
- **PER_PRESS_NET:** kg líquidos / horas em que houve extrusão;
- **TOTAL_GROSS:** kg líquidos / horas combinadas de todas as prensas;
- **rendimento:** kg líquidos / kg brutos necessários, usando a eficiência
  cadastrada;
- **cobertura da carga:** minutos operacionais ocupados / minutos disponíveis;
- **NO_LOAD:** minutos disponíveis sem ordem planejada. NO_LOAD reduz a
  cobertura e a produtividade de turno, mas não reduz a produtividade técnica
  de uma ferramenta que estava extrudando.

Cada minuto recebe no máximo uma classificação: `EXTRUSION_TIME`,
`DEAD_CYCLE`, `SETUP`, `PLANNED_STOP`, `UNPLANNED_STOP`, `HEATING_WAIT`,
`RESOURCE_WAIT`, `LABOR_WAIT` ou `NO_LOAD`. Quando a fonte ainda não fornece
`DEAD_CYCLE`, mão de obra ou parada real, o relatório mostra zero/informação
ausente e não inventa uma duração.

O contrato `productivityBasis` permanece explícito em
`src/modules/planning/source-of-truth.ts`, pois a operação ainda precisa
confirmar qual das três visões deve governar a meta. As três visões continuam
visíveis para auditoria.

## Fornos e linha do tempo física

Cada prensa possui três fornos com sete posições cada. As 21 posições são
recursos físicos paralelos, identificados por `forno + posição`; nunca são uma
fila de aquecimento. Para cada ferramenta, o simulador registra entrada no
forno, pronta em, retirada do forno, início da extrusão e o motivo de qualquer
espera.

A posição permanece reservada até a retirada confirmada no início da
extrusão. Assim, `HEATING` representa o período mínimo até ficar pronta e
`READY_WAITING` representa a permanência posterior já pronta no forno. A
espera por aquecimento não pode ser apresentada como espera pronta, nem
`NO_LOAD` como baixa produtividade técnica.

O motor pode antecipar o aquecimento apenas quando uma posição livre, a
cobertura futura ou uma restrição temporal justificarem a antecipação. O
motivo precisa acompanhar a decisão. A capacidade de mão de obra para carga e
descarga ainda é pendente e não deve ser estimada silenciosamente.

## Transparência

Cada cenário precisa retornar indicadores comuns, deltas contra o Original,
ordens excluídas, fatores limitantes, motivos de mudança, riscos, metas de
turno, cobertura, rendimento e trade-offs. A recomendação compara cenários
viáveis e não escolhe somente pela maior nota. A explicação deve informar
quanto falta/excede 25 toneladas e 1.300 kg/h, além de apontar setups,
esperas, baixa produtividade, falta de carga, indisponibilidade e outras
restrições que limitam o resultado.

Detalhes operacionais dos perfis e da busca: `PLANNING_SCENARIOS.md`.
