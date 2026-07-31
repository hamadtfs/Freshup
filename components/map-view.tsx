"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { haversineKm, sliceRouteForDisplay } from "@/lib/geo";
import { fetchDemandZonesInBbox } from "@/lib/demand-zones/client";
import {
  DEMAND_HEATMAP_OPACITY,
  demandZonesToHeatmapGeoJSON,
  heatmapColorRamp,
  HEATMAP_BLUE_RGB,
  HEATMAP_GREEN_RGB,
  HEATMAP_INTENSITY_EXPRESSION,
  HEATMAP_RADIUS_EXPRESSION,
  HEATMAP_RED_RGB,
} from "@/lib/demand-zones/overlay";
import { FRESHUP_BASEMAP_STYLE } from "@/lib/maps/map-style";
import {
  zoomLevelForKmSpan,
} from "@/lib/demand-zones/grid";
import {
  createLiveFleetMarkerElement,
  ensureLiveFleetMarkerStyles,
  updateLiveFleetMarkerHeading,
  type LiveFleetMarkerVariant,
} from "@/lib/maps/live-fleet-marker";

type LatLng = { lat: number; lng: number };

export type FleetMarkerStyle = "numbered" | "live";

export type DemandMapOverlayConfig = {
  serviceId: string;
  audience: "customer" | "provider";
  accessToken: string;
};

const DEMAND_OVERLAY_SOURCE = "demand-zones";
const DEMAND_HEATMAP_GREEN_LAYER = "demand-heatmap-green";
const DEMAND_HEATMAP_BLUE_LAYER = "demand-heatmap-blue";
const DEMAND_HEATMAP_RED_LAYER = "demand-heatmap-red";
const LEGACY_DEMAND_LAYERS = [
  "demand-zones-glow",
  "demand-zones-fill",
  "demand-heatmap-hot",
  "demand-heatmap-cool",
] as const;

const HEATMAP_RADIUS =
  HEATMAP_RADIUS_EXPRESSION as maplibregl.ExpressionSpecification;
const HEATMAP_INTENSITY =
  HEATMAP_INTENSITY_EXPRESSION as maplibregl.ExpressionSpecification;
const DEMAND_OVERLAY_MOVE_DEBOUNCE_MS = 350;
const DEMAND_OVERLAY_INITIAL_DELAY_MS = 200;
const FLEET_MOVE_ANIM_MS = 900;
const MARKET_CALC_MIN_MS = 650;
/** Browse default zoom — slightly wider than one demand cell (~1 km) for street context. */
const BROWSE_MAP_VIEWPORT_SPAN_KM = 1.75;
const GRID_VIEWPORT_PADDING = {
  top: 80,
  bottom: 200,
  left: 40,
  right: 40,
} as const;

function fitBrowseViewportOneKm(
  map: maplibregl.Map,
  lat: number,
  lng: number,
  duration = 500,
) {
  const container = map.getContainer();
  const width = container.clientWidth || 400;
  const height = container.clientHeight || 700;
  // Visible map area above the bottom sheet (~52% of screen).
  const usableHeight = height * 0.52;
  const zoom = zoomLevelForKmSpan(
    lat,
    BROWSE_MAP_VIEWPORT_SPAN_KM,
    width,
    usableHeight,
  );
  map.easeTo({
    center: [lng, lat],
    zoom,
    padding: GRID_VIEWPORT_PADDING,
    duration,
  });
}

type ProviderMarker = {
  id: string;
  lat: number;
  lng: number;
  type: "mobile" | "salon";
  status: "available" | "busy" | "unavailable";
  number?: number;
  heading?: number;
};

const isFiniteNum = (n: any) => typeof n === "number" && Number.isFinite(n);
const isValidLngLat = (
  p: { lat: number; lng: number } | null | undefined,
): p is { lat: number; lng: number } =>
  !!p && isFiniteNum(p.lat) && isFiniteNum(p.lng);

/** Matches CARTO light_all tile background (no purple gradient bleed-through). */
const MAP_SURFACE_COLOR = "#ebe9e4";

