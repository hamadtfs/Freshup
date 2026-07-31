-- provider_service_profiles is no longer used after migrating matching and onboarding
-- to provider_skills as the canonical provider service mapping table.

DROP TABLE IF EXISTS public.provider_service_profiles;
