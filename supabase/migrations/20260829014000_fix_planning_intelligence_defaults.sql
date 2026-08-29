begin;

alter table public.planning_intelligence_settings
  alter column thermal_weight set default 15,
  alter column resource_weight set default 20,
  alter column material_weight set default 20,
  alter column delivery_weight set default 10,
  alter column flow_weight set default 10,
  alter column hole_sequence_weight set default 10,
  alter column short_run_weight set default 15;

comment on constraint planning_intelligence_weights_total on public.planning_intelligence_settings is
  'Os sete critérios da nota AluPilot devem totalizar exatamente 100%. Os defaults também respeitam essa soma.';

commit;
