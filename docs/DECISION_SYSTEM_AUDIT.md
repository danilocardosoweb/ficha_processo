# Carga Máquina — evolução auditada em 07/09/2026

## Proteção antes da mudança

- Commit anterior preservado: 579e7acb1f131dce52e40c7a48fbe638d35025cf.
- Branch de segurança: backup/carga-maquina-pre-evolucao-20260907.
- Tag: checkpoint-carga-maquina-v1-20260907.
- Desenvolvimento: feat/alupilot-decision-system.
- Para consultar a versão anterior, use a branch de segurança em outro worktree. Não execute reset destrutivo sobre alterações atuais.
- Git protege o código, não restaura dados de produção. As duas novas migrações são aditivas; versões de perfis são preservadas. Não excluir tabelas para reverter a interface.

## Diagnóstico e implementação desta etapa

| Tema | Constatação | Entrega |
|---|---|---|
| Carcaças | Cadastro da matriz, sequência física e estoque são informações distintas; a consulta parcial perdia ferramentas | Checkpoint já contém paginação completa, seleção física e mensagens que distinguem modelo cadastrado de quantidade livre |
| Produtividade | Valores de importação inconsistentes contaminavam aprendizagem e tempo | Checkpoint contém validação 0 < kg/h <= 2500, substituição por 1300 e arquivo privado dos dados inválidos |
| Critérios | A nota antiga não orientava a heurística da sequência sugerida | Novo perfil alimenta avaliação e busca real de alternativas |
| Segurança da decisão | Uma nota única não distingue inviabilidade de preferência | Restrições e dados desconhecidos ficam separados da nota; comparação prioriza impedimentos |
| Tempo | Intervalos fora do turno inflavam a perda operacional | Quadro separa produção, preparação, espera térmica, espera de recurso, parada cadastrada e tempo fora do turno |
| Fornos | Vaga era liberada no fim do aquecimento, mesmo sem retirada | Retenção até o início de uso da ferramenta; validação de ocupação inicial excedente |
| Material | Saldo era apresentado agrupando as prensas, não pela ordem temporal | Reconstituição do saldo pela cronologia do início de extrusão, com conservação de massa |
| Prazo | Datas com horário recebiam tratamento inadequado | Conversão distingue data sem horário de timestamp |
| Aprendizado | “Segurança” aparecia mesmo sem previsões comparadas | Interface declara ausência de medição; remove promessa de precisão |
| IA | Pacote omitira prazo e fixava desenho de forno | Prazo, vagas configuradas e avaliação do perfil incluídos; fallback não atribui confiança inventada |
| UX | Muitas informações simultâneas | Central recolhida inicialmente, sete áreas, detalhes progressivos, ações de teste separadas da produção |

## Arquitetura executável, sem motores fictícios

Em src/modules/planning/decision-system:

- schema.ts: contrato validado de perfis, condições, pesos, limiares e cinco estratégias iniciais.
- catalog.ts: catálogo e dependências do mapa visual.
- engine.ts: classificação, avaliação, penalidades, rastreio por ordem e agrupamento de impactos.
- optimizer.ts: busca heurística limitada, com cada candidato recalculado no simulador real.
- worker.ts: busca fora da linha principal da interface.
- dates.ts: prazo e atraso.
- times.ts: decomposição operacional do calendário.

O simulador existente continua responsável por calendário, aquecimento, reservas, carcaças, BO, produtividade e material. Esses componentes ainda não foram transformados em dezesseis serviços independentes: criar nomes sem separar responsabilidades não resolveria o acoplamento.

Fluxo: dados atuais → simulador → avaliação do perfil → alternativas recalculadas → comparação humana → sequência manual → salvar cenário → aprovação existente com trava adicional.

A IA explica o pacote; não fornece o tempo oficial, não aprova produção e não substitui as restrições.

## Como usar

1. Entre em Carga Máquina e expanda a Central de Decisões.
2. Leia Resumo e confirme cadastros/estoques pendentes.
3. Em Critérios, escolha um perfil. No modo avançado, crie condições sem escrever código.
4. Clique em Testar impacto. A mesma sequência pode mudar de nota sem mudar de horário.
5. Gere alternativas para realmente testar outras sequências.
6. Compare atrasos, término, preparação, espera, sobra e impedimentos — não apenas a nota.
7. Use uma alternativa na simulação manual. Esse botão não inicia a produção.
8. Salve o cenário para comparação e use o fluxo de aprovação após resolver pendências.
9. Administradores podem salvar versões do perfil com motivo e restaurar documentos anteriores como nova versão.

