-- Point #2 alignment migration:
-- Add naming-compatible tables/views and provider skill structure expected by task brief.

-- 1) Service modes (home/provider/both)
CREATE TABLE IF NOT EXISTS public.service_modes (
  id text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.service_modes (id, label)
VALUES
  ('home', 'Home Service'),
  ('provider', 'At Provider'),
  ('both', 'Both')
ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label;

ALTER TABLE public.service_modes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read service modes" ON public.service_modes;
CREATE POLICY "Anyone can read service modes"
  ON public.service_modes
  FOR SELECT
  USING (true);

GRANT SELECT ON public.service_modes TO anon, authenticated;
GRANT ALL ON public.service_modes TO service_role;

-- 2) Enrich provider_skills with explicit FK columns used in requirement mapping
ALTER TABLE public.provider_skills
  ADD COLUMN IF NOT EXISTS mode_id text,
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS category_id text,
  ADD COLUMN IF NOT EXISTS service_mode_id text;

-- Backfill relation columns from selected service
UPDATE public.provider_skills ps
SET
  mode_id = s.mode_id,
  target_id = s.target_id,
  category_id = s.category_id
FROM public.services s
WHERE s.id = ps.service_id
  AND (ps.mode_id IS NULL OR ps.target_id IS NULL OR ps.category_id IS NULL);

ALTER TABLE public.provider_skills
  ADD CONSTRAINT provider_skills_mode_id_fkey
    FOREIGN KEY (mode_id) REFERENCES public.modes(id) ON DELETE SET NULL;

ALTER TABLE public.provider_skills
  ADD CONSTRAINT provider_skills_target_id_fkey
    FOREIGN KEY (target_id) REFERENCES public.targets(id) ON DELETE SET NULL;

ALTER TABLE public.provider_skills
  ADD CONSTRAINT provider_skills_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL;

ALTER TABLE public.provider_skills
  ADD CONSTRAINT provider_skills_service_mode_id_fkey
    FOREIGN KEY (service_mode_id) REFERENCES public.service_modes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_skills_mode_id ON public.provider_skills(mode_id);
CREATE INDEX IF NOT EXISTS idx_provider_skills_target_id ON public.provider_skills(target_id);
CREATE INDEX IF NOT EXISTS idx_provider_skills_category_id ON public.provider_skills(category_id);
CREATE INDEX IF NOT EXISTS idx_provider_skills_service_mode_id ON public.provider_skills(service_mode_id);

-- 3) Explicit provider services mapping table (as required brief structure)
CREATE TABLE IF NOT EXISTS public.provider_service_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode_id text NOT NULL REFERENCES public.modes(id) ON DELETE CASCADE,
  service_target text NOT NULL REFERENCES public.targets(id) ON DELETE CASCADE,
  category_id text NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  services text[] NOT NULL DEFAULT '{}'::text[],
  service_mode_id text NOT NULL REFERENCES public.service_modes(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_service_profiles_unique UNIQUE (user_id, mode_id, service_target, category_id, service_mode_id)
);

ALTER TABLE public.provider_service_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Providers manage own service profiles" ON public.provider_service_profiles;
CREATE POLICY "Providers manage own service profiles"
  ON public.provider_service_profiles
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_service_profiles TO authenticated;
GRANT ALL ON public.provider_service_profiles TO service_role;

-- 4) Naming-compatibility views for presentation/demo
CREATE OR REPLACE VIEW public.service_targets AS
SELECT * FROM public.targets;

CREATE OR REPLACE VIEW public.category_services AS
SELECT * FROM public.services;

CREATE OR REPLACE VIEW public.jobs AS
SELECT * FROM public.orders;

CREATE OR REPLACE VIEW public.job_events AS
SELECT * FROM public.order_events;

CREATE OR REPLACE VIEW public.support_chat AS
SELECT * FROM public.conversations WHERE conversation_type = 'support';

CREATE OR REPLACE VIEW public.customer_provider_chat AS
SELECT * FROM public.conversations WHERE conversation_type IN ('order', 'direct');
