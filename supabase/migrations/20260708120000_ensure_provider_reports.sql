-- Ensure provider_reports exists (may be missing on hosted DBs that skipped blueprint).
CREATE TABLE IF NOT EXISTS public.provider_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  category text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_reports_status_check CHECK (
    status = ANY (ARRAY['open', 'reviewing', 'resolved', 'dismissed']::text[])
  )
);

CREATE INDEX IF NOT EXISTS idx_provider_reports_reporter
  ON public.provider_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_provider_reports_provider
  ON public.provider_reports (provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_reports_order
  ON public.provider_reports (order_id);

CREATE TABLE IF NOT EXISTS public.report_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.provider_reports (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  action text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_actions_report
  ON public.report_actions (report_id);

ALTER TABLE public.provider_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'provider_reports'
      AND policyname = 'Users manage own reports'
  ) THEN
    CREATE POLICY "Users manage own reports"
      ON public.provider_reports
      FOR ALL
      USING (reporter_id = auth.uid())
      WITH CHECK (reporter_id = auth.uid());
  END IF;
END $$;

GRANT ALL ON TABLE public.provider_reports TO anon;
GRANT ALL ON TABLE public.provider_reports TO authenticated;
GRANT ALL ON TABLE public.provider_reports TO service_role;

GRANT ALL ON TABLE public.report_actions TO anon;
GRANT ALL ON TABLE public.report_actions TO authenticated;
GRANT ALL ON TABLE public.report_actions TO service_role;
