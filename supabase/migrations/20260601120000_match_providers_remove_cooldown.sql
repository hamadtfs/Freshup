-- Remove winner cooldown / deprioritization from match_providers.
-- Providers who just finished or accepted a job are ranked like everyone else
-- (distance, then rating). Busy / ready-for-next rules are unchanged.

DROP FUNCTION IF EXISTS public.match_providers(
  text, text, text, text, text, double precision, double precision, timestamptz
);
DROP FUNCTION IF EXISTS public.match_providers(
  text, text, text, text, text, double precision, double precision, timestamptz,
  double precision, double precision, text
);

CREATE OR REPLACE FUNCTION public.match_providers(
  p_mode_id text,
  p_target_id text,
  p_category_id text,
  p_service_id text,
  p_service_mode_id text,
  p_customer_lat double precision,
  p_customer_lng double precision,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_max_distance_km double precision DEFAULT 10.0,
  p_min_rating double precision DEFAULT 2.0,
  p_performance_tier text DEFAULT NULL
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
    p_scheduled_at AS scheduled_at,
    COALESCE(p_max_distance_km, 10.0) AS max_distance_km,
    COALESCE(p_min_rating, 2.0) AS min_rating,
    NULLIF(lower(trim(COALESCE(p_performance_tier, ''))), '') AS performance_tier
),
strict_candidates AS (
  SELECT DISTINCT ps.provider_id
  FROM public.provider_skills ps
  JOIN req r ON true
  WHERE ps.service_id = r.service_id
    AND COALESCE(ps.is_active, true) = true
    AND COALESCE(ps.available_now, true) = true
    AND (ps.mode_id IS NULL OR ps.mode_id = r.mode_id)
    AND (ps.target_id IS NULL OR ps.target_id = r.target_id)
    AND (ps.category_id IS NULL OR ps.category_id = r.category_id)
    AND (
      ps.service_mode_id IS NULL
      OR ps.service_mode_id = 'both'
      OR r.service_mode_id = 'both'
      OR ps.service_mode_id = r.service_mode_id
    )
),
online_candidates AS (
  SELECT sc.provider_id
  FROM strict_candidates sc
  JOIN public.provider_details pd ON pd.id = sc.provider_id
  WHERE COALESCE(pd.is_online, false) = true
    AND (
      (SELECT performance_tier FROM req) IS NULL
      OR coalesce(
          nullif(lower(trim(pd.dispatch_performance_tier)), ''),
          'gold'
        ) = (SELECT performance_tier FROM req)
    )
),
provider_points AS (
  SELECT
    oc.provider_id,
    pd.lat::double precision AS provider_lat,
    pd.lng::double precision AS provider_lng
  FROM online_candidates oc
  JOIN public.provider_details pd ON pd.id = oc.provider_id
),
distance_candidates AS (
  SELECT
    pp.provider_id,
    CASE
      WHEN pp.provider_lat IS NOT NULL AND pp.provider_lng IS NOT NULL THEN (
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
      )::double precision
      WHEN r.service_mode_id IN ('provider', 'both') THEN 0.0::double precision
      ELSE NULL::double precision
    END AS distance_km
  FROM provider_points pp
  JOIN req r ON true
  WHERE
    (pp.provider_lat IS NOT NULL AND pp.provider_lng IS NOT NULL)
    OR r.service_mode_id IN ('provider', 'both')
),
with_ratings AS (
  SELECT
    dc.provider_id,
    dc.distance_km,
    COALESCE(MAX(ps.competence_rating)::double precision, 0.0) AS service_rating
  FROM distance_candidates dc
  JOIN req r ON true
  LEFT JOIN public.provider_skills ps
    ON ps.provider_id = dc.provider_id
   AND ps.service_id = r.service_id
   AND COALESCE(ps.is_active, true) = true
   AND COALESCE(ps.available_now, true) = true
   AND (ps.mode_id IS NULL OR ps.mode_id = r.mode_id)
   AND (ps.target_id IS NULL OR ps.target_id = r.target_id)
   AND (ps.category_id IS NULL OR ps.category_id = r.category_id)
   AND (
     ps.service_mode_id IS NULL
     OR ps.service_mode_id = 'both'
     OR r.service_mode_id = 'both'
     OR ps.service_mode_id = r.service_mode_id
   )
  WHERE dc.distance_km IS NOT NULL
    AND dc.distance_km <= r.max_distance_km
  GROUP BY dc.provider_id, dc.distance_km
),
available_candidates AS (
  SELECT wr.*
  FROM with_ratings wr
  JOIN req r ON true
  WHERE wr.service_rating >= r.min_rating
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders o
      LEFT JOIN public.services s2 ON s2.id = o.service_id
      WHERE o.provider_id = wr.provider_id
        AND (
          o.status IN ('assigned', 'en_route')
          OR (
            o.status = 'in_progress'
            AND o.ready_for_next_request_at IS NULL
          )
        )
        AND (
          r.scheduled_at IS NULL
          OR
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
  SELECT *
  FROM public.match_providers(
    p_mode_id,
    p_target_id,
    p_category_id,
    p_service_id,
    p_service_mode_id,
    p_customer_lat,
    p_customer_lng,
    p_scheduled_at,
    10.0,
    2.0,
    NULL
  );
$$;

COMMENT ON FUNCTION public.match_providers(
  text, text, text, text, text,
  double precision, double precision,
  timestamptz, double precision, double precision, text
) IS
  'Match online providers by skill, distance, rating, and performance tier.
   Busy providers are excluded unless orders.ready_for_next_request_at is set.
   No post-job cooldown or deprioritization.';

GRANT EXECUTE ON FUNCTION public.match_providers(
  text, text, text, text, text, double precision, double precision, timestamptz,
  double precision, double precision, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.match_providers(
  text, text, text, text, text, double precision, double precision, timestamptz
) TO anon, authenticated, service_role;
