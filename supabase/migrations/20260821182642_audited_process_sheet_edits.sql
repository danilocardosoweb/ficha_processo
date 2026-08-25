alter table public.process_sheets
  add column if not exists last_changed_by_name text,
  add column if not exists last_change_reason text;

create table if not exists public.process_sheet_change_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  process_sheet_id uuid not null references public.process_sheets(id) on delete restrict,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  changed_by_name text not null,
  change_reason text not null,
  changed_at timestamptz not null default now(),
  previous_parameters jsonb not null,
  new_parameters jsonb not null,
  previous_snapshot jsonb not null,
  new_snapshot jsonb not null,
  source text not null default 'production_cockpit'
    check (source in ('production_cockpit', 'engineering', 'import', 'database'))
);

create index if not exists process_sheet_history_sheet_date_idx
  on public.process_sheet_change_history (process_sheet_id, changed_at desc);

create index if not exists process_sheet_history_org_date_idx
  on public.process_sheet_change_history (organization_id, changed_at desc);

alter table public.process_sheet_change_history enable row level security;

drop policy if exists process_sheet_history_authenticated_select
  on public.process_sheet_change_history;
create policy process_sheet_history_authenticated_select
  on public.process_sheet_change_history
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));

drop policy if exists process_sheet_history_v1_open_select
  on public.process_sheet_change_history;
create policy process_sheet_history_v1_open_select
  on public.process_sheet_change_history
  for select to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

grant select on public.process_sheet_change_history to anon, authenticated;

create or replace function private.audit_process_sheet_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.parameters is distinct from new.parameters then
    if nullif(btrim(new.last_changed_by_name), '') is null then
      raise exception 'Informe o usuário responsável pela alteração da Ficha de Processo';
    end if;
    if nullif(btrim(new.last_change_reason), '') is null then
      raise exception 'Informe o motivo da alteração da Ficha de Processo';
    end if;

    insert into public.process_sheet_change_history (
      organization_id,
      process_sheet_id,
      changed_by_user_id,
      changed_by_name,
      change_reason,
      previous_parameters,
      new_parameters,
      previous_snapshot,
      new_snapshot,
      source
    ) values (
      new.organization_id,
      new.id,
      auth.uid(),
      new.last_changed_by_name,
      new.last_change_reason,
      old.parameters,
      new.parameters,
      to_jsonb(old),
      to_jsonb(new),
      'production_cockpit'
    );
  end if;
  return new;
end;
$$;

revoke all on function private.audit_process_sheet_change() from public, anon, authenticated;

drop trigger if exists audit_process_sheet_change on public.process_sheets;
create trigger audit_process_sheet_change
after update of parameters on public.process_sheets
for each row execute function private.audit_process_sheet_change();
