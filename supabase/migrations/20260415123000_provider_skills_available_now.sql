-- Separate temporary dashboard availability from persisted skill registration.
-- is_active keeps "provider has this skill"; available_now controls live matching eligibility.

alter table public.provider_skills
add column if not exists available_now boolean;

update public.provider_skills
set available_now = coalesce(is_active, true)
where available_now is null;

alter table public.provider_skills
alter column available_now set default true;

alter table public.provider_skills
alter column available_now set not null;

create index if not exists idx_provider_skills_available_now
  on public.provider_skills(provider_id, service_id, available_now);
