create table public.decision_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  current_version integer not null default 1 check(current_version > 0),
  created_at timestamptz not null default now()
);
create table public.decision_profile_versions (
  profile_id uuid not null references public.decision_profiles(id),
  version integer not null check(version > 0),
  document jsonb not null check(jsonb_typeof(document) = 'object'),
  reason text not null check(length(btrim(reason)) between 5 and 1000),
  simulated_impact jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  actor_name text not null,
  created_at timestamptz not null default now(),
  primary key(profile_id, version)
);
create index decision_profiles_org_idx on public.decision_profiles(organization_id);
alter table public.decision_profiles enable row level security;
alter table public.decision_profile_versions enable row level security;
revoke all on public.decision_profiles, public.decision_profile_versions from public, anon, authenticated;

create or replace function public.local_list_decision_profiles(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id=v_actor;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select p.id, p.name, p.current_version, v.version, v.document, v.reason,
      v.simulated_impact, v.actor_name, v.created_at
    from public.decision_profiles p
    join public.decision_profile_versions v on v.profile_id=p.id
    where p.organization_id=v_org
    order by v.created_at desc limit 100
  ) r), '[]'::jsonb);
end;
$$;

create or replace function public.local_save_decision_profile(
  p_token text, p_id uuid, p_base_version integer, p_document jsonb,
  p_reason text, p_impact jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_name text; v_id uuid; v_version integer;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, display_name into v_org, v_name from private.local_users where id=v_actor;
  if p_reason is null or length(btrim(p_reason)) < 5 or length(p_reason)>1000 then raise exception 'Informe o motivo da alteração.'; end if;
  if jsonb_typeof(p_document) is distinct from 'object' or p_document->>'schemaVersion' is distinct from '1'
     or length(p_document::text)>100000
     or jsonb_typeof(p_document->'weights') is distinct from 'object'
     or jsonb_typeof(p_document->'customCriteria') is distinct from 'array'
     or jsonb_array_length(p_document->'customCriteria')>40 then
    raise exception 'Perfil de decisão inválido.';
  end if;
  if p_id is null then
    insert into public.decision_profiles(organization_id,name) values(v_org,p_document->>'name') returning id into v_id;
    v_version := 1;
  else
    select id,current_version into v_id,v_version from public.decision_profiles
      where id=p_id and organization_id=v_org for update;
    if v_id is null then raise exception 'Perfil não encontrado.'; end if;
    if v_version is distinct from p_base_version then raise exception 'Este perfil mudou. Recarregue antes de salvar.'; end if;
    v_version := v_version+1;
    update public.decision_profiles set name=p_document->>'name', current_version=v_version where id=v_id;
  end if;
  insert into public.decision_profile_versions(profile_id,version,document,reason,simulated_impact,actor_id,actor_name)
    values(v_id,v_version,p_document,p_reason,coalesce(p_impact,'{}'::jsonb),v_actor,v_name);
  return jsonb_build_object('id',v_id,'version',v_version,'document',p_document);
end;
$$;
revoke all on function public.local_list_decision_profiles(text) from public;
revoke all on function public.local_save_decision_profile(text,uuid,integer,jsonb,text,jsonb) from public;
grant execute on function public.local_list_decision_profiles(text) to anon,authenticated;
grant execute on function public.local_save_decision_profile(text,uuid,integer,jsonb,text,jsonb) to anon,authenticated;
