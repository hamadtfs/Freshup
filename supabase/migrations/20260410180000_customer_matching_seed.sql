-- Customer matching / booking dev seed (idempotent where possible).
-- Mirrors manual fixes applied for local API testing: skills hierarchy, sample add-on,
-- and one test-ready provider location for strict matchProviders() (see lib/customer/match-providers.ts).
--
-- Apply manually: supabase db push / your usual migration workflow (do not run from agent).

-- ---------------------------------------------------------------------------
-- 1) Backfill provider_skills hierarchy from public.services (legacy / partial rows)
-- ---------------------------------------------------------------------------

UPDATE public.provider_skills ps
SET
  mode_id = s.mode_id,
  target_id = s.target_id,
  category_id = s.category_id
FROM public.services s
WHERE ps.service_id = s.id
  AND COALESCE(ps.is_active, true) = true
  AND (
    ps.mode_id IS NULL
    OR ps.target_id IS NULL
    OR ps.category_id IS NULL
  );

-- ---------------------------------------------------------------------------
-- 2) Sample add-on for GET /api/services/addons + POST /api/orders/book tests
-- ---------------------------------------------------------------------------

INSERT INTO public.service_addons (service_id, name, description, extra_price, extra_minutes, is_active)
SELECT
  'skin-fade',
  'Beard trim (sample)',
  'Test add-on for customer booking flow (safe to delete in production).',
  150,
  10,
  true
WHERE EXISTS (SELECT 1 FROM public.services s WHERE s.id = 'skin-fade')
  AND NOT EXISTS (
    SELECT 1
    FROM public.service_addons sa
    WHERE sa.service_id = 'skin-fade'
      AND sa.name = 'Beard trim (sample)'
  );

-- ---------------------------------------------------------------------------
-- 3) Dev provider: online + Oslo-ish coordinates for providers who offer
--    beauty / male / haircut / home via provider_service_profiles but have no lat/lng yet.
--    Skips rows that already have coordinates (no prod overwrite).
-- ---------------------------------------------------------------------------

UPDATE public.provider_details pd
SET
  is_online = true,
  lat = 59.91400000,
  lng = 10.75300000,
  radius_km = COALESCE(pd.radius_km, 10),
  updated_at = now()
FROM public.provider_service_profiles psp
WHERE pd.id = psp.user_id
  AND psp.mode_id = 'beauty'
  AND psp.service_target = 'male'
  AND psp.category_id = 'haircut'
  AND psp.service_mode_id = 'home'
  AND pd.lat IS NULL
  AND pd.lng IS NULL;
