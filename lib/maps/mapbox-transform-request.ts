import type { RequestParameters, ResourceType } from "maplibre-gl";

/** MapLibre cannot fetch mapbox:// URLs directly — rewrite to HTTPS + token. */
export function createMapboxTransformRequest(
  accessToken: string,
): (url: string, resourceType?: ResourceType) => RequestParameters {
  return (url: string) => {
    if (url.startsWith("mapbox://")) {
      const path = url.slice("mapbox://".length);
      if (path.startsWith("sprites/")) {
        return {
          url: `https://api.mapbox.com/styles/v1/${path.slice("sprites/".length)}/sprite?access_token=${accessToken}`,
        };
      }
      if (path.startsWith("fonts/")) {
        return {
          url: `https://api.mapbox.com/fonts/v1/${path.slice("fonts/".length)}?access_token=${accessToken}`,
        };
      }
      return {
        url: `https://api.mapbox.com/v4/${path}.json?secure&access_token=${accessToken}`,
      };
    }
    if (url.includes("api.mapbox.com") && !url.includes("access_token=")) {
      const sep = url.includes("?") ? "&" : "?";
      return { url: `${url}${sep}access_token=${accessToken}` };
    }
    return { url };
  };
}
