-- FreshUp: tables from docs/supabase-table-blueprint.md (beyond 20260407191210_remote_schema.sql)

-- ---------------------------------------------------------------------------
-- 1) Identity: roles, profiles, provider_verifications
-- ---------------------------------------------------------------------------

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles (id) ON DELETE SET NULL,
  display_name text,
  phone text,
  email text,
  avatar_url text,
  preferred_language text,
  notification_opt_in boolean NOT NULL DEFAULT true,
  default_location_label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_preferred_language_check CHECK (
    preferred_language IS NULL OR preferred_language = ANY (ARRAY['no', 'en']::text[])
  )
);

CREATE TABLE public.provider_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  status text NOT NULL,
  document_type text,
  document_url text,
  reviewed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_verifications_status_check CHECK (
    status = ANY (ARRAY['pending', 'approved', 'rejected']::text[])
  )
);

CREATE INDEX idx_provider_verifications_provider ON public.provider_verifications (provider_id);

-- ---------------------------------------------------------------------------
-- 2) Service add-ons
-- ---------------------------------------------------------------------------

CREATE TABLE public.service_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id text NOT NULL REFERENCES public.services (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  extra_price integer NOT NULL,
  extra_minutes integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_addons_service ON public.service_addons (service_id);

-- ---------------------------------------------------------------------------
-- 3) Order extensions, matching, dispatch
-- ---------------------------------------------------------------------------

CREATE TABLE public.order_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  addon_id uuid NOT NULL REFERENCES public.service_addons (id) ON DELETE RESTRICT,
  unit_price integer NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_addons_order ON public.order_addons (order_id);

CREATE TABLE public.matching_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  input_payload jsonb,
  strategy_version text,
  started_at timestamptz,
  finished_at timestamptz,
  result_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matching_runs_order ON public.matching_runs (order_id);

CREATE TABLE public.matching_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matching_run_id uuid NOT NULL REFERENCES public.matching_runs (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  distance_km numeric(6, 3),
  skill_score numeric(6, 3),
  availability_score numeric(6, 3),
  rank integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matching_candidates_run ON public.matching_candidates (matching_run_id);

CREATE TABLE public.dispatch_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  batch_no integer NOT NULL,
  distance_limit_km numeric(5, 2),
  min_rating integer,
  duration_seconds integer NOT NULL DEFAULT 15,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispatch_batches_order ON public.dispatch_batches (order_id);

CREATE TABLE public.dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.dispatch_batches (id) ON DELETE CASCADE,
  attempt_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_attempts_status_check CHECK (
    attempt_status = ANY (
      ARRAY['sent', 'timeout', 'accepted', 'declined', 'skipped']::text[]
    )
  )
);

CREATE INDEX idx_dispatch_attempts_order ON public.dispatch_attempts (order_id);
CREATE INDEX idx_dispatch_attempts_batch ON public.dispatch_attempts (batch_id);

-- ---------------------------------------------------------------------------
-- 4) Presence and realtime
-- ---------------------------------------------------------------------------

CREATE TABLE public.provider_presence (
  provider_id uuid PRIMARY KEY REFERENCES public.provider_details (id) ON DELETE CASCADE,
  is_online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz,
  app_state text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_presence_app_state_check CHECK (
    app_state IS NULL OR app_state = ANY (ARRAY['foreground', 'background', 'offline']::text[])
  )
);

CREATE TABLE public.provider_realtime_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  lat numeric(10, 8) NOT NULL,
  lng numeric(11, 8) NOT NULL,
  heading numeric(5, 2),
  speed_mps numeric(6, 2),
  accuracy_m numeric(6, 2),
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_realtime_locations_provider ON public.provider_realtime_locations (provider_id);
CREATE INDEX idx_provider_realtime_locations_order ON public.provider_realtime_locations (order_id);

-- ---------------------------------------------------------------------------
-- 5) Trust and moderation
-- ---------------------------------------------------------------------------

