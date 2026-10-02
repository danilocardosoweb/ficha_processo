# Carga Máquina — memória técnica do legado

Data: 16/09/2026. Status: referência histórica; não é a arquitetura da próxima versão.

## 1. Escopo e evidências

Auditoria do código local, contratos, migrações, documentação anterior, imagens fornecidas e execução da suíte de regressão. Não foi feita nesta etapa uma auditoria do conteúdo do banco de produção, aplicação de migrações ou homologação industrial. Existência de uma coluna não comprova preenchimento, atualidade ou qualidade dos dados.

Nenhum componente, cadastro ou cenário antigo foi removido. As alterações já existentes no diretório de trabalho permanecem preservadas. “Legado” é uma decisão de evolução do produto, não uma operação destrutiva.

Fontes principais, relativas à raiz do projeto:

- `src/app/(app)/carga-maquina/page.tsx`: entrada protegida por permissão de simulação.
- `src/components/machine-load-simulator.tsx`: carregamento, resolução de dados, estado, ações e apresentação; aproximadamente 4.900 linhas.
- `src/modules/planning/machine-load-simulator.ts`: calendário, aquecimento, recursos, material e horários.
- `src/modules/planning/productivity.ts` e `tool-selection.ts`: normalização e escolha de ferramenta física.
- `src/modules/planning/decision-system/`: perfis, avaliação, otimização, execução em worker e explicação.
- `src/modules/planning/planning-intelligence.ts`: avaliação/aprendizado anterior, coexistente com o sistema de decisões.
- `src/modules/planning/simulation/`: contratos de cenários e interface de repositório.
- `src/app/api/simulation-scenarios/route.ts`: persistência e encaminhamento da aprovação às funções do banco.
- `src/app/api/press-resources/route.ts`, `bo-resources/route.ts`: cadastros físicos agregados.
- `supabase/migrations/20260824203804_tool_oven_capacity_and_safety.sql`: fornos, posições, tipo e parâmetros térmicos nos ciclos; há migrações posteriores.
- `docs/DECISION_SYSTEM_AUDIT.md`, `WORKSPACE_VALIDATION.md`, `PLANNING_AGENTS.md`: memória das etapas anteriores. Resultados históricos não equivalem a revalidação nesta data.

## 2. Arquitetura e fluxo existentes

A página monta um componente principal que consulta ordens, fichas, ferramentas, ciclos vinculados às ordens, ligas alternativas e diversas APIs. O próprio componente resolve precedência de fontes, configura simulação, guarda estado de seleção, inicia busca, abre cenários e apresenta tabelas, gráficos e controles.

Fluxo principal: dados atuais → normalização na interface → simulação → avaliação por perfil → alternativas recalculadas → sequência manual → salvar cenário → aprovação existente.

O simulador puro é separado da interface, mas reúne responsabilidades industriais distintas. Há mais de um caminho de ordenação e avaliação: modo otimizado interno, inteligência anterior e otimizador de decisões. Os perfis e as notas não são intercambiáveis.

O contrato de repositório de cenários é uma boa intenção de separação; sua existência isolada não prova que todo acesso esteja desacoplado. A interface ainda usa diretamente APIs e estruturas do legado.

## 3. Funcionalidades implementadas e aprendizados

