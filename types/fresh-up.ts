// =====================================================
// Fresh Up - TypeScript Type Definitions
// =====================================================

// App Modes
export type AppMode = "beauty" | "vehicle" | "pet" | "home_service" | "health"
export type DeliveryMode = "home" | "at_provider" | "both"
export type OrderStatus = "pending" | "offered" | "assigned" | "en_route" | "arrived" | "in_progress" | "completed" | "cancelled"

// =====================================================
// REFERENCE TYPES (Static Data)
// =====================================================

export interface Mode {
  id: AppMode
  label: string
  icon: string
  sort_order: number
}

export interface Target {
  id: string
  mode_id: AppMode
  label: string
  icon: string
  sort_order: number
}

export interface Category {
  id: string
  mode_id: AppMode
  target_id: string
  label: string
  icon?: string
  sort_order: number
}

export interface Service {
  id: string
  category_id: string
  name: string
  description?: string
  duration_minutes: number
  base_price_min?: number
  base_price_max?: number
  active: boolean
  sort_order: number
}

// =====================================================
// USER TYPES
// =====================================================

export interface Profile {
  id: string // UUID from auth.users
  email: string
  name?: string
  avatar_url?: string
  role?: "customer" | "provider"
  created_at: string
  updated_at: string
}

export interface ProviderDetails {
  id: string // References profiles(id)
  business_name?: string
  description?: string
  address?: string
  lat?: number
  lng?: number
  /** M2 performance tier for Architecture §4.3 (gold | silver | bronze). */
  dispatch_performance_tier?: "gold" | "silver" | "bronze"
  supports_home_delivery: boolean
  supports_at_provider: boolean
  is_online: boolean
  last_online_at?: string
  is_verified: boolean
  verified_at?: string
  total_jobs: number
  average_rating: number
  created_at: string
  updated_at: string
}

// =====================================================
// PROVIDER SKILLS
// =====================================================

export interface ProviderMode {
  provider_id: string
  mode_id: AppMode
}

export interface ProviderTarget {
  provider_id: string
  target_id: string
}

export interface ProviderCategory {
  provider_id: string
  category_id: string
}

export interface ProviderService {
  provider_id: string
  service_id: string
  competence_rating: number // 1-5
  custom_duration_minutes?: number
  custom_price_min?: number
  custom_price_max?: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProviderDeliveryMode {
  provider_id: string
  delivery_mode: DeliveryMode
}

// =====================================================
// ORDERS
// =====================================================

export interface ServiceOrder {
  id: string
  customer_id: string
  mode_id: AppMode
  target_id: string
  category_id: string
  service_id: string
  delivery_mode: DeliveryMode
  customer_lat: number
  customer_lng: number
  customer_address?: string
  provider_location_lat?: number
  provider_location_lng?: number
  provider_address?: string
  provider_id?: string
  status: OrderStatus
  scheduled_at?: string
  eta_minutes?: number
  started_at?: string
  completed_at?: string
  price_estimate?: number
  price_final?: number
  customer_notes?: string
  created_at: string
  updated_at: string
}

export interface ServiceOrderOffer {
  id: string
  order_id: string
  provider_id: string
  status: "pending" | "accepted" | "declined" | "expired"
  distance_km?: number
  eta_minutes?: number
  sent_at: string
  responded_at?: string
  expires_at?: string
}

export interface ServiceOrderEvent {
  id: string
  order_id: string
  event_type: string
  event_data?: Record<string, any>
  created_at: string
}

// =====================================================
// RATINGS & REVIEWS
// =====================================================

export interface ServiceRating {
  id: string
  order_id: string
  rater_id: string
  ratee_id: string
  stars: number // 1-5
  comment?: string
  rating_type: "customer_to_provider" | "provider_to_customer"
  created_at: string
}

// =====================================================
// PAYMENTS
// =====================================================

export interface ServicePayment {
  id: string
  order_id: string
  stripe_payment_intent_id?: string
  stripe_customer_id?: string
  amount: number // In smallest currency unit (ore for NOK)
  currency: string
  platform_fee: number
  provider_payout?: number
  status: "pending" | "authorized" | "captured" | "refunded" | "failed"
  created_at: string
  updated_at: string
}

// =====================================================
// LOCATION TRACKING
// =====================================================

export interface ProviderLocation {
  provider_id: string
  lat: number
  lng: number
  heading?: number
  speed?: number
  accuracy?: number
  updated_at: string
}

// =====================================================
// MATCHING RESULT
// =====================================================

export interface MatchingProvider {
  provider_id: string
  provider_name?: string
  competence_rating: number
  distance_km: number
  is_online: boolean
}

// =====================================================
// API REQUEST/RESPONSE TYPES
// =====================================================

export interface CreateOrderRequest {
  mode_id: AppMode
  target_id: string
  category_id: string
  service_id: string
  delivery_mode: DeliveryMode
  customer_lat: number
  customer_lng: number
  customer_address?: string
  scheduled_at?: string
  customer_notes?: string
}

export interface CreateOrderResponse {
  order: ServiceOrder
  matching_providers: MatchingProvider[]
}

export interface AcceptOrderRequest {
  order_id: string
  provider_id: string
}

export interface ProviderSignUpRequest {
  email: string
  password: string
  name: string
  business_name?: string
  description?: string
  modes: AppMode[]
  delivery_modes: DeliveryMode[]
}

export interface ProviderOnboardingData {
  modes: ProviderMode[]
  targets: ProviderTarget[]
  categories: ProviderCategory[]
  services: ProviderService[]
  deliveryModes: ProviderDeliveryMode[]
}
