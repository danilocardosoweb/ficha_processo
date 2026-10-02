# Workspace operacional — primeira evolução supervisionada

## Entrega

- Programação em eixo comum no topo da sala; seleção integrada ao passaporte da ordem.
- Agentes compactos, com estado de análise separado dos indicadores operacionais.
- Configuração do provedor recolhida; rodada para após duas falhas consecutivas.
- Pareceres concluídos salvos no servidor, por usuário autenticado.
- Decisões exigem motivo de 10–500 caracteres. Registro exclusivo impede decisões duplicadas para a mesma proposta.
- Histórico consultável após sair da tela; não reaplica propostas antigas.
- Trocas requerem comparação e permissão existentes; afetam somente a simulação. O registro significa solicitação de aplicação, não produção nem cenário salvo.

## Armazenamento do piloto local

Arquivos em `data/agent-workspace`, fora do Git, por diretório derivado do usuário. `AGENT_WORKSPACE_DIR` permite apontar um volume durável exclusivo desta instalação. Fazer backup e proteger o diretório com permissões do sistema operacional. O armazenamento não é adequado a hospedagem efêmera/serverless nem instâncias com discos independentes. A consulta retorna os 50 pareceres mais recentes; não há exclusão automática dos arquivos antigos.

Somente o servidor grava pareceres retornados pelo agente. A rota de avaliação resolve o parecer no diretório do usuário autenticado e não aceita conteúdos substitutos. Cada proposta pode receber uma única avaliação; a revisão deve ser feita em uma nova rodada. Os registros são pessoais, não uma auditoria compartilhada entre turnos. Não armazenam sessão, credenciais nem a carga completa.

## Limites deliberados

Usa uma cópia da simulação, comparada com consultas pontuais de produção, cadastro de fornos e ciclos registrados, por organização e prensas autorizadas. Não integra OpenClaw, tarefas em segundo plano, memória compartilhada, assinatura de eventos, reservas ou liberação de qualidade. Não envia comandos para equipamentos. Nenhuma animação representa atividade inexistente.

## Consultas operacionais — skills 1.1.0

Cada agente recebe uma leitura do servidor em consultar/operacao. O navegador não pode fornecer esse objeto. A consulta inclui ordens ativas da carga, fornos ativos e ciclos heating/released com vínculos de ordens, sem nomes ou notas. Há prazo de 8 segundos e limites explícitos (200 ordens, 100 fornos, 500 ciclos); resultado excedente é descartado com aviso, nunca tratado como estoque vazio. Erros parciais são informados ao agente e no parecer. O horário indica leitura, não frescor do apontamento físico.

O agente deve consultar operacao antes de concluir. A simulação permanece separada: mudança de status/quantidade ou ausência de confirmação impede simular_troca. Isso não é transação de produção nem reserva de recurso. A confirmação final continua humana. Temperatura medida e resultados de qualidade não estão disponíveis.

O esquema das três consultas foi verificado no serviço configurado sem retornar dados de produção. Testes cobrem filtros, consulta parcial, injeção de leitura falsa e bloqueio por divergência. O fluxo autenticado completo exige teste com sessão de usuário.

Próxima etapa: adaptar consultas autorizadas dos ciclos reais de forno e produção; implantar fila durável e propostas compartilhadas no banco com controle de concorrência e validade. Só então ligar os especialistas OpenClaw ao coordenador por ferramentas restritas. O backend do AluPilot continuará sendo a autoridade de aplicação.

## Verificação

Testes automatizados de isolamento de histórico, decisões duplicadas, validação de motivo, tipos de proposta e persistência. Testar manualmente autenticado: rodar equipe, aceitar/recusar com motivo, sair/reentrar e carregar histórico; selecionar ordem no eixo e conferir passaporte; falhar provedor e verificar interrupção da rodada. Testes de provedor real são opcionais, não equivalem ao teste completo autenticado.
