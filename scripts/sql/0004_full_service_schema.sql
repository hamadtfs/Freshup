-- =====================================================
-- Fresh Up - Full Multi-Mode Service Schema
-- =====================================================
-- This migration adds support for:
-- - 5 Modes (beauty, vehicle, pet, home_service, health)
-- - Dynamic targets per mode
-- - Categories per mode+target
-- - Services per category
-- - Provider skills with self-rating
-- - Uber-style matching system

-- =====================================================
-- ENUM TYPES
-- =====================================================

-- Create mode type if not exists
DO $$ BEGIN
  CREATE TYPE app_mode AS ENUM ('beauty', 'vehicle', 'pet', 'home_service', 'health');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create delivery mode type
DO $$ BEGIN
  CREATE TYPE delivery_mode AS ENUM ('home', 'at_provider', 'both');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create order status type
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending',      -- Customer submitted, finding providers
    'offered',      -- Sent to providers, waiting for accept
    'assigned',     -- Provider claimed the job
    'en_route',     -- Provider on the way (home delivery)
    'in_progress',  -- Service started
    'completed',    -- Service done
    'cancelled'     -- Cancelled by customer or system
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- REFERENCE TABLES (Static data - modes, targets, categories, services)
-- =====================================================

-- Modes table
CREATE TABLE IF NOT EXISTS modes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

-- Targets table (per mode)
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort_order INT DEFAULT 0
);

-- Categories table (per mode + target)
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  mode_id TEXT NOT NULL REFERENCES modes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT,
  sort_order INT DEFAULT 0
);

-- Services table (per category)
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL,
  base_price_min INT,  -- For dynamic pricing reference
  base_price_max INT,
  active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0
);

-- =====================================================
-- USER TABLES
-- =====================================================

-- Update profiles table to support both customers and providers
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Provider extended profile (for providers)
CREATE TABLE IF NOT EXISTS provider_details (
  id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  business_name TEXT,
  description TEXT,
  
  -- Location
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  
  -- Service area
  radius_km REAL DEFAULT 10,
  
  -- Delivery modes they support
  supports_home_delivery BOOLEAN DEFAULT TRUE,
  supports_at_provider BOOLEAN DEFAULT FALSE,
  
  -- Availability
  is_online BOOLEAN DEFAULT FALSE,
  last_online_at TIMESTAMPTZ,
  
  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  
  -- Stats
  total_jobs INT DEFAULT 0,
  average_rating DECIMAL(3,2) DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- PROVIDER SKILLS (What services a provider offers)
-- =====================================================

-- Provider modes (which modes they work in)
CREATE TABLE IF NOT EXISTS provider_modes (
  provider_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  mode_id TEXT REFERENCES modes(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, mode_id)
);

-- Provider targets (which targets they serve per mode)
CREATE TABLE IF NOT EXISTS provider_targets (
  provider_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES targets(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, target_id)
);

-- Provider categories (which categories they can do)
CREATE TABLE IF NOT EXISTS provider_categories_new (
  provider_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, category_id)
);

-- Provider services with self-rating
CREATE TABLE IF NOT EXISTS provider_services (
  provider_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
  
  -- Self-rating (1-5 stars)
  competence_rating INT CHECK (competence_rating BETWEEN 1 AND 5) DEFAULT 3,
  
  -- Optional overrides
  custom_duration_minutes INT,
  custom_price_min INT,
  custom_price_max INT,
  
  -- Is this service currently active for this provider?
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY (provider_id, service_id)
);

-- Provider delivery modes
CREATE TABLE IF NOT EXISTS provider_delivery_modes (
  provider_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  delivery_mode delivery_mode NOT NULL,
  PRIMARY KEY (provider_id, delivery_mode)
);

-- =====================================================
-- ORDERS (Booking/matching system)
-- =====================================================

