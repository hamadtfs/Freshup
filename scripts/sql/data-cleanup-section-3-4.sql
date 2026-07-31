-- Data cleanup for Pricing & Tier System Spec §3.4
--
-- ⚠️  REVIEW ONLY. Do NOT auto-apply via migrations.
--     Execution policy: this file is run manually by the project owner
--     (Supabase SQL Editor) after the rows have been inspected.
--
-- What this script does:
--   1. Lists the orphan / mis-seeded service rows that were observed in
--      the live `quote-bulk` API response (`bob`, `air_filter`, plus
--      three UUID-keyed services duplicating `skin_fade`, `low_fade`,
--      `mid_fade`).
--   2. Verifies the rows are not referenced by `provider_offered_services`,
--      `orders`, or `provider_price_inputs` (so deleting them is safe).
--   3. Deletes them.
--
-- Run the SELECT blocks first to confirm the rows look right, then run
-- the DELETE block.
--
-- ───────────────────────────────────────────────────────────────────────
-- Step 1 · Inspect the rows we plan to delete
-- ───────────────────────────────────────────────────────────────────────

select id, name, mode_id, target_id, category_id, base_price_min, base_price_max
from public.services
where id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
)
order by id;

-- ───────────────────────────────────────────────────────────────────────
-- Step 2 · Reference checks (each query MUST return 0 rows before delete)
-- ───────────────────────────────────────────────────────────────────────

-- 2a) Orders referencing any of these service ids
select count(*) as orders_referencing_target_services
from public.orders
where service_id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

-- 2b) Provider offered services referencing any of these service ids
select count(*) as provider_offered_services_referencing_target_services
from public.provider_offered_services
where service_id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

-- 2c) Provider price inputs referencing any of these service ids
select count(*) as provider_price_inputs_referencing_target_services
from public.provider_price_inputs
where service_id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

-- 2d) Area base prices referencing any of these service ids
select count(*) as area_base_prices_referencing_target_services
from public.area_base_prices
where service_id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

-- ───────────────────────────────────────────────────────────────────────
-- Step 3 · Delete the orphan rows  (run only if all 4 checks above are 0)
-- ───────────────────────────────────────────────────────────────────────

-- Wrap in a transaction so the whole delete is atomic.
begin;

-- Defensive: also clean any orphan provider_price_inputs rows that may
-- have been seeded for these service ids (won't fail if there are none).
delete from public.provider_price_inputs
where service_id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

delete from public.area_base_prices
where service_id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

delete from public.services
where id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);

commit;

-- ───────────────────────────────────────────────────────────────────────
-- Step 4 · Post-delete verification
-- ───────────────────────────────────────────────────────────────────────

select count(*) as remaining_target_services
from public.services
where id in (
  'bob',
  'air_filter',
  'fe2bd997-9e4e-4760-ac65-891e67ca21e4',
  '959deeda-39b6-4503-a154-5f44a7584e27',
  '07fbf8e4-2e9c-4b61-a807-aaaebaf9421b'
);
-- Expected: 0
