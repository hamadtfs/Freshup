# Milestone 4 — E2E (no Mapbox key yet)

## Done in code (backend + web)

- DB order status unchanged; UI labels via `lib/orders/order-status-ui.ts`
- External navigation: Apple Maps / Google Maps deep links
- Live GPS publish every ~8s during active jobs; provider only `en_route` + `in_progress`
- Home delivery: OSRM driving km (`GET /api/pricing/delivery-km`, nearest online provider) in lock/book; straight-line fallback if OSRM down
- Demand zones: `demand_zones` table + `GET /api/demand-zones` (apply migration manually)
- Orders + earnings lists from API (`provider_total` from price locks)
- Service progress bar from `orders.started_at` + service duration
- Driving route polyline via public OSRM (falls back to straight line)
- Order chat: per-order messages in `localStorage` (device-only until server chat)
- `/provider` page: assigned → en_route → arrived → in_progress transitions

## Mapbox-ready (works without token)

- Set `MAPBOX_ACCESS_TOKEN` and/or `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` → Directions + map style switch automatically.
- Without token: **OSRM** (distance/route) + **CARTO** tiles (unchanged interim).
- `GET /api/maps/driving-route` — server route polyline (Mapbox → OSRM fallback).
- `POST /api/cron/refresh-demand-zones` — Opptatt data refresh (see `docs/opptatt_data_layer_outline.md`).

## Still blocked / M5

- Mapbox zone **overlay paint** on map (M5).
- **Expo Location** on native app (web still uses browser geolocation).

## Manual migration

Apply `supabase/migrations/20260525140000_demand_zones.sql` in Supabase Dashboard or `db push` (manual per project policy).

## Quick test

1. Customer books home visit — confirm step shows delivery km + fee (not 0 km only).
2. Provider accepts → Start driving → customer sees status labels (Provider on the way, etc.).
3. Directions button opens maps app (not alert).
4. `GET /api/demand-zones?service_id=…&min_lat=…&audience=customer` returns zones with tier/label.
