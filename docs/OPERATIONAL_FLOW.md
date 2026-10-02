# Fluxo operacional e ajustes de sequência

O mapa apresenta a ferramenta escolhida, com quatro etapas: aquecimento, carcaça, BO e produção. Cada nó abre uma orientação com os dados daquela ordem. As setas representam o caminho de conferência, não comandos enviados às máquinas.

O ramo de aquecimento diferencia a liberação cadastrada da previsão por tempo. O simulador não recebe temperatura medida nem limite térmico homologado. Por isso, 450 °C não foi cadastrado como regra e nenhum botão declara liberação física.

Abrir sequenciamento mostra cartões em ordem por prensa, com entrada, saída e produtividade. O operador escolhe uma posição, informa o motivo e calcula a prévia. O motor recalcula as ordens; a aplicação muda apenas a simulação manual. Ordens iniciadas ou pausadas não podem ser movidas nem ultrapassadas por essa ação.

Motivos e posições anteriores/novas ficam na sessão e no inputSnapshot do cenário quando o usuário o salva. O registro é exibido ao abrir o cenário salvo. Não é um apontamento real nem uma trilha independente de ocorrências de produção.

Limites: edição livre de conexões, sensores de temperatura, retorno físico ao forno e mudanças reais de disponibilidade não foram ativados por esse mapa. Exigem parâmetros e integração com os cadastros/apontamentos existentes. As ações do fluxo não ignoram essas verificações.
