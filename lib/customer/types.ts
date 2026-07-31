/** Customer booking / matching payloads shared by API routes and UI. */

export type DeliveryMode = "home" | "at_provider";
export type ServiceModeId = "home" | "provider" | "both";

export type MatchProvidersRequestBody = {
  mode_id: string;
  target_id: string;
  category_id: string;
  service_id: string;
  service_mode_id: ServiceModeId;
  customer_lat: number;
  customer_lng: number;
  scheduled_at?: string | null;
};

export type MatchedProvider = {
  provider_id: string;
  business_name: string | null;
  distance_km: number;
  service_rating: number;
  avg_rating: number | null;
};

export type OrderAddonSelection = {
  catalog_id: string;
  name: string;
  price: number;
  extra_minutes?: number;
};

export type BookOrderRequestBody = MatchProvidersRequestBody & {
  delivery_mode: DeliveryMode;
  customer_address?: string;
  scheduled_at?: string;
  notes?: string;
  /** Add-on row IDs from `public.service_addons` — must belong to `service_id`. */
  addon_ids?: string[];
  /** UI catalog add-ons; server resolves/creates `service_addons` rows for each. */
  addon_selections?: OrderAddonSelection[];
  /**
   * Optional `booking_price_locks.id` from POST /api/pricing/lock.
   * When present, the order's price is copied from the lock instead of
   * recomputing — implements spec §2.3 "lock the displayed price so it
   * doesn't change mid-flow." Backward-compatible: omit it and the legacy
   * computation runs unchanged.
   */
  price_lock_id?: string;
  /** Home-visit distance in km when known before provider assignment. */
  delivery_km?: number;
};