Os pesos iniciais são propostas de avaliação, não parâmetros certificados da fábrica. Restrições físicas protegidas não podem ser desativadas pelo editor. Prioridade organiza orientações; peso e penalidade afetam o custo; regras obrigatórias prevalecem mesmo com peso zero.

## Persistência e controle

- decision_profiles e decision_profile_versions: acesso direto negado a anon/authenticated; RLS habilitada.
- Operações autorizadas pelo mecanismo de sessão local existente, sempre filtradas por organização.
- Escrita de perfil exige administrador, justificativa e versão-base; conflito concorrente é recusado.
- API de cenários reavalia o snapshot da decisão em vez de aceitar a nota enviada pelo navegador.
- Trigger de aprovação impede transição de cenários v3 quando o estado da decisão não é viável.
- As verificações existentes de reservas continuam ativas. Reavaliar snapshot não equivale a reconstruir toda a produção a partir de fontes atuais no servidor.

Os avisos do verificador sobre RLS sem policies nas novas tabelas são intencionais: não há acesso direto, apenas funções com sessão/organização. Os avisos sobre funções SECURITY DEFINER exigem manter essa verificação. Há avisos legados de segurança fora desta entrega; não foi declarada uma auditoria global concluída. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Referências de produto

Comparação documental, não ensaio de desempenho nem afirmação de superioridade:

- Siemens Opcenter: programação com restrições e comparação de cenários. https://www.siemens.com/en-gb/products/opcenter/advanced-planning-scheduling-aps/advanced-scheduling-software/
- Camunda DMN: decisões executáveis separadas da apresentação. https://camunda.com/platform/decision-engine/
- Asprova: sequenciamento e restrições de recursos industriais. https://www.asprova.com/en/asprova/newfeature/ver1301.html

Aplicação local: separar restrições de objetivos, ligar o mapa a condições reais e comparar resultados calculados. Não copiar limites industriais de demonstrações de fornecedores.

## Verificação e limitações

- Build Next.js e TypeScript concluídos.
- Nove testes automatizados: produtividade, seleção física, datas, restrição com peso zero, estoque desconhecido, validação de perfil, otimização sem perda de ordens, conservação de material e mensagem de estoque físico.
- Migrações aplicadas e verificados RLS, privilégios e presença da trava de aprovação.
- App iniciado em 127.0.0.1:3000; navegador chega ao login. Fluxo autenticado, escrita de perfis pela interface e qualidade visual das novas áreas ainda precisam de sessão do usuário.
- Não foi feito teste de IA paga ponta a ponta nesta etapa nem benchmark com milhares de ordens.

## Próximas etapas necessárias — não declaradas concluídas

1. Homologação autenticada: salvar/abrir/restaurar perfil, conflito entre dois administradores, teclado, celular e comparação com carga real.
2. Unificar progressivamente a nota histórica e a nova avaliação. A nota antiga permanece para preservar cenários; não é equivalente à nova nota.
3. Persistir a escolha de perfil ativo por usuário/organização. Nesta etapa, os documentos são persistidos e a aplicação do perfil é local à simulação.
4. Retirar os motores internos do componente/simulador monolítico em módulos menores com regressão dedicada.
5. Reconstrução autoritativa de cenários no servidor na aprovação, sem depender de snapshots de entrada do cliente. O legado ainda aceita snapshots; a trava nova não constitui solução completa contra um cliente malicioso.
6. Otimizador global das duas prensas: hoje a reserva é calculada prensa a prensa e a busca não transfere ordens. Compatibilidades industriais precisam ser cadastradas antes de permitir transferência.
7. Reservar ferramentas pela identidade física completa, não apenas código da matriz, em todos os motores e calendários.
8. Escolha da liga alternativa e saldo: a escolha agora usa o ledger cronológico compartilhado das duas prensas e recalcula a programação quando a troca de liga altera a preparação; a disponibilidade física continua sendo validada contra o estoque confirmado.
9. Aquecimento, retirada, transporte, retorno e disponibilidade real exigem validação de processo. Tempos não cadastrados não foram inventados.
10. Aprendizado estatístico: separar produção líquida e paradas nos apontamentos, ampliar amostras válidas e medir erro em dados não usados no ajuste.
11. Conversação contextual, detecção geral de ciclos entre regras e otimização mais ampla são evoluções futuras; o editor atual usa predicados limitados e seguros.
12. Testes de carga, concorrência e validação industrial de toda a lista do pedido são necessários antes de tratar esta etapa como sistema integralmente homologado.
