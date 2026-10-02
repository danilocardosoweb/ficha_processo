# Novo Carga Máquina — proposta antes da implementação

Data: 16/09/2026. Estado: proposta técnica e de produto; não implementada.

## 1. Decisão de produto

Reconstruir em módulo isolado. Duas abas: **Programação** e **Cenários**. O primeiro gerador de cenários será determinístico. Não desenvolver IA, OpenClaw, editor de regras genérico ou sala de agentes nesta etapa.

O legado está documentado em [memória técnica](CARGA_MAQUINA_LEGADO_MEMORIA.md). Nenhuma funcionalidade existente foi removida durante a análise. A proposta é apresentada antes de alterar a aplicação, conforme solicitado.

## 2. Experiência proposta

### Programação

Mostrar a sequência oficial armazenada, por prensa, sem reordenar ao abrir ou atualizar. Cabeçalho com filtro de prensa, horário da última leitura e atualização. Resumo compacto: kg restantes, ordens pendentes, pendências agrupadas por causa e término previsto quando calculável.

Tabela: posição; ferramenta/seq. física/tipo; liga; kg restantes; disponibilidade; entrada e saída previstas. Prensa identificada no agrupamento. Horários reais, quando presentes, têm rótulos distintos dos previstos. Não exibir horário exato se faltam dados essenciais para calculá-lo; usar “A calcular” ou “Estimativa parcial” conforme o caso.

Ao selecionar uma linha, abrir detalhe lateral com carcaça, BO, forno/posição, fonte da produtividade, pendências, previsão de uso e origem dos dados. Ajuda contextual curta junto a termos difíceis. Evitar tabela inicial com todos os atributos de engenharia.

Disponibilidade possui três estados: **confirmada para o intervalo**, **conflito confirmado**, **a confirmar**. Não é uma autorização de operação. Alertas agrupados: “Carcaça X sem disponibilidade confirmada afeta 17 ordens”; expandir para ver quais e a causa. Não pintar todas as ordens de vermelho por uma única lacuna cadastral.

### Cenários

Uma ação inicial: “Gerar cenário por regras”. Preservar cópia identificada da programação e informar versão, instante de referência e regras usadas. Mostrar progresso real por fases/candidatos avaliados; nunca porcentagem fictícia de tempo.

Comparação lado a lado, mesma base: atrasos em minutos/ordens, espera por recursos e aquecimento, trocas de liga, intervenções no almoço e término. Exibir ganhos e perdas, ordens alteradas e dados pendentes. Não apresentar nota única como autorização.

“Por que mudou?” abre explicação da alteração: posição anterior/nova, regra decisiva, recurso/intervalo, benefício calculado e efeito adverso. “Recursos no tempo” será detalhe expansível, não nova aba principal. O mapa de decisão será uma sequência de causas e mudanças, não editor de nós decorativo.

Na fase inicial, Cenários informa que o motor está em construção; não disponibiliza botão que simule uma otimização inexistente. Aprovar/aplicar só será exposto quando houver validação autoritativa e persistência segura. Fechar cenário não altera a produção.

## 3. Arquitetura nova

Diretório proposto: `src/modules/machine-load-v2/`. UI em `src/components/machine-load-v2/`; API própria versionada quando necessária. Não importar `MachineLoadSimulator` para dentro da nova implementação.

| Camada | Responsabilidade | Não pode fazer |
|---|---|---|
| `data` | Adaptar fontes existentes, validar identidade/origem/atualidade e criar snapshot | Inventar disponibilidade ou escolher cadastro divergente silenciosamente |
| `domain` | Ordens, recursos, intervalos, capacidades, regras e resultados tipados | Depender de React, Supabase ou provedor de IA |
| `rules` | Catálogo versionado de restrições e preferências, com parâmetros | Alterar dados ou esconder regra obrigatória em peso |
| `evaluation` | Agendar eventos e verificar ambas as prensas sobre os mesmos recursos | Consultar banco durante cálculo puro |
| `scenarios` | Gerar candidatos limitados, estáveis e reavaliados | Modificar programação oficial |
| `comparison` | Deltas de indicadores e mudanças na mesma base | Comparar snapshots diferentes como se fossem equivalentes |
| `explanations` | Registrar motivo, evidência, regra e impacto durante a decisão | Gerar justificativa sem cálculo correspondente |
| UI | Ler resultado, selecionar, comparar e solicitar ações | Implementar regra industrial nos componentes |

