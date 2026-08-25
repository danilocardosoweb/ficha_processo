-- Simplificada ativa = programacao disponivel para o operador.
alter table public.simplified_imports
  add column if not exists is_active boolean not null default true;

alter table public.production_orders
  add column if not exists is_active boolean not null default true,
  add column if not exists demand_unit text not null default 'kg';

alter table public.production_orders
  alter column target_kg drop not null;

alter table public.production_orders
  drop constraint if exists production_orders_target_kg_check;
alter table public.production_orders
  add constraint production_orders_target_kg_check
  check (target_kg is null or target_kg > 0);

alter table public.production_orders
  drop constraint if exists production_orders_demand_unit_check;
alter table public.production_orders
  add constraint production_orders_demand_unit_check
  check (demand_unit in ('kg', 'pieces', 'bars'));

alter table public.production_orders
  drop constraint if exists production_orders_target_by_unit_check;
alter table public.production_orders
  add constraint production_orders_target_by_unit_check
  check (
    (demand_unit = 'kg' and target_kg is not null and target_kg > 0)
    or
    (demand_unit in ('pieces', 'bars') and target_quantity is not null and target_quantity > 0)
  );

create index if not exists simplified_imports_active_idx
  on public.simplified_imports (organization_id, is_active, created_at desc);

create index if not exists production_orders_active_planning_idx
  on public.production_orders (organization_id, is_active, status, machine_code, sequence);
