-- Canonical provider matching contract for customer booking flow.
-- Input: mode/target/category/service/service_mode/customer location (+ optional scheduled_at)
-- Output sorted by distance_km asc, then service_rating desc, within 10km only.

CREATE OR REPLACE FUNCTION public.match_providers(
  p_mode_id text,
  p_target_id text,
  p_category_id text,
  p_service_id text,
  p_service_mode_id text,
  p_customer_lat double precision,
  p_customer_lng double precision,
  p_scheduled_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  provider_id uuid,
  distance_km double precision,
  service_rating double precision,
  reason_codes text[],
  is_available boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
WITH req AS (
  SELECT
    p_mode_id AS mode_id,
    p_target_id AS target_id,
    p_category_id AS category_id,
    p_service_id AS service_id,
    p_service_mode_id AS service_mode_id,
    p_customer_lat AS customer_lat,
    p_customer_lng AS customer_lng,
    p_scheduled_at AS scheduled_at
),
strict_candidates AS (
  SELECT DISTINCT psp.user_id AS provider_id
  FROM public.provider_service_profiles psp
  JOIN req r ON true
  WHERE psp.mode_id = r.mode_id
    AND psp.service_target = r.target_id
    AND psp.category_id = r.category_id
    AND r.service_id = ANY(psp.services)
    AND (
      psp.service_mode_id = 'both'
      OR r.service_mode_id = 'both'
      OR psp.service_mode_id = r.service_mode_id
    )
),
online_candidates AS (
  SELECT sc.provider_id
  FROM strict_candidates sc
  JOIN public.provider_presence pp ON pp.provider_id = sc.provider_id
  WHERE pp.is_online = true
),
provider_points AS (
  SELECT
    oc.provider_id,
    COALESCE(rl.lat::double precision, pd.lat::double precision) AS provider_lat,
    COALESCE(rl.lng::double precision, pd.lng::double precision) AS provider_lng
  FROM online_candidates oc
  LEFT JOIN LATERAL (
    SELECT l.lat, l.lng
    FROM public.provider_realtime_locations l
    WHERE l.provider_id = oc.provider_id
    ORDER BY l.recorded_at DESC
    LIMIT 1
  ) rl ON true
  LEFT JOIN public.provider_details pd ON pd.id = oc.provider_id
),
distance_candidates AS (
  SELECT
    pp.provider_id,
    (
      6371.0 * acos(
        LEAST(
          1.0,
          GREATEST(
            -1.0,
            cos(radians(r.customer_lat)) * cos(radians(pp.provider_lat)) *
            cos(radians(pp.provider_lng) - radians(r.customer_lng)) +
            sin(radians(r.customer_lat)) * sin(radians(pp.provider_lat))
          )
        )
      )
    )::double precision AS distance_km
  FROM provider_points pp
  JOIN req r ON true
  WHERE pp.provider_lat IS NOT NULL AND pp.provider_lng IS NOT NULL
),
with_ratings AS (
  SELECT
    dc.provider_id,
    dc.distance_km,
    COALESCE(MAX(ps.competence_rating)::double precision, 0.0) AS service_rating
  FROM distance_candidates dc
  LEFT JOIN public.provider_skills ps
    ON ps.provider_id = dc.provider_id
   AND ps.service_id = (SELECT service_id FROM req)
   AND COALESCE(ps.is_active, true) = true
   AND (ps.mode_id IS NULL OR ps.mode_id = (SELECT mode_id FROM req))
   AND (ps.target_id IS NULL OR ps.target_id = (SELECT target_id FROM req))
   AND (ps.category_id IS NULL OR ps.category_id = (SELECT category_id FROM req))
   AND (
     ps.service_mode_id IS NULL
     OR ps.service_mode_id = 'both'
     OR (SELECT service_mode_id FROM req) = 'both'
     OR ps.service_mode_id = (SELECT service_mode_id FROM req)
   )
  WHERE dc.distance_km <= 10.0
  GROUP BY dc.provider_id, dc.distance_km
),
available_candidates AS (
  SELECT wr.*
  FROM with_ratings wr
  JOIN req r ON true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.orders o
    LEFT JOIN public.services s2 ON s2.id = o.service_id
    WHERE o.provider_id = wr.provider_id
      AND o.status IN ('accepted', 'en_route', 'in_progress')
      AND (
        -- ASAP: any active assignment blocks.
        r.scheduled_at IS NULL
        OR
        -- Scheduled: block only when time windows overlap.
        (
          r.scheduled_at IS NOT NULL
          AND (
            COALESCE(
              o.scheduled_at,
              o.started_at,
              o.accepted_at,
              o.created_at
            )
          ) < (
            r.scheduled_at + make_interval(mins => GREATEST(COALESCE((SELECT duration_minutes FROM public.services WHERE id = r.service_id), 60), 1))
          )
          AND
          (
            r.scheduled_at
          ) < (
            COALESCE(
              o.scheduled_at,
              o.started_at,
              o.accepted_at,
              o.created_at
            ) + make_interval(mins => GREATEST(COALESCE(s2.duration_minutes, 60), 1))
          )
        )
      )
  )
)
SELECT
  ac.provider_id,
  round(ac.distance_km::numeric, 3)::double precision AS distance_km,
  ac.service_rating,
  ARRAY[]::text[] AS reason_codes,
  true AS is_available
FROM available_candidates ac
ORDER BY ac.distance_km ASC, ac.service_rating DESC;
$$;

GRANT EXECUTE ON FUNCTION public.match_providers(
  text,
  text,
  text,
  text,
  text,
  double precision,
  double precision,
  timestamptz
) TO anon, authenticated, service_role;