Fluxo: fontes autorizadas → snapshot imutável → avaliação da sequência atual → candidatos → avaliação comum → comparação/explicações → decisão humana. Aprovação futura reconstrói/revalida no servidor usando dados atuais e versão-base.

Integração: preservar autenticação e escopo organizacional do AluPilot, permissões e cadastros existentes. Nenhuma chave privilegiada no navegador. A análise do Supabase orientou a distinção entre schema existente e dados efetivamente verificados; não há necessidade de duplicar todos os cadastros.

Reuso seletivo: normalizador de produtividade, conceitos de datas e seleção física, linguagem contextual e casos de teste. Antes de importar helpers, verificar unidades, fuso e identidade sob o novo contrato. Não reutilizar automaticamente motor, pesos, presets, capacidades padrão ou UI monolítica.

## 4. Modelo mínimo e lacunas

Todo snapshot deve incluir organização, instante de referência, versão da programação, revisão das regras, fuso da fábrica e status de cada fonte. Dado confirmado, estimado, desconhecido ou divergente são estados explícitos; desconhecido não vira zero.

| Informação | Evidência local disponível | Complemento necessário |
|---|---|---|
| Ordem e fila | Prensa, sequência, ferramenta, liga, volumes, prazo e status em ordens | Tratar versão/concorrência, datas reais e prioridade oficial |
| Ferramenta física | Cadastro e sequência em ferramentas/importação | Identidade estável em toda reserva; resolver ambiguidades |
| Sólida/tubular | Tipo nos ciclos de aquecimento | Fonte mestre anterior ao ciclo, preenchimento e eventual classificação por configuração física |
| Carcaça | Modelo exigido, mapeamentos, quantidade/status, prensa/localização | Localização estruturada atual; unidades ou lotes rastreáveis; transferência e retorno |
| BO | Código requerido, estoque agregado, status/localização textual | Compatibilidade e quantidade por configuração; localização e reservas temporais consistentes |
| Fornos | Cadastro físico, posições, ciclos, parâmetros por tipo | Conectar motor às posições reais; incluir ciclos ocupantes fora da fila selecionada |
| Aquecimento | Início/estado/previsão e regras de cadastro | Receitas aprovadas, evidência de liberação, validade após retirada e reaquecimento |
| Preparação | Tempos gerais de setup/troca | Capacidade de montadores, espaço e duração por etapa; não presumir preparação infinita |
| Transferência | Prensa/localização parcial no cadastro | Quem pode movimentar, recursos permitidos, duração, segurança e momento de liberação |
| Calendário | Turnos e indisponibilidades | Fuso explícito, feriados, exceções e distinção entre parada e redução de equipe |
| Material | Estoque por liga, peso/rendimento, liga alternativa | Compatibilidade de alternativas aprovada e características de corte/sobra reutilizável |
| Produtividade | Importação, ficha, ferramenta e histórico | Proveniência, validade e distinção entre líquido, bruto e tempo com paradas |

Modelo de reserva: recurso identificado (unidade ou grupo homogêneo), localização, quantidade, início/fim, etapa, ordem e origem. Grupos agregados só são aceitáveis se unidades forem intercambiáveis no local e período. Transferências exigem identidade rastreável ou lote transferido; não somar estoque das duas prensas como acesso instantâneo.

O tipo de ferramenta não será deduzido por código/furos. Valores de 1.300 kg/h são estimativas marcadas quando não há produtividade válida; entradas acima de 2.500 são rejeitadas, não arredondadas para o teto. Nenhum valor de temperatura exemplificado em conversa vira regra de liberação.

## 5. Catálogo inicial de regras

Separar **categoria**, **severidade** e **política de exceção**. Exceção não é uma quarta classe equivalente às demais: é uma permissão explícita vinculada a uma regra elegível, com motivo, responsável e impacto. Incompatibilidade física ou liberação de segurança não podem ser contornadas por preferência.

