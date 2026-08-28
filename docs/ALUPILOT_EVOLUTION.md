# Evolução TecnoMES → AluPilot

Este documento é o registro vivo da evolução do sistema. Ele existe para preservar decisões, regras e compatibilidade com a operação atual.

## Ponto seguro de retorno

- Commit: `fd3fbc0`
- Tag: `backup-pre-alupilot-2026-08-27`
- Branch: `backup/pre-alupilot-2026-08-27`
- Pacote local: `outputs/backups/tecnomes-pre-alupilot-2026-08-27.zip`

## Princípios

1. Evoluir o produto existente; não reconstruir do zero.
2. Não alterar o resultado operacional atual sem uma regra versionada e verificável.
3. Toda simulação deve guardar entradas, regras, resultados e autoria.
4. Recomendações devem ser explicáveis; o usuário mantém a decisão final.
5. Dados previstos e realizados nunca devem ser misturados.

## Estado atual

| Área | Estado | Observação |
|---|---|---|
| Simplificada e ordens | Implementada | Importação, fila, status e rastreabilidade já existem. |
| Fichas de processo | Implementada | Revisões, auditoria e cópia de setup já existem. |
| Produção | Implementada | Assistente, início/conclusão e cálculo de tarugos. |
| Fornos | Implementada | 3 fornos × 7 posições por prensa, aquecimento e liberação. |
| Paradas | Implementada | Catálogos, turnos, abertura e encerramento. |
| Carga Máquina | Implementada — V2 | Simulação determinística, restrições de recursos, Gantt, comparação, cenários versionados e aprovação controlada. |
| Estoque físico de tarugos | Implementado | Cadastro por liga/lote, reservas e confronto com a carga estão persistidos no Supabase. |
| Carcaças como recurso | Implementado | Estoque compartilhado, vínculo ferramenta–carcaça, capacidade física, reservas futuras e alertas no simulador. |
| Otimização explicável | Implementada — primeira versão | Nota ponderada, critérios visíveis e recomendações com motivo, impacto e ação sugerida. |
| Aprendizado operacional | Implementado — calibração inicial | Previsto × realizado por ferramenta, prensa e sequência, com confiança mínima configurável. |

## Recursos do simulador

O modelo AluPilot tratará os recursos abaixo de forma explícita:

- prensa;
- forno e posição;
- ferramenta e sequência física;
- tarugo e liga principal/alternativa;
- carcaça;
- quantidade de furos;
- BO;
- turnos e calendários;
- produtividade prevista e alcançada.

`Furos` e `BO` já são importados e armazenados no cadastro de ferramentas. Nesta primeira etapa passam a integrar o contrato e o snapshot da simulação. Ainda não alteram a duração calculada: a influência matemática só será ativada com regra documentada, dados históricos suficientes e validação da Engenharia.

## Arquitetura alvo

```text
Interface
  → Casos de uso
    → Motor de recursos e calendários
    → Motor de regras versionadas
    → Simulador determinístico
    → Pontuação e recomendações explicáveis
  → Repositórios
    → Supabase / cache offline / integrações
```

## Roadmap

### Etapa 1 — Fundação segura — concluída

- registrar cenários e versões imutáveis;
- guardar snapshots das entradas, regras e resultados;
- incorporar Furos e BO ao contrato do simulador;
- preservar integralmente o comportamento atual.

### Etapa 2 — Recursos reais — concluída

- estoque e reservas de tarugos;
- carcaças e disponibilidade;
- calendários por prensa, forno e manutenção;
- validação de capacidade por recurso.

### Etapa 3 — Simulador V2 — concluída

- sequência candidata com pontuação;
- restrições duras e preferências separadas;
- explicação de cada decisão;
- comparação lado a lado entre cenários.

### Etapa 4 — Aprendizado operacional — concluída na primeira versão

- previsto × realizado por item e setup;
- calibração de produtividade, eficiência e tempos;
- indicadores de confiabilidade da previsão.