-- Main orders table
CREATE TABLE IF NOT EXISTS service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Customer info
  customer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Service details (snapshot at time of booking)
  mode_id TEXT NOT NULL REFERENCES modes(id),
  target_id TEXT NOT NULL REFERENCES targets(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  
  -- Delivery mode
  delivery_mode delivery_mode NOT NULL,
  
  -- Location
  customer_lat DOUBLE PRECISION NOT NULL,
  customer_lng DOUBLE PRECISION NOT NULL,
  customer_address TEXT,
  
  -- If at_provider, store provider location too
  provider_location_lat DOUBLE PRECISION,
  provider_location_lng DOUBLE PRECISION,
  provider_address TEXT,
  
  -- Assigned provider (NULL until accepted)
  provider_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  
  -- Status
  status order_status NOT NULL DEFAULT 'pending',
  
  -- Timing
  scheduled_at TIMESTAMPTZ,  -- NULL = ASAP
  eta_minutes INT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Pricing
  price_estimate INT,
  price_final INT,
  
  -- Notes
  customer_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order offers (sent to multiple providers)
CREATE TABLE IF NOT EXISTS service_order_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Offer status
  status TEXT CHECK (status IN ('pending', 'accepted', 'declined', 'expired')) DEFAULT 'pending',
  
  -- Distance from provider to customer
  distance_km REAL,
  eta_minutes INT,
  
  -- Timestamps
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  
  UNIQUE (order_id, provider_id)
);

-- Order events timeline
CREATE TABLE IF NOT EXISTS service_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- RATINGS & REVIEWS
-- =====================================================

CREATE TABLE IF NOT EXISTS service_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  
  -- Who rated whom
  rater_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ratee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  
  -- Rating
  stars INT CHECK (stars BETWEEN 1 AND 5) NOT NULL,
  comment TEXT,
  
  -- Was this rating for customer or provider?
  rating_type TEXT CHECK (rating_type IN ('customer_to_provider', 'provider_to_customer')) NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (order_id, rating_type)
);

