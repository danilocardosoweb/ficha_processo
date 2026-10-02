# Nova Carga Máquina — fase 3 implementada

16/09/2026.

## Entrega

- evaluator.ts implementa avaliação temporal pura, sem Supabase, React ou escrita.
- Verifica carcaça, BO, ferramenta, reservas sobrepostas e capacidade de forno quando informada.
- Avalia as duas prensas sobre um mesmo conjunto de recursos.
- Classifica cada ordem como disponível, conflito ou desconhecida.
- Classifica o conjunto como viável, bloqueado ou incompleto.
- Reserva desconhecida não é tratada como livre.
- A leitura autenticada da nova Programação consulta os RPCs existentes de carcaças e BOs e exibe o resultado da validação.

## Limites

O cadastro de fornos ainda não está convertido em capacidade temporal por prensa/posição no novo snapshot. Por isso a tela declara essa parte como incompleta. Não foi criado valor padrão de forno nem temperatura fictícia.

O avaliador ainda não gera horários oficiais, não aprova cenários e não escreve reservas. O resultado é diagnóstico para a próxima etapa de cenários.

## Verificação

- 43 testes aprovados, zero falhas e três integrações opcionais ignoradas.
- Build de produção aprovado.
- Testes cobrem desconhecido, reserva sobreposta, capacidade compartilhada e uso por duas prensas.
