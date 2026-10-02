# Nova Carga Máquina — fase 4 implementada

16/09/2026.

## Entrega

- Paradas cadastradas por prensa agora deslocam o início previsto.
- O tempo deslocado fica separado como espera de calendário.
- A janela de almoço, 11:20–14:20, é contabilizada como preferência operacional.
- Almoço não bloqueia nem altera automaticamente a sequência.
- A nova leitura consulta o RPC protegido de indisponibilidades para os próximos 90 dias.
- O resultado da validação mostra conflitos, pendências, minutos deslocados e intervenções no almoço.

## Limites

O horário é uma previsão do avaliador e não uma autorização de produção. O fuso usado deve ser confirmado na configuração da fábrica; o módulo não transforma almoço em parada rígida. Movimentação entre prensas ainda não é permitida porque falta cadastro de origem, destino, duração e responsável.

## Verificação

- 46 testes aprovados, zero falhas e três integrações opcionais ignoradas.
- Build de produção aprovado.
- Testes cobrem parada deslocando horário e almoço como preferência.
