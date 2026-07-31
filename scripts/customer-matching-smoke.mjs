#!/usr/bin/env node
import assert from "node:assert/strict";

const baseUrl = process.env.BASE_URL || "http://localhost:3000";
const token = process.env.MATCH_BEARER_TOKEN;

if (!token) {
  console.error("Missing MATCH_BEARER_TOKEN env var.");
  process.exit(1);
}

async function postJson(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

const common = {
  service_id: "mid-fade",
  mode_id: "beauty",
  target_id: "male",
  category_id: "haircut",
  service_mode_id: "home",
};

const oslo = await postJson("/api/rpc/match_providers", {
  ...common,
  customer_lat: 59.9139,
  customer_lng: 10.7522,
});
assert.equal(oslo.status, 200, "Expected Oslo match request to return 200");
assert.ok(Array.isArray(oslo.data.providers), "Expected providers array in Oslo response");
assert.ok(oslo.data.providers.length > 0, "Expected at least one provider for Oslo test payload");
for (let i = 1; i < oslo.data.providers.length; i += 1) {
  const prev = oslo.data.providers[i - 1];
  const curr = oslo.data.providers[i];
  assert.ok(
    prev.distance_km < curr.distance_km ||
      (prev.distance_km === curr.distance_km &&
        prev.service_rating >= curr.service_rating),
    "Expected providers sorted by distance asc, then service_rating desc",
  );
}

const lahore = await postJson("/api/rpc/match_providers", {
  ...common,
  customer_lat: 31.4603,
  customer_lng: 74.3034,
});
assert.equal(lahore.status, 200, "Expected Lahore match request to return 200");
assert.ok(Array.isArray(lahore.data.providers), "Expected providers array in Lahore response");
assert.equal(lahore.data.providers.length, 0, "Expected zero providers for Lahore edge case payload");

const invalidHierarchy = await postJson("/api/rpc/match_providers", {
  ...common,
  target_id: "female",
  customer_lat: 59.9139,
  customer_lng: 10.7522,
});
assert.equal(
  invalidHierarchy.status,
  400,
  "Expected strict hierarchy test to return 400",
);
assert.equal(
  invalidHierarchy.data.error,
  "HIERARCHY_MISMATCH",
  "Expected HIERARCHY_MISMATCH when client hierarchy does not match service",
);

console.log("customer-matching-smoke: all checks passed");