| ID | Regra | Categoria e tratamento |
|---|---|---|
| R01 | Carcaça compatível, em quantidade e intervalo disponíveis | Obrigatória. Se faltar dado, resultado não verificável; se faltar recurso, aguardar ou declarar inviável |
| R02 | BO compatível e disponível no intervalo necessário | Obrigatória, mesma distinção entre conflito e desconhecido |
| R03 | Ferramenta física, prensa compatível, posição de forno e não sobreposição | Obrigatória. Ordens iniciadas preservadas; incluir outras reservas reais |
| R04 | Aquecimento e liberação conforme processo aprovado | Obrigatória. Previsão térmica não substitui medição/validação operacional |
| R05 | Capacidade de montagem, espaço e preparação antecipada | Restrição operacional; capacidades físicas e calendário de pessoas são limites rígidos quando conhecidos |
| R06 | Sequências de aproximadamente 300 kg ou menos | Risco operacional: medir se a próxima ferramenta estará pronta; não proibir lotes pequenos automaticamente |
| R07 | Equilíbrio de carcaças entre prensas | Preferência. Transferência é exceção permitida, com duração/localização e ganho demonstrado |
| R08 | Agrupar ligas | Otimização de setup/fragmentação; não superar compatibilidade, material, prazo prioritário ou prontidão |
| R09 | Evitar concentração de sólidas ou tubulares | Preferência operacional parametrizada; respeitar capacidade de acessórios de forma obrigatória, sem exigir alternância artificial |
| R10 | Menos intervenções entre 11:20 e 14:20 | Preferência de menor prioridade. Avaliar trocas realmente dentro da janela, não apenas kg do lote |
| R11 | Calendário, material e prazo | Calendário e material disponíveis são restrições; atraso é objetivo, salvo compromisso explicitamente congelado pelo PCP |

Ausência de dado crítico bloqueia a classificação “viável”, mas permite visualizar uma proposta exploratória claramente incompleta. Uma ordem inviável deve continuar visível como não alocada; nunca desaparecer para melhorar indicadores.

### Ordem de decisão proposta

1. Validar dados críticos e preservar ordens iniciadas/congeladas.
2. Encontrar alocação fisicamente viável; uma boa nota jamais compra uma violação.
3. Minimizar atraso conforme prioridades aprovadas e espera operacional evitável.
4. Reduzir preparação/trocas e desperdício modelado, comparando término das prensas.
5. Melhorar equilíbrio de tipos/carcaças e almoço, somente dentro das tolerâncias do PCP.

Essa ordem é proposta inicial, não política certificada. Troca entre atraso e utilização requer confirmação do PCP. “Não prejudicar significativamente” no almoço precisa de tolerâncias configuradas em minutos/atraso; até defini-las, permitir apenas melhoria de almoço sem piora dos objetivos superiores.

## 6. Primeiro algoritmo: pequeno e explicável

Fixar snapshot, instante inicial, regras e desempates por sequência oficial/ID. Alocar os próximos eventos de ambas as prensas no mesmo calendário compartilhado; incluir montagem, aquecimento, retenção no forno, retirada, transferência quando permitida, setup, produção e liberação/retorno conforme parâmetros conhecidos.

Começar avaliando a fila oficial. Gerar candidatos por seleção gulosa de ordens elegíveis e melhoria local limitada por número fixo de avaliações. Primeiro escopo: reordenação dentro da mesma prensa. Movimentação de carcaça é diferente de transferência de ordem entre prensas; esta última fica fora até existir matriz de compatibilidade e aprovação específica.

Não otimizar somente carcaças e ajustar forno depois: toda alteração passa pela mesma avaliação integrada. Quando recursos não permitem avanço, registrar causa e próximo evento conhecido. Se não existe liberação conhecida, devolver não alocação; não inventar data finita.

Resultado inclui melhor candidato encontrado, quantidade examinada, eventual interrupção e ausência de garantia de ótimo global. Mesmos dados e orçamento completo devem produzir mesmo resultado; limite de tempo serve como interrupção sinalizada, não como configuração silenciosa da qualidade.

Explicação estruturada por mudança: IDs da ordem/regra/recurso, posição anterior/nova, dados usados, intervalo, restrições satisfeitas, alternativas rejeitadas entre as efetivamente testadas, deltas e exceções. Exemplo ilustrativo: “Antecipada para aproveitar carcaça livre; espera térmica diminuiu, mas uma troca de liga foi adicionada.” Os valores numéricos devem vir do cálculo.

## 7. Persistência e aplicação futura

Cenário guarda snapshot/versionamento, candidato, avaliação, explicações, exceções e autor. Comparações exigem mesma base ou recálculo explícito dos dois lados. Se execução/estoque/reservas mudarem, mostrar “desatualizado”.

