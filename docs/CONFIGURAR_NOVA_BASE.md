# Configuração da nova base Supabase

O projeto já possui 68 migrações SQL versionadas em `supabase/migrations`, na ordem correta. Não é necessário executar `supabase init` novamente.

## Aplicação recomendada

No terminal, dentro deste projeto:

```powershell
supabase login
supabase link --project-ref vtqipxqcwhagwpafmjgh
supabase db push
```

O `db push` aplica todas as migrações pendentes, incluindo as tabelas, funções RPC, índices, RLS e regras do AlumMES.

## Verificação após aplicar

No SQL Editor do novo projeto, execute somente consultas de leitura:

```sql
select to_regprocedure('public.local_login(text,text,text,text)') as login_function;
select to_regprocedure('public.local_get_session(text)') as session_function;
select count(*) as active_users
from private.local_users
where is_active = true;
```

O primeiro e o segundo resultado devem retornar a assinatura da função, e `active_users` deve ser maior que zero para o login real funcionar.

## Observação sobre o usuário de desenvolvimento

Enquanto a base nova não tiver as migrações, o projeto local usa o acesso temporário `dev` apenas em ambiente de desenvolvimento. Esse acesso não cria registro no Supabase e deve ser desativado depois da configuração:

```env
LOCAL_DEV_AUTH_ENABLED=false
```

Nunca execute migrações destrutivas ou apague dados para resolver o problema de quota.
