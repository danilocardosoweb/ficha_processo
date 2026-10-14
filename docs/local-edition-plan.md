# TecnoMES Local — plano de implementação

## Objetivo

Transformar esta pasta em um aplicativo desktop para Windows, instalado no computador da operação. O banco de dados é SQLite e permanece no equipamento; a edição local não usa Vercel, Supabase, Realtime ou chaves públicas.

## Decisões adotadas

- **Aplicativo:** Electron com a interface Next.js/React existente.
- **Banco:** SQLite, em modo WAL, com chaves estrangeiras habilitadas e tempo de espera para escrita concorrente.
- **Local dos dados:** diretório protegido do aplicativo Windows (`%APPDATA%/TecnoMES Local/data/tecnomes.sqlite`). O instalador e futuras atualizações não devem apagar esse diretório.
- **Acesso:** usuários, sessões opacas e auditoria próprios no SQLite. O primeiro acesso cria somente um administrador local; não há senha padrão gravada no código.
- **Conexão:** o processo Electron abre somente `127.0.0.1`. A aplicação não publica portas para a rede da fábrica.
- **Escopo inicial:** uma instalação por banco. Um arquivo SQLite não será aberto por várias máquinas em uma pasta de rede.

## O que já foi entregue nesta etapa

1. Estrutura Electron para desenvolvimento e criação de instalador Windows.
2. Banco SQLite inicial com controle de migrações, WAL, usuários, sessões, configurações e auditoria.
3. Primeiro acesso seguro: criação do administrador diretamente no computador.
4. Login e logout locais quando o aplicativo é iniciado em modo desktop.
5. Identificação de versão, ambiente e data de build adaptada para a edição local.
6. Cadastros de prensas e ferramentas conectados às tabelas SQLite, com pesquisa, edição e eventos de auditoria.
7. Importação do histórico de ferramentas e das fichas de processo, gravadas no SQLite; repetição do mesmo arquivo é reconhecida pelo hash.
8. Consulta, edição e criação/cópia de fichas de processo no banco local.
9. Estoque de tarugos, BOs e carcaças e vínculo ferramenta–carcaça persistidos no SQLite; ações registradas na auditoria.
10. Reserva de tarugos por liga em ordem FIFO e liberação de reserva, com atualização transacional do saldo.
11. Fila compartilhada da programação no caminho padrão `W:\App_Prensa`: senhas sequenciais, reserva exclusiva por estação, renovação de atividade, cancelamento/liberação e recuperação administrativa após 5 minutos sem sinal. O SQLite continua separado e local em cada computador.
12. Carga histórica da versão web: 104.366 registros de 51 tabelas arquivados no SQLite local; ferramentas, fichas de processo, tarugos e carcaças também carregados nos cadastros locais. Tela administrativa de consulta somente leitura em `/dados-importados`. Usuários e sessões web não são copiados.
13. Carteira e Simplificadas materializadas em tabelas locais próprias: o último snapshot contém 934 pedidos, dentro dos 4.138 registros de carteira; as 212 ordens Simplificadas e seus 12 lotes de importação também foram preservados. A carteira histórica e o baseline Simplificada são imutáveis e consultáveis em telas administrativas somente leitura.

## Migração por domínio

| Etapa | Substituir | Critério de aceite |
| --- | --- | --- |
| 1 — Fundamento | Electron, SQLite, primeiro acesso, sessão e auditoria | Aplicativo inicia sem variáveis do Supabase e permite entrar com administrador local. |
| 2 — Cadastros | Organização, prensas, ferramentas, fichas, tarugos, BO e carcaças | **Persistência e carga histórica implementadas:** dados atuais preservados no SQLite; ferramentas, fichas, tarugos, carcaças, carteira e Simplificadas materializados. Consulta da carteira e baseline é somente leitura; ainda falta importação local nova, edição/publicação de programação e conectar reservas de carcaça ao fluxo de produção. |
| 3 — Operação | Forno, aquecimento, produção, paradas e diário de bordo | Cada ação gera evento imutável e mantém o estado após reinício. |
| 4 — Planejamento | Simplificada, carteira, simulador e cenários | O motor mantém os testes de regressão e usa somente o SQLite. A coordenação da vez entre estações já existe; o salvamento/publicação ainda precisa validar a reserva e o número de versão. |
| 5 — Importação e conciliação | Prévia, hash, idempotência, matcher e revisão | A mesma importação não duplica dados e cada decisão é auditável. **Parcial:** histórico de ferramentas e fichas importadas com hash e registro de auditoria; matcher e revisão pendentes. |
| 6 — Segurança operacional | Backup, restauração, diagnóstico e instalador | Backup consistente, restauração validada e instalador testado em computador sem Node.js. |

