# AlumMES V1

MES para extrusão de alumínio centrado na Ordem de Produção, com preparação de ferramentas, execução no chão de fábrica e inteligência para o PCP.

## Entregue nesta versao

- Login local seguro, usuários, perfis, prensas e trilha de auditoria
- Importação de Simplificadas Excel, carteira e histórico de planejamentos
- Fila FIFO de Planos e controle do ciclo de vida dos itens
- Fichas de processo, cadastro e histórico de ferramentas
- Controle de 3 fornos por prensa, 7 posições por forno e aquecimento rastreável
- Assistente de extrusão e calculadora de tarugos, peças e tolerâncias
- Apontamentos de paradas integrados à Manutenção
- Mensagens operacionais por usuário, perfil, prensa ou toda a operação
- Operação offline para consultas críticas e arquitetura pronta para futuro CLP

## Executar localmente

Requer Node.js 20.9 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Conectar ao Supabase

1. Crie um projeto no Supabase.
2. Copie `.env.example` para `.env.local` e preencha URL e chave publicavel.
3. Vincule o CLI e aplique a migracao:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

4. O acesso é mantido nas tabelas privadas `private.local_users` e `private.local_sessions`; o app não depende do Supabase Auth.

## Simplificada

O importador reconhece XLS, XLSX, XLSM, XLSB, ODS, CSV e TSV e adapta os cabeçalhos da Simplificada utilizada nas prensas.

## Analista IA do AluPilot

A análise por IA é opcional e complementa as regras determinísticas da Carga Máquina. Configure uma chave nova do OpenRouter em `OPENROUTER_API_KEY`, somente no servidor, e ative o recurso em **Carga Máquina → Ajustar critérios**. A chave nunca deve usar o prefixo `NEXT_PUBLIC_` nem ser adicionada ao repositório.

O AluPilot envia um pacote compacto sem identificação de cliente, exige resposta estruturada, registra modelo, duração e resultado para auditoria e reaproveita análises iguais por 30 minutos. A IA explica e prioriza; bloqueios de estoque, carcaça, BO, ferramenta e forno permanecem soberanos.

## Vercel

Importe o repositorio na Vercel e cadastre as duas variaveis do `.env.example`. A chave `service_role` nunca deve ser cadastrada como variavel `NEXT_PUBLIC_*`.

## Arquitetura

- `src/app`: rotas e layouts do App Router
- `src/components`: interface e componentes shadcn/ui
- `src/modules`: dominios e portas para integracoes futuras
- `src/lib/local-auth`: sessão local e perfis de acesso
- `src/lib/supabase`: clientes de banco no browser e servidor
- `supabase/migrations`: schema versionado, indices, grants e RLS

O contrato de CLP esta em `src/modules/integrations/contracts.ts`. Uma implementacao futura deve ficar atras dessa porta e persistir eventos idempotentes usando `external_id`; nenhuma dependencia de protocolo industrial foi adicionada a V1.
