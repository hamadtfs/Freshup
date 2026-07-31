


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."app_mode" AS ENUM (
    'beauty',
    'vehicle',
    'pet',
    'home_service',
    'health'
);


ALTER TYPE "public"."app_mode" OWNER TO "postgres";


CREATE TYPE "public"."delivery_mode" AS ENUM (
    'home',
    'at_provider',
    'both'
);


ALTER TYPE "public"."delivery_mode" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'pending',
    'offered',
    'accepted',
    'en_route',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_matching_providers"("p_service_id" "text", "p_customer_lat" numeric, "p_customer_lng" numeric, "p_max_distance_km" integer DEFAULT 15) RETURNS TABLE("provider_id" "uuid", "business_name" "text", "avg_rating" numeric, "distance_km" numeric, "competence_rating" integer)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    pd.id,
    pd.business_name,
    pd.avg_rating,
    ROUND(CAST(
      (
        6371 * acos(
          cos(radians(p_customer_lat)) *
          cos(radians(pd.lat)) *
          cos(radians(pd.lng) - radians(p_customer_lng)) +
          sin(radians(p_customer_lat)) *
          sin(radians(pd.lat))
        )
      ) AS NUMERIC
    ), 2) as distance_km,
    ps.competence_rating
  FROM
    provider_details pd
    JOIN provider_skills ps ON pd.id = ps.provider_id
  WHERE
    ps.service_id = p_service_id
    AND pd.is_online = TRUE
    AND ps.is_active = TRUE
    AND (
      6371 * acos(
        cos(radians(p_customer_lat)) *
        cos(radians(pd.lat)) *
        cos(radians(pd.lng) - radians(p_customer_lng)) +
        sin(radians(p_customer_lat)) *
        sin(radians(pd.lat))
      )
    ) <= p_max_distance_km
  ORDER BY
    distance_km ASC,
    pd.avg_rating DESC,
    ps.competence_rating DESC
  LIMIT 20;
END;
$$;


