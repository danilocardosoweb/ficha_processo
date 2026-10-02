# Linguagem e ajuda da Carga Máquina

Aplicação do Humanizer 2.11.2 fornecido pelo usuário, licença MIT.

O guia orienta a redação das instruções da IA e da ajuda local. Não é executado como programa e não altera cálculos. O arquivo original em Downloads foi preservado.

## Padrão adotado

Explique o problema, o efeito na produção, a ação e como conferir o resultado. Preserve dados, unidades e alertas. Não prometa disponibilidade ou prazo que o cálculo não confirmou. Exemplos devem estar identificados como exemplos.

Os textos fixos ficam em src/modules/planning/load-help.ts. A orientação aplicada à IA fica em src/modules/planning/operator-language.ts. Mudanças futuras no motor precisam revisar os exemplos e os limites descritos na ajuda.

## Interação

- O ícone junto ao campo mostra uma explicação curta no mouse ou foco de teclado.
- Clique, Enter ou toque abre detalhes com exemplo e passos.
- O diálogo permite fechar com Escape e voltar ao acionador sem descartar o formulário.
- Ajuda desta tela permite procurar assuntos com ou sem acento.
- A ajuda é local e não depende de resposta ou cobrança de IA.
- O texto longo aparece somente quando solicitado para não aumentar a rolagem da página.

## Cuidados

Pesos da Central de Decisões não precisam somar 100. Não confundir com os percentuais da nota histórica. A ajuda não deve reutilizar explicações de campos com regras diferentes.

Uma nota alta não libera impedimentos. Cadastrar a medida da carcaça não confirma quantidade livre. Produtividade padrão é estimativa. Testar, aplicar perfil, salvar perfil, salvar cenário e aprovar são ações diferentes.