function ensureLiveMarkerStyles() {
  if (typeof document === "undefined") return;

  const existing = document.getElementById(
    "freshup-live-marker-styles",
  ) as HTMLStyleElement | null;
  const style = existing ?? document.createElement("style");
  style.id = "freshup-live-marker-styles";
  style.textContent = `
    @keyframes freshup-live-pulse {
      0% { transform: scale(0.8); opacity: 0.55; }
      70% { transform: scale(2.4); opacity: 0; }
      100% { transform: scale(2.4); opacity: 0; }
    }
    .freshup-live-marker {
      width: var(--freshup-marker-size, 20px);
      height: var(--freshup-marker-size, 20px);
      border-radius: 9999px;
      --freshup-marker-color: #3b82f6;
    }
    .freshup-live-marker__visual {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 9999px;
    }
    .freshup-live-marker__visual::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 9999px;
      background: var(--freshup-marker-color);
      animation: freshup-live-pulse 1.35s ease-out infinite;
    }
    .freshup-live-marker__visual::after {
      content: "";
      position: absolute;
      inset: 3px;
      border: 3px solid #ffffff;
      border-radius: 9999px;
      background: var(--freshup-marker-color);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
  `;
  if (!existing) document.head.appendChild(style);
}

function applyLiveMarkerTone(el: HTMLElement, type: "customer" | "provider") {
  const size = 20;
  const color = type === "customer" ? "#3b82f6" : "#f97316";
  el.classList.add("freshup-live-marker");
  el.style.setProperty("--freshup-marker-size", `${size}px`);
  el.style.setProperty("--freshup-marker-color", color);
  el.title =
    type === "customer" ? "Customer live location" : "Provider live location";
  el.style.removeProperty("position");

  const existingVisual = el.firstElementChild;
  if (!existingVisual?.classList.contains("freshup-live-marker__visual")) {
    const visual = document.createElement("div");
    visual.className = "freshup-live-marker__visual";
    el.replaceChildren(visual);
  }
}

function createLiveMarkerElement(type: "customer" | "provider") {
  ensureLiveMarkerStyles();
  const el = document.createElement("div");
  applyLiveMarkerTone(el, type);
  return el;
}

