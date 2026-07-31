-- Remove legacy provider state structures after canonicalizing provider data in provider_details.
-- Provider service taxonomy is now canonical in provider_skills.

DROP VIEW IF EXISTS public.provider_profiles;

DROP TABLE IF EXISTS public.provider_presence;
