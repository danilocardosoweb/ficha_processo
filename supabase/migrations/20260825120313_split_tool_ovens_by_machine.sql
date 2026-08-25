-- Cada prensa possui seu próprio conjunto físico de três fornos.
alter table public.tool_ovens
  add column machine_code text;

alter table public.tool_ovens
  drop constraint tool_ovens_organization_id_code_key;

-- Os três cadastros originais pertencem à Prensa 1.8. Isto preserva os ciclos
-- já registrados (inclusive a TG-7403 atualmente na posição 1 do Forno 1).
update public.tool_ovens
   set machine_code = '18'
 where machine_code is null;

insert into public.tool_ovens (
  organization_id, machine_code, code, name, position_count,
  solid_minimum_minutes, tubular_minimum_minutes, maximum_minutes,
  solid_target_temperature_c, tubular_target_temperature_c, is_active
)
select
  organization_id, '19', code, name, position_count,
  solid_minimum_minutes, tubular_minimum_minutes, maximum_minutes,
  solid_target_temperature_c, tubular_target_temperature_c, is_active
from public.tool_ovens
where machine_code = '18'
on conflict do nothing;

-- Caso existam ciclos antigos da Prensa 1.9, mova o vínculo para o forno
-- equivalente da própria prensa sem alterar entrada ou relógio.
update public.tool_heating_cycles c
   set oven_id = target.id,
       oven_code = target.name
  from public.tool_ovens source,
       public.tool_ovens target
 where c.oven_id = source.id
   and c.machine_code = '19'
   and source.machine_code = '18'
   and target.organization_id = c.organization_id
   and target.machine_code = '19'
   and target.code = source.code;

alter table public.tool_ovens
  alter column machine_code set not null,
  add constraint tool_ovens_organization_machine_fkey
    foreign key (organization_id, machine_code)
    references public.machines (organization_id, code) on update cascade on delete restrict,
  add constraint tool_ovens_organization_machine_code_key
    unique (organization_id, machine_code, code),
  add constraint tool_ovens_organization_machine_id_key
    unique (organization_id, machine_code, id);

drop index if exists public.tool_ovens_active_idx;
create index tool_ovens_active_idx
  on public.tool_ovens (organization_id, machine_code, is_active, code);

-- Defesa adicional: mesmo por RPC ou acesso concorrente, um ciclo só pode
-- apontar para um forno pertencente à mesma prensa.
create or replace function private.guard_tool_heating_oven_machine()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.oven_id is not null and not exists (
    select 1
      from public.tool_ovens o
     where o.id = new.oven_id
       and o.organization_id = new.organization_id
       and o.machine_code = new.machine_code
       and o.is_active
  ) then
    raise exception 'O forno selecionado não pertence à prensa de destino.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_tool_heating_oven_machine
  on public.tool_heating_cycles;
create trigger guard_tool_heating_oven_machine
before insert or update of oven_id, machine_code
on public.tool_heating_cycles
for each row execute function private.guard_tool_heating_oven_machine();
