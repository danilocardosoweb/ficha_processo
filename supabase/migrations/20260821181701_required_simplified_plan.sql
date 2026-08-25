alter table public.simplified_imports
  add column if not exists plan_code text;

update public.simplified_imports si
   set plan_code = (
     select min(po.plan_code)
       from public.production_orders po
      where po.import_batch_id = si.id
        and nullif(btrim(po.plan_code), '') is not null
   )
 where si.status = 'processed'
   and nullif(btrim(si.plan_code), '') is null;

alter table public.simplified_imports
  drop constraint if exists simplified_imports_processed_plan_required;

alter table public.simplified_imports
  add constraint simplified_imports_processed_plan_required
  check (
    status <> 'processed'
    or nullif(btrim(plan_code), '') is not null
  ) not valid;

alter table public.simplified_imports
  validate constraint simplified_imports_processed_plan_required;

create index if not exists simplified_imports_plan_lookup_idx
  on public.simplified_imports (organization_id, plan_code, created_at desc)
  where plan_code is not null;