CREATE TABLE public.provider_reports (
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

CREATE INDEX idx_provider_reports_reporter ON public.provider_reports (reporter_id);
CREATE INDEX idx_provider_reports_provider ON public.provider_reports (provider_id);

CREATE TABLE public.report_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.provider_reports (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  action text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_actions_report ON public.report_actions (report_id);

-- ---------------------------------------------------------------------------
-- 6) Payments
-- ---------------------------------------------------------------------------

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customer_details (id) ON DELETE CASCADE,
  kind text NOT NULL,
  provider text NOT NULL,
  provider_payment_method_id text,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_kind_check CHECK (
    kind = ANY (ARRAY['card', 'apple_pay', 'vipps']::text[])
  )
);

CREATE INDEX idx_payment_methods_customer ON public.payment_methods (customer_id);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customer_details (id) ON DELETE CASCADE,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'NOK',
  status text NOT NULL,
  provider text NOT NULL,
  provider_intent_id text,
  failure_reason text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_status_check CHECK (
    status = ANY (
      ARRAY[
        'requires_payment_method',
        'requires_confirmation',
        'requires_action',
        'processing',
        'succeeded',
        'failed',
        'refunded'
      ]::text[]
    )
  )
);

CREATE INDEX idx_payments_order ON public.payments (order_id);
CREATE INDEX idx_payments_customer ON public.payments (customer_id);

CREATE TABLE public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments (id) ON DELETE CASCADE,
  amount integer NOT NULL,
  reason text,
  provider_refund_id text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_status_check CHECK (status = ANY (ARRAY['pending', 'succeeded', 'failed']::text[]))
);

CREATE INDEX idx_refunds_payment ON public.refunds (payment_id);

CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'NOK',
  status text NOT NULL,
  provider_payout_id text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_status_check CHECK (
    status = ANY (ARRAY['pending', 'in_transit', 'paid', 'failed']::text[])
  )
);

CREATE INDEX idx_payouts_provider ON public.payouts (provider_id);

CREATE TABLE public.provider_earnings_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.provider_details (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  entry_type text NOT NULL,
  amount integer NOT NULL,
  currency text NOT NULL DEFAULT 'NOK',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_earnings_ledger_entry_type_check CHECK (
    entry_type = ANY (ARRAY['earning', 'adjustment', 'fee', 'refund']::text[])
  )
);

CREATE INDEX idx_provider_earnings_ledger_provider ON public.provider_earnings_ledger (provider_id);

-- ---------------------------------------------------------------------------
-- 7) Chat and support
-- ---------------------------------------------------------------------------

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_type text NOT NULL,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_type_check CHECK (
    conversation_type = ANY (ARRAY['order', 'support', 'direct']::text[])
  )
);

CREATE INDEX idx_conversations_order ON public.conversations (order_id);

CREATE TABLE public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles (id) ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT conversation_participants_unique UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_conversation_participants_conversation ON public.conversation_participants (conversation_id);
CREATE INDEX idx_conversation_participants_user ON public.conversation_participants (user_id);

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  message_type text NOT NULL DEFAULT 'text',
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation ON public.messages (conversation_id);
CREATE INDEX idx_messages_sent_at ON public.messages (conversation_id, sent_at);

CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_message_attachments_message ON public.message_attachments (message_id);

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders (id) ON DELETE SET NULL,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_tickets_status_check CHECK (
    status = ANY (ARRAY['open', 'in_progress', 'resolved', 'closed']::text[])
  ),
  CONSTRAINT support_tickets_priority_check CHECK (
    priority = ANY (ARRAY['low', 'normal', 'high', 'urgent']::text[])
  )
);

CREATE INDEX idx_support_tickets_user ON public.support_tickets (user_id);

CREATE TABLE public.support_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets (id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_ticket_events_ticket ON public.support_ticket_events (ticket_id);

-- ---------------------------------------------------------------------------
-- 8) Subscriptions (optional layer)
-- ---------------------------------------------------------------------------

CREATE TABLE public.plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text,
  price integer NOT NULL,
  currency text NOT NULL DEFAULT 'NOK',
  interval text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plans_interval_check CHECK (interval = ANY (ARRAY['month', 'year']::text[]))
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.plans (id) ON DELETE RESTRICT,
  status text NOT NULL,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_status_check CHECK (
    status = ANY (ARRAY['trialing', 'active', 'past_due', 'canceled']::text[])
  )
);

CREATE INDEX idx_subscriptions_profile ON public.subscriptions (profile_id);