| Área | Implementado | Aprendizado para a reconstrução |
|---|---|---|
| Programação | FIFO, sequência sugerida/manual, filtros por prensa, horários e volumes | A sequência oficial deve ser distinguida de uma previsão ou alternativa local |
| Produtividade | Aceita formatos brasileiros/históricos; valores válidos entre 0 e 2.500 kg/h; padrão 1.300 | Preservar origem e aviso de estimativa; não transformar valor absurdo em 2.500 |
| Ferramenta física | Consulta paginada; normalização de código; seleção por sequência; recusa configurações ambíguas | Matriz não é unidade física; identidade completa precisa acompanhar todas as reservas |
| Carcaça e BO | Modelo exigido, quantidade, indisponibilidade, conflitos e espera | Modelo cadastrado, estoque físico e recurso livre são conceitos distintos |
| Calendário | Turnos e períodos indisponíveis; separação de tempos | Tempo calendário não é tempo de produção nem perda operacional |
| Aquecimento | Vagas agregadas, ciclos conhecidos, espera e retenção da vaga até retirada | Prontidão prevista não é liberação medida; agregar vagas esconde identidade/localização |
| Material | Rendimento, bruto necessário, barras e saldo por liga; reconstrução cronológica entre prensas | Conservação de massa é necessária, mas não representa sozinha corte físico e sobras utilizáveis |
| Alternativas | Estratégias e trocas adjacentes com nova simulação por candidato | Comparar o resultado calculado, não apenas mudar uma nota |
| Ajuste manual | Motivo e proteção de ordens iniciadas | Imprevistos precisam de justificativa, revalidação e histórico |
| Cenários | Snapshots, versões, comparação e aprovação separada | Preservar isolamento; aprovação precisa validar estado atual, não confiar no navegador |
| Explicações | Resumo, critérios, posição, mapa e recursos no tempo | Explicação útil deve mostrar alteração, causa e impacto, não apenas conexões visuais |
| Ajuda | Explicação contextual de campos e efeitos | Manter ajuda curta e específica, junto da decisão |
| Agentes | Papéis/skills, consultas limitadas, propostas supervisionadas, histórico, LM Studio/OpenRouter | Não confundir chamada bem-sucedida de conexão com cinco agentes operacionais confiáveis |

## 4. Dados e regras efetivamente observados

### Ordens e resolução de cadastro

`production_orders` tem prensa, sequência, ferramenta, liga, volumes, status, prazo, dados de importação e campos opcionais de acessórios. `process_sheets`, `tools`, mapeamentos e importações complementam esses campos.

A resolução atual de carcaça prioriza: campo da ordem, dimensão derivada, dados importados, ficha, ferramenta e mapeamento. Dimensões são montadas a partir de diferentes fontes. Isso pode ocultar divergências entre fontes; é um risco de composição, não uma causa comprovada para cada imagem. A nova versão deve retornar valor, origem e divergências, sem escolher silenciosamente uma configuração incompatível.

A produtividade prioriza simplificada, ficha, ferramenta, aprendizado e padrão. `normalizeProductivityKgH` descarta amostras inválidas antes de tirar a média. Quantidade restante é `max(meta − produzido, 0)`; minutos produtivos são `restante / kgPorHora × 60`; bruto necessário é `restante / rendimento`. A semântica líquida da produtividade deve ser confirmada com o PCP antes de aplicar a fontes novas.

### Recursos

O cadastro de carcaças admite prensa, código, quantidade total, indisponível, status e localização. BO admite código, quantidades, status e localização textual. O contrato da simulação reduz carcaças a capacidade por código e reservas; BO a código/capacidade. Não há nesse contrato uma transferência com origem, destino, duração e responsável.

`LoadOrderInput` não carrega sequência física nem tipo sólida/tubular. Embora a seleção de cadastro use a sequência, o simulador reserva a ferramenta essencialmente por código. Configurações distintas da mesma matriz podem ser tratadas como um recurso único.

Fornos reais e posições existem no banco descrito pelas migrações. O simulador reconstrói vagas a partir de quantidades e usa tempo de aquecimento por prensa. A interface contém padrões de três fornos/sete posições quando faltam configurações. Esses padrões não podem ser herdados como capacidade física comprovada.

O tipo sólida/tubular existe em ciclos térmicos e há parâmetros distintos por tipo no cadastro de forno. Isso não garante classificação prévia de todas as ferramentas da fila. Não inferir tipo a partir de número de furos.

### Otimização

O otimizador de decisões testa estratégias e trocas adjacentes dentro da mesma prensa; não transfere ordens. Prioriza impedimentos, dados faltantes e custo. Ordens iniciadas/pausadas são protegidas nos ajustes relevantes.

A busca tem orçamento de tempo e quantidade de candidatos. O orçamento de relógio pode alterar quais candidatos são explorados em máquinas diferentes. Um motor previsível deve usar ordem estável de candidatos e limite de iterações; se cancelado, declarar resultado parcial.

