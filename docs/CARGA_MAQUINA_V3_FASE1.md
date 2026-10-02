# Carga Máquina V3 — fundação e baseline

22/09/2026.

## Entrega

- A rota experimental anterior deixou de ser exposta; `/carga-maquina/nova` redireciona para `/carga-maquina/v3`.
- A navegação principal aponta para a V3 em modo sombra.
- Criado o contrato `alupilot-v3.0` para carteira, zonas, travas, atribuições e métricas.
- Implementado baseline determinístico que reproduz a prensa e a posição cadastradas.
- Criadas as zonas inicializadas: congelada, rolante e livre.
- Ordens com início real ficam congeladas e não são movidas pelo baseline.
- Criado validador independente para duplicidade, prensa inelegível e violação de congelamento.
- Pendências cadastrais aparecem explicitamente; o motor não inventa elegibilidade de prensa.
- A tela deixa claro que o solver global e a IA ainda não participam do cálculo.

## Próxima etapa do plano

Validar a matriz real ferramenta × prensa, depois substituir o baseline por um solver global das prensas 1.8 e 1.9.
