/** Provider/customer GPS publish interval during active jobs (client: 5–10 s). */
export const LIVE_LOCATION_PUBLISH_MS = 8_000;

/** Ignore GPS updates when moved less than this (meters). */
export const LIVE_LOCATION_MIN_MOVE_M = 25;

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

/** Provider in-app job step when GPS should be published. */
export function providerJobStepPublishesLiveLocation(step: string): boolean {
  const key = String(step || "").toLowerCase();
  return key === "enroute" || key === "in_service";
}
