/** Active-delivery GPS watch: ask the OS for frequent fixes (Uber-like). */
export const LIVE_LOCATION_WATCH_TIME_MS = 1_500;
export const LIVE_LOCATION_WATCH_DISTANCE_M = 8;

/**
 * Minimum gap between network publishes while watching.
 * Local markers still update on every watch fix.
 */
export const LIVE_LOCATION_PUBLISH_MS = 3_000;

/** Ignore network publishes when moved less than this (meters). */
export const LIVE_LOCATION_MIN_MOVE_M = 12;

/** DB `orders.status` values where provider live GPS is shared with the customer. */
export const PROVIDER_LIVE_LOCATION_DB_STATUSES = [
  "en_route",
  "in_progress",
] as const;

export function orderStatusSharesProviderLiveLocation(status: string): boolean {
  const key = String(status || "").toLowerCase();
  return (
    key === "en_route" || key === "in_progress"
  );
}

/** Customer UI status (`enroute` / `in_service`) aligned with live provider GPS. */
export function customerUiStatusShowsProviderLiveLocation(
  status: string,
): boolean {
  const key = String(status || "").toLowerCase();
  return key === "enroute" || key === "in_service";
}

/**
 * Customer UI status when the customer publishes GPS for the provider.
 * Matches `shouldPublishCustomerLiveLocation` in the mobile app.
 */
export function customerUiStatusPublishesLiveLocation(
  status: string,
): boolean {
  const key = String(status || "").toLowerCase();
  return key === "enroute" || key === "in_service";
}

/** Provider in-app job step when GPS should be published. */
export function providerJobStepPublishesLiveLocation(step: string): boolean {
  const key = String(step || "").toLowerCase();
  return key === "enroute" || key === "in_service";
}
