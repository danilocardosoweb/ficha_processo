# Equipe de agentes — rodada manual para testes

Abra Carga Máquina → Central de Decisões → Sala de controle → Iniciar rodada dos cinco agentes.

## Skills próprias e ferramentas

Cada papel tem um SKILL.md versionado em src/modules/planning/agents/skills. O servidor carrega apenas a skill do agente solicitado e a entrega como instrução ao modelo configurado. Os papéis são PCP, montador, operador, qualidade e líder (consolidação final). O próximo recebe os pareceres concluídos, identificados como hipóteses, não como fatos físicos.

Não são respostas fixas: o modelo escolhe consultas, recebe resultados, pode solicitar um teste de troca e precisa concluir com saída estruturada validada. O laço tem até cinco chamadas por agente e dez consultas/testes. Não usa framework de execução durável nesta primeira rodada limitada.

- consultar: programação, recursos, previsões de forno, materiais, pareceres anteriores; seções limitadas por papel.
- simular_troca: cálculo no motor existente, sem gravação; indisponível para qualidade.
- concluir: propostas com evidências e passos; troca só é aceita no parecer se foi calculada com os mesmos argumentos.

## Dados e limites

A fonte é uma cópia validada da simulação fornecida pela tela (até 200 ordens), não a operação atual consultada diretamente. Datas são restauradas e campos desconhecidos são removidos. Não são enviados nomes de clientes, sessões ou chaves. Campos textuais e pareceres são dados não confiáveis; não alteram permissões.

A seção fornos mantém previsões da carga. A seção operacao acrescenta leituras pontuais do servidor: ordens, fornos e ciclos registrados com posição, horários e vínculos, limitados à organização e prensas autorizadas. Não são sensores nem confirmação física de prontidão. Qualidade não recebe ensaios. Horário, cobertura e erros da consulta são apresentados no parecer; consulta incompleta não significa forno vazio. Skills 1.1.0 exigem consultar operacao. Divergência de status ou quantidade impede testar troca até atualizar a carga.

Ainda não há acompanhamento por eventos, execução com navegador fechado, coordenação distribuída ou memória operacional compartilhada. Cada rodada é manual. Trocar dados ou sair da sala cancela a solicitação; pareceres concluídos e avaliações humanas já ficam no histórico pessoal do servidor local. O limite de concorrência/uso do servidor é por processo e deve ser substituído por controle durável antes de escalar para múltiplas instâncias.

## Aprovação humana

Aceitar ou recusar exige motivo e registra a avaliação pessoal no servidor local. Não atribui tarefa nem registra operação. Propostas de troca são recalculadas e comparadas antes da confirmação de aplicação na simulação. A permissão canAdjust existente continua obrigatória. Salvar/aprovar o cenário usa o fluxo existente; nenhum agente possui ferramenta para iniciar produção, liberar forno, reservar recursos ou aprovar qualidade. Consulte OPERATIONAL_WORKSPACE_PILOT.md para armazenamento e limites.

## Integração e segurança

POST /api/planning-agents verifica sessão, acesso à Carga Máquina, origem, limite de tamanho e configuração aiEnabled. Utiliza a chave somente no servidor. Modo automático usa openrouter/auto com suporte obrigatório aos parâmetros tools; modo manual respeita a escolha dos critérios. Há limite de tempo, cancelamento e limitação local a quinze análises de agente por dez minutos por usuário. Falhas aparecem como falhas; não há substituição silenciosa por regras. O guia fixo permanece separado da resposta de IA.

## Testes

node --test tests/planning-regression.mjs valida os contratos, consultas, proteção contra ordens inventadas, preservação da carga e o laço de ferramentas com provedor simulado.

O teste opcional “provedor real com carga fictícia” usa OPENROUTER_API_KEY com ALUPILOT_AGENT_SMOKE=1. Ele nunca usa dados reais de produção nem registra operações. Não equivale a teste autenticado da interface inteira.

Referência do protocolo: https://openrouter.ai/docs/guides/features/tool-calling
