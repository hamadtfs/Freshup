-- Point #1 foundation: Supabase auth + basic RLS hardening
-- Keeps UI untouched; focuses on DB/auth behavior.

-- 1) Auto-create profile on every auth signup
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  customer_role_id uuid;
  provider_role_id uuid;
  picked_role_id uuid;
  app_role text;
BEGIN
  SELECT id INTO customer_role_id FROM public.roles WHERE slug = 'customer' LIMIT 1;
  SELECT id INTO provider_role_id FROM public.roles WHERE slug = 'provider' LIMIT 1;

  app_role := COALESCE(NEW.raw_user_meta_data ->> 'app_role', 'customer');
  picked_role_id := CASE WHEN app_role = 'provider' THEN provider_role_id ELSE customer_role_id END;

  INSERT INTO public.profiles (id, role_id, display_name, phone, email)
  VALUES (
    NEW.id,
    picked_role_id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.phone,
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE
  SET
    role_id = COALESCE(EXCLUDED.role_id, public.profiles.role_id),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    updated_at = now();

  IF app_role = 'provider' THEN
    INSERT INTO public.provider_details (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.customer_details (id)
    VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 2) Basic RLS policies (id-scoped), safe recreate
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Customers can read own details" ON public.customer_details;
DROP POLICY IF EXISTS "Customers can insert own details" ON public.customer_details;
DROP POLICY IF EXISTS "Customers can update own details" ON public.customer_details;
CREATE POLICY "Customers can read own details" ON public.customer_details
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Customers can insert own details" ON public.customer_details
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Customers can update own details" ON public.customer_details
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Providers can read own details" ON public.provider_details;
DROP POLICY IF EXISTS "Providers can insert own details" ON public.provider_details;
DROP POLICY IF EXISTS "Providers can update own details" ON public.provider_details;
CREATE POLICY "Providers can read own details" ON public.provider_details
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Providers can insert own details" ON public.provider_details
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Providers can update own details" ON public.provider_details
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
