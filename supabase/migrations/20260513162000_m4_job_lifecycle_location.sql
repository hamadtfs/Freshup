-- M4 job lifecycle: canonical arrived status and timestamps.

alter type public.order_status add value if not exists 'arrived';

alter table public.orders
  add column if not exists en_route_at timestamptz,
  add column if not exists arrived_at timestamptz;

comment on column public.orders.en_route_at is
  'Set when assigned provider starts driving to the customer.';
comment on column public.orders.arrived_at is
  'Set when assigned provider marks arrival at the job location.';
