-- Track provider pause/resume during in-progress service so elapsed timers freeze for both parties.
alter table public.orders
  add column if not exists service_paused_at timestamptz,
  add column if not exists service_paused_total_seconds integer not null default 0;

comment on column public.orders.service_paused_at is
  'When set, the service timer is frozen at this timestamp until resumed.';
comment on column public.orders.service_paused_total_seconds is
  'Accumulated active-service seconds lost to pauses before the current pause.';
