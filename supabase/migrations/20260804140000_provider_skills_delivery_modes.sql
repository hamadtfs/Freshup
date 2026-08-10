-- Per-service delivery modes (spec): providers declare home / at_provider per skill.
-- Matching now uses provider_skills.service_mode_id — see
-- 20260804150000_match_providers_skill_service_mode.sql.
-- Apply manually — do not run from the agent.

alter table public.provider_skills
  add column if not exists offers_home boolean not null default true,
  add column if not exists offers_at_provider boolean not null default true;

comment on column public.provider_skills.offers_home is
  'Provider will travel to the customer for this service';
comment on column public.provider_skills.offers_at_provider is
  'Customer can come to the provider for this service';