-- =====================================================
-- PAYMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS service_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  
  -- Stripe
  stripe_payment_intent_id TEXT,
  stripe_customer_id TEXT,
  
  -- Amounts (in smallest currency unit, e.g., ore for NOK)
  amount INT NOT NULL,
  currency TEXT DEFAULT 'nok',
  
  -- Platform fee
  platform_fee INT DEFAULT 0,
  provider_payout INT,
  
  -- Status
  status TEXT CHECK (status IN ('pending', 'authorized', 'captured', 'refunded', 'failed')) DEFAULT 'pending',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- REALTIME LOCATION TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS provider_locations (
  provider_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  heading REAL,  -- Direction in degrees
  speed REAL,    -- km/h
  accuracy REAL, -- meters
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_categories_new ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_delivery_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_locations ENABLE ROW LEVEL SECURITY;

-- Reference tables: Everyone can read
CREATE POLICY "modes_public_read" ON modes FOR SELECT USING (true);
CREATE POLICY "targets_public_read" ON targets FOR SELECT USING (true);
CREATE POLICY "categories_public_read" ON categories FOR SELECT USING (true);
CREATE POLICY "services_public_read" ON services FOR SELECT USING (true);

-- Provider details: Public read, owner write
CREATE POLICY "provider_details_public_read" ON provider_details FOR SELECT USING (true);
CREATE POLICY "provider_details_owner_insert" ON provider_details FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "provider_details_owner_update" ON provider_details FOR UPDATE USING (auth.uid() = id);

-- Provider skills: Public read, owner write
CREATE POLICY "provider_modes_public_read" ON provider_modes FOR SELECT USING (true);
CREATE POLICY "provider_modes_owner_all" ON provider_modes FOR ALL USING (auth.uid() = provider_id);

CREATE POLICY "provider_targets_public_read" ON provider_targets FOR SELECT USING (true);
CREATE POLICY "provider_targets_owner_all" ON provider_targets FOR ALL USING (auth.uid() = provider_id);

CREATE POLICY "provider_categories_public_read" ON provider_categories_new FOR SELECT USING (true);
CREATE POLICY "provider_categories_owner_all" ON provider_categories_new FOR ALL USING (auth.uid() = provider_id);

CREATE POLICY "provider_services_public_read" ON provider_services FOR SELECT USING (true);
CREATE POLICY "provider_services_owner_all" ON provider_services FOR ALL USING (auth.uid() = provider_id);

CREATE POLICY "provider_delivery_public_read" ON provider_delivery_modes FOR SELECT USING (true);
CREATE POLICY "provider_delivery_owner_all" ON provider_delivery_modes FOR ALL USING (auth.uid() = provider_id);

-- Orders: Customer and assigned provider can read/update
CREATE POLICY "orders_customer_select" ON service_orders FOR SELECT USING (auth.uid() = customer_id);
CREATE POLICY "orders_customer_insert" ON service_orders FOR INSERT WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "orders_customer_update" ON service_orders FOR UPDATE USING (auth.uid() = customer_id);
CREATE POLICY "orders_provider_select" ON service_orders FOR SELECT USING (auth.uid() = provider_id);
CREATE POLICY "orders_provider_update" ON service_orders FOR UPDATE USING (auth.uid() = provider_id);

-- Order offers: Provider can see and respond to their offers
CREATE POLICY "offers_provider_select" ON service_order_offers FOR SELECT USING (auth.uid() = provider_id);
CREATE POLICY "offers_provider_update" ON service_order_offers FOR UPDATE USING (auth.uid() = provider_id);

-- Order events: Related parties can read
CREATE POLICY "events_customer_select" ON service_order_events FOR SELECT 
  USING (EXISTS (SELECT 1 FROM service_orders WHERE id = order_id AND customer_id = auth.uid()));
CREATE POLICY "events_provider_select" ON service_order_events FOR SELECT 
  USING (EXISTS (SELECT 1 FROM service_orders WHERE id = order_id AND provider_id = auth.uid()));

-- Ratings: Public read, parties can write
CREATE POLICY "ratings_public_read" ON service_ratings FOR SELECT USING (true);
CREATE POLICY "ratings_rater_insert" ON service_ratings FOR INSERT WITH CHECK (auth.uid() = rater_id);

-- Payments: Only related parties
CREATE POLICY "payments_customer_select" ON service_payments FOR SELECT 
  USING (EXISTS (SELECT 1 FROM service_orders WHERE id = order_id AND customer_id = auth.uid()));
CREATE POLICY "payments_provider_select" ON service_payments FOR SELECT 
  USING (EXISTS (SELECT 1 FROM service_orders WHERE id = order_id AND provider_id = auth.uid()));

-- Provider locations: Owner can write, public read (for showing on map)
CREATE POLICY "locations_public_read" ON provider_locations FOR SELECT USING (true);
CREATE POLICY "locations_owner_upsert" ON provider_locations FOR INSERT WITH CHECK (auth.uid() = provider_id);
CREATE POLICY "locations_owner_update" ON provider_locations FOR UPDATE USING (auth.uid() = provider_id);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_targets_mode ON targets(mode_id);
CREATE INDEX IF NOT EXISTS idx_categories_mode_target ON categories(mode_id, target_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_service ON provider_services(service_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON service_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_provider ON service_orders(provider_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON service_orders(status);
CREATE INDEX IF NOT EXISTS idx_order_offers_order ON service_order_offers(order_id);
CREATE INDEX IF NOT EXISTS idx_provider_locations_geo ON provider_locations(lat, lng);

-- =====================================================
-- FUNCTIONS FOR MATCHING
-- =====================================================

-- Function to find matching providers for an order
CREATE OR REPLACE FUNCTION find_matching_providers(
  p_service_id TEXT,
  p_delivery_mode delivery_mode,
  p_customer_lat DOUBLE PRECISION,
  p_customer_lng DOUBLE PRECISION,
  p_radius_km REAL DEFAULT 10
)
RETURNS TABLE (
  provider_id UUID,
  provider_name TEXT,
  competence_rating INT,
  distance_km REAL,
  is_online BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id AS provider_id,
    p.name AS provider_name,
    ps.competence_rating,
    (
      6371 * acos(
        cos(radians(p_customer_lat)) * cos(radians(pd.lat)) *
        cos(radians(pd.lng) - radians(p_customer_lng)) +
        sin(radians(p_customer_lat)) * sin(radians(pd.lat))
      )
    )::REAL AS distance_km,
    pd.is_online
  FROM profiles p
  JOIN provider_details pd ON pd.id = p.id
  JOIN provider_services ps ON ps.provider_id = p.id AND ps.service_id = p_service_id AND ps.is_active = TRUE
  JOIN provider_delivery_modes pdm ON pdm.provider_id = p.id AND (pdm.delivery_mode = p_delivery_mode OR pdm.delivery_mode = 'both')
  WHERE 
    p.role = 'provider'
    AND pd.is_online = TRUE
    AND pd.is_verified = TRUE
    AND (
      6371 * acos(
        cos(radians(p_customer_lat)) * cos(radians(pd.lat)) *
        cos(radians(pd.lng) - radians(p_customer_lng)) +
        sin(radians(p_customer_lat)) * sin(radians(pd.lat))
      )
    ) <= LEAST(p_radius_km, pd.radius_km)
  ORDER BY ps.competence_rating DESC, distance_km ASC;
END;
$$;