CREATE TABLE public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.subscriptions (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscription_events_subscription ON public.subscription_events (subscription_id);

-- ---------------------------------------------------------------------------
-- Seed: canonical roles (slug values align with app / blueprint)
-- ---------------------------------------------------------------------------

INSERT INTO public.roles (slug, label, description, sort_order)
VALUES
  ('customer', 'Customer', 'Books services', 10),
  ('provider', 'Provider', 'Offers services', 20),
  ('admin', 'Admin', 'Internal administration', 30),
  ('support', 'Support', 'Customer and provider support', 40),
  ('system', 'System', 'Automated jobs and integrations', 50)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Grants (match existing migration pattern)
-- ---------------------------------------------------------------------------

GRANT ALL ON TABLE public.roles TO anon;
GRANT ALL ON TABLE public.roles TO authenticated;
GRANT ALL ON TABLE public.roles TO service_role;

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

GRANT ALL ON TABLE public.provider_verifications TO anon;
GRANT ALL ON TABLE public.provider_verifications TO authenticated;
GRANT ALL ON TABLE public.provider_verifications TO service_role;

GRANT ALL ON TABLE public.service_addons TO anon;
GRANT ALL ON TABLE public.service_addons TO authenticated;
GRANT ALL ON TABLE public.service_addons TO service_role;

GRANT ALL ON TABLE public.order_addons TO anon;
GRANT ALL ON TABLE public.order_addons TO authenticated;
GRANT ALL ON TABLE public.order_addons TO service_role;

GRANT ALL ON TABLE public.matching_runs TO anon;
GRANT ALL ON TABLE public.matching_runs TO authenticated;
GRANT ALL ON TABLE public.matching_runs TO service_role;

GRANT ALL ON TABLE public.matching_candidates TO anon;
GRANT ALL ON TABLE public.matching_candidates TO authenticated;
GRANT ALL ON TABLE public.matching_candidates TO service_role;

GRANT ALL ON TABLE public.dispatch_batches TO anon;
GRANT ALL ON TABLE public.dispatch_batches TO authenticated;
GRANT ALL ON TABLE public.dispatch_batches TO service_role;

GRANT ALL ON TABLE public.dispatch_attempts TO anon;
GRANT ALL ON TABLE public.dispatch_attempts TO authenticated;
GRANT ALL ON TABLE public.dispatch_attempts TO service_role;

GRANT ALL ON TABLE public.provider_presence TO anon;
GRANT ALL ON TABLE public.provider_presence TO authenticated;
GRANT ALL ON TABLE public.provider_presence TO service_role;

GRANT ALL ON TABLE public.provider_realtime_locations TO anon;
GRANT ALL ON TABLE public.provider_realtime_locations TO authenticated;
GRANT ALL ON TABLE public.provider_realtime_locations TO service_role;

GRANT ALL ON TABLE public.provider_reports TO anon;
GRANT ALL ON TABLE public.provider_reports TO authenticated;
GRANT ALL ON TABLE public.provider_reports TO service_role;

GRANT ALL ON TABLE public.report_actions TO anon;
GRANT ALL ON TABLE public.report_actions TO authenticated;
GRANT ALL ON TABLE public.report_actions TO service_role;

GRANT ALL ON TABLE public.payment_methods TO anon;
GRANT ALL ON TABLE public.payment_methods TO authenticated;
GRANT ALL ON TABLE public.payment_methods TO service_role;

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;

GRANT ALL ON TABLE public.refunds TO anon;
GRANT ALL ON TABLE public.refunds TO authenticated;
GRANT ALL ON TABLE public.refunds TO service_role;

GRANT ALL ON TABLE public.payouts TO anon;
GRANT ALL ON TABLE public.payouts TO authenticated;
GRANT ALL ON TABLE public.payouts TO service_role;

GRANT ALL ON TABLE public.provider_earnings_ledger TO anon;
GRANT ALL ON TABLE public.provider_earnings_ledger TO authenticated;
GRANT ALL ON TABLE public.provider_earnings_ledger TO service_role;

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;

GRANT ALL ON TABLE public.conversation_participants TO anon;
GRANT ALL ON TABLE public.conversation_participants TO authenticated;
GRANT ALL ON TABLE public.conversation_participants TO service_role;

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;

GRANT ALL ON TABLE public.message_attachments TO anon;
GRANT ALL ON TABLE public.message_attachments TO authenticated;
GRANT ALL ON TABLE public.message_attachments TO service_role;

GRANT ALL ON TABLE public.support_tickets TO anon;
GRANT ALL ON TABLE public.support_tickets TO authenticated;
GRANT ALL ON TABLE public.support_tickets TO service_role;

GRANT ALL ON TABLE public.support_ticket_events TO anon;
GRANT ALL ON TABLE public.support_ticket_events TO authenticated;
GRANT ALL ON TABLE public.support_ticket_events TO service_role;

GRANT ALL ON TABLE public.plans TO anon;
GRANT ALL ON TABLE public.plans TO authenticated;
GRANT ALL ON TABLE public.plans TO service_role;

GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;

GRANT ALL ON TABLE public.subscription_events TO anon;
GRANT ALL ON TABLE public.subscription_events TO authenticated;
GRANT ALL ON TABLE public.subscription_events TO service_role;

-- ---------------------------------------------------------------------------
-- RLS policies (RLS is enabled by existing rls_auto_enable trigger on new tables)
-- ---------------------------------------------------------------------------

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_realtime_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_earnings_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read roles" ON public.roles FOR SELECT USING (true);

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Providers manage own verifications"
  ON public.provider_verifications
  FOR ALL
  USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Anyone can read active service addons"
  ON public.service_addons
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Users manage order addons for visible orders"
  ON public.order_addons
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_addons.order_id
        AND (o.customer_id = auth.uid() OR o.provider_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.orders o
      WHERE o.id = order_addons.order_id
        AND (o.customer_id = auth.uid() OR o.provider_id = auth.uid())
    )
  );

