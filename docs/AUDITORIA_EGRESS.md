# AUDITORIA DE EGRESS

Data da auditoria: 2026-09-24

## Diagnóstico antes das alterações

| Arquivo / componente | Problema encontrado | Estimativa de requisições | Impacto provável | Solução |
| --- | --- | ---: | --- | --- |
| `src/components/tool-oven-board.tsx` / `load` | Três consultas Supabase grandes são repetidas a cada 15 segundos. A consulta de ciclos inclui ordens de produção aninhadas e a consulta de ordens pode retornar até 1.000 registros. | Até 1.920 ciclos em 8 h por aba (5.760 consultas), por usuário | **Crítico**: provável fonte de egress elevado quando a sala fica aberta; o payload pode conter milhares de linhas repetidas | Atualizar somente quando a aba está visível, bloquear chamadas concorrentes, reduzir a frequência para 60 s e atualizar ao retornar para a aba |
| `src/components/operational-messages-provider.tsx` / `refresh` | Polling global a cada 30 s, mesmo com a aba em segundo plano; chamadas podem se sobrepor se o servidor estiver lento. | Até 960 chamadas em 8 h por sessão | Médio: payload normalmente pequeno, mas é repetido em todas as telas autenticadas | Deduplicar chamada em andamento, pausar em aba oculta e sincronizar ao voltar |
| `src/components/app-shell.tsx` / heartbeat | Heartbeat a cada 45 s. É uma escrita pequena, não um download de Storage. | Até 640 chamadas em 8 h | Baixo para Cached Egress; preservado por ser parte da validade da sessão | Nenhuma alteração nesta fase |
| `src/components/machine-load-simulator.tsx` / `load` | Ao abrir a simulação, executa várias consultas e seis endpoints em paralelo; não há repetição automática neste componente. | Uma rodada por montagem | Médio em telas abertas repetidamente; não há evidência de loop | Preservado para não alterar a simulação; revisar com paginação/DTOs em etapa posterior |
| Projeto inteiro / Supabase Storage | Nenhuma chamada a `download`, `list`, `getPublicUrl`, `createSignedUrl`, `upload` ou buckets foi encontrada em `src` ou nas migrações. | 0 | Não há evidência de egress de arquivos neste código | Criada camada preventiva para futuros anexos, sem alterar o fluxo atual |

## Correções realizadas

1. O quadro de fornos agora possui deduplicação de chamadas, polling condicionado à visibilidade, intervalo de 60 s e atualização imediata ao retornar à aba.
2. A central de avisos agora evita chamadas concorrentes, pausa o polling em segundo plano e atualiza ao retornar à aba.
3. Foi criada uma camada central de Storage com cache de URLs assinadas/públicas, deduplicação de requisições, limite de concorrência e telemetria local de acessos repetidos.
4. O relacionamento de ordens dentro dos ciclos do forno passou a usar um DTO compacto (`id`, `plan_code`, `status`, `is_active`), mantendo o DTO completo somente na consulta principal.

## Origem provável dos 27 GB

O repositório não contém acesso a arquivos do Storage. O maior padrão real de tráfego encontrado é o polling do quadro de fornos, que repetia payloads de produção e ciclos completos a cada 15 segundos. A origem histórica exata precisa ser confirmada nos logs/Usage do projeto Supabase por rota e serviço; o projeto atualmente está bloqueado por `exceed_cached_egress_quota`, impedindo uma consulta operacional completa.

## Riscos restantes

- Consultas grandes da simulação e do quadro ainda podem retornar mais linhas que o necessário em cargas muito grandes.
- O histórico de consumo anterior não está disponível no código; é necessário conferir o relatório de Usage do Supabase após a reativação.
- A camada de Storage ainda não é usada por nenhuma tela, pois não existem anexos implementados neste projeto.
- O payload repetido dos ciclos foi reduzido ao remover campos completos de cliente, massa, datas e `source_data` das ordens aninhadas.

## Próximas melhorias recomendadas

1. Paginar `production_orders`, ciclos e ferramentas no backend, retornando somente o DTO usado pela tela.
2. Criar uma consulta/RPC resumida para o quadro de fornos, sem ordens aninhadas completas.
3. Adicionar métricas no servidor por rota e tamanho de resposta (`Content-Length`) e comparar com Usage do Supabase.
4. Se anexos forem adicionados, usar thumbnails e a camada `storage-service.ts`, nunca `download` direto no componente.
