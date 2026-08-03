-- Expo push device tokens (one row per device installation / ExpoPushToken)

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL,
  app_role text,
  device_id text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT push_tokens_platform_check CHECK (
    platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])
  ),
  CONSTRAINT push_tokens_app_role_check CHECK (
    app_role IS NULL
    OR app_role = ANY (ARRAY['customer'::text, 'provider'::text])
  ),
  CONSTRAINT push_tokens_token_key UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
  ON public.push_tokens (user_id)
  WHERE is_active = true;

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'push_tokens'
      AND policyname = 'Users manage own push tokens'
  ) THEN
    CREATE POLICY "Users manage own push tokens"
      ON public.push_tokens
      FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

GRANT ALL ON TABLE public.push_tokens TO anon;
GRANT ALL ON TABLE public.push_tokens TO authenticated;
GRANT ALL ON TABLE public.push_tokens TO service_role;