CREATE POLICY "Users access own provider presence"
  ON public.provider_presence
  FOR ALL
  USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Users manage own realtime locations"
  ON public.provider_realtime_locations
  FOR ALL
  USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Users manage own reports"
  ON public.provider_reports
  FOR ALL
  USING (reporter_id = auth.uid())
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Users manage own payment methods"
  ON public.payment_methods
  FOR ALL
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Users access own payments"
  ON public.payments
  FOR ALL
  USING (customer_id = auth.uid())
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Users access refunds for own payments"
  ON public.refunds
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.payments p WHERE p.id = refunds.payment_id AND p.customer_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payments p WHERE p.id = refunds.payment_id AND p.customer_id = auth.uid()
    )
  );

CREATE POLICY "Providers access own payouts"
  ON public.payouts
  FOR ALL
  USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Providers access own earnings ledger"
  ON public.provider_earnings_ledger
  FOR ALL
  USING (provider_id = auth.uid())
  WITH CHECK (provider_id = auth.uid());

CREATE POLICY "Users create conversations"
  ON public.conversations
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users read conversations they participate in"
  ON public.conversations
  FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users update conversations they participate in"
  ON public.conversations
  FOR UPDATE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Participants read conversation membership"
  ON public.conversation_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = conversation_participants.conversation_id
        AND cp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "Users join or creators add participants"
  ON public.conversation_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.conversations c
      WHERE c.id = conversation_id AND c.created_by = auth.uid()
    )
  );

CREATE POLICY "Users update own membership row"
  ON public.conversation_participants
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read messages in their conversations"
  ON public.messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users send messages in their conversations"
  ON public.messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users access attachments in their conversations"
  ON public.message_attachments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = message_attachments.message_id AND cp.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.messages m
      JOIN public.conversation_participants cp ON cp.conversation_id = m.conversation_id
      WHERE m.id = message_attachments.message_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Users manage own support tickets"
  ON public.support_tickets
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read events on own tickets"
  ON public.support_ticket_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t WHERE t.id = support_ticket_events.ticket_id AND t.user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can read active plans" ON public.plans FOR SELECT USING (is_active = true);

CREATE POLICY "Users manage own subscriptions"
  ON public.subscriptions
  FOR ALL
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users read own subscription events"
  ON public.subscription_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions s WHERE s.id = subscription_events.subscription_id AND s.profile_id = auth.uid()
    )
  );