Aplicação futura: permissão de PCP → reconstrução e revalidação no servidor → checagem de versão/reservas → transação atômica e idempotente → histórico de diferenças/motivo. Recusar versão obsoleta ou fonte crítica indisponível. Não aceitar o booleano `feasible` nem horários enviados pelo navegador como autoridade. Não reutilizar o endpoint legado sem revisão dessas garantias.

IA futura implementará apenas um contrato de geração de candidato. Não terá caminho alternativo para regras, aprovação ou escrita. Mesmos snapshots, avaliador e explicações verificáveis para qualquer gerador.

## 8. Roadmap e critérios de aceite

| Fase | Entrega | Aceite mínimo |
|---|---|---|
| 1 | Nova estrutura e Programação simples, somente leitura | Duas abas; fila preservada; origens/pendências claras; nenhuma chamada de IA; nenhuma escrita operacional |
| 2 | Modelo de recursos/dados e adaptadores | Identidade física, tipo, fontes, localização e lacunas explícitas; plano de migração aditivo somente onde necessário |
| 3 | Avaliador e regras | Testes por regra; ambas as prensas no mesmo calendário; impossível/desconhecido não vira viável |
| 4 | Primeiro cenário por regras | Reprodutível, preserva ordens e estados iniciados; resultado separado; trilha de decisão |
| 5 | Comparação atual × candidato | Mesma base, deltas corretos, ganhos/perdas visíveis; aprovação só com garantias de servidor testadas |
| 6 | Explicação/mapa | Toda mudança explicável com evidência calculada; sem justificativa fabricada |
| 7 | Recursos no tempo | Identidades e intervalos reais; distinguir operação, espera, turno e conflito; seleção ligada à ordem |
| Futura | IA/agentes | Gerador adicional subordinado ao mesmo avaliador, sem nova autoridade de execução |

A coleta da explicação começa na fase 3, ainda que a visualização completa venha na 6. A modelagem temporal começa na fase 2/3, ainda que a linha do tempo venha na 7. Não postergar a física só porque o gráfico vem depois.

Fase 1: publicar inicialmente em rota de homologação isolada; manter a rota legada até verificar leitura, permissões e sequência com o PCP. A fila já pode ser mostrada com dados incompletos; previsão integrada só aparecerá depois do avaliador, sem chamar o simulador antigo silenciosamente. Migração da rota principal será uma etapa explícita, não um efeito colateral.

## 9. Casos essenciais de validação

- Uma carcaça atende duas prensas: intervalos não se sobrepõem e transferência não é instantânea.
- Duas sequências físicas da mesma matriz não se confundem; recurso ausente não é recurso desconhecido.
- BO indisponível impede operação; BO sem informação impede confirmação de viabilidade.
- Forno cheio, ferramenta pronta ainda dentro, ciclo fora da fila e retirada atrasada ocupam capacidade corretamente.
- Vários lotes de 300 kg não deixam a prensa sem ferramenta pronta sem que o risco/espera apareça.
- Sólida/tubular desconhecida não vira uma classificação inventada; equilíbrio não viola acessórios.
- Lote grande no almoço não pode aumentar atraso prioritário só para satisfazer preferência.
- Agrupamento de liga não troca especificação do pedido sem compatibilidade explícita.
- Pausas/noturnos não inflam minutos produtivos; sobras e consumo conservam massa.
- Candidato conserva todas as ordens; produção iniciada não é movida; permutações com empate são estáveis.
- Dados atuais diferentes invalidam aprovação antiga; outra organização não acessa cenário; clique repetido não duplica aplicação.

## 10. Confirmações industriais para as fases seguintes

1. Qual cadastro será autoridade para tipo e configuração física da ferramenta?
2. Carcaças/BOs são controlados individualmente ou por lotes homogêneos? Quais podem circular entre prensas e em quanto tempo?
3. Recursos acompanham a ferramenta desde a montagem/forno ou só na prensa? Quando retornam realmente ao estoque?
4. Quantos montadores/espaços existem por turno, e quais tempos/receitas já são aprovados?
5. Quais prioridades de prazo são congeladas, e qual piora é tolerável em troca de setup/utilização?

Não são bloqueios para construir a tabela de leitura. São bloqueios para afirmar otimização fisicamente validada. O próximo incremento é exclusivamente a fase 1; não retomar os agentes como atalho para essas lacunas.