## Regras de migração

- As migrações PostgreSQL de `supabase/migrations` são referência funcional, não podem ser executadas no SQLite diretamente.
- Cada domínio novo recebe uma migração SQLite própria e um repositório local. Componentes não devem importar `better-sqlite3` no navegador.
- O processo principal do Electron guarda a localização dos dados; a interface não recebe acesso ao sistema de arquivos nem ao banco.
- A Simplificada continua imutável. O motor de programação permanece determinístico e só será alterado acompanhado de teste de regressão.
- O Supabase será removido somente depois que o domínio correspondente estiver migrado e validado. Não haverá período com a operação sem persistência.

## Próxima implementação

Carteira e Simplificadas já estão materializadas e podem ser consultadas no aplicativo sem Supabase. Próximo: importar planilhas localmente com prévia, validação e idempotência; depois migrar o ciclo de forno e produção para sessões/eventos imutáveis e ligar a publicação da programação à reserva/fence da fila. Até essas etapas e seus testes de concorrência, os novos módulos continuam somente leitura; não usar para apontamento real.

## Coordenação entre máquinas

O controle de vez usa arquivos de coordenação no compartilhamento, protegidos por uma trava curta entre operações. Abrir a tela da fila registra automaticamente a estação, promove o primeiro da ordem sem ação manual e, ao sair da tela, cancela a espera ou libera a reserva. A pasta é configurável pela variável `TECNOMES_SHARED_APP_ROOT`; o padrão é `W:\App_Prensa`. Se o compartilhamento estiver fora do ar, o recurso falha fechado e não cria uma fila paralela local. A ordem é atribuída por contador comum, sob a trava do compartilhamento, e cada reserva recebe um token e um número de proteção (fence). Recuperação por administrador/gerente exige 5 minutos sem renovação e motivo registrado para situações anormais, como fechamento abrupto ou perda de rede. O compartilhamento precisa permitir que as estações autorizadas criem e renomeiem arquivos; suas permissões devem limitar o acesso a quem pode programar.

**Limite importante:** esta entrega reserva a vez e coordena a fila, mas ainda não publica nem replica o conteúdo da programação. O futuro endpoint de publicação deve executar sua gravação compartilhada dentro de `withPlanningTurn(...)`, validando o token/fence enquanto mantém a trava. Até essa integração, alterações feitas em outros caminhos não são protegidas pela fila.

**Limite de segurança:** trata-se de um controle de concorrência para uso cooperativo, não de autenticação central resistente a adulteração. Cada computador ainda tem seus próprios usuários locais; quem tiver permissão de escrita direta na pasta de coordenação poderá alterar seus arquivos. A validação em dois computadores e a revisão das permissões de rede são obrigatórias antes do uso em produção.

## Base compartilhada para oito estações

`W:\App_Prensa` é a origem de dados compartilhada desejada para duas estações PCP, uma de gerência de produção, duas de produção, uma de gerência de manutenção e duas de qualidade. O SQLite em WAL não pode ser simplesmente movido para `W:` e aberto simultaneamente por oito computadores. Cada estação mantém seu SQLite local como cache; a pasta compartilhada recebe versões imutáveis e eventos operacionais identificados por geração, com índice publicado sob trava e conferência SHA-256. A estrutura inicial fica em `.tecnomes/shared-data` e não contém usuários, senhas ou sessões.

O protocolo de arquivos e seus testes de conflito/integridade já foram criados. O cadastro de prensas é o primeiro fluxo integrado no código: PCP/administrador publica uma versão antes de atualizar o SQLite local, e outra estação pode recebê-la. A leitura usa o cache local identificado como desatualizado se `W:` cair; gravações são bloqueadas. **A base compartilhada real ainda está vazia e os demais módulos não publicam nem aplicam mudanças dela.** Portanto, esta edição continua inadequada para lançamentos multiestação. A próxima implementação precisa publicar o bootstrap, ligar cada escrita operacional ao protocolo, reconstituir os caches locais, impor permissões por função no aplicativo, criar backup/restauração e validar em pelo menos duas máquinas reais. Não remover este aviso até o teste fim a fim em rede.
