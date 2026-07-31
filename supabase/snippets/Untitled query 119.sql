select column_name
from information_schema.columns
where table_schema='public'
  and table_name='provider_skills'
  and column_name in (
    'provider_id',
    'mode_id',
    'target_id',
    'category_id',
    'service_id',
    'service_mode_id'
  )
order by column_name;