ALTER FUNCTION "public"."find_matching_providers"("p_service_id" "text", "p_customer_lat" numeric, "p_customer_lng" numeric, "p_max_distance_km" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "text" NOT NULL,
    "mode_id" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_details" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "phone" "text",
    "default_address" "text",
    "default_lat" numeric(10,8),
    "default_lng" numeric(11,8),
    "stripe_customer_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."customer_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."modes" (
    "id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."modes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "actor_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."order_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "offered_price" integer,
    "provider_distance_km" numeric(5,2),
    "expires_at" timestamp with time zone NOT NULL,
    "responded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "order_offers_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."order_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "provider_id" "uuid",
    "service_id" "text" NOT NULL,
    "status" "public"."order_status" DEFAULT 'pending'::"public"."order_status",
    "delivery_mode" "text" NOT NULL,
    "customer_lat" numeric(10,8),
    "customer_lng" numeric(11,8),
    "customer_address" "text",
    "scheduled_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "price" integer,
    "currency" "text" DEFAULT 'NOK'::"text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "orders_delivery_mode_check" CHECK (("delivery_mode" = ANY (ARRAY['home'::"text", 'at_provider'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "category_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."provider_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_details" (
    "id" "uuid" NOT NULL,
    "business_name" "text",
    "description" "text",
    "phone" "text",
    "address" "text",
    "lat" numeric(10,8),
    "lng" numeric(11,8),
    "radius_km" integer DEFAULT 10,
    "delivery_modes" "text"[] DEFAULT ARRAY['home'::"text", 'at_provider'::"text"],
    "is_online" boolean DEFAULT false,
    "last_online_at" timestamp with time zone,
    "stripe_account_id" "text",
    "stripe_onboarded" boolean DEFAULT false,
    "avg_rating" numeric(3,2) DEFAULT 0,
    "total_ratings" integer DEFAULT 0,
    "total_jobs" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."provider_details" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_modes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "mode_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."provider_modes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_skills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "service_id" "text" NOT NULL,
    "competence_rating" integer NOT NULL,
    "custom_duration_minutes" integer,
    "custom_price" integer,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "provider_skills_competence_rating_check" CHECK ((("competence_rating" >= 1) AND ("competence_rating" <= 5)))
);


ALTER TABLE "public"."provider_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_id" "uuid" NOT NULL,
    "target_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."provider_targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ratings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "rater_id" "uuid" NOT NULL,
    "ratee_id" "uuid" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "ratings_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."ratings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "text" NOT NULL,
    "mode_id" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "category_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "duration_minutes" integer NOT NULL,
    "base_price_min" integer,
    "base_price_max" integer,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."targets" (
    "id" "text" NOT NULL,
    "mode_id" "text" NOT NULL,
    "label" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."targets" OWNER TO "postgres";


ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customer_details"
    ADD CONSTRAINT "customer_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."modes"
    ADD CONSTRAINT "modes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_offers"
    ADD CONSTRAINT "order_offers_order_id_provider_id_key" UNIQUE ("order_id", "provider_id");



ALTER TABLE ONLY "public"."order_offers"
    ADD CONSTRAINT "order_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_categories"
    ADD CONSTRAINT "provider_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_categories"
    ADD CONSTRAINT "provider_categories_provider_id_category_id_key" UNIQUE ("provider_id", "category_id");



ALTER TABLE ONLY "public"."provider_details"
    ADD CONSTRAINT "provider_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_modes"
    ADD CONSTRAINT "provider_modes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_modes"
    ADD CONSTRAINT "provider_modes_provider_id_mode_id_key" UNIQUE ("provider_id", "mode_id");



ALTER TABLE ONLY "public"."provider_skills"
    ADD CONSTRAINT "provider_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_skills"
    ADD CONSTRAINT "provider_skills_provider_id_service_id_key" UNIQUE ("provider_id", "service_id");



ALTER TABLE ONLY "public"."provider_targets"
    ADD CONSTRAINT "provider_targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_targets"
    ADD CONSTRAINT "provider_targets_provider_id_target_id_key" UNIQUE ("provider_id", "target_id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_order_id_rater_id_key" UNIQUE ("order_id", "rater_id");



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."targets"
    ADD CONSTRAINT "targets_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_categories_mode_target" ON "public"."categories" USING "btree" ("mode_id", "target_id");



CREATE INDEX "idx_order_events_order" ON "public"."order_events" USING "btree" ("order_id");



CREATE INDEX "idx_order_offers_order" ON "public"."order_offers" USING "btree" ("order_id");



CREATE INDEX "idx_order_offers_provider" ON "public"."order_offers" USING "btree" ("provider_id");



CREATE INDEX "idx_orders_customer" ON "public"."orders" USING "btree" ("customer_id");



CREATE INDEX "idx_orders_provider" ON "public"."orders" USING "btree" ("provider_id");



CREATE INDEX "idx_orders_status" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "idx_provider_details_location" ON "public"."provider_details" USING "btree" ("lat", "lng");



CREATE INDEX "idx_provider_details_online" ON "public"."provider_details" USING "btree" ("is_online") WHERE ("is_online" = true);



CREATE INDEX "idx_provider_skills_provider" ON "public"."provider_skills" USING "btree" ("provider_id");



CREATE INDEX "idx_provider_skills_service" ON "public"."provider_skills" USING "btree" ("service_id");



CREATE INDEX "idx_services_category" ON "public"."services" USING "btree" ("category_id");



CREATE INDEX "idx_services_mode_target" ON "public"."services" USING "btree" ("mode_id", "target_id");



CREATE INDEX "idx_targets_mode" ON "public"."targets" USING "btree" ("mode_id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "public"."modes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."customer_details"
    ADD CONSTRAINT "customer_details_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."order_events"
    ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_offers"
    ADD CONSTRAINT "order_offers_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_offers"
    ADD CONSTRAINT "order_offers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_details"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_categories"
    ADD CONSTRAINT "provider_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_categories"
    ADD CONSTRAINT "provider_categories_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_details"
    ADD CONSTRAINT "provider_details_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_modes"
    ADD CONSTRAINT "provider_modes_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "public"."modes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_modes"
    ADD CONSTRAINT "provider_modes_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_skills"
    ADD CONSTRAINT "provider_skills_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_skills"
    ADD CONSTRAINT "provider_skills_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_targets"
    ADD CONSTRAINT "provider_targets_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_details"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_targets"
    ADD CONSTRAINT "provider_targets_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_ratee_id_fkey" FOREIGN KEY ("ratee_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ratings"
    ADD CONSTRAINT "ratings_rater_id_fkey" FOREIGN KEY ("rater_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "public"."modes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."targets"
    ADD CONSTRAINT "targets_mode_id_fkey" FOREIGN KEY ("mode_id") REFERENCES "public"."modes"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can read categories" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Anyone can read modes" ON "public"."modes" FOR SELECT USING (true);



CREATE POLICY "Anyone can read services" ON "public"."services" FOR SELECT USING (true);



CREATE POLICY "Anyone can read targets" ON "public"."targets" FOR SELECT USING (true);



CREATE POLICY "Customers can create orders" ON "public"."orders" FOR INSERT WITH CHECK (("auth"."uid"() = "customer_id"));



CREATE POLICY "Customers can insert own details" ON "public"."customer_details" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Customers can read own details" ON "public"."customer_details" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Customers can update own details" ON "public"."customer_details" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Customers can view own orders" ON "public"."orders" FOR SELECT USING (("auth"."uid"() = "customer_id"));



CREATE POLICY "Providers can insert own details" ON "public"."provider_details" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Providers can manage own categories" ON "public"."provider_categories" USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can manage own modes" ON "public"."provider_modes" USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can manage own skills" ON "public"."provider_skills" USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can manage own targets" ON "public"."provider_targets" USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can read own details" ON "public"."provider_details" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Providers can update assigned orders" ON "public"."orders" FOR UPDATE USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can update own details" ON "public"."provider_details" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Providers can update own offers" ON "public"."order_offers" FOR UPDATE USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can view assigned orders" ON "public"."orders" FOR SELECT USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Providers can view own offers" ON "public"."order_offers" FOR SELECT USING (("auth"."uid"() = "provider_id"));



CREATE POLICY "Users can create ratings for own orders" ON "public"."ratings" FOR INSERT WITH CHECK (("auth"."uid"() = "rater_id"));



CREATE POLICY "Users can view ratings" ON "public"."ratings" FOR SELECT USING (true);



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."modes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_details" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_modes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_targets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ratings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."targets" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."find_matching_providers"("p_service_id" "text", "p_customer_lat" numeric, "p_customer_lng" numeric, "p_max_distance_km" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."find_matching_providers"("p_service_id" "text", "p_customer_lat" numeric, "p_customer_lng" numeric, "p_max_distance_km" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_matching_providers"("p_service_id" "text", "p_customer_lat" numeric, "p_customer_lng" numeric, "p_max_distance_km" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";


















GRANT ALL ON TABLE "public"."categories" TO "anon";
GRANT ALL ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT ALL ON TABLE "public"."customer_details" TO "anon";
GRANT ALL ON TABLE "public"."customer_details" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_details" TO "service_role";



GRANT ALL ON TABLE "public"."modes" TO "anon";
GRANT ALL ON TABLE "public"."modes" TO "authenticated";
GRANT ALL ON TABLE "public"."modes" TO "service_role";



GRANT ALL ON TABLE "public"."order_events" TO "anon";
GRANT ALL ON TABLE "public"."order_events" TO "authenticated";
GRANT ALL ON TABLE "public"."order_events" TO "service_role";



GRANT ALL ON TABLE "public"."order_offers" TO "anon";
GRANT ALL ON TABLE "public"."order_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."order_offers" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."provider_categories" TO "anon";
GRANT ALL ON TABLE "public"."provider_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_categories" TO "service_role";



GRANT ALL ON TABLE "public"."provider_details" TO "anon";
GRANT ALL ON TABLE "public"."provider_details" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_details" TO "service_role";



GRANT ALL ON TABLE "public"."provider_modes" TO "anon";
GRANT ALL ON TABLE "public"."provider_modes" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_modes" TO "service_role";



GRANT ALL ON TABLE "public"."provider_skills" TO "anon";
GRANT ALL ON TABLE "public"."provider_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_skills" TO "service_role";



GRANT ALL ON TABLE "public"."provider_targets" TO "anon";
GRANT ALL ON TABLE "public"."provider_targets" TO "authenticated";
GRANT ALL ON TABLE "public"."provider_targets" TO "service_role";



GRANT ALL ON TABLE "public"."ratings" TO "anon";
GRANT ALL ON TABLE "public"."ratings" TO "authenticated";
GRANT ALL ON TABLE "public"."ratings" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."targets" TO "anon";
GRANT ALL ON TABLE "public"."targets" TO "authenticated";
GRANT ALL ON TABLE "public"."targets" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































drop extension if exists "pg_net";


