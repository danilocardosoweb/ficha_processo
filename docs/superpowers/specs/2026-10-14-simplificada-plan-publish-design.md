# Importação, sequenciamento e publicação local da Simplificada

Data: 2026-10-14
Status: proposto

## Contexto e motivação

A edição local do TecnoMES roda hoje em até 7 estações (2 prensas, 2 PCP, 2
qualidade, 1 gerência de produção) sem acesso à internet, só com a pasta de
rede `W:\App_Prensa` em comum. Forno, Produção, Manutenção, Qualidade e
Planejamento continuam dependentes do Supabase e não funcionam nessa
instalação (ver `docs/local-edition-plan.md`).

Decisão operacional: antes de portar Forno/Produção, o primeiro passo é
destravar o PCP para importar uma Simplificada nova localmente, ajustar a
sequência por prensa manualmente (sem o simulador Carga Máquina/IA) e
publicar essa programação na pasta compartilhada, para que as outras 6
estações consigam ler qual é o plano vigente de cada prensa.

Fora de escopo nesta entrega: simulador Carga Máquina/AluPilot, apontamento
de produção, forno, qualidade. Essas telas continuam ocultas na edição
local.

## Por que não reaproveitar `local_simplified_baseline_orders`

Essa tabela (`src/lib/local-db/planning-snapshot-migration.ts`) é o dump
histórico importado uma única vez da versão web, protegido por triggers que
bloqueiam `update`/`delete`. Ela representa o baseline imutável exigido por
`AGENTS.md` ("A Simplificada é um baseline imutável"), não um plano vivo que
o PCP edita no dia a dia. Por isso este design cria tabelas novas, deixando
esse histórico intocado.

## Modelo de dados

```sql
create table local_simplified_plan_imports (
  file_hash text primary key,
  file_name text not null,
  imported_by_user_id text references local_users(id),
  imported_by_name text not null,
  row_count integer not null,
  status text not null check (status in ('processing','completed','failed')),
  created_at text not null,
  completed_at text
);

create table local_simplified_plan_orders (
  id text primary key,
  import_batch_id text not null references local_simplified_plan_imports(file_hash),
  -- campos vindos do Excel, imutáveis após a importação
  machine_code text not null collate nocase,
  order_number text not null,
  customer_name text,
  tool_code text not null collate nocase,
  product_code text,
  alloy_code text not null collate nocase,
  temper text,
  due_date text,
  demand_unit text not null check (demand_unit in ('kg','pieces')),
  target_kg real,
  target_quantity real,
  source_row integer not null,
  source_data_json text not null,
  -- únicos campos editáveis pelo PCP depois da importação
  sequence_number integer not null,
  is_current_plan integer not null default 1 check (is_current_plan in (0,1)),
  created_at text not null,
  updated_at text not null
);
create index local_simplified_plan_orders_machine_idx
  on local_simplified_plan_orders(machine_code, is_current_plan, sequence_number);

create table local_simplified_plan_publications (
  id text primary key,
  generation integer not null,
  published_by_user_id text references local_users(id),
  published_by_name text not null,
  fence integer not null,
  content_hash text not null,
  published_at text not null,
  machine_count integer not null,
  order_count integer not null
);
```

Regras:
- Importar um novo lote **não apaga** o anterior: o lote anterior tem
  `is_current_plan` zerado para as prensas que o novo lote cobre; outras
  prensas não mencionadas no novo lote mantêm seu plano atual. Isso
  preserva histórico e auditoria sem precisar de triggers de imutabilidade
  (o PCP pode legitimamente reimportar e resequenciar; cada mudança de
  `sequence_number` grava um evento em `local_audit_events` com
  `entity_type = 'simplified_plan_order'`).
- Campos vindos do Excel nunca são alterados por código depois de
  inseridos; só `sequence_number`, `is_current_plan` e `updated_at` mudam,
  sempre via rota de API dedicada, nunca por UPDATE direto de outra tela.

## Fluxo