### Etapa 5 — Copiloto de planejamento — concluída na primeira versão

- sugestões com evidências e nível de confiança;
- aprovação humana e trilha de auditoria;
- preparação para integrações de estoque, ERP e CLP.

## Regras implantadas no Simulador V2

- prensa respeita turno, paradas e indisponibilidades cadastradas;
- ferramenta não pode ocupar duas prensas ao mesmo tempo;
- carcaça é um estoque compartilhado entre as prensas e sua capacidade é verificada por intervalo;
- o vínculo ferramenta–carcaça pode ser geral ou específico por prensa e sequência;
- fornos usam topologia configurável (`quantidade de fornos × vagas por forno`) e a regra térmica cadastrada;
- a aprovação é bloqueada quando há falta de material, carcaça ausente/sem capacidade ou outro conflito impeditivo;
- ao aprovar, o sistema reserva tarugos, carcaças, prensa, ferramenta e vaga do forno, aplica a fila e registra auditoria;
- cenários calculados permanecem imutáveis e podem ser comparados antes da decisão;
- Furos e BO permanecem rastreáveis e visíveis, mas ainda não alteram matematicamente a duração sem validação da Engenharia.

## Inteligência explicável e aprendizado

- a nota do cenário varia de 0 a 100 e combina cobertura térmica, recursos físicos, material, prazo e fluxo;
- os pesos são configuráveis e precisam totalizar 100%;
- toda recomendação informa por que foi criada, impacto esperado e ação possível;
- a produção realizada gera automaticamente uma observação de aprendizado com produtividade e duração previstas × realizadas;
- a calibração é agrupada por ferramenta, prensa e sequência;
- uma produtividade aprendida só é usada quando atinge o número mínimo configurado de amostras; até lá, a receita continua sendo a fonte segura;
- a aprovação humana continua obrigatória: a inteligência recomenda, mas não libera produção sozinha.

## Pendências operacionais de dados

Estas não são falhas de implementação. São cadastros físicos que precisam refletir a fábrica antes de uma aprovação real:

1. completar os vínculos ferramenta–carcaça das ferramentas que ainda aparecem sem carcaça;
2. conferir quantidade total e indisponível de cada carcaça compartilhada;
3. validar peso por barra e eficiência de cada prensa/liga;
4. confirmar a topologia real dos fornos e suas vagas;
5. acumular histórico realizado suficiente para elevar a confiança das calibrações.

## Registro de mudanças

### 2026-08-27

