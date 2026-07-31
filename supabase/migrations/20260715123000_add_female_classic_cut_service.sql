-- Female Classic Cut exists in the app catalog (`classic-cut-f`) but was never
-- seeded in `public.services`. Pricing falls back to services.base_price_* when
-- area aggregates are inactive; without a row that yields PRICE_UNAVAILABLE
-- (and the demand chip stuck on "Loading prices…").
--
-- Mirror hierarchy from an existing female haircut sibling (layers_f / bob_f / …)
-- so this works whether category ids are slug- or UUID-based.

insert into public.services (
  id,
  mode_id,
  target_id,
  category_id,
  name,
  description,
  duration_minutes,
  base_price_min,
  base_price_max,
  sort_order,
  is_active
)
select
  'classic_cut_f',
  s.mode_id,
  s.target_id,
  s.category_id,
  'Classic Cut',
  'Classic women''s haircut with styling',
  45,
  450,
  550,
  0,
  true
from public.services s
where s.id in ('layers_f', 'bob_f', 'pixie_f', 'trim_f')
order by case s.id
  when 'layers_f' then 1
  when 'bob_f' then 2
  when 'pixie_f' then 3
  else 4
end
limit 1
on conflict (id) do update
set
  mode_id = excluded.mode_id,
  target_id = excluded.target_id,
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  base_price_min = case
    when coalesce(public.services.base_price_min, 0) > 0
      then public.services.base_price_min
    else excluded.base_price_min
  end,
  base_price_max = case
    when coalesce(public.services.base_price_max, 0) > 0
      then public.services.base_price_max
    else excluded.base_price_max
  end,
  is_active = true;
