update public.production_orders
   set target_quantity = regexp_replace(
         coalesce(source_data ->> 'pc', ''),
         '[^0-9]', '', 'g'
       )::integer
 where target_quantity is null
   and nullif(
         regexp_replace(coalesce(source_data ->> 'pc', ''), '[^0-9]', '', 'g'),
         ''
       ) is not null
   and regexp_replace(
         coalesce(source_data ->> 'pc', ''),
         '[^0-9]', '', 'g'
       )::bigint > 0;
