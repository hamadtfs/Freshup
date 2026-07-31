import type { StyleSpecification } from "maplibre-gl";
import { getMapboxPublicAccessToken } from "@/lib/maps/mapbox-config";

/** Original FreshUp basemap — CARTO light_all @2x (warm cream, soft roads, light labels). */
export const CARTO_LIGHT_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "FreshUp Clean Style",
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    {
      id: "osm-tiles",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

/** App map always uses this; Mapbox token powers directions only. */
export const FRESHUP_BASEMAP_STYLE = CARTO_LIGHT_MAP_STYLE;

/** Opt-in Mapbox raster tiles (`NEXT_PUBLIC_MAP_TILES=mapbox`) for future M5 work. */
export const MAPBOX_STYLE_ID =
  process.env.NEXT_PUBLIC_MAPBOX_STYLE || "mapbox/light-v11";

const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function buildMapboxRasterStyle(
  accessToken: string,
  styleId: string = MAPBOX_STYLE_ID,
): StyleSpecification {
  return {
    version: 8,
    name: "FreshUp Mapbox Light",
    sources: {
      mapbox: {
        type: "raster",
        tiles: [
          `https://api.mapbox.com/styles/v1/${styleId}/tiles/512/{z}/{x}/{y}@2x?access_token=${accessToken}`,
        ],
        tileSize: 512,
        attribution: MAPBOX_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "mapbox-raster",
        type: "raster",
        source: "mapbox",
        minzoom: 0,
        maxzoom: 22,
        paint: {
          "raster-saturation": -0.28,
          "raster-contrast": -0.08,
          "raster-brightness-max": 0.9,
        },
      },
    ],
  };
}

function mapTilesPreference(): "carto" | "mapbox" {
  const raw = process.env.NEXT_PUBLIC_MAP_TILES?.trim().toLowerCase();
  return raw === "mapbox" ? "mapbox" : "carto";
}

export function resolveMapLibreStyle(): StyleSpecification {
  if (mapTilesPreference() === "mapbox") {
    const token = getMapboxPublicAccessToken();
    if (token) return buildMapboxRasterStyle(token);
  }
  return FRESHUP_BASEMAP_STYLE;
}

export function mapAttributionNote(): string {
  const style = resolveMapLibreStyle();
  return style.name?.includes("Mapbox") ? "Mapbox" : "CARTO / OpenStreetMap";
}
