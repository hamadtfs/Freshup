-- Munib 6 Aug: delivery mode is per service (provider_skills.service_mode_id).
-- Drop provider_details.accepting_delivery_mode; backfill any remaining null skill modes.
-- Apply manually — do not run from the agent.

-- Remaining nulls → both (matching already treats null as both; make column authoritative).
update public.provider_skills
set service_mode_id = 'both'
where service_mode_id is null;

update public.provider_skills
set
  offers_home = service_mode_id in ('home', 'both'),
  offers_at_provider = service_mode_id in ('provider', 'both')
where service_mode_id in ('home', 'provider', 'both');

alter table public.provider_details
  drop column if exists accepting_delivery_mode;

comment on column public.provider_details.delivery_modes is
  'Legacy capability array. Matching uses provider_skills.service_mode_id only.';
