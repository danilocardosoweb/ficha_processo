# Nova Carga Máquina — fase 1 implementada

16/09/2026.

## Acesso

- Homologação: /carga-maquina/nova.
- A rota anterior foi preservada e ganhou um link para a nova versão.
- Requer permissão simulation. Consulta servidor filtrada pela organização da sessão e pelas prensas autorizadas, quando restritas.

## Entrega

Programação somente leitura, agrupada por prensa e ordenada pela posição oficial, com busca, filtro, atualização, resumo de volumes conhecidos e detalhes expansíveis por ordem. Divergências de carcaça/BO e ausência de dados são explícitas. O cadastro de ferramentas é complemento opcional; falha nessa consulta não oculta as ordens.

Separação entre domínio/normalização, leitura no servidor e interface. Reutilizados somente helpers pequenos de produtividade e seleção física. Nenhuma dependência do simulador antigo, agentes ou gerador de cenários.

A aba Cenários contém explicação do próximo incremento, sem botão fictício de otimização. A disponibilidade temporal, tipo e previsão integrada ainda não foram implementados: são mostrados como a confirmar/a calcular. A duração líquida estimada nos detalhes não inclui setup, aquecimento ou pausas e não é previsão de saída.

Não houve escrita operacional, migração ou alteração de reservas. Leitura paginada não é um snapshot transacional; não deve fundamentar aprovação futura sem versionamento/revalidação.

## Validação

- TypeScript e ESLint dos arquivos alterados: aprovados.
- Build de produção: aprovado, incluindo rota nova.
- Suíte: 39 aprovados, zero falhas e três integrações opcionais de IA ignoradas.
- Quatro testes novos: preservação da sequência/entradas; volume desconhecido e produtividade inválida; correspondência física/divergências; volume restante e duração.
- Servidor iniciado em 127.0.0.1:3000.
- Navegador confirmou redirecionamento da nova rota ao login. A sessão estava encerrada; consulta autenticada e inspeção visual da tabela real permanecem para homologação após login. Não foi alegado teste autenticado concluído.

Próxima fase: completar modelo de tipo, identidade/localização dos recursos e contratos do avaliador, sem antecipar IA.
