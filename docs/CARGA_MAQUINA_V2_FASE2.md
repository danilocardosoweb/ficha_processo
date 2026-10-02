# Nova Carga Máquina — fase 2 implementada

16/09/2026.

## Entrega

- O domínio da nova versão agora representa tipo de ferramenta (solid, tubular ou unknown) e mantém a incerteza explícita.
- A consulta de ferramentas busca a classificação física quando cadastrada.
- A aba Cenários ganhou uma prévia determinística de agrupamento de ligas.
- A prévia é uma cópia separada: mostra posição anterior, nova posição e motivo calculado.
- Ordens com início real não são movidas.
- A proposta mantém todas as ordens e não altera a fila oficial, banco, reservas ou produção.
- Ausência de carcaça, BO, tipo ou forno torna a prévia não validada fisicamente e remove qualquer ação de aplicar.

## Limites intencionais

Ainda não é um otimizador global. Não calcula conflitos temporais de carcaça/BO, ocupação de forno, transferência entre prensas, pausa de almoço ou saída prevista. O agrupamento existe para validar a experiência e a trilha de explicação; a próxima fase deve submeter candidatos ao avaliador físico comum.

## Verificação

- 40 testes aprovados, zero falhas e três integrações opcionais de IA ignoradas.
- Build de produção aprovado e rota /carga-maquina/nova incluída.