- criado o ponto seguro anterior ao AluPilot;
- documentada a arquitetura evolutiva;
- iniciado o contrato versionado de cenários;
- Furos e BO incluídos como entradas rastreáveis, sem alterar cálculos.
- criada a API de cenários da Carga Máquina;
- adicionada a interface para salvar, listar e reabrir cenários históricos em modo somente leitura;
- cada novo salvamento do mesmo cenário gera uma versão imutável com entradas, regras, resultados e recursos;
- preparada a migration de cenários, versões, itens e eventos de recursos com acesso pelas sessões locais do TecnoMES.
- criado o cadastro auditável de lotes de tarugo com liga, peso por barra, quantidade, localização, condição e data de entrada;
- modeladas reservas FIFO por lote, com proteção contra estoque negativo e separação entre barras físicas, reservadas e livres;
- integrada a disponibilidade real à Carga Máquina, com cobertura por liga e alerta de risco de parada por falta de material;
- snapshots de cenários passaram a registrar a fotografia do estoque usada na análise;
- nenhuma migration foi aplicada remotamente e nenhum repositório remoto foi atualizado nesta etapa.
- Furos, BO e Carcaça passaram a ser lidos das ferramentas/receitas e exibidos em cada item da Carga Máquina;
- criado o cadastro de carcaças físicas por prensa, com quantidade total, indisponível, reservada e livre;
- o simulador passou a alertar carcaça ausente ou indisponível na prensa correta e a registrar a fotografia desses recursos no cenário;
- Furos e BO permanecem rastreados, sem alterar produtividade ou duração até existir regra validada pela Engenharia.
- criado o calendário auditável de indisponibilidades planejadas de prensa;
- o motor agora subtrai esses intervalos dos turnos produtivos e recalcula início e término dos itens;
- a fotografia dos turnos e indisponibilidades também é preservada em cada versão do cenário.
- migrations AluPilot aplicadas ao projeto Supabase `Supervisorio Prensa` em 28/08/2026: cenários, estoque de tarugos, recursos das prensas e calendário operacional;
- verificação pós-aplicação confirmou nove tabelas com RLS ativo, onze RPCs disponíveis e histórico das quatro migrations registrado no Supabase;
- diagnósticos de segurança e desempenho executados; os avisos de RLS sem policy são esperados neste modelo, pois as tabelas permanecem sem acesso direto e as operações usam RPCs validadas por token local.
- corrigidas seis funções AluPilot que consultavam `full_name`; o modelo local de usuários utiliza `display_name` como fonte única do nome do operador;
- correção aplicada no Supabase e validada sem criar coluna duplicada ou alterar os usuários existentes.
- carcaças passaram de recursos dedicados por prensa para um estoque físico único compartilhado pelas prensas 1.8 e 1.9;
- a análise de carcaças agora compara o pico de usos simultâneos das duas prensas com a quantidade livre do estoque comum;
- Furos e BO da Simplificada foram promovidos para colunas próprias das ordens, preservando também o arquivo original no histórico JSON;
- a Carga Máquina passou a exibir Furos, BO e Carcaça em uma coluna de recursos visível por item;
- a tela de tarugos passou a mostrar o peso físico e o peso livre em kg por lote, além da quantidade de barras;
- modelo dos novos cenários atualizado para `alupilot-v1.1`;
- foi identificado que as 27 ordens ativas possuem Furos e BO, porém ainda não possuem vínculo de carcaça nem ficha de processo correspondente; esse dado permanece explicitamente pendente, sem inferência automática insegura.
- a linha do tempo passou a separar quantidade líquida do pedido e necessidade bruta de tarugo, calculada sobre o saldo líquido pela eficiência configurada da prensa;
- o antigo saldo isolado por ferramenta foi substituído visualmente por uma trilha de saldo projetado por liga: carga inicial calculada, consumo bruto cronológico, equivalência em barras e saldo final destacado;
- o cálculo do saldo projetado cruza os horários das duas prensas para representar a ordem real prevista de consumo da mesma liga.

### 2026-08-28 — Simulador V2, explicabilidade e aprendizado

- criado o cadastro auditável de vínculos ferramenta–carcaça, incluindo exceções por prensa e sequência;
- a capacidade dos fornos passou a ser configurável por quantidade de fornos e vagas, preservando 3 × 7 como padrão atual;
- o motor passou a detectar e acomodar conflitos globais de ferramenta e carcaça entre as prensas;
- criada a visualização Gantt da programação e o painel de restrições por recurso;
- criada a comparação lado a lado de duas versões salvas;
- criada a aprovação controlada de cenário, com validação impeditiva, aplicação da fila e reservas atômicas de tarugo e carcaça;
- a trilha de recursos aprovada passou a registrar prensa, ferramenta, carcaça e vaga de forno;
- criada a nota explicável de 0 a 100, com pesos configuráveis e recomendações priorizadas;
- criado o aprendizado previsto × realizado e a calibração por ferramenta, prensa e sequência;
- o banco já contém duas observações históricas iniciais; o uso automático da produtividade aprendida respeita o mínimo configurado de amostras;
- funções internas de gatilho tiveram execução direta removida de usuários anônimos e autenticados;
- migrations aplicadas diretamente ao Supabase do projeto; nenhuma atualização foi enviada ao GitHub.
