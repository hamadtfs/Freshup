# Opptatt (demand zones) — data layer outline (M4)

Client-approved split: **data layer in M4**, **map overlay paint in M5**.

## Table: `public.demand_zones`

| Column | Type | Purpose |
|--------|------|---------|
| `grid_id` | text | 1 km cell id, e.g. `g_535_-122` |
| `service_id` | text FK → `services.id` | Capacity is per service |
| `center_lat`, `center_lng` | double | Cell centre for labels / future overlay |
| `used_capacity_pct` | numeric | 0–100+, same formula as dynamic pricing |
| `active_bookings` | int | Orders in cell (last 30 min, active statuses) |
| `online_providers` | int | `provider_skills.available_now` + `provider_details` in cell |
| `computed_at` | timestamptz | Last recompute time |

Primary key: `(grid_id, service_id)`.

## Grid

- **Cell size:** ~**1 km × 1 km** (`lib/demand-zones/grid.ts`, `DEMAND_ZONE_GRID_KM = 1`).
- Separate from pricing_areas (~22 km cells).

## Capacity per cell

1. Count **active orders** for the service whose `customer_lat/lng` fall in the cell (statuses: pending, offered, assigned, en_route, arrived, in_progress; **created within the last 30 minutes** — spec §2.3 `active_bookings_last_30min`).
2. Count **online providers** for that service in the cell (`provider_skills` + `provider_details.lat/lng`, `available_now`).
3. `used_capacity_pct = computeUsedCapacity(active_bookings, online_providers)` (shared with pricing engine).

## Tiers (read-time, not stored)

- &lt; 35% → green, 35–65% → blue, ≥ 65% → red.
- Customer vs provider labels inverted (`lib/demand-zones/tiers.ts`).

## Refresh

| Mechanism | Interval | Notes |
|-----------|----------|--------|
| On read | Stale if **&gt; 5 min** | `GET /api/demand-zones` recomputes missing/stale cells |
| Background cron | **5–10 min** (recommended) | `POST /api/cron/refresh-demand-zones` with `CRON_SECRET`; default bbox Greater Oslo |

## API

- `GET /api/demand-zones?service_id=&min_lat=&min_lng=&max_lat=&max_lng=&audience=customer|provider`
- UI chip (text): `fetchDemandZoneAtPoint` — no polygon overlay until M5.

## M5 (out of scope for M4 build)

- Mapbox GL polygon/fill overlay from `demand_zones` rows in viewport.
- Requires `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`.

## Code references

- Migration: `supabase/migrations/20260525140000_demand_zones.sql`
- Compute: `lib/demand-zones/compute-zone.ts`
- Cron refresh: `lib/demand-zones/refresh-bbox.ts`, `app/api/cron/refresh-demand-zones/route.ts`
