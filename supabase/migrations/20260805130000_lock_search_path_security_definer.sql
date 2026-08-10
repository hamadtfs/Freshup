-- Lock search_path on SECURITY DEFINER helpers flagged by Munib / advisors.
-- Functions live in production but were never checked into migrations; ALTER
-- is sufficient and safer than recreating unknown bodies.
-- Apply manually — do not run from the agent.

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_latest_offer_time', 'get_service_hierarchy_v2')
  loop
    execute format(
      'alter function %s set search_path to public, pg_temp',
      r.sig
    );
    n := n + 1;
    raise notice 'set search_path on %', r.sig;
  end loop;

  if n = 0 then
    raise notice
      'No public.get_latest_offer_time / get_service_hierarchy_v2 found — nothing to alter';
  end if;
end $$;
