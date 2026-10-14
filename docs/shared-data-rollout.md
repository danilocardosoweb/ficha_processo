# Implantação da base compartilhada

## Topologia aprovada pelo pedido

- Pasta comum: `W:\App_Prensa`; não colocar `tecnomes.sqlite`, `-wal` ou `-shm` diretamente nela.
- 2 estações PCP: importar carteira/Simplificada, editar cenários e publicar programação.
- 2 estações Produção: registrar início, paradas, apontamentos e conclusão.
- 1 gerência de Produção: consultar tudo e aprovar/ajustar conforme permissão.
- 1 gerência de Manutenção: consultar e registrar indisponibilidade/manutenção quando autorizado.
- 2 estações Qualidade: consultar e registrar apontamentos de qualidade quando autorizado.
- SQLite de cada estação: cache local e autenticação local. A pasta `W:` é a fonte compartilhada para registros operacionais publicados.

## Estado em 13/10/2026

Foi criada `W:\App_Prensa\.tecnomes\shared-data\manifest.json` e publicado o primeiro lote na geração 1: 2 prensas, 8.450 ferramentas, 8.063 fichas de processo, 2 lotes de tarugos, 7 carcaças, 4.138 snapshots de carteira, 12 importações de Simplificada e 212 ordens de referência. Recursos de BO e requisitos ferramenta/carcaça estavam vazios na origem. Todas as 10 contagens e os hashes dos arquivos foram relidos e conferidos após a publicação. Nenhuma credencial, sessão ou usuário foi publicada. O protocolo experimental em `src/lib/local-db/shared-data-store.mjs` mantém snapshots e eventos imutáveis, valida SHA-256, serializa escritores e recusa gravações sobre geração desatualizada. `node scripts/verify-shared-drive.mjs` passou no compartilhamento real; removeu apenas a pasta de teste criada por ele. A fila da programação preexistente permanece separada.

**Não é uma versão pronta para produção.** No código em desenvolvimento, o cadastro de prensas já grava primeiro na base compartilhada, sincroniza um segundo SQLite e bloqueia escrita sem rede; consultas mostram cache local identificado como desatualizado quando o compartilhamento cai. Ferramentas, recursos, carteira, Simplificada, forno e produção ainda não estão conectados ao protocolo de gravação compartilhada. Os 104.366 registros históricos continuam no SQLite deste computador; somente as 10 tabelas operacionais acima foram copiadas para a pasta. Não enviar o instalador atual às oito estações como se houvesse sincronização completa.

No computador de origem, `W:` está mapeada para `\\192.168.0.202\dados$\parada tecno`; portanto a pasta física é `\\192.168.0.202\dados$\parada tecno\App_Prensa`. O compartilhamento `dados$` pode ter permissões diferentes em outras estações. Verificar acesso de leitura e gravação com cada perfil antes de instalar; não presumir que a letra `W:` exista em todos os computadores.

## Integrações obrigatórias antes da liberação

1. Selecionar as tabelas operacionais que podem ser publicadas por função e nunca compartilhar `local_users`, hashes de senha, sessões ou auditoria privada sem política específica.
2. Publicar um bootstrap conferido da carteira, Simplificada, fichas, ferramentas, prensas e recursos; todas as estações devem apontar para a mesma pasta física, mesmo que a letra da unidade varie.
3. Transformar toda gravação de PCP, produção, forno, manutenção e qualidade em evento confirmado na base compartilhada. Atualizar os caches locais pela geração; rejeitar conflitos e perda de rede explicitamente.
4. Impor permissões no aplicativo e no compartilhamento. A permissão de leitura direta em `W:` permite contornar filtros da interface; por isso dados sensíveis precisam de diretórios/ACL separados ou permanecer fora da pasta.
5. Criar backup verificável, restauração, compactação de eventos, diagnóstico de atraso e recuperação após queda de energia.
6. Testar no mínimo duas estações reais em operações simultâneas e, depois, as oito estações e seus perfis; validar que uma escrita é visível nas outras e que uma falha de rede nunca é anunciada como salvamento compartilhado.

## Critério de aceite

Somente marcar a edição como pronta quando carteira, Simplificada, forno, produção, qualidade/manutenção e cadastros necessários estiverem ligados à base compartilhada, com testes de permissão, concorrência, falha/reconexão, migração e backup aprovados. A tela inicial deve exibir geração compartilhada, última sincronização e estado da rede; não deve apenas mostrar “banco local” quando o operador acreditar que está gravando para todos.
