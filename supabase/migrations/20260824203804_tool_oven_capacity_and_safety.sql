-- Cadastro físico dos fornos de ferramentas. Os tempos de sólido e tubular
-- são separados para permitir revisão futura sem alterar o aplicativo.
create table public.tool_ovens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  position_count smallint not null default 7 check (position_count between 1 and 50),
  solid_minimum_minutes integer not null default 240 check (solid_minimum_minutes between 1 and 1439),
  tubular_minimum_minutes integer not null default 240 check (tubular_minimum_minutes between 1 and 1439),
  maximum_minutes integer not null default 1440 check (maximum_minutes between 2 and 10080),
  solid_target_temperature_c numeric(5,1) not null default 400,
  tubular_target_temperature_c numeric(5,1) not null default 420,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  check (maximum_minutes > solid_minimum_minutes),
  check (maximum_minutes > tubular_minimum_minutes)
);

create index tool_ovens_active_idx
  on public.tool_ovens (organization_id, is_active, code);

create trigger tool_ovens_updated_at
before update on public.tool_ovens
for each row execute function private.set_updated_at();

alter table public.tool_ovens enable row level security;
grant select on public.tool_ovens to anon, authenticated;

create policy tool_ovens_v1_select on public.tool_ovens
  for select to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
create policy tool_ovens_authenticated_select on public.tool_ovens
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));

insert into public.tool_ovens (
  organization_id, code, name, position_count,
  solid_minimum_minutes, tubular_minimum_minutes, maximum_minutes,
  solid_target_temperature_c, tubular_target_temperature_c
)
select
  '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid,
  value.code,
  value.name,
  7,
  240,
  240,
  1440,
  400,
  420
from (values
  ('F1', 'Forno 1'),
  ('F2', 'Forno 2'),
  ('F3', 'Forno 3')
) as value(code, name)
on conflict (organization_id, code) do update
set name = excluded.name,
    position_count = excluded.position_count,
    is_active = true,
    updated_at = now();

alter table public.tool_heating_cycles
  add column oven_id uuid references public.tool_ovens(id) on delete restrict,
  add column oven_position smallint,
  add column tool_type text check (tool_type in ('solid','tubular')),
  add column target_temperature_c numeric(5,1),
  add column maximum_due_at timestamptz;

update public.tool_heating_cycles
   set maximum_due_at = entered_at + interval '24 hours'
 where maximum_due_at is null;

alter table public.tool_heating_cycles
  alter column maximum_due_at set not null,
  add constraint tool_heating_cycles_position_range
    check (oven_position is null or oven_position between 1 and 7),
  add constraint tool_heating_cycles_oven_position_pair
    check ((oven_id is null) = (oven_position is null)),
  add constraint tool_heating_cycles_maximum_after_entry
    check (maximum_due_at > entered_at and maximum_due_at > expected_ready_at);

create unique index tool_heating_cycles_active_position_idx
  on public.tool_heating_cycles (oven_id, oven_position)
  where status = 'heating' and oven_id is not null;
create index tool_heating_cycles_machine_status_idx
  on public.tool_heating_cycles (organization_id, machine_code, status, expected_ready_at);

drop function public.start_tool_heating(uuid[], integer, text, text, text);

