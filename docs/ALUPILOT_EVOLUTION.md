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
| Carga Máquina | Parcial | Simulação determinística com interface de cenários e versionamento preparada; a persistência depende da aplicação da migration no Supabase. |
| Estoque físico de tarugos | Não existe | Hoje o cálculo representa necessidade teórica. |
| Carcaças como recurso | Não existe | Há dados de carcaça, mas não agenda/reserva. |
| Otimização explicável | Não existe | A sequência sugerida usa heurísticas fixas. |

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

### Etapa 1 — Fundação segura

- registrar cenários e versões imutáveis;
- guardar snapshots das entradas, regras e resultados;
- incorporar Furos e BO ao contrato do simulador;
- preservar integralmente o comportamento atual.

### Etapa 2 — Recursos reais

- estoque e reservas de tarugos;
- carcaças e disponibilidade;
- calendários por prensa, forno e manutenção;
- validação de capacidade por recurso.

### Etapa 3 — Simulador V2

- sequência candidata com pontuação;
- restrições duras e preferências separadas;
- explicação de cada decisão;
- comparação lado a lado entre cenários.

### Etapa 4 — Aprendizado operacional

- previsto × realizado por item e setup;
- calibração de produtividade, eficiência e tempos;
- indicadores de confiabilidade da previsão.

### Etapa 5 — Copiloto de planejamento

- sugestões com evidências e nível de confiança;
- aprovação humana e trilha de auditoria;
- preparação para integrações de estoque, ERP e CLP.

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