1. **Importar** — `POST /api/local/simplified-plan/import`
   - Reaproveita o parser/validação de cabeçalho de
     `src/components/simplified-import.tsx` (só a parte que não toca
     Supabase).
   - Grava em `local_simplified_plan_imports` +
     `local_simplified_plan_orders` com `sequence_number` inicial = ordem
     do arquivo. Hash do arquivo evita reprocessar o mesmo upload (mesmo
     padrão de `src/app/api/local/tools/import/route.ts`).
   - Permissão: `pcp`, `admin`, `manager`.

2. **Ajustar sequência** — nova rota `/programacao-local`: lista por prensa
   das ordens do plano vigente, com subir/descer (sem drag-and-drop na v1,
   para simplificar). Cada mudança chama
   `PATCH /api/local/simplified-plan/orders/:id` alterando só
   `sequence_number` e grava auditoria.

3. **Publicar** — `POST /api/local/simplified-plan/publish`
   - Exige que o usuário tenha a vez na fila de programação
     (`fila-programação`); a escrita é envolvida em `withPlanningTurn()`
     (`src/lib/local-db/shared-planning-queue.ts:396`), que hoje já existe
     mas está sem nenhum chamador — este é o primeiro.
   - Dentro da trava: monta o plano vigente (todas as prensas, ordenado),
     calcula hash de conteúdo, grava uma linha em
     `local_simplified_plan_publications` e escreve a geração na pasta
     compartilhada usando o mesmo protocolo de
     `src/lib/local-db/shared-data-store.mjs` já validado para o cadastro
     de prensas (escreve arquivo imutável por geração + atualiza um
     índice/manifesto sob trava, confere SHA-256).

4. **Consultar (prensas, qualidade, gerência)**
   - Estende `src/lib/local-db/shared-catalog-sync.mjs` para também puxar a
     geração mais recente do plano publicado para o cache local de cada
     estação (`local_shared_sync_state` já tem a estrutura para isso).
   - Mesma rota `/programacao-local`, em modo somente leitura para quem não
     é `pcp`/`admin`/`manager`, mostrando a sequência vigente da(s)
     prensa(s) relevantes ao usuário
     (operador vê a sua prensa pelo `machine_codes` do usuário; PCP/gerência
     veem todas).
   - Se a pasta compartilhada estiver inacessível, mostra o cache local
     com aviso explícito "desatualizado desde XX:XX" — nunca finge que é a
     versão vigente.

## Erros e casos de borda

- Pasta de rede fora do ar durante importação/sequenciamento: essas ações
  são 100% locais (não dependem de `W:`), então continuam funcionando;
  só a **publicação** exige a rede e falha fechado se ela cair, com a
  mesma mensagem já usada em `shared-planning-queue.ts`.
- Dois PCPs tentando publicar ao mesmo tempo: resolvido pela fila
  existente (`fila-programação`) — só quem tem a vez pode publicar.
- Arquivo Excel reenviado sem mudança: idempotente pelo hash, não duplica.
- Prensa cujo `machine_code` não aparece no novo lote: mantém o plano
  anterior publicado (não é apagado nem fica em branco).

## Testes

- Importação: hash idempotente não duplica linhas; mapeamento de
  cabeçalho cobre os casos já testados em `simplified-import.tsx` (reuso
  de fixtures se existirem).
- Sequenciamento: só `sequence_number`/`is_current_plan`/`updated_at`
  mudam; evento de auditoria gravado.
- Publicação → sincronização → leitura em outra estação: teste de
  round-trip no molde de `tests/shared-catalog-sync.test.mjs`.
- Regressão: `local_simplified_baseline_orders` (dump histórico
  imutável) permanece intocado por qualquer rota deste domínio.
- `npm run test:planning` continua verde (o motor determinístico não é
  tocado por este design).

## Fora de escopo (adiado para sub-projetos seguintes)

- Simulador Carga Máquina / AluPilot rodando local.
- Forno, Produção, apontamento, Qualidade, Manutenção.
- Edição de valores importados do Excel (quantidade, prazo, liga) depois
  da importação — só a sequência é editável.