create function public.start_tool_heating(
  p_order_ids uuid[],
  p_actor text,
  p_oven_id uuid,
  p_oven_position integer,
  p_tool_type text,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle_id uuid;
  v_org uuid;
  v_import uuid;
  v_machine text;
  v_tool text;
  v_count integer;
  v_oven public.tool_ovens;
  v_required integer;
  v_target_temperature numeric(5,1);
begin
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um item da Simplificada.';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela entrada no forno.';
  end if;
  if p_tool_type not in ('solid', 'tubular') then
    raise exception 'Informe se a ferramenta é sólida ou tubular.';
  end if;

  select * into v_oven
    from public.tool_ovens
   where id = p_oven_id and is_active
   for share;
  if not found then
    raise exception 'Forno não encontrado ou inativo.';
  end if;
  if p_oven_position not between 1 and v_oven.position_count then
    raise exception 'Selecione uma posição válida do forno.';
  end if;
  if exists (
    select 1 from public.tool_heating_cycles c
     where c.oven_id = p_oven_id
       and c.oven_position = p_oven_position
       and c.status = 'heating'
  ) then
    raise exception 'Esta posição acabou de ser ocupada. Escolha outra posição.';
  end if;

  select min(po.organization_id::text)::uuid,
         min(po.import_batch_id::text)::uuid,
         min(po.machine_code), min(po.tool_code), count(*)
    into v_org, v_import, v_machine, v_tool, v_count
    from public.production_orders po
    join public.simplified_imports si on si.id = po.import_batch_id
   where po.id = any(p_order_ids)
     and po.is_active = true
     and po.status in ('planned','released','paused')
     and si.status = 'processed'
     and si.is_active = true
     and si.deleted_at is null;

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'Um ou mais itens não estão disponíveis numa Simplificada ativa.';
  end if;
  if v_oven.organization_id <> v_org then
    raise exception 'O forno e os itens pertencem a organizações diferentes.';
  end if;
  if ((select auth.uid()) is null and v_org <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_org and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  if (select count(distinct po.organization_id) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct po.machine_code) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct upper(po.tool_code)) from public.production_orders po where po.id = any(p_order_ids)) <> 1 then
    raise exception 'Agrupe somente itens da mesma ferramenta e da mesma prensa.';
  end if;
  if exists (
    select 1 from public.tool_heating_cycle_orders co
    join public.tool_heating_cycles c on c.id = co.cycle_id
    where co.production_order_id = any(p_order_ids) and c.status in ('heating','released')
  ) then
    raise exception 'Um dos itens já possui aquecimento ativo ou já foi liberado.';
  end if;

  v_required := case when p_tool_type = 'tubular'
    then v_oven.tubular_minimum_minutes else v_oven.solid_minimum_minutes end;
  v_target_temperature := case when p_tool_type = 'tubular'
    then v_oven.tubular_target_temperature_c else v_oven.solid_target_temperature_c end;

  insert into public.tool_heating_cycles (
    organization_id, import_batch_id, machine_code, tool_code,
    oven_code, oven_id, oven_position, tool_type, target_temperature_c,
    required_minutes, entered_at, expected_ready_at, maximum_due_at,
    entered_by_name, notes
  ) values (
    v_org, v_import, v_machine, v_tool,
    v_oven.name, v_oven.id, p_oven_position, p_tool_type, v_target_temperature,
    v_required, now(), now() + make_interval(mins => v_required),
    now() + make_interval(mins => v_oven.maximum_minutes),
    trim(p_actor), nullif(trim(p_notes), '')
  ) returning id into v_cycle_id;

  insert into public.tool_heating_cycle_orders (cycle_id, production_order_id)
  select v_cycle_id, unnest(p_order_ids);

  insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
  select v_org, v_cycle_id, 'entered', trim(p_actor), nullif(trim(p_notes), ''), to_jsonb(c)
  from public.tool_heating_cycles c where c.id = v_cycle_id;

  return v_cycle_id;
exception
  when unique_violation then
    raise exception 'Esta posição acabou de ser ocupada por outro usuário. Escolha outra posição.';
end;
$$;

create or replace function public.release_tool_heating(
  p_cycle_id uuid,
  p_actor text,
  p_notes text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle public.tool_heating_cycles;
begin
  select * into v_cycle from public.tool_heating_cycles where id = p_cycle_id for update;
  if not found or v_cycle.status <> 'heating' then
    raise exception 'Este aquecimento não está disponível para liberação.';
  end if;
  if ((select auth.uid()) is null and v_cycle.organization_id <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_cycle.organization_id and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  if now() < v_cycle.expected_ready_at then
    raise exception 'O tempo mínimo de aquecimento ainda não foi atingido.';
  end if;
  if now() >= v_cycle.maximum_due_at then
    raise exception 'Limite de 24 horas excedido. Retire e bloqueie a ferramenta para avaliação.';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela liberação.';
  end if;

  update public.tool_heating_cycles
     set status = 'released', released_at = now(), released_by_name = trim(p_actor),
         release_notes = nullif(trim(p_notes), '')
   where id = p_cycle_id;

  update public.production_orders po
     set status = 'released', last_status_reason = concat('Ferramenta liberada do forno por ', trim(p_actor))
    from public.tool_heating_cycle_orders co
   where co.cycle_id = p_cycle_id and po.id = co.production_order_id and po.status = 'planned';

  insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
  select organization_id, id, 'released', trim(p_actor), nullif(trim(p_notes), ''), to_jsonb(c)
  from public.tool_heating_cycles c where c.id = p_cycle_id;
end;
$$;

revoke all on function public.start_tool_heating(uuid[], text, uuid, integer, text, text) from public;
grant execute on function public.start_tool_heating(uuid[], text, uuid, integer, text, text) to anon, authenticated;