O simulador percorre grupos de prensas e reserva recursos compartilhados nessa ordem. Reconstituir material cronologicamente no final não torna toda a alocação conjunta e global. A próxima versão deve avaliar ambas as prensas no mesmo calendário de eventos.

Os critérios atuais incluem atraso, setup, espera térmica, recursos, corridas curtas, muitos furos, sobra e término. Equilíbrio sólida/tubular, almoço e transferências explícitas não estão representados adequadamente por esses critérios. “Muitos furos” não substitui “tubular”.

## 5. O que funcionou conceitualmente

- Funções pequenas de produtividade e seleção física, com regressões específicas.
- Separação entre restrições e preferências; peso zero não remove obrigação física.
- Recálculo de cada alternativa, conservação de ordens/material e proteção de produção iniciada.
- Cenário isolado da produção; motivo de alteração e histórico.
- Diferenciar produção, preparação, espera e tempo fora de turno.
- Visão resumida, ajuda contextual e investigação por ordem.

Esses pontos são candidatos a reaproveitamento sob novos contratos e testes. Não autorizam importar automaticamente o componente principal ou o simulador inteiro.

## 6. O que não atingiu o objetivo

- Acúmulo de modos, notas, oito áreas de decisão e painéis aumenta esforço de leitura.
- Barras que abrangem noites/intervalos parecem longas operações; cartões todos vermelhos escondem poucas causas comuns que afetam muitas ordens.
- Dependências desenhadas não explicam, por si, o motivo de uma posição nem permitem avaliar uma mudança.
- “Disponível” agregado não resolve localização, transferência, preparação, reserva futura e retorno.
- Carregamento redefine a referência de simulação para agora; precisa ser separado de atualização da programação oficial.
- Reservas por código de matriz e vagas sintéticas limitam fidelidade física.
- Dados desconhecidos, estimativas e impedimentos aparecem juntos em parte dos fluxos.
- O endpoint reavalia a nota do resultado recebido, mas isso não equivale a reconstruir o cenário a partir das fontes atuais no servidor. A documentação anterior já reconhece essa limitação.
- Cenários “melhores” por score não são garantia de melhor operação nem de melhoria estatisticamente comprovada.

## 7. Memória da experiência com IA — fora da próxima fase

Conforme `WORKSPACE_VALIDATION.md`, havia cinco papéis com skills, ferramentas de consulta/simulação e propostas sem execução física automática. O último ensaio documentado concluiu quatro de cinco pareceres; o montador excedeu o limite. Outras rodadas falharam em papéis diferentes. Teste sintético de conexão passou, mas não homologou a equipe. Modelos gratuitos do OpenRouter foram bloqueados pela política de privacidade da conta nos ensaios documentados; não se deve enfraquecer essa política como correção automática.

Leituras eram pontuais, não acompanhamento contínuo. A janela exclusiva dependia da aba principal. OpenClaw não estava integrado. O histórico pessoal não substituía registro operacional compartilhado. Preservar contratos de evidência, supervisão e estados de progresso como referência futura; não levar provedores, agentes ou canvas para a primeira versão nova.

## 8. Verificação nesta auditoria

Executado em 16/09/2026: `node --test tests/planning-regression.mjs`.

Resultado: 38 testes registrados; 35 aprovados, zero falhas, três integrações optativas de provedores não executadas. Cobertura inclui produtividade, seleção física, datas, conservação de material, ajustes, limites de agente e regras básicas.

Não comprova: preenchimento do banco real, duração industrial dos processos, alocação ótima global, concorrência da aprovação nova, confiabilidade de IA ou usabilidade da futura interface. Não houve alteração do código executável nesta etapa.

## 9. Política de transição

Consultar este documento e os testes como memória. Criar um módulo novo e isolado; manter cadastros e autenticação do AluPilot por adaptadores. Não apagar o legado nem migrar cenários antigos automaticamente. Marcar versões antigas como antigas e impedir comparação silenciosa entre motores diferentes.

Próxima referência: [proposta do novo módulo](CARGA_MAQUINA_V2_PROPOSTA.md).