export default function MapView({
  center,
  customer,
  providers = [],
  providerPos,
  route,
  onMapClick,
  fitKey = 0,
  language = "no",
  providerMarkerTone = "provider",
  followCenter = true,
  customerMarkerOnTop = false,
  viewportResetKey,
  recenterNonce = 0,
  demandOverlay = null,
  showDemandOverlay = false,
  fleetMarkerStyle = "numbered",
  fleetVariant = "car",
  marketCalculating = false,
  marketActivityLabel = null,
  onDemandOverlayLoadingChange,
  lockViewportToGridCell = false,
}: {
  center: LatLng;
  customer?: LatLng | null;
  providers?: ProviderMarker[];
  providerPos?: LatLng | null;
  route?: LatLng[] | null;
  onMapClick?: (pt: LatLng) => void;
  fitKey?: number;
  providerMarkerTone?: "customer" | "provider";
  /** When false, fitBounds drives the viewport during active jobs (provider + customer). */
  followCenter?: boolean;
  /** When true, blue customer dot renders above orange provider dot at overlaps. */
  customerMarkerOnTop?: boolean;
  /** New job / session — allow auto-fit again after the user has panned or zoomed. */
  viewportResetKey?: string | number | null;
  /** Bump to clear pan lock and fly to `center` (GPS FAB). */
  recenterNonce?: number;
  /** Matches app `Language`; controls loading overlay copy. */
  language?: "no" | "en";
  /** Opptatt / demand-zone grid overlay (1 km cells, green / blue / red). */
  demandOverlay?: DemandMapOverlayConfig | null;
  showDemandOverlay?: boolean;
  /** `live` = small moving fleet dots; `numbered` = legacy pool markers. */
  fleetMarkerStyle?: FleetMarkerStyle;
  fleetVariant?: LiveFleetMarkerVariant;
  /** Pulsing ring while pricing / demand data is loading. */
  marketCalculating?: boolean;
  marketActivityLabel?: string | null;
  onDemandOverlayLoadingChange?: (loading: boolean) => void;
  /** Browse mode: show exactly one 1×1 km demand grid cell around center. */
  lockViewportToGridCell?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const customerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const providerMarkerRef = useRef<maplibregl.Marker | null>(null);
  const providerMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const fleetAnimRef = useRef<
    Map<string, { from: [number, number]; to: [number, number]; start: number }>
  >(new Map());
  const fleetAnimFrameRef = useRef<number | null>(null);
  const userMovedViewportRef = useRef(false);
  const isProgrammaticMoveRef = useRef(false);
  const lastFittedKeyRef = useRef<number | null>(null);
  const lastSyncedCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const onDemandOverlayLoadingChangeRef = useRef(onDemandOverlayLoadingChange);
  onDemandOverlayLoadingChangeRef.current = onDemandOverlayLoadingChange;
  const demandOverlayEpochRef = useRef(0);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (marketCalculating || fleetMarkerStyle === "live") {
      ensureLiveFleetMarkerStyles();
    }
  }, [marketCalculating, fleetMarkerStyle]);

  const normalizedProviders = useMemo(
    () =>
      (providers || [])
        .filter((p) => isFiniteNum(p.lat) && isFiniteNum(p.lng))
        .map((p) => ({
          ...p,
          latlng: [p.lng, p.lat] as [number, number],
        })),
    [providers],
  );

  const routeCoords = useMemo(() => {
    if (!route || route.length === 0) return null;
    const out = route.filter(isValidLngLat);
    if (out.length < 2) return null;

    // Slice along road geometry from provider → customer; never flip endpoints by distance.
    if (isValidLngLat(customer) && isValidLngLat(providerPos)) {
      return sliceRouteForDisplay(out, providerPos, customer);
    }

    return out;
  }, [route, customer, providerPos]);

  const addRouteLayer = (map: maplibregl.Map) => {
    if (map.getSource("route")) return;
    map.addSource("route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#22c55e",
        "line-width": 5,
        "line-opacity": 0.85,
      },
    });
  };

  const ensureDemandZoneLayers = (map: maplibregl.Map) => {
    for (const layerId of LEGACY_DEMAND_LAYERS) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }

    const hasAllLayers =
      map.getSource(DEMAND_OVERLAY_SOURCE) &&
      map.getLayer(DEMAND_HEATMAP_GREEN_LAYER) &&
      map.getLayer(DEMAND_HEATMAP_BLUE_LAYER) &&
      map.getLayer(DEMAND_HEATMAP_RED_LAYER);
    if (hasAllLayers) {
      return;
    }

    for (const layerId of [
      DEMAND_HEATMAP_GREEN_LAYER,
      DEMAND_HEATMAP_BLUE_LAYER,
      DEMAND_HEATMAP_RED_LAYER,
    ] as const) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
    }

    if (map.getSource(DEMAND_OVERLAY_SOURCE)) {
      map.removeSource(DEMAND_OVERLAY_SOURCE);
    }

    map.addSource(DEMAND_OVERLAY_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    const beforeId = map.getLayer("route-line") ? "route-line" : undefined;

    const addTierHeatmap = (
      layerId: string,
      weightKey: string,
      rgb: string,
    ) => {
      map.addLayer(
        {
          id: layerId,
          type: "heatmap",
          source: DEMAND_OVERLAY_SOURCE,
          minzoom: 10,
          paint: {
            "heatmap-weight": ["get", weightKey],
            "heatmap-intensity": HEATMAP_INTENSITY,
            "heatmap-radius": HEATMAP_RADIUS,
            "heatmap-color": heatmapColorRamp(
              rgb,
            ) as maplibregl.ExpressionSpecification,
            "heatmap-opacity": DEMAND_HEATMAP_OPACITY,
          },
        },
        beforeId,
      );
    };

    addTierHeatmap(
      DEMAND_HEATMAP_GREEN_LAYER,
      "weight_green",
      HEATMAP_GREEN_RGB,
    );
    addTierHeatmap(
      DEMAND_HEATMAP_BLUE_LAYER,
      "weight_blue",
      HEATMAP_BLUE_RGB,
    );
    addTierHeatmap(DEMAND_HEATMAP_RED_LAYER, "weight_red", HEATMAP_RED_RGB);
  };

  const clearDemandZoneOverlay = (map: maplibregl.Map) => {
    const source = map.getSource(
      DEMAND_OVERLAY_SOURCE,
    ) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: [] });
  };

  // Original FreshUp map — CARTO light_all basemap.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    let cancelled = false;
    let didMarkReady = false;

    const markReady = (map: maplibregl.Map) => {
      if (cancelled || didMarkReady) return;
      didMarkReady = true;
      setReady(true);
      ensureDemandZoneLayers(map);
      addRouteLayer(map);
    };

    const map = new maplibregl.Map({
      container,
      style: FRESHUP_BASEMAP_STYLE,
      center: [center.lng, center.lat],
      zoom: 13,
      attributionControl: false,
      maxZoom: 18,
      minZoom: 5,
    });

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    map.on("load", () => {
      markReady(map);
      if (lockViewportToGridCell && isValidLngLat(center)) {
        fitBrowseViewportOneKm(map, center.lat, center.lng, 0);
      }
    });
    map.on("idle", () => {
      if (map.isStyleLoaded()) markReady(map);
    });

    map.on("error", (e) => {
      console.error("[map-view] map error", e.error?.message ?? e);
    });

    if (onMapClick) {
      map.on("click", (e) => {
        onMapClick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
    }

    mapRef.current = map;

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    userMovedViewportRef.current = false;
    lastFittedKeyRef.current = null;
    lastSyncedCenterRef.current = null;
  }, [viewportResetKey]);

  // GPS FAB / explicit recenter — clear pan lock and fly to current center.
  useEffect(() => {
    if (!recenterNonce || !mapRef.current || !ready) return;
    if (!isValidLngLat(center)) return;
    userMovedViewportRef.current = false;
    lastSyncedCenterRef.current = { lat: center.lat, lng: center.lng };
    runProgrammaticViewport(() => {
      if (lockViewportToGridCell) {
        fitBrowseViewportOneKm(mapRef.current!, center.lat, center.lng);
        return;
      }
      mapRef.current!.easeTo({
        center: [center.lng, center.lat],
        duration: 450,
      });
    });
    // Intentionally keyed on nonce only — center is read at bump time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterNonce, ready]);

  useEffect(() => {
    if (!mapRef.current || !ready || !lockViewportToGridCell) return;
    if (!isValidLngLat(center) || userMovedViewportRef.current) return;
    runProgrammaticViewport(() => {
      fitBrowseViewportOneKm(mapRef.current!, center.lat, center.lng);
    });
  }, [lockViewportToGridCell, ready, center.lat, center.lng]);

  // Respect manual pan/zoom — stop auto viewport changes until the next job.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onMoveStart = (e: maplibregl.MapLibreEvent) => {
      if (isProgrammaticMoveRef.current || !e.originalEvent) return;
      userMovedViewportRef.current = true;
    };

    map.on("movestart", onMoveStart);
    return () => {
      map.off("movestart", onMoveStart);
    };
  }, [ready]);

  const runProgrammaticViewport = (fn: () => void) => {
    const map = mapRef.current;
    if (!map) return;
    isProgrammaticMoveRef.current = true;
    fn();
    map.once("moveend", () => {
      isProgrammaticMoveRef.current = false;
    });
  };

  // Keep center in sync (disabled during active jobs so fitBounds can show both markers)
  useEffect(() => {
    if (!followCenter || !mapRef.current || !isValidLngLat(center)) return;
    if (userMovedViewportRef.current) return;
    const prev = lastSyncedCenterRef.current;
    if (
      prev &&
      Math.abs(prev.lat - center.lat) < 1e-6 &&
      Math.abs(prev.lng - center.lng) < 1e-6
    ) {
      return;
    }
    lastSyncedCenterRef.current = { lat: center.lat, lng: center.lng };
    runProgrammaticViewport(() => {
      if (lockViewportToGridCell) {
        fitBrowseViewportOneKm(mapRef.current!, center.lat, center.lng);
        return;
      }
      mapRef.current!.easeTo({
        center: [center.lng, center.lat],
        duration: 500,
      });
    });
  }, [center, followCenter, lockViewportToGridCell]);

  // Customer marker (blue dot) — single HTML marker only (no duplicate map layers)
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    const customerPoint = isValidLngLat(customer) ? customer : null;

    if (!customerPoint) {
      customerMarkerRef.current?.remove();
      customerMarkerRef.current = null;
      return;
    }

    if (!customerMarkerRef.current) {
      customerMarkerRef.current = new maplibregl.Marker({
        element: createLiveMarkerElement("customer"),
        anchor: "center",
      })
        .setLngLat([customerPoint.lng, customerPoint.lat])
        .addTo(mapRef.current);
    } else {
      applyLiveMarkerTone(customerMarkerRef.current.getElement(), "customer");
      customerMarkerRef.current.setLngLat([
        customerPoint.lng,
        customerPoint.lat,
      ]);
    }
  }, [customer, ready]);

  // Assigned provider marker (orange dot on provider side, orange when tracking provider on customer side)
  useEffect(() => {
    if (!mapRef.current || !ready) return;

    if (!isValidLngLat(providerPos)) {
      providerMarkerRef.current?.remove();
      providerMarkerRef.current = null;
      return;
    }

    const markerTone: "customer" | "provider" =
      providerMarkerTone === "customer" ? "customer" : "provider";

    if (!providerMarkerRef.current) {
      providerMarkerRef.current = new maplibregl.Marker({
        element: createLiveMarkerElement(markerTone),
        anchor: "center",
      })
        .setLngLat([providerPos.lng, providerPos.lat])
        .addTo(mapRef.current);
    } else {
      applyLiveMarkerTone(
        providerMarkerRef.current.getElement(),
        markerTone,
      );
      providerMarkerRef.current.setLngLat([providerPos.lng, providerPos.lat]);
    }
  }, [providerPos, providerMarkerTone, ready]);

  // Keep customer blue dot in front when requested (rating / completed overlap).
  useEffect(() => {
    if (!ready) return;
    const cEl = customerMarkerRef.current?.getElement();
    const pEl = providerMarkerRef.current?.getElement();
    if (!cEl || !pEl) return;
    if (customerMarkerOnTop) {
      cEl.style.zIndex = "2";
      pEl.style.zIndex = "1";
    } else {
      cEl.style.zIndex = "";
      pEl.style.zIndex = "";
    }
  }, [customer, providerPos, customerMarkerOnTop, ready]);

  const scheduleFleetMoveAnimation = () => {
    if (fleetAnimFrameRef.current != null) return;

    const tick = (now: number) => {
      let active = false;
      for (const [id, anim] of fleetAnimRef.current.entries()) {
        const marker = providerMarkersRef.current.get(id);
        if (!marker) {
          fleetAnimRef.current.delete(id);
          continue;
        }
        const t = Math.min(1, (now - anim.start) / FLEET_MOVE_ANIM_MS);
        const eased = 1 - (1 - t) ** 3;
        const lng = anim.from[0] + (anim.to[0] - anim.from[0]) * eased;
        const lat = anim.from[1] + (anim.to[1] - anim.from[1]) * eased;
        marker.setLngLat([lng, lat]);
        if (t < 1) active = true;
        else fleetAnimRef.current.delete(id);
      }
      if (active) {
        fleetAnimFrameRef.current = requestAnimationFrame(tick);
      } else {
        fleetAnimFrameRef.current = null;
      }
    };

    fleetAnimFrameRef.current = requestAnimationFrame(tick);
  };

  const moveFleetMarker = (
    id: string,
    marker: maplibregl.Marker,
    target: [number, number],
    animate: boolean,
  ) => {
    if (!animate) {
      marker.setLngLat(target);
      return;
    }
    const current = marker.getLngLat();
    fleetAnimRef.current.set(id, {
      from: [current.lng, current.lat],
      to: target,
      start: performance.now(),
    });
    scheduleFleetMoveAnimation();
  };

  // Provider pool / live fleet markers on the browse map.
  useEffect(() => {
    if (!mapRef.current || !ready) return;

    const existing = providerMarkersRef.current;
    const nextIds = new Set(normalizedProviders.map((p) => p.id));
    const useLiveFleet = fleetMarkerStyle === "live";

    if (useLiveFleet) ensureLiveFleetMarkerStyles();

    for (const [id, marker] of existing.entries()) {
      if (!nextIds.has(id)) {
        marker.remove();
        existing.delete(id);
        fleetAnimRef.current.delete(id);
      }
    }

    for (const p of normalizedProviders) {
      const target: [number, number] = [p.latlng[0], p.latlng[1]];
      let marker = existing.get(p.id);

      if (!marker) {
        const el = useLiveFleet
          ? createLiveFleetMarkerElement(
              fleetVariant,
              p.heading ?? 0,
            )
          : (() => {
              const numbered = document.createElement("div");
              const color =
                p.status === "unavailable" ? "#6b7280" : "#22c55e";
              numbered.className = "provider-pool-marker";
              numbered.style.cssText = `
          width: 32px;
          height: 32px;
          background: ${color};
          border: 2px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: bold;
          font-size: 14px;
          font-family: system-ui, -apple-system, sans-serif;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        `;
              numbered.textContent = String(p.number || "");
              return numbered;
            })();

        marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat(target)
          .addTo(mapRef.current!);
        existing.set(p.id, marker);
        continue;
      }

      if (useLiveFleet) {
        const el = marker.getElement();
        if (el && typeof p.heading === "number") {
          updateLiveFleetMarkerHeading(el, p.heading);
        }
        moveFleetMarker(p.id, marker, target, true);
      } else {
        marker.setLngLat(p.latlng);
        const el = marker.getElement();
        if (el) {
          const color = p.status === "unavailable" ? "#6b7280" : "#22c55e";
          el.style.background = color;
          el.textContent = String(p.number || "");
        }
      }
    }
  }, [normalizedProviders, fleetMarkerStyle, fleetVariant, ready]);

  // Route polyline
  useEffect(() => {
    if (!mapRef.current || !ready) return;

    const source = mapRef.current.getSource(
      "route",
    ) as maplibregl.GeoJSONSource;
    if (!source) return;

    if (!routeCoords || routeCoords.length < 2) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    source.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: routeCoords.map((p) => [p.lng, p.lat]),
      },
    });
  }, [routeCoords, ready]);

  // Fit bounds — only on explicit fitKey bumps, not live GPS marker updates.
  useEffect(() => {
    if (!mapRef.current || !ready) return;
    if (lastFittedKeyRef.current === fitKey) return;
    lastFittedKeyRef.current = fitKey;
    if (userMovedViewportRef.current) return;

    if (lockViewportToGridCell && isValidLngLat(center)) {
      runProgrammaticViewport(() => {
        fitBrowseViewportOneKm(mapRef.current!, center.lat, center.lng);
      });
      return;
    }

    const coords: [number, number][] = [];

    if (isValidLngLat(customer)) {
      coords.push([customer.lng, customer.lat]);
    }

    for (const p of normalizedProviders) {
      coords.push(p.latlng);
    }

    if (isValidLngLat(providerPos)) {
      coords.push([providerPos.lng, providerPos.lat]);
    }

    if (routeCoords && routeCoords.length >= 2) {
      coords.push([routeCoords[0].lng, routeCoords[0].lat]);
      const mid = routeCoords[Math.floor(routeCoords.length / 2)];
      coords.push([mid.lng, mid.lat]);
      coords.push([
        routeCoords[routeCoords.length - 1].lng,
        routeCoords[routeCoords.length - 1].lat,
      ]);
    }

    if (coords.length === 0) return;

    if (coords.length === 1) {
      runProgrammaticViewport(() => {
        if (lockViewportToGridCell) {
          fitBrowseViewportOneKm(mapRef.current!, coords[0][1], coords[0][0]);
          return;
        }
        mapRef.current!.easeTo({
          center: coords[0],
          zoom: 14,
          duration: 500,
        });
      });
      return;
    }

    const bounds = coords.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coords[0], coords[0]),
    );

    // When provider and customer are very close, still zoom out enough to see both pins.
    const spanKm =
      isValidLngLat(customer) && isValidLngLat(providerPos)
        ? haversineKm(customer, providerPos)
        : 0;
    if (spanKm > 0 && spanKm < 0.25) {
      const midLat = (customer!.lat + providerPos!.lat) / 2;
      const midLng = (customer!.lng + providerPos!.lng) / 2;
      const padDeg = Math.max(0.004, spanKm / 111);
      bounds.extend([midLng - padDeg, midLat - padDeg]);
      bounds.extend([midLng + padDeg, midLat + padDeg]);
    }

    runProgrammaticViewport(() => {
      mapRef.current!.fitBounds(bounds, {
        padding: { top: 80, bottom: 200, left: 40, right: 40 },
        duration: 500,
        maxZoom: spanKm > 2 ? 14 : 15,
      });
    });
  }, [
    customer,
    providerPos,
    routeCoords,
    normalizedProviders,
    fitKey,
    ready,
    lockViewportToGridCell,
    center,
  ]);

  // Opptatt demand-zone heatmap — refreshes on pan/zoom (debounced).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    if (
      !showDemandOverlay ||
      !demandOverlay?.serviceId ||
      !demandOverlay.accessToken
    ) {
      clearDemandZoneOverlay(map);
      return;
    }

    const effectEpoch = demandOverlayEpochRef.current;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let activeAbortController: AbortController | null = null;
    let zonesFetchPrimed = false;
    let latestRequestId = 0;
    const overlayConfig = demandOverlay;

    const overlayFetchKey = () => {
      const bounds = map.getBounds();
      return [
        overlayConfig.serviceId,
        overlayConfig.audience,
        bounds.getSouth().toFixed(3),
        bounds.getWest().toFixed(3),
        bounds.getNorth().toFixed(3),
        bounds.getEast().toFixed(3),
      ].join("|");
    };

    let lastFetchKey = "";

    const applyZones = async () => {
      if (effectEpoch !== demandOverlayEpochRef.current) return;

      const fetchKey = overlayFetchKey();
      if (fetchKey === lastFetchKey && zonesFetchPrimed) return;

      const requestId = ++latestRequestId;
      activeAbortController?.abort();
      const ac = new AbortController();
      activeAbortController = ac;

      onDemandOverlayLoadingChangeRef.current?.(true);
      try {
        const bounds = map.getBounds();
        const mapCenter = map.getCenter();
        const zones = await fetchDemandZonesInBbox(
          overlayConfig.accessToken,
          {
            serviceId: overlayConfig.serviceId,
            audience: overlayConfig.audience,
            minLat: bounds.getSouth(),
            minLng: bounds.getWest(),
            maxLat: bounds.getNorth(),
            maxLng: bounds.getEast(),
            centerLat: mapCenter.lat,
            centerLng: mapCenter.lng,
            language,
          },
          ac.signal,
        );
        if (requestId !== latestRequestId) return;
        if (effectEpoch !== demandOverlayEpochRef.current) return;
        if (ac.signal.aborted) return;

        const source = map.getSource(
          DEMAND_OVERLAY_SOURCE,
        ) as maplibregl.GeoJSONSource | undefined;
        if (!source) return;

        const geojson = demandZonesToHeatmapGeoJSON(
          zones.map((z) => ({
            grid_id: z.grid_id,
            tier: z.tier,
            used_capacity_pct: z.used_capacity_pct,
          })),
        );
        source.setData(geojson);
        lastFetchKey = fetchKey;
        zonesFetchPrimed = true;

        // Heatmap layers need a repaint after source updates.
        map.triggerRepaint();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (
          requestId === latestRequestId &&
          effectEpoch === demandOverlayEpochRef.current &&
          !ac.signal.aborted
        ) {
          onDemandOverlayLoadingChangeRef.current?.(false);
        }
      }
    };

    const scheduleRefresh = () => {
      if (!zonesFetchPrimed) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void applyZones();
      }, DEMAND_OVERLAY_MOVE_DEBOUNCE_MS);
    };

    ensureDemandZoneLayers(map);

    const startInitialFetch = () => {
      if (effectEpoch !== demandOverlayEpochRef.current) return;
      void applyZones();
    };

    const queueInitialFetch = () => {
      if (initialTimer) clearTimeout(initialTimer);
      initialTimer = setTimeout(() => {
        if (map.isMoving()) {
          map.once("idle", startInitialFetch);
        } else {
          startInitialFetch();
        }
      }, DEMAND_OVERLAY_INITIAL_DELAY_MS);
    };

    queueInitialFetch();
    map.on("moveend", scheduleRefresh);

    return () => {
      demandOverlayEpochRef.current += 1;
      activeAbortController?.abort();
      if (debounceTimer) clearTimeout(debounceTimer);
      if (initialTimer) clearTimeout(initialTimer);
      map.off("moveend", scheduleRefresh);
      map.off("idle", startInitialFetch);
    };
  }, [
    ready,
    showDemandOverlay,
    demandOverlay?.serviceId,
    demandOverlay?.audience,
    demandOverlay?.accessToken,
    language,
  ]);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      style={{ backgroundColor: MAP_SURFACE_COLOR }}
    >
      {marketCalculating && marketActivityLabel ? (
        <div className="pointer-events-none absolute bottom-36 left-1/2 z-[5] -translate-x-1/2">
          <div className="freshup-market-calculating__label">
            {marketActivityLabel}
          </div>
        </div>
      ) : null}
      {!ready && (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center"
          style={{ backgroundColor: MAP_SURFACE_COLOR }}
        >
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
            <span className="text-sm text-gray-500">
              {language === "en" ? "Loading map…" : "Laster kart…"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
