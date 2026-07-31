-- 2) Provider service profile mapping (mode/target/category/services)
-- 4) Provider details/profile check
select id, business_name, phone, delivery_modes, created_at
from public.provider_details
order by created_at desc
limit 20;