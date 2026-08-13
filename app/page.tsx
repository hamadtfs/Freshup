"use client";

import type React from "react";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearStoredDashboardMode,
  readStoredDashboardMode,
  writeStoredDashboardMode,
} from "@/lib/auth/dashboard-mode";
import {
  fetchAccountRoles,
  setActiveRoleClaim,
} from "@/lib/auth/fetch-account-roles";
import {
  metadataRoleFromUser,
  pickDashboardMode,
} from "@/lib/auth/resolve-account-roles";
import { clearOAuthPending } from "@/lib/auth/oauth-pending";
import {
  clearProviderSignupInProgress,
  isProviderSignupInProgress,
} from "@/lib/auth/provider-signup-gate";
import {
  Scissors,
  X,
  Check,
  Phone,
  Star,
  Clock,
  MapPin,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  ArrowLeft,
  User,
  Mail,
  Lock,
  MessageSquare,
  MessageCircle,
  LocateFixed,
  Camera,
  Play,
  Pause,
  XCircle,
  Loader2,
} from "lucide-react";
import { offerCountdownSeconds } from "@/lib/orders/offerCountdown";
import { formatMmSs, isReadyForNextUnlocked } from "@/lib/orders/readyForNext";
import { computeServiceElapsedSeconds } from "@/lib/orders/serviceElapsed";
import { ProviderOnlineToggle } from "@/components/provider-online-toggle";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { SERVICE_ID_ALIASES } from "@/lib/service-id";
import { isEquipmentDependentAddon } from "@/lib/catalog/equipment-addons";
import { DISPATCH_PROVIDER_OFFER_TTL_MS } from "@/lib/orders/dispatchTiming";
import {
  CATEGORIES,
  SERVICES,
  type CategoryId,
  type Gender as GenderType,
} from "@/lib/services";
import { haversineKm, kmToEtaMinutes, snapRouteEndpoints } from "@/lib/geo";
import { fetchDrivingRoutePolylineClient } from "@/lib/maps/driving-route-client";
import { computeServiceProgressPercent } from "@/lib/orders/service-progress";
import ServiceCard from "../components/service-card";
import HamburgerMenu from "@/components/hamburger-menu";
import OrdersPage, { type OrderAgainPayload } from "@/components/orders-page";
import type { OrderHistoryCardData } from "@/components/order-history-card";
import SupportPage from "@/components/support-page";
import SupportChatPage from "@/components/support-chat-page";
import AboutPage from "@/components/about-page";
import ReportProviderPage, {
  type ReportProviderContext,
} from "@/components/report-provider-page";
import OrderChatModal from "@/components/order-chat-modal";
import PaymentPage from "@/components/payment-page";
import EarningsPage from "@/components/earnings-page";
import WalletPage from "@/components/wallet-page";
import AdminVerificationsPage from "@/components/admin-verifications-page";
import SkillsPage from "@/components/skills-page";
import ProfilePage from "@/components/profile-page";
import ChatPage from "@/components/chat-page";
import SplashScreen from "@/components/splash-screen";
import LoginPage from "@/components/login-page";
import { Toaster, toast } from "sonner";
import { computeDeliveryFee } from "@/lib/pricing";
import { legacyProviderBaseToCustomerServicePrice } from "@/lib/pricing/catalog-display-price";
import {
  formatDeliveryRateLabel,
  formatDisplayPrice,
} from "@/lib/pricing/format-display-kr";
import {
  providerNetFromCustomerAmount,
  resolveProviderAddonsNet,
  resolveProviderOfferEarnings,
  resolveProviderServiceNet,
} from "@/lib/pricing/provider-offer";
import {
  homeOrderCustomerTotal,
  resolveCustomerServicePrice,
  resolveServicePriceFromOrderTotal,
} from "@/lib/pricing/home-order-total";
import { DEFAULT_SEARCH_DELIVERY_KM } from "@/lib/pricing/interim-delivery-km";
import {
  formatCustomerJobTitleFromUi,
  formatDbOrderStatusLabel,
  formatProviderJobStepTitle,
} from "@/lib/orders/order-status-ui";
import { demandTierDotClass } from "@/lib/demand-zones/client";
import {
  capacityPctToTier,
  tierForAudience,
  tierPriceArrow,
  tierShortLabel,
  tierTextClass,
  type DemandZoneTier,
} from "@/lib/demand-zones/tiers";
import { openExternalMapsDirections } from "@/lib/maps/external-maps";
import { parseOfferDistanceKm as parseOfferMatchDistanceKm } from "@/lib/maps/resolve-customer-destination";
import {
  LIVE_LOCATION_MIN_MOVE_M,
  LIVE_LOCATION_PUBLISH_MS,
  customerUiStatusPublishesLiveLocation,
  customerUiStatusShowsProviderLiveLocation,
  providerJobStepPublishesLiveLocation,
} from "@/lib/constants/live-location";
import {
  REALTIME_SAFETY_POLL_MS,
  createAdaptivePoll,
  isRealtimeDownStatus,
} from "@/lib/realtime/adaptive-poll";
import { DISPATCH_TIER_GAP_MS } from "@/lib/orders/dispatchTiming";
import { maxDeliveryFeeAtDispatchRadius } from "@/lib/payments/delivery-ceiling";
import { authorizeAmountFromPriceLock } from "@/lib/payments/payment-amounts";
import { runBookingPaymentFlow } from "@/lib/payments/booking-payment-client";
import {
  loginToBookCopy,
  mapAuthGateCopy,
} from "@/lib/auth/login-required-copy";

/** Customer status poll while hunting — slightly after each 3s dispatch wave. */
const CUSTOMER_SEARCH_STATUS_POLL_MS = DISPATCH_TIER_GAP_MS + 500;
/** Active job status poll — realtime is primary; this is fallback only. */
const CUSTOMER_ACTIVE_STATUS_POLL_MS = 12_000;

const DEV_DEMO_SHORTCUTS =
  process.env.NEXT_PUBLIC_DEV_DEMO_SHORTCUTS === "true";

// Map component
const MapView = dynamic(() => import("@/components/map-view"), { ssr: false });

type LatLng = { lat: number; lng: number };
const OSLO_DEFAULT: LatLng = { lat: 59.9139, lng: 10.7522 };
// const OSLO_DEFAULT: LatLng = { lat: 31.5204, lng: 74.3587 };

/** Prefer live GPS when saved profile location is far away (common in two-browser local testing). */
function pickMarketDetectionCoords(
  saved: LatLng | null,
  live: LatLng | null,
  maxKm = 10,
): LatLng | null {
  if (saved && live) {
    if (haversineKm(saved, live) > maxKm) return live;
    return saved;
  }
  return saved ?? live ?? null;
}

function isSameLatLng(
  a: LatLng | null | undefined,
  b: LatLng | null | undefined,
  epsilon = 0.00001,
) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < epsilon && Math.abs(a.lng - b.lng) < epsilon;
}

type ProviderMapJobStep = "accepted" | "enroute" | "arrived" | "in_service";

/** Provider map origin — live GPS unless device GPS is at the customer pin while dispatch says the shop is far away. */
function resolveProviderMapOrigin(
  liveGps: LatLng | null | undefined,
  customerPin: LatLng | null | undefined,
  storedProviderPin: LatLng | null | undefined,
  matchDistanceKm?: number | null,
  jobStep?: ProviderMapJobStep | null,
): LatLng | null {
  if (!liveGps) return storedProviderPin ?? null;
  if (!customerPin) return liveGps;
  if (jobStep === "arrived" || jobStep === "in_service") return liveGps;

  const liveToCustomer = haversineKm(liveGps, customerPin);
  const storedToCustomer = storedProviderPin
    ? haversineKm(storedProviderPin, customerPin)
    : null;
  const matchKm =
    matchDistanceKm != null &&
    Number.isFinite(matchDistanceKm) &&
    matchDistanceKm > 0.5
      ? matchDistanceKm
      : null;

  const deviceLooksLikeCustomerSpot = liveToCustomer < 0.5;
  const storedLooksLikeDispatchShop =
    storedToCustomer != null &&
    (matchKm != null
      ? storedToCustomer >= Math.max(1, matchKm * 0.45)
      : storedToCustomer >= 1);

  if (
    storedProviderPin &&
    deviceLooksLikeCustomerSpot &&
    storedLooksLikeDispatchShop
  ) {
    return storedProviderPin;
  }

  if (matchKm != null && liveToCustomer < Math.min(1, matchKm * 0.25)) {
    return storedProviderPin ?? liveGps;
  }

  return liveGps;
}

/** Home delivery map/route origin — shop pin until live GPS moves away from customer. */
function resolveProviderHomeMapPin(
  liveGps: LatLng | null | undefined,
  customerPin: LatLng | null | undefined,
  shopPin: LatLng | null | undefined,
  jobStep?: ProviderMapJobStep | null,
): LatLng | null {
  if (!shopPin && !liveGps && !customerPin) return null;
  if (!customerPin) return liveGps ?? shopPin ?? null;
  if (jobStep === "arrived" || jobStep === "in_service") {
    if (liveGps && haversineKm(liveGps, customerPin) < 0.5) {
      return liveGps;
    }
    // Provider marked arrived — both map dots meet at the delivery address.
    return customerPin ?? liveGps ?? shopPin ?? null;
  }
  if (liveGps && haversineKm(liveGps, customerPin) >= 0.5) {
    return liveGps;
  }
  return shopPin ?? liveGps ?? null;
}

/** Driving polyline for home delivery — always shop → customer when both are known. */
function resolveHomeDeliveryRoute(
  shopPin: LatLng | null | undefined,
  customerPin: LatLng | null | undefined,
): { from: LatLng | null; to: LatLng | null } {
  const shop = isValidLatLng(shopPin) ? shopPin : null;
  const customer = isValidLatLng(customerPin) ? customerPin : null;
  if (shop && customer) return { from: shop, to: customer };
  return { from: shop ?? customer, to: customer ?? shop };
}

function routeEndpointsKey(from: LatLng, to: LatLng): string {
  return `${from.lat.toFixed(5)},${from.lng.toFixed(5)}->${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
}

function movedAtLeastMeters(
  a: LatLng | null | undefined,
  b: LatLng,
  minM: number,
): boolean {
  if (!a) return true;
  return haversineKm(a, b) * 1000 >= minM;
}

function isValidLatLng(p: LatLng | null | undefined): p is LatLng {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/** Nudge overlapping arrived pins so blue + orange both stay visible. */
function separateArrivedMapPins(
  customerPin: LatLng,
  providerPin: LatLng,
  minSepM = 22,
): { customer: LatLng; provider: LatLng } {
  if (haversineKm(customerPin, providerPin) * 1000 >= minSepM) {
    return { customer: customerPin, provider: providerPin };
  }
  const bump = minSepM / 111320;
  return {
    provider: {
      lat: providerPin.lat + bump * 0.65,
      lng: providerPin.lng + bump * 0.45,
    },
    customer: {
      lat: customerPin.lat - bump * 0.65,
      lng: customerPin.lng - bump * 0.45,
    },
  };
}

function homeDeliveryFeeFromKm(km: number): number {
  return computeDeliveryFee(km, true);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

type ProviderOfferPriceLockSlice = {
  customer_service_price?: number | null;
  provider_service_price?: number | null;
  delivery_fee?: number | null;
  addons_customer_total?: number | null;
  addons_provider_total?: number | null;
  customer_total?: number | null;
  delivery_km?: number | null;
};

type ProviderOfferAddonLine = {
  id: string;
  name: string;
  price: number;
};

function resolveProviderOfferAddonLines(
  orderAddonLines: ProviderOfferAddonLine[],
  priceLock: ProviderOfferPriceLockSlice | null | undefined,
  language: Language,
): ProviderOfferAddonLine[] {
  if (orderAddonLines.length > 0) return orderAddonLines;
  const total = Math.round(resolveProviderAddonsNet(priceLock, 0));
  if (total <= 0) return [];
  return [
    {
      id: "addons-total",
      name: language === "en" ? "Add-ons" : "Tillegg",
      price: total,
    },
  ];
}

async function fetchOfferPricing(
  orderId: string,
  accessToken: string | null | undefined,
): Promise<{
  priceLock: ProviderOfferPriceLockSlice | null;
  addonLines: ProviderOfferAddonLine[];
}> {
  if (!orderId || !accessToken) {
    return { priceLock: null, addonLines: [] };
  }
  try {
    const res = await fetch(
      `/api/orders/offer-pricing?order_id=${encodeURIComponent(orderId)}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) return { priceLock: null, addonLines: [] };
    const json = (await res.json()) as {
      price_lock?: ProviderOfferPriceLockSlice | null;
      addon_lines?: ProviderOfferAddonLine[];
    };
    const addonLines = Array.isArray(json?.addon_lines)
      ? json.addon_lines
          .map((line) => ({
            id: String(line.id || ""),
            name: String(line.name || "").trim(),
            price: Math.round(Number(line.price) || 0),
          }))
          .filter((line) => line.id && line.name && line.price > 0)
      : [];
    return { priceLock: json?.price_lock ?? null, addonLines };
  } catch {
    return { priceLock: null, addonLines: [] };
  }
}

async function fetchOfferPriceLock(
  orderId: string,
  accessToken: string | null | undefined,
): Promise<ProviderOfferPriceLockSlice | null> {
  const { priceLock } = await fetchOfferPricing(orderId, accessToken);
  return priceLock;
}

function sumProviderOfferAddonLines(
  addonLines: ProviderOfferAddonLine[],
): number {
  return addonLines.reduce(
    (sum, line) => sum + Math.round(Number(line.price) || 0),
    0,
  );
}

function pricingFromPriceLock(
  lock: ProviderOfferPriceLockSlice | null | undefined,
  orderPrice: number,
  mode: "home" | "provider",
  providerDistanceKm: number,
  addonLines: ProviderOfferAddonLine[] = [],
) {
  const lockedDelivery = roundMoney(Number(lock?.delivery_fee) || 0);
  const hasProviderDistance =
    Number.isFinite(providerDistanceKm) && providerDistanceKm > 0;
  const distanceDelivery = hasProviderDistance
    ? homeDeliveryFeeFromKm(providerDistanceKm)
    : 0;
  const addonsCustomer = Math.round(Number(lock?.addons_customer_total) || 0);
  let addonsProvider = Math.round(
    resolveProviderAddonsNet(lock, addonsCustomer),
  );
  const addonsFromLines = sumProviderOfferAddonLines(addonLines);
  if (addonsProvider <= 0 && addonsFromLines > 0) {
    addonsProvider = addonsFromLines;
  }
  const deliveryFee =
    mode === "home"
      ? distanceDelivery > 0
        ? distanceDelivery
        : lockedDelivery > 0
          ? lockedDelivery
          : homeDeliveryFeeFromKm(0)
      : 0;
  const customerService =
    mode === "home"
      ? resolveServicePriceFromOrderTotal(
          orderPrice,
          mode,
          lock,
          addonsCustomer,
        )
      : resolveCustomerServicePrice(lock, orderPrice);
  const providerService = Math.round(
    resolveProviderServiceNet(lock, customerService),
  );
  const displayServicePrice = Math.round(customerService);
  const displayDeliveryFee = Math.round(deliveryFee);

  return {
    servicePrice: displayServicePrice,
    providerServicePrice: providerService,
    lockedDeliveryFee: displayDeliveryFee,
    addonsCustomerTotal: addonsCustomer,
    addonsProviderTotal: addonsProvider,
    deliveryFee: displayDeliveryFee,
    orderTotal: displayServicePrice + addonsCustomer + displayDeliveryFee,
    providerEarnings: providerService + addonsProvider + displayDeliveryFee,
  };
}

function providerOfferDeliveryFee(offer: {
  mode?: "home" | "provider";
  location?: { distance?: unknown };
  matchDistanceKm?: number | null;
  lockedDeliveryFee?: number;
}): number {
  if (offer.mode !== "home") return 0;
  const matchKm = offer.matchDistanceKm;
  const distanceKm =
    typeof matchKm === "number" && Number.isFinite(matchKm) && matchKm >= 0
      ? matchKm
      : parseOfferDistanceKm(offer.location?.distance);
  if (Number.isFinite(distanceKm) && distanceKm > 0) {
    return Math.round(homeDeliveryFeeFromKm(distanceKm));
  }
  const locked = Math.round(Number(offer.lockedDeliveryFee) || 0);
  if (locked > 0) return locked;
  return Math.round(homeDeliveryFeeFromKm(0));
}

/** Instant provider-offer prices from order_offers.offered_price (no hydration wait). */
function providerOfferQuickPrices(opts: {
  offeredPrice: number;
  distanceKm: number;
  mode?: "home" | "provider";
}): {
  servicePrice: number;
  deliveryFee: number;
  customerOrderTotal: number;
} {
  const customerOrderTotal = Math.round(Number(opts.offeredPrice) || 0);
  const mode = opts.mode === "provider" ? "provider" : "home";
  if (customerOrderTotal <= 0) {
    return { servicePrice: 0, deliveryFee: 0, customerOrderTotal: 0 };
  }
  if (mode !== "home") {
    return {
      servicePrice: customerOrderTotal,
      deliveryFee: 0,
      customerOrderTotal,
    };
  }
  const distanceKm = Number(opts.distanceKm);
  const deliveryFee =
    Number.isFinite(distanceKm) && distanceKm >= 0
      ? Math.round(homeDeliveryFeeFromKm(distanceKm))
      : 0;
  const servicePrice = Math.max(0, customerOrderTotal - deliveryFee);
  return { servicePrice, deliveryFee, customerOrderTotal };
}

function providerOfferDisplayServicePrice(offer: {
  providerServicePrice?: number;
  service: { price: number };
  mode?: "home" | "provider";
  customerOrderTotal?: number;
  matchDistanceKm?: number | null;
  location?: { distance?: unknown };
  lockedDeliveryFee?: number;
}): number {
  const explicit = Math.round(Number(offer.providerServicePrice) || 0);
  if (explicit > 0) return explicit;
  const stored = Math.round(Number(offer.service.price) || 0);
  if (stored > 0) return stored;
  const distanceKm =
    typeof offer.matchDistanceKm === "number" &&
    Number.isFinite(offer.matchDistanceKm) &&
    offer.matchDistanceKm >= 0
      ? offer.matchDistanceKm
      : parseOfferDistanceKm(offer.location?.distance);
  const quick = providerOfferQuickPrices({
    offeredPrice: Number(offer.customerOrderTotal) || 0,
    distanceKm,
    mode: offer.mode,
  });
  return providerNetFromCustomerAmount(quick.servicePrice);
}

function orderTotalFromPriceLock(
  lock: ProviderOfferPriceLockSlice | null | undefined,
  orderPriceFallback = 0,
): number {
  const explicitTotal = Number(lock?.customer_total);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    return explicitTotal;
  }
  const service = roundMoney(Number(lock?.customer_service_price) || 0);
  const addons = roundMoney(Number(lock?.addons_customer_total) || 0);
  const delivery = roundMoney(Number(lock?.delivery_fee) || 0);
  const sum = service + addons + delivery;
  if (sum > 0) return sum;
  const fallback = Number(orderPriceFallback);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
}

function bookedOrderTotalFromSources(
  priceLock: ProviderOfferPriceLockSlice | null | undefined,
  orderPrice: number,
  computedTotal = 0,
): number {
  const fromLock = orderTotalFromPriceLock(priceLock, orderPrice);
  if (fromLock > 0) return fromLock;
  if (Number.isFinite(orderPrice) && orderPrice > 0) return orderPrice;
  if (Number.isFinite(computedTotal) && computedTotal > 0) return computedTotal;
  return 0;
}

function providerOfferOrderTotal(offer: {
  customerOrderTotal?: number;
  service: { price: number };
  mode?: "home" | "provider";
  location?: { distance?: unknown };
  addonsCustomerTotal?: number;
  addonsProviderTotal?: number;
  lockedDeliveryFee?: number;
  matchDistanceKm?: number | null;
  providerEarnings?: number;
  providerServicePrice?: number;
}): number {
  const earnings = providerOfferProviderEarnings(offer);
  if (earnings > 0) return earnings;

  const distanceKm =
    typeof offer.matchDistanceKm === "number" &&
    Number.isFinite(offer.matchDistanceKm) &&
    offer.matchDistanceKm >= 0
      ? offer.matchDistanceKm
      : parseOfferDistanceKm(offer.location?.distance);
  const quick = providerOfferQuickPrices({
    offeredPrice: Number(offer.customerOrderTotal) || 0,
    distanceKm,
    mode: offer.mode,
  });
  return (
    providerNetFromCustomerAmount(quick.servicePrice) +
    Math.round(Number(offer.addonsProviderTotal) || 0) +
    (offer.mode === "home" ? quick.deliveryFee : 0)
  );
}

function customerPriceLockFromQuoteBreakdown(
  breakdown: Record<string, unknown> | null | undefined,
): ProviderOfferPriceLockSlice | null {
  if (!breakdown) return null;
  return {
    customer_service_price: Number(breakdown.customerServicePrice) || 0,
    provider_service_price: Number(breakdown.providerServicePrice) || 0,
    delivery_fee: Number(breakdown.deliveryFee) || 0,
    addons_customer_total: Number(breakdown.addonsCustomerTotal) || 0,
    addons_provider_total: Number(breakdown.addonsProviderTotal) || 0,
    customer_total:
      Number(breakdown.customerTotal) || Number(breakdown.customer_total) || 0,
  };
}

function customerPriceLockFromApiPricing(
  pricing: Record<string, unknown> | null | undefined,
): ProviderOfferPriceLockSlice | null {
  if (!pricing) return null;
  return {
    customer_service_price: Number(pricing.customer_service_price) || 0,
    delivery_fee: Number(pricing.delivery_fee) || 0,
    addons_customer_total: Number(pricing.addons_customer_total) || 0,
    customer_total: Number(pricing.customer_total) || 0,
  };
}

function customerMatchedOrderTotal(
  priceLock: ProviderOfferPriceLockSlice | null | undefined,
  orderPriceFallback: number,
  mode: "home" | "provider",
  providerDistanceKm: number | null | undefined,
): number {
  if (mode === "home") {
    return homeOrderCustomerTotal(
      priceLock,
      orderPriceFallback,
      providerDistanceKm,
    );
  }
  return orderTotalFromPriceLock(priceLock, orderPriceFallback);
}

function readProviderDistanceKm(
  providerData: Record<string, unknown> | null | undefined,
): number | null {
  const km = Number(providerData?.distance_km ?? providerData?.distanceKm);
  return Number.isFinite(km) && km >= 0 ? km : null;
}

function resolveProviderDisplayName(opts: {
  name?: unknown;
  businessName?: unknown;
  displayName?: unknown;
  providerId: string;
  language: Language;
}): string {
  for (const candidate of [opts.name, opts.businessName, opts.displayName]) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return `${opts.language === "en" ? "Provider" : "Tilbyder"} ${opts.providerId.slice(0, 6)}`;
}

function readContactAvatarUrl(
  contact: Record<string, unknown> | null | undefined,
): string | null {
  const url = String(contact?.avatarUrl ?? contact?.avatar_url ?? "").trim();
  return url || null;
}

function readProviderAvatarUrl(
  providerData: Record<string, unknown> | null | undefined,
): string | null {
  return readContactAvatarUrl(providerData);
}

function resolveCustomerDisplayName(opts: {
  name?: unknown;
  displayName?: unknown;
  customerId: string;
  language: Language;
}): string {
  for (const candidate of [opts.name, opts.displayName]) {
    const value = String(candidate ?? "").trim();
    if (value) return value;
  }
  return `${opts.language === "en" ? "Customer" : "Kunde"} ${opts.customerId.slice(0, 6)}`;
}

function buildOfferCustomer(
  apiCustomer: Record<string, unknown> | null | undefined,
  customerIdFallback: string,
  language: Language,
): {
  name: string;
  avatar: string;
  avatarUrl?: string | null;
  rating: number;
  phone: string;
  id?: string;
} {
  const customerId = String(apiCustomer?.id ?? customerIdFallback ?? "").trim();
  return {
    id: customerId || undefined,
    name: resolveCustomerDisplayName({
      name: apiCustomer?.name,
      displayName: apiCustomer?.display_name ?? apiCustomer?.displayName,
      customerId: customerId || "unknown",
      language,
    }),
    avatar: "👤",
    avatarUrl: readContactAvatarUrl(apiCustomer),
    rating: 4.8,
    phone: String(apiCustomer?.phone ?? "").trim(),
  };
}

async function fetchOrderCustomerParty(
  orderId: string,
  accessToken: string | null | undefined,
  customerIdFallback: string,
  language: Language,
) {
  if (!accessToken || !orderId) {
    return buildOfferCustomer(null, customerIdFallback, language);
  }
  try {
    const res = await fetch(
      `/api/orders/customer-info?order_id=${encodeURIComponent(orderId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      return buildOfferCustomer(null, customerIdFallback, language);
    }
    const data = await res.json().catch(() => ({}));
    return buildOfferCustomer(
      (data?.customer ?? null) as Record<string, unknown> | null,
      customerIdFallback,
      language,
    );
  } catch {
    return buildOfferCustomer(null, customerIdFallback, language);
  }
}

function isPlaceholderServiceName(name: string, language: Language): boolean {
  const trimmed = String(name || "").trim();
  if (!trimmed) return true;
  return trimmed === "Service" || trimmed === "Tjeneste";
}

function isProviderOfferFullyHydrated(
  offer: {
    service?: { name?: string };
    customer?: { name?: string };
  } | null,
  language: Language,
): boolean {
  if (!offer) return false;
  const serviceName = String(offer.service?.name || "").trim();
  const customerName = String(offer.customer?.name || "").trim();
  // Require a real service label. Allow fallback customer labels like
  // "Customer 362ae9" — many profiles have null display_name, and blocking
  // on that hid the offer sheet after customer-info already succeeded.
  if (!serviceName || !customerName) return false;
  return !isPlaceholderServiceName(serviceName, language);
}

async function resolveProviderAccessToken(supabase: {
  auth: {
    getSession: () => Promise<{
      data: { session?: { access_token?: string } | null };
    }>;
  };
}): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token ?? null;
    if (token) return token;
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  return null;
}

function resolveCustomerPartyFromProfile(
  profile: { display_name?: string | null; avatar_url?: string | null } | null,
  customerId: string,
  language: Language,
) {
  const displayName = String(profile?.display_name || "").trim();
  if (!displayName) return null;
  return buildOfferCustomer(
    {
      id: customerId,
      name: displayName,
      avatar_url: profile?.avatar_url ?? null,
    },
    customerId,
    language,
  );
}

function resolveServiceRowFromOrder(
  order: Record<string, unknown> | null | undefined,
) {
  if (!order) return null;
  const nested = order.services;
  if (!nested || typeof nested !== "object") return null;
  return Array.isArray(nested) ? (nested[0] ?? null) : nested;
}

function resolveCustomerProviderFromStatus(
  providerData: Record<string, unknown>,
  language: Language,
  codePrefix: string,
) {
  const codeNum = Math.floor(100 + Math.random() * 900);
  const providerId = String(providerData.id);
  const distanceKm = readProviderDistanceKm(providerData);
  return {
    id: providerId,
    name: resolveProviderDisplayName({
      name: providerData.name,
      businessName: providerData.business_name ?? providerData.businessName,
      displayName: providerData.display_name ?? providerData.displayName,
      providerId,
      language,
    }),
    rating: 4.8,
    code: `${codePrefix}${codeNum}`,
    distanceKm,
    avatarUrl: readProviderAvatarUrl(providerData),
    phone: String(providerData.phone ?? "").trim() || null,
  };
}

function CustomerProviderAvatar({
  avatarUrl,
  name,
  className,
  iconClassName,
}: {
  avatarUrl?: string | null;
  name: string;
  className?: string;
  iconClassName?: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={cn("rounded-full object-cover", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center glass-morphism border-0 text-gray-700",
        className,
      )}
    >
      <User className={cn("text-gray-600", iconClassName ?? "h-5 w-5")} />
    </div>
  );
}

function providerOfferProviderEarnings(offer: {
  providerEarnings?: number;
  providerServicePrice?: number;
  service: { price: number };
  mode?: "home" | "provider";
  location?: { distance?: unknown };
  addonsProviderTotal?: number;
  addonsCustomerTotal?: number;
  lockedDeliveryFee?: number;
  matchDistanceKm?: number | null;
}): number {
  const stored = Number(offer.providerEarnings);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);

  const deliveryFee =
    offer.mode === "home" ? providerOfferDeliveryFee(offer) : 0;

  return resolveProviderOfferEarnings({
    providerServicePrice:
      Number(offer.providerServicePrice) ||
      Number(offer.service.price) ||
      undefined,
    addonsProviderTotal: offer.addonsProviderTotal,
    addonsCustomerTotal: offer.addonsCustomerTotal,
    deliveryFee,
    mode: offer.mode,
  });
}

type ServiceMode = "home" | "provider";
type OrderStatus =
  | "searching"
  | "assigned"
  | "enroute"
  | "arrived"
  | "in_service"
  | "completed"
  | "cancelled";
type Language = "no" | "en";
const PROVIDER_SETUP_REDIRECT_KEY = "freshup.providerSetupRedirect";
const SKILLS_SAVED_MAIN_REDIRECT_KEY = "freshup.skillsSavedGoMainOnce";
const LANGUAGE_STORAGE_KEY = "freshup.language";
const PROVIDER_OFFER_EXPIRES_MS = DISPATCH_PROVIDER_OFFER_TTL_MS;
const PROVIDER_OFFER_EXPIRES_SECONDS = Math.round(
  PROVIDER_OFFER_EXPIRES_MS / 1000,
);
const PROVIDER_INCOMING_TIMER_STORAGE_PREFIX =
  "freshup_provider_incoming_timer:";
const PROVIDER_QUEUED_TIMER_STORAGE_PREFIX = "freshup_provider_queued_timer:";

function readProviderOfferDisplayExpiresAt(
  storagePrefix: string,
  offerId: string,
): string | null {
  if (typeof window === "undefined" || !offerId) return null;
  try {
    return sessionStorage.getItem(`${storagePrefix}${offerId}`);
  } catch {
    return null;
  }
}

function writeProviderOfferDisplayExpiresAt(
  storagePrefix: string,
  offerId: string,
  expiresAtIso: string,
): void {
  if (typeof window === "undefined" || !offerId || !expiresAtIso) return;
  try {
    sessionStorage.setItem(`${storagePrefix}${offerId}`, expiresAtIso);
  } catch {
    /* ignore quota */
  }
}

function clearProviderOfferDisplayExpiresAt(
  storagePrefix: string,
  offerId: string,
): void {
  if (typeof window === "undefined" || !offerId) return;
  try {
    sessionStorage.removeItem(`${storagePrefix}${offerId}`);
  } catch {
    /* ignore */
  }
}

/** Full 60s UI window on first show; survives refresh via sessionStorage. */
function resolveProviderIncomingDisplayExpiresAt(
  offerId: string,
  _serverExpiresAtIso: string | null | undefined,
  nowMs = Date.now(),
): string {
  const existing = readProviderOfferDisplayExpiresAt(
    PROVIDER_INCOMING_TIMER_STORAGE_PREFIX,
    offerId,
  );
  if (existing) {
    const existingMs = new Date(existing).getTime();
    if (Number.isFinite(existingMs) && existingMs > nowMs) {
      return existing;
    }
  }

  // Count from when the provider sees hydrated details, not dispatch `expires_at`
  // (network + hydration often consume 2–4s before the sheet appears).
  const deadlineIso = new Date(nowMs + PROVIDER_OFFER_EXPIRES_MS).toISOString();
  writeProviderOfferDisplayExpiresAt(
    PROVIDER_INCOMING_TIMER_STORAGE_PREFIX,
    offerId,
    deadlineIso,
  );
  return deadlineIso;
}

function resolveProviderQueuedDisplayExpiresAt(
  offerId: string,
  nowMs = Date.now(),
): string {
  const existing = readProviderOfferDisplayExpiresAt(
    PROVIDER_QUEUED_TIMER_STORAGE_PREFIX,
    offerId,
  );
  if (existing) {
    const existingMs = new Date(existing).getTime();
    if (Number.isFinite(existingMs) && existingMs > nowMs) {
      return existing;
    }
  }
  const deadlineIso = new Date(nowMs + PROVIDER_OFFER_EXPIRES_MS).toISOString();
  writeProviderOfferDisplayExpiresAt(
    PROVIDER_QUEUED_TIMER_STORAGE_PREFIX,
    offerId,
    deadlineIso,
  );
  return deadlineIso;
}

function formatProviderOfferDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return "—";
  if (distanceKm < 0.1) return "< 0.1 km";
  if (distanceKm < 1) return `${distanceKm.toFixed(2)} km`;
  return `${distanceKm.toFixed(1)} km`;
}

const ACTIVE_JOB_ORDER_STATUSES = [
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
] as const;

function providerJobStepFromOrderStatus(
  status: string,
): "accepted" | "enroute" | "arrived" | "in_service" | null {
  switch (status) {
    case "assigned":
      return "accepted";
    case "en_route":
      return "enroute";
    case "arrived":
      return "arrived";
    case "in_progress":
      return "in_service";
    default:
      return null;
  }
}

function customerFlowFromOrderStatus(
  status: string,
): { step: "matched" | "in_service"; status: OrderStatus } | null {
  switch (status) {
    case "assigned":
      return { step: "matched", status: "assigned" };
    case "en_route":
      return { step: "matched", status: "enroute" };
    case "arrived":
      return { step: "matched", status: "arrived" };
    case "in_progress":
      return { step: "in_service", status: "in_service" };
    default:
      return null;
  }
}

function customerStatusToMapStep(
  orderStatus: OrderStatus,
): ProviderMapJobStep | null {
  switch (orderStatus) {
    case "assigned":
      return "accepted";
    case "enroute":
      return "enroute";
    case "arrived":
      return "arrived";
    case "in_service":
      return "in_service";
    default:
      return null;
  }
}

/** Supabase auth user id from localStorage (works in browser console; no @/ imports). */
function readSupabaseUserIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as {
        user?: { id?: string };
        currentSession?: { user?: { id?: string } };
      };
      const id = data?.user?.id ?? data?.currentSession?.user?.id;
      if (typeof id === "string" && id.length > 0) return id;
    }
  } catch {
    // ignore malformed auth payload
  }
  return null;
}

function readStoredLanguage(): Language | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (v === "no" || v === "en") return v;
  return null;
}

function writeStoredLanguage(language: Language) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

/** Km from labels like "5.2 km"; missing → 0 so fee stays base-only (no NaN). */
function parseOfferDistanceKm(distanceLabel: unknown): number {
  const raw = String(distanceLabel ?? "").trim();
  if (!raw || raw === "—" || raw === "-" || /^n\/?a$/i.test(raw)) return 0;
  const m = raw.match(/[\d]+(?:[.,]\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0].replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function resolveUserModeFromMetadata(sessionUser: {
  user_metadata?: any;
  app_metadata?: any;
}): "customer" | "provider" {
  return metadataRoleFromUser(sessionUser) ?? "customer";
}

function resolveDashboardMode(sessionUser: {
  id: string;
  user_metadata?: any;
  app_metadata?: any;
}): "customer" | "provider" {
  // Preference cache only — applySession re-resolves from /api/auth/roles.
  const stored = readStoredDashboardMode(sessionUser.id);
  return stored ?? resolveUserModeFromMetadata(sessionUser);
}

async function resolveDashboardModeFromServer(
  sessionUser: {
    id: string;
    user_metadata?: any;
    app_metadata?: any;
  },
  accessToken?: string | null,
  preferredIntent?: "customer" | "provider" | null,
): Promise<"customer" | "provider"> {
  const roles = await fetchAccountRoles({
    accessToken,
    intent: preferredIntent ?? null,
  });
  if (roles) {
    const mode = pickDashboardMode({
      hasCustomer: roles.has_customer,
      hasProvider: roles.has_provider,
      preferredIntent: preferredIntent ?? null,
      stored: readStoredDashboardMode(sessionUser.id),
      metadataRole: metadataRoleFromUser(sessionUser),
    });
    writeStoredDashboardMode(sessionUser.id, mode);
    return mode;
  }
  return resolveDashboardMode(sessionUser);
}

type AppPage =
  | "main"
  | "orders"
  | "support"
  | "support-chat"
  | "about"
  | "payment"
  | "earnings"
  | "wallet"
  | "stats"
  | "skills"
  | "profile"
  | "chat"
  | "report"
  | "admin";

function pageFromPathname(pathname: string): AppPage | null {
  const normalized = pathname.replace(/^\/+|\/+$/g, "");
  if (!normalized) return "main";
  if (
    normalized === "orders" ||
    normalized === "support" ||
    normalized === "support-chat" ||
    normalized === "about" ||
    normalized === "payment" ||
    normalized === "earnings" ||
    normalized === "wallet" ||
    normalized === "stats" ||
    normalized === "skills" ||
    normalized === "profile" ||
    normalized === "chat" ||
    normalized === "report" ||
    normalized === "admin"
  ) {
    return normalized;
  }
  return null;
}

function pathnameFromPage(page: AppPage): string {
  return page === "main" ? "/" : `/${page}`;
}

function normalizeServiceId(serviceId: unknown): string {
  return String(serviceId || "")
    .trim()
    .replace(/_/g, "-");
}

function serviceIdVariants(serviceId: unknown): string[] {
  const raw = String(serviceId || "").trim();
  if (!raw) return [];
  const dash = raw.replace(/_/g, "-");
  const underscore = raw.replace(/-/g, "_");
  return [...new Set([raw, dash, underscore])];
}

const DASHBOARD_SERVICE_ID_ALIASES: Record<string, string[]> =
  SERVICE_ID_ALIASES;

function serviceIdVariantsForDashboard(serviceId: unknown): string[] {
  const normalized = normalizeServiceId(serviceId);
  const direct = serviceIdVariants(normalized);
  const alias = DASHBOARD_SERVICE_ID_ALIASES[normalized] || [];
  const reverseAliases = Object.entries(DASHBOARD_SERVICE_ID_ALIASES)
    .filter(([, mapped]) =>
      mapped.some((id) => normalizeServiceId(id) === normalized),
    )
    .map(([uiId]) => uiId);
  const aliasVariants = [...alias, ...reverseAliases].flatMap((id) =>
    serviceIdVariants(id),
  );
  return [
    ...new Set(
      [...direct, ...aliasVariants].map((id) => normalizeServiceId(id)),
    ),
  ];
}

type DashboardDynamicPriceEntry = {
  customer: number;
  multiplier: number;
  usedCapacityPct: number | null;
  isActive: boolean;
  marketClosed?: boolean;
};

function lookupDynamicPriceEntry(
  serviceId: string,
  prices: Record<string, DashboardDynamicPriceEntry>,
): DashboardDynamicPriceEntry | undefined {
  const normalized = normalizeServiceId(serviceId);
  const variants = [
    normalized,
    ...serviceIdVariantsForDashboard(serviceId).filter(
      (id) => id !== normalized,
    ),
  ];
  for (const variant of variants) {
    const entry = prices[variant];
    if (entry) return entry;
  }
  return undefined;
}

function lookupDynamicCustomerPrice(
  serviceId: string,
  prices: Record<string, DashboardDynamicPriceEntry>,
): number | undefined {
  const entry = lookupDynamicPriceEntry(serviceId, prices);
  if (typeof entry?.customer === "number" && entry.customer > 0) {
    return roundMoney(entry.customer);
  }
  return undefined;
}

function customerDemandTierFromPrices(
  serviceId: string,
  prices: Record<string, DashboardDynamicPriceEntry>,
): DemandZoneTier | null {
  const entry = lookupDynamicPriceEntry(serviceId, prices);
  if (!entry) return null;
  if (entry.marketClosed) return "closed";
  const usedCapacityPct = entry.usedCapacityPct;
  if (usedCapacityPct == null || !Number.isFinite(usedCapacityPct)) {
    return null;
  }
  return capacityPctToTier(usedCapacityPct);
}

function providerDemandTierFromPrices(
  serviceId: string,
  prices: Record<string, DashboardDynamicPriceEntry>,
): DemandZoneTier | null {
  const entry = lookupDynamicPriceEntry(serviceId, prices);
  if (!entry) return null;
  if (entry.marketClosed) return "closed";
  const usedCapacityPct = entry.usedCapacityPct;
  if (usedCapacityPct == null || !Number.isFinite(usedCapacityPct)) {
    return null;
  }
  return tierForAudience(usedCapacityPct, "provider");
}

/** Prefer quote-bulk price; else convert DB provider legacy base to customer price. */
function resolveCatalogServicePrice(
  serviceId: string,
  opts: {
    providerLegacyBase?: number;
    staticListPrice?: number;
    prices: Record<string, DashboardDynamicPriceEntry>;
  },
): number {
  const dynamic = lookupDynamicCustomerPrice(serviceId, opts.prices);
  if (dynamic != null) return dynamic;
  const providerBase = roundMoney(Number(opts.providerLegacyBase) || 0);
  if (providerBase > 0) {
    // Mid-capacity default — matches seed; avoids flashing quietest −30% price.
    return legacyProviderBaseToCustomerServicePrice(providerBase, {
      usedCapacityPct: 50,
      multiplier: 0,
    });
  }
  // staticListPrice is already customer-facing (prior resolve / UI catalog).
  // Do not apply commission again.
  const staticBase = roundMoney(Number(opts.staticListPrice) || 0);
  return staticBase > 0 ? staticBase : 0;
}

function readServiceProviderLegacyBase(row: {
  base_price_min?: number | null;
  base_price_max?: number | null;
}): number {
  const min = Number(row.base_price_min) || 0;
  const max = Number(row.base_price_max) || 0;
  if (min > 0 && max > 0) return Math.round((min + max) / 2);
  if (min > 0) return min;
  if (max > 0) return max;
  return 0;
}

function lookupDbServiceProviderLegacyBase(
  serviceId: string,
  dbCatalog: {
    services?: Array<{
      id?: string;
      base_price_min?: number | null;
      base_price_max?: number | null;
    }>;
  } | null,
): number {
  if (!dbCatalog?.services?.length) return 0;
  const normalized = normalizeServiceId(serviceId);
  for (const row of dbCatalog.services) {
    if (normalizeServiceId(row.id) !== normalized) continue;
    const legacy = readServiceProviderLegacyBase(row);
    if (legacy > 0) return legacy;
  }
  const variants = new Set(
    serviceIdVariantsForDashboard(serviceId).flatMap((id) =>
      serviceIdVariants(id),
    ),
  );
  for (const row of dbCatalog.services) {
    const rowVariants = serviceIdVariants(row.id);
    if (!rowVariants.some((id) => variants.has(id))) continue;
    const legacy = readServiceProviderLegacyBase(row);
    if (legacy > 0) return legacy;
  }
  return 0;
}

function resolveCatalogDisplayPrice(
  serviceId: string,
  staticListPrice: number,
  prices: Record<string, DashboardDynamicPriceEntry>,
  dbCatalog: {
    services?: Array<{
      id?: string;
      base_price_min?: number | null;
      base_price_max?: number | null;
    }>;
  } | null,
): number {
  const providerLegacyBase = lookupDbServiceProviderLegacyBase(
    serviceId,
    dbCatalog,
  );
  return resolveCatalogServicePrice(serviceId, {
    providerLegacyBase,
    staticListPrice,
    prices,
  });
}

function sharedDeliveryModeKey(userId: string): string {
  return `freshup.deliveryMode.${userId}`;
}

function providerSkillsSnapshotKey(userId: string): string {
  return `freshup.skills.snapshot.${userId}`;
}

const PROVIDER_SKILLS_SNAPSHOT_FRESH_MS = 120_000;

function readProviderSkillsSnapshot(userId: string): {
  services?: string[];
  savedAt?: number;
  ratings?: Record<string, number>;
} | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = localStorage.getItem(providerSkillsSnapshotKey(userId));
    if (!raw) return null;
    return JSON.parse(raw) as {
      services?: string[];
      savedAt?: number;
      ratings?: Record<string, number>;
    };
  } catch {
    return null;
  }
}

function expandSnapshotServiceIds(serviceIds: string[]): string[] {
  return [
    ...new Set(
      serviceIds
        .map((id) => normalizeServiceId(id))
        .filter(Boolean)
        .flatMap((id) => serviceIdVariantsForDashboard(id))
        .filter(Boolean),
    ),
  ];
}

function mergeSkillsFromLocalSnapshot(
  userId: string,
  registered: string[],
  online: string[],
): { registered: string[]; online: string[] } {
  const snapshot = readProviderSkillsSnapshot(userId);
  if (!snapshot) return { registered, online };
  const snapshotServices = Array.isArray(snapshot.services)
    ? snapshot.services
    : [];
  if (snapshotServices.length === 0) return { registered, online };

  const savedAt = Number(snapshot.savedAt) || 0;
  const snapshotIsFresh =
    savedAt > 0 && Date.now() - savedAt < PROVIDER_SKILLS_SNAPSHOT_FRESH_MS;
  if (!snapshotIsFresh && registered.length > 0) {
    return { registered, online };
  }

  const expanded = expandSnapshotServiceIds(snapshotServices);
  if (expanded.length === 0) return { registered, online };

  // Snapshot only knows which skills were saved (registered). Never treat
  // those as available_now — that flag lives in DB / API and must win after
  // the provider toggles a service offline.
  return {
    registered: [...new Set([...registered, ...expanded])],
    online,
  };
}

function patchProviderSkillsSnapshotFilters(
  userId: string,
  filters: { mode?: string; target?: string; categories?: string[] },
): void {
  if (typeof window === "undefined" || !userId) return;
  const keys = [
    providerSkillsSnapshotKey(userId),
    "freshup.skills.snapshot.last",
  ];
  keys.forEach((key) => {
    const raw = localStorage.getItem(key);
    const next = {
      ...(raw
        ? (() => {
            try {
              return JSON.parse(raw) as Record<string, unknown>;
            } catch {
              return {};
            }
          })()
        : {}),
      ...filters,
      savedAt: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(next));
  });
}

function profileCacheKey(userId: string, userMode: "customer" | "provider") {
  return `freshup.profile.contact.${userMode}.${userId}`;
}

function readSavedProfileLocation(
  userId: string,
  userMode: "customer" | "provider",
): LatLng | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(profileCacheKey(userId, userMode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown };
    if (
      typeof parsed?.lat !== "number" ||
      typeof parsed?.lng !== "number" ||
      !Number.isFinite(parsed.lat) ||
      !Number.isFinite(parsed.lng)
    ) {
      return null;
    }
    return { lat: parsed.lat, lng: parsed.lng };
  } catch {
    return null;
  }
}

function syncSkillInSnapshots(
  userId: string,
  serviceId: string,
  isActive: boolean,
): void {
  if (typeof window === "undefined") return;
  const variants = serviceIdVariants(serviceId);
  const normalized = normalizeServiceId(serviceId);
  const keys = [
    providerSkillsSnapshotKey(userId),
    "freshup.skills.snapshot.last",
  ];

  keys.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const snap = JSON.parse(raw) as {
        services?: string[];
        ratings?: Record<string, number>;
      };
      const prevServices = Array.isArray(snap.services) ? snap.services : [];
      const filteredServices = prevServices
        .map((id) => normalizeServiceId(id))
        .filter((id) => id && !variants.includes(id));
      const nextServices = isActive
        ? [...new Set([...filteredServices, normalized])]
        : filteredServices;

      const nextRatings = { ...(snap.ratings || {}) } as Record<string, number>;
      variants.forEach((id) => {
        delete nextRatings[id];
      });
      if (isActive && !nextRatings[normalized]) {
        nextRatings[normalized] = 3;
      }

      localStorage.setItem(
        key,
        JSON.stringify({
          ...snap,
          services: nextServices,
          ratings: nextRatings,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // ignore malformed snapshot payloads
    }
  });
}

function syncDeliveryModeInSnapshots(
  userId: string,
  mode: "home" | "provider",
): void {
  if (typeof window === "undefined") return;
  const keys = [
    providerSkillsSnapshotKey(userId),
    "freshup.skills.snapshot.last",
  ];
  keys.forEach((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const snap = JSON.parse(raw);
      localStorage.setItem(
        key,
        JSON.stringify({
          ...snap,
          deliveryMode: mode,
          savedAt: Date.now(),
        }),
      );
    } catch {
      // ignore malformed snapshot payloads
    }
  });
}

// Translations
const TRANSLATIONS: Record<Language, Record<string, string>> = {
  no: {
    // General
    delivery: "Delivery",
    provider: "Provider",
    customer: "Kunde",
    search: "Sok...",
    cancel: "Avbryt",
    confirm: "Bekreft",
    back: "Tilbake",
    skip: "Hopp over",
    login: "Logg inn",
    logout: "Logg ut",
    done: "Ferdig",
    your_services: "Dine tjenester",
    select: "Velg",
    service: "tjeneste",
    add_to_skills: "Legg til i Skills",
    swipe_online: "Swipe for a ga online",
    swipe_offline: "Du er online - swipe for a ga offline",
    confirm_identity: "Bekreft kundens identitet",
    review_order: "Ga gjennom bestillingen",
    take_before_photo: "Ta for-bilde (valgfritt)",
    take_after_photo: "Ta etter-bilde (valgfritt)",
    continue: "Fortsett",
    pause: "Pause",
    driving_to: "Kjorer til kunde",
    service_paused: "Tjeneste pauset",

    // Booking flow
    confirm_booking: "Bekreft bestilling",
    searching_provider: "Soker etter tilbyder...",
    provider_found: "Tilbyder funnet!",
    service_in_progress: "Tjeneste pagar",
    service_completed: "Tjeneste fullfort!",
    at_provider: "Hos tilbyder",
    at_your_location: "Hos deg",
    eta: "ETA",
    minutes: "minutter",
    min: "min",
    will_arrive: "tilbyderen ankommer",
    swipe_more: "Swipe opp for flere valg",

    // Provider flow
    new_request: "Ny forespørsel",
    new_request_banner_hint: "Trykk for a se eller akseptere",
    new_request_banner_collapse_hint: "Trykk for å lukke",
    accept: "Aksepter",
    decline: "Avsla",
    start_driving: "Start kjoring",
    arrived: "Jeg er fremme",
    customer_arrived: "Kunde har ankommet",
    start_service: "Start tjeneste",
    next_job: "Neste jobb",
    next_job_waiting_hint: "Tilgjengelig når nåværende jobb er fullført",
    next_job_ready_hint: "Trykk Start for å begynne",
    complete_service: "Fullfør tjeneste",
    ready_for_next_request: "Klar for neste forespørsel",
    service_elapsed_label: "Tid brukt",
    service_typical_duration: "typisk",
    waiting_customer: "Venter pa kunde",
    driving_to_customer: "Kjorer til kunde",
    ready_to_drive: "Klar til a kjore",
    directions: "Veibeskrivelse",
    ready: "Klar",
    waiting: "Venter",
    driving: "Kjorer",
    at_location: "Fremme",
    customer_here: "Kunde her",
    paused: "Pauset",
    confirm_cancel_service: "Er du sikker pa at du vil avbryte tjenesten?",
    active: "Pagar",
    completed: "Fullfort",
    customer_coming: "Kunde ankommer snart",

    // Payment
    payment: "Betaling",
    total: "Totalt",
    card_hold_disclosure:
      "{quoted} — inntil {hold} reserveres avhengig av avstand. Du betaler kun sluttprisen.",
    delivery_fee: "Delivery-tillegg",
    distance: "Avstand",
    comment: "Kommentar",
    add: "Legg til",

    // Rating
    rate_service: "Vurder tjenesten",
    rate_customer: "Vurder kunden",
    submit_rating: "Send vurdering",
    select_rating_first: "Velg rating først",
    skip_rating: "Hopp over rating",
    thank_you_rating: "Takk for vurderingen!",
    addons: "Tillegg",
    confirm_selection: "Bekreft valg",
    select_service: "Velg en tjeneste",
    location: "Lokasjon",
    popular: "Populær",
    available_now_short: "Tilgjengelig nå",
    addons_label: "Tillegg:",
    addon_home_visit_may_vary: "Kan variere ved hjemmebesøk",
    percent_done: "ferdig",
    confirmed: "ferdig",
    service_completed_exclaim: "Tjeneste fullført!",
    how_was_experience: "Hvordan var opplevelsen med",
    select_rating: "Velg rating først",
    confirm_code: "Bekreft kode",
    confirming: "Bekrefter…",
    confirm_payment: "Bekreft betaling",
    availability: "Tilgjengelighet",
    available_providers: "Tilgjengelige tilbydere i nærheten",
    yesterday: "I går",

    // Addon names - male beauty
    hair_wash: "Hårvasking",
    beard_trim: "Skjeggtrim",
    hair_styling: "Styling",
    scalp_treatment: "Hodebunnsbehandling",

    // Service descriptions
    fade_skin_max_contrast: "Fade ned til hud for maksimal kontrast",
    fade_skin: "Fade ned til hud",
    trim_and_shape: "Trim og form",

    // Skills page
    herreklipp: "Herreklipp",
    dameklipp: "Dameklipp",
    beard_trimming: "Skjeggtrimming",

    // Support
    select_service_confirm_wait:
      "Velg kategori, tjeneste og tid. Bekreft og vent på at en tilbyder aksepterer.",

    // Earnings page
    beard_trim_earnings: "Skjeggtrim",

    // Categories
    haircut: "Harklipp",
    Hårklipp: "Harklipp",
    braids: "Fletter",
    Fletter: "Fletter",
    beard: "Skjegg",
    Skjegg: "Skjegg",
    nails: "Negler",
    Negler: "Negler",
    lashes: "Vipper",
    Vipper: "Vipper",
    brows: "Bryn",
    Bryn: "Bryn",
    body: "Fysikalske",
    Fysikalske: "Fysikalske",
    wash: "Vask",
    Vask: "Vask",
    Service: "Service",
    tires: "Dekk",
    Dekk: "Dekk",
    interior: "Interior",
    Interiør: "Interior",
    grooming: "Stell",
    Stell: "Stell",
    vet: "Veterinær",
    Veterinær: "Veterinær",
    training: "Trening",
    Trening: "Trening",
    other: "Annet",
    Annet: "Annet",
    cleaning: "Rengjoring",
    Rengjøring: "Rengjoring",
    plumber: "Rorlegger",
    Rørlegger: "Rorlegger",
    electrician: "Elektriker",
    Elektriker: "Elektriker",
    garden: "Hage",
    Hage: "Hage",
    massage: "Massasje",
    Massasje: "Massasje",
    physio: "Fysioterapi",
    Fysioterapi: "Fysioterapi",
    mental: "Mental helse",
    "Mental helse": "Mental helse",
    wellness: "Wellness",
    Wellness: "Wellness",

    // Targets
    male: "Mann",
    Mann: "Mann",
    female: "Kvinne",
    Kvinne: "Kvinne",
    car: "Bil",
    Bil: "Bil",
    motorcycle: "Motorsykkel",
    Motorsykkel: "Motorsykkel",
    dog: "Hund",
    Hund: "Hund",
    cat: "Katt",
    Katt: "Katt",
    apartment: "Leilighet",
    Leilighet: "Leilighet",
    house: "Hus",
    Hus: "Hus",
    individual: "Individuell",
    Individuell: "Individuell",
    group: "Gruppe",
    Gruppe: "Gruppe",

    // Service names
    "Skin Fade": "Skin Fade",
    "Low Fade": "Low Fade",
    "Mid Fade": "Mid Fade",
    "High Fade": "High Fade",
    "Buzz Cut": "Buzz Cut",
    "Classic Cut": "Classic Cut",
    "Box Braids": "Box Braids",
    Cornrows: "Cornrows",
    "Beard Trim": "Beard Trim",

    // Misc
    high_demand: "Hoy etterspørsel",
    normal_demand: "Normal etterspørsel",
    low_demand: "Lav etterspørsel",
    available_now: "Tilgjengelig na",
    available_in: "Tilgjengelig om",
    currency: "kr",
    online: "Online",
    offline: "Offline",
  },
  en: {
    // General
    delivery: "Delivery",
    provider: "Provider",
    customer: "Customer",
    search: "Search...",
    cancel: "Cancel",
    confirm: "Confirm",
    back: "Back",
    skip: "Skip",
    login: "Log in",
    logout: "Log out",
    done: "Done",
    your_services: "Your services",
    select: "Select",
    service: "service",
    add_to_skills: "Add to Skills",
    swipe_online: "Swipe to go online",
    swipe_offline: "You are online - swipe to go offline",
    confirm_identity: "Confirm customer identity",
    review_order: "Review the order",
    take_before_photo: "Take before photo (optional)",
    take_after_photo: "Take after photo (optional)",
    continue: "Continue",
    pause: "Pause",
    driving_to: "Driving to customer",
    service_paused: "Service paused",

    // Booking flow
    confirm_booking: "Confirm booking",
    searching_provider: "Searching for provider...",
    provider_found: "Provider found!",
    service_in_progress: "Service in progress",
    service_completed: "Service completed!",
    at_provider: "At provider",
    at_your_location: "At your location",
    eta: "ETA",
    minutes: "minutes",
    min: "min",
    will_arrive: "provider arrives",
    swipe_more: "Swipe up for more options",

    // Provider flow
    new_request: "New request",
    new_request_banner_hint: "Tap to view or accept",
    new_request_banner_collapse_hint: "Tap to collapse",
    accept: "Accept",
    decline: "Decline",
    start_driving: "Start driving",
    arrived: "You have arrived",
    customer_arrived: "Customer arrived",
    start_service: "Start service",
    next_job: "Next job",
    next_job_waiting_hint: "Available when current job is completed",
    next_job_ready_hint: "Tap Start to begin",
    complete_service: "Complete service",
    ready_for_next_request: "Ready for next request",
    service_elapsed_label: "Elapsed",
    service_typical_duration: "typical",
    waiting_customer: "Waiting for customer",
    driving_to_customer: "Driving to customer",
    ready_to_drive: "Ready to drive",
    directions: "Directions",
    ready: "Ready",
    waiting: "Waiting",
    driving: "Driving",
    at_location: "You have arrived",
    customer_here: "Customer here",
    paused: "Paused",
    confirm_cancel_service: "Are you sure you want to cancel the service?",
    active: "Active",
    completed: "Done",
    customer_coming: "Customer arriving soon",

    // Payment
    payment: "Payment",
    total: "Total",
    card_hold_disclosure:
      "Up to {hold} is reserved depending on distance. You only pay the final price.",
    delivery_fee: "Delivery fee",
    distance: "Distance",
    comment: "Comment",
    add: "Add",

    // Rating
    rate_service: "Rate the service",
    rate_customer: "Rate the customer",
    submit_rating: "Submit rating",
    select_rating_first: "Select a rating first",
    skip_rating: "Skip rating",
    thank_you_rating: "Thank you for rating!",
    addons: "Add-ons",
    confirm_selection: "Confirm selection",
    select_service: "Select a service",
    location: "Location",
    popular: "Popular",
    available_now_short: "Available now",
    addons_label: "Add-ons:",
    addon_home_visit_may_vary: "May vary for home visits",
    percent_done: "done",
    confirmed: "done",
    service_completed_exclaim: "Service completed!",
    how_was_experience: "How was your experience with",
    select_rating: "Select a rating first",
    confirm_code: "Confirm code",
    confirming: "Confirming…",
    confirm_payment: "Confirm payment",
    availability: "Availability",
    available_providers: "Available providers nearby",
    yesterday: "Yesterday",

    // Addon names - male beauty
    hair_wash: "Hair wash",
    beard_trim: "Beard trim",
    hair_styling: "Styling",
    scalp_treatment: "Scalp treatment",

    // Service descriptions
    fade_skin_max_contrast: "Fade down to skin for maximum contrast",
    fade_skin: "Fade down to skin",
    trim_and_shape: "Trim and shape",

    // Skills page
    herreklipp: "Men's haircut",
    dameklipp: "Women's haircut",
    beard_trimming: "Beard trimming",

    // Support
    select_service_confirm_wait:
      "Select category, service and time. Confirm and wait for a provider to accept.",

    // Earnings page
    beard_trim_earnings: "Beard trim",

    // Categories
    haircut: "Haircut",
    Hårklipp: "Haircut",
    braids: "Braids",
    Fletter: "Braids",
    beard: "Beard",
    Skjegg: "Beard",
    nails: "Nails",
    Negler: "Nails",
    lashes: "Lashes",
    Vipper: "Lashes",
    brows: "Brows",
    Bryn: "Brows",
    body: "Body",
    Fysikalske: "Body therapy",
    wash: "Wash",
    Vask: "Wash",
    Service: "Service",
    tires: "Tires",
    Dekk: "Tires",
    interior: "Interior",
    Interiør: "Interior",
    grooming: "Grooming",
    Stell: "Grooming",
    vet: "Veterinary",
    Veterinær: "Veterinary",
    training: "Training",
    Trening: "Training",
    other: "Other",
    Annet: "Other",
    cleaning: "Cleaning",
    Rengjøring: "Cleaning",
    plumber: "Plumber",
    Rørlegger: "Plumber",
    electrician: "Electrician",
    Elektriker: "Electrician",
    garden: "Garden",
    Hage: "Garden",
    massage: "Massage",
    Massasje: "Massage",
    physio: "Physiotherapy",
    Fysioterapi: "Physiotherapy",
    mental: "Mental health",
    "Mental helse": "Mental health",
    wellness: "Wellness",
    Wellness: "Wellness",

    // Targets
    male: "Male",
    Mann: "Male",
    female: "Female",
    Kvinne: "Female",
    car: "Car",
    Bil: "Car",
    motorcycle: "Motorcycle",
    Motorsykkel: "Motorcycle",
    dog: "Dog",
    Hund: "Dog",
    cat: "Cat",
    Katt: "Cat",
    apartment: "Apartment",
    Leilighet: "Apartment",
    house: "House",
    Hus: "House",
    individual: "Individual",
    Individuell: "Individual",
    group: "Group",
    Gruppe: "Group",

    // Service names
    "Skin Fade": "Skin Fade",
    "Low Fade": "Low Fade",
    "Mid Fade": "Mid Fade",
    "High Fade": "High Fade",
    "Buzz Cut": "Buzz Cut",
    "Classic Cut": "Classic Cut",
    "Box Braids": "Box Braids",
    Cornrows: "Cornrows",
    "Beard Trim": "Beard Trim",

    // Misc
    high_demand: "High demand",
    normal_demand: "Normal demand",
    low_demand: "Low demand",
    available_now: "Available now",
    available_in: "Available in",
    currency: "$",
    online: "Online",
    offline: "Offline",
  },
};

// App Modes - determines target, categories, and services
type AppMode = "beauty" | "vehicle" | "pet" | "home_service" | "health";

const APP_MODES_NO = {
  beauty: {
    id: "beauty",
    label: "Beauty",
    icon: "sparkles",
    providerName: "stylist",
    locationName: "salongen",
    codePrefix: "HAIR",
  },
  vehicle: {
    id: "vehicle",
    label: "Kjoretoy",
    icon: "car",
    providerName: "mekaniker",
    locationName: "verkstedet",
    codePrefix: "AUTO",
  },
  pet: {
    id: "pet",
    label: "Kjaledyr",
    icon: "paw",
    providerName: "dyrepasser",
    locationName: "klinikken",
    codePrefix: "PET",
  },
  home_service: {
    id: "home_service",
    label: "Hjem",
    icon: "home",
    providerName: "handverker",
    locationName: "kontoret",
    codePrefix: "HOME",
  },
  health: {
    id: "health",
    label: "Helse",
    icon: "heart",
    providerName: "terapeut",
    locationName: "klinikken",
    codePrefix: "HELSE",
  },
} as const;

const APP_MODES_EN = {
  beauty: {
    id: "beauty",
    label: "Beauty",
    icon: "sparkles",
    providerName: "stylist",
    locationName: "salon",
    codePrefix: "HAIR",
  },
  vehicle: {
    id: "vehicle",
    label: "Vehicle",
    icon: "car",
    providerName: "mechanic",
    locationName: "workshop",
    codePrefix: "AUTO",
  },
  pet: {
    id: "pet",
    label: "Pet",
    icon: "paw",
    providerName: "pet groomer",
    locationName: "clinic",
    codePrefix: "PET",
  },
  home_service: {
    id: "home_service",
    label: "Home",
    icon: "home",
    providerName: "handyman",
    locationName: "office",
    codePrefix: "HOME",
  },
  health: {
    id: "health",
    label: "Health",
    icon: "heart",
    providerName: "therapist",
    locationName: "clinic",
    codePrefix: "HEALTH",
  },
} as const;

const CATALOG_CATEGORY_KEYS = new Set([
  "haircut",
  "braids",
  "beard",
  "nails",
  "lashes",
  "brows",
  "body",
  "wash",
  "service",
  "tires",
  "interior",
  "cleaning",
  "plumber",
  "electrician",
  "garden",
  "grooming",
  "vet",
  "training",
  "other",
  "massage",
  "physio",
  "mental",
  "wellness",
]);

function normalizeCatalogTargetKey(targetId: string): string {
  const raw = String(targetId || "")
    .trim()
    .toLowerCase();
  if (!raw) return raw;
  const parts = raw.split("_");
  return parts[parts.length - 1] || raw;
}

function normalizeCatalogCategoryKey(categoryId: string): string {
  const raw = String(categoryId || "")
    .trim()
    .toLowerCase();
  if (!raw) return raw;
  if (CATALOG_CATEGORY_KEYS.has(raw)) return raw;
  const parts = raw.split("_");
  for (let i = parts.length - 1; i >= 0; i--) {
    if (CATALOG_CATEGORY_KEYS.has(parts[i])) return parts[i];
  }
  return parts[parts.length - 1] || raw;
}

function normalizeCatalogCategoryLabel(label?: string): string | null {
  const normalizedLabel = String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalizedLabel) return null;
  if (CATALOG_CATEGORY_KEYS.has(normalizedLabel)) return normalizedLabel;
  for (const key of CATALOG_CATEGORY_KEYS) {
    if (normalizedLabel === key || normalizedLabel.includes(key)) return key;
  }
  return null;
}

function categoryCatalogKey(categoryId: string, label?: string): string {
  const fromId = normalizeCatalogCategoryKey(categoryId);
  if (CATALOG_CATEGORY_KEYS.has(fromId)) return fromId;
  const fromLabel = normalizeCatalogCategoryLabel(label);
  if (fromLabel) return fromLabel;
  return fromId;
}

function isUuidLikeCatalogId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function catalogRowPriority(id: string): number {
  const raw = String(id || "").trim();
  if (!raw) return 10_000;
  if (isUuidLikeCatalogId(raw)) return 5_000 + raw.length;
  return raw.length;
}

function isFemaleCatalogTarget(targetId: string): boolean {
  return normalizeCatalogTargetKey(targetId) === "female";
}

function matchesCatalogTarget(
  selectedTarget: string,
  candidateTarget: string,
): boolean {
  const selected = normalizeCatalogTargetKey(selectedTarget);
  const candidate = normalizeCatalogTargetKey(candidateTarget);
  return (
    selectedTarget === candidateTarget ||
    selected === candidateTarget ||
    selectedTarget === candidate ||
    selected === candidate
  );
}

function matchesCatalogCategory(
  selectedCategory: string,
  candidateCategory: string,
  candidateLabel?: string,
): boolean {
  if (selectedCategory === candidateCategory) return true;
  return (
    categoryCatalogKey(selectedCategory) ===
    categoryCatalogKey(candidateCategory, candidateLabel)
  );
}

function categoryBelongsToTarget(
  categoryId: string,
  targetId: string,
): boolean {
  const raw = String(categoryId || "")
    .trim()
    .toLowerCase();
  const targetKey = normalizeCatalogTargetKey(targetId);
  if (!raw.includes("_")) return true;

  const hasGenderedPrefix =
    raw.includes("_male_") ||
    raw.includes("_female_") ||
    raw.startsWith("beauty_male_") ||
    raw.startsWith("beauty_female_");
  if (!hasGenderedPrefix) return true;

  if (targetKey === "male") {
    return (
      raw.includes("_male_") ||
      raw.startsWith("beauty_male_") ||
      raw === "beauty_male"
    );
  }
  if (targetKey === "female") {
    return (
      raw.includes("_female_") ||
      raw.startsWith("beauty_female_") ||
      raw === "beauty_female"
    );
  }
  return !raw.includes("_male_") && !raw.includes("_female_");
}

function resolveCategoryForTarget(
  categoryId: string,
  targetId: string,
  categories: readonly { id: string; label?: string }[],
): string | null {
  if (!categories.length) return null;
  if (
    categoryBelongsToTarget(categoryId, targetId) &&
    categories.some((row) => row.id === categoryId)
  ) {
    return categoryId;
  }
  const selectedKey = categoryCatalogKey(categoryId);
  const equivalent = categories.find(
    (row) => categoryCatalogKey(row.id, row.label) === selectedKey,
  );
  return equivalent?.id ?? categories[0]?.id ?? null;
}

function getCatalogTargetNode<T>(
  tree: Record<string, T> | undefined,
  targetId: string,
): T | undefined {
  if (!tree) return undefined;
  const direct = tree[targetId];
  if (direct) return direct;
  const targetKey = normalizeCatalogTargetKey(targetId);
  const keyed = tree[targetKey];
  if (keyed) return keyed;
  for (const [key, node] of Object.entries(tree)) {
    if (normalizeCatalogTargetKey(key) === targetKey) return node;
  }
  return undefined;
}

function getCatalogServices(
  tree:
    | Record<
        string,
        Record<
          string,
          { id: string; name: string; duration: number; price: number }[]
        >
      >
    | undefined,
  targetId: string,
  categoryId: string,
  categoryLabel?: string,
) {
  const targetNode = getCatalogTargetNode(tree, targetId);
  if (!targetNode) return [];
  const categoryKey = categoryCatalogKey(categoryId, categoryLabel);
  const direct = targetNode[categoryId] || targetNode[categoryKey];
  if (direct) return direct;
  for (const [key, services] of Object.entries(targetNode)) {
    if (categoryCatalogKey(key) === categoryKey) return services;
  }
  return [];
}

function normalizeCatalogServiceName(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Full name + first token so "Pixie Cut" still matches catalog "Pixie". */
function catalogServiceNameKeys(value: unknown): string[] {
  const full = normalizeCatalogServiceName(value);
  if (!full) return [];
  const first = full.split(/\s+/)[0] || "";
  return [...new Set([full, first].filter((k) => k.length >= 3))];
}

const PROVIDER_HIDDEN_SERVICE_IDS = new Set(["manicure"]);

function isHiddenProviderCatalogService(id: string): boolean {
  const normalized = normalizeServiceId(id);
  if (PROVIDER_HIDDEN_SERVICE_IDS.has(normalized)) return true;
  return serviceIdVariantsForDashboard(id).some((variant) =>
    PROVIDER_HIDDEN_SERVICE_IDS.has(normalizeServiceId(variant)),
  );
}

function orderServicesLikeCatalog<T extends { id: string; name?: string }>(
  services: readonly T[],
  catalog: readonly { id: string; name?: string }[],
): T[] {
  if (!services.length || !catalog.length) return [...services];

  const byKey = new Map<string, T>();
  for (const service of services) {
    for (const variant of serviceIdVariantsForDashboard(service.id)) {
      if (!byKey.has(variant)) byKey.set(variant, service);
    }
    for (const nameKey of catalogServiceNameKeys(service.name)) {
      if (!byKey.has(nameKey)) byKey.set(nameKey, service);
    }
  }

  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const template of catalog) {
    let match: T | undefined;
    for (const variant of serviceIdVariantsForDashboard(template.id)) {
      match = byKey.get(variant);
      if (match) break;
    }
    if (!match && template.name) {
      for (const nameKey of catalogServiceNameKeys(template.name)) {
        match = byKey.get(nameKey);
        if (match) break;
      }
    }
    if (!match) continue;
    const key = normalizeServiceId(template.id);
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push({
      ...match,
      id: template.id,
      ...(template.name ? { name: template.name } : {}),
    });
  }

  return ordered;
}

type ProviderCatalogSnapshot = {
  dbServices: Array<{
    id: string;
    mode_id?: string;
    target_id?: string;
    category_id?: string;
  }>;
  modeTargets: Record<
    string,
    readonly { id: string; label: string; icon: string }[]
  >;
  modeCategories: Record<
    string,
    Record<string, { id: string; label: string }[]>
  >;
  modeServicesDb: Record<
    string,
    Record<string, Record<string, { id: string }[]>>
  >;
  fallbackModeServices: Record<
    string,
    Record<string, Record<string, { id: string }[]>>
  >;
};

function resolveServiceCatalogSelection(
  serviceId: string,
  snapshot: ProviderCatalogSnapshot,
): { mode: AppMode; target: string; category: string } | null {
  const normalized = normalizeServiceId(serviceId);
  if (!normalized) return null;
  const variants = serviceIdVariantsForDashboard(normalized);

  const dbRow = snapshot.dbServices.find((row) =>
    variants.includes(normalizeServiceId(row.id)),
  );
  if (dbRow?.mode_id && dbRow?.target_id && dbRow?.category_id) {
    return {
      mode: String(dbRow.mode_id) as AppMode,
      target: String(dbRow.target_id),
      category: String(dbRow.category_id),
    };
  }

  for (const tree of [
    snapshot.modeServicesDb,
    snapshot.fallbackModeServices,
  ] as const) {
    for (const [modeKey, targetsForMode] of Object.entries(tree)) {
      for (const [targetKey, categoriesForTarget] of Object.entries(
        targetsForMode || {},
      )) {
        for (const [categoryKey, services] of Object.entries(
          categoriesForTarget || {},
        )) {
          if (
            (services || []).some((service) =>
              variants.includes(normalizeServiceId(service?.id)),
            )
          ) {
            return {
              mode: modeKey as AppMode,
              target: targetKey,
              category: categoryKey,
            };
          }
        }
      }
    }
  }
  return null;
}

function buildProviderOfferServiceFields(
  serviceId: string,
  snapshot: ProviderCatalogSnapshot,
  translate: (key: string) => string,
) {
  const selection = resolveServiceCatalogSelection(serviceId, snapshot);
  if (!selection) {
    return {
      appMode: undefined as AppMode | undefined,
      categoryId: undefined as string | undefined,
      category: translate("Service") || "Service",
      targetId: undefined as string | undefined,
      target: "",
      targetIcon: "",
    };
  }

  const targets = snapshot.modeTargets[selection.mode] || [];
  const targetKey = normalizeCatalogTargetKey(selection.target);
  const targetRow =
    targets.find((row) => matchesCatalogTarget(selection.target, row.id)) ??
    targets.find((row) => normalizeCatalogTargetKey(row.id) === targetKey) ??
    null;
  const categories =
    snapshot.modeCategories[selection.mode]?.[selection.target] ||
    snapshot.modeCategories[selection.mode]?.[targetKey] ||
    [];
  const categoryRow =
    categories.find((row) => row.id === selection.category) ??
    categories.find(
      (row) =>
        categoryCatalogKey(row.id, row.label) ===
        categoryCatalogKey(selection.category),
    ) ??
    null;

  const categoryLabel = categoryRow?.label
    ? translate(categoryRow.label) || categoryRow.label
    : selection.category;
  const targetLabel = targetRow?.label
    ? translate(targetRow.label) || targetRow.label
    : selection.target;

  return {
    appMode: selection.mode,
    categoryId: selection.category,
    category: categoryLabel,
    targetId: targetRow?.id ?? selection.target,
    target: targetLabel,
    targetIcon: targetRow?.icon ?? "",
  };
}

function sortCatalogTargetsForDisplay(
  appMode: AppMode,
  targets: readonly { id: string; label: string; icon: string }[],
) {
  if (targets.length <= 1) return [...targets];
  const rank = (targetId: string) => {
    const key = normalizeCatalogTargetKey(targetId);
    if (appMode === "beauty") {
      if (key === "male") return 0;
      if (key === "female") return 1;
    }
    return 2;
  };
  return [...targets].sort((a, b) => rank(a.id) - rank(b.id));
}

function TargetSwitchButtons({
  appMode,
  targets,
  selectedTarget,
  onSelect,
  compact = false,
}: {
  appMode: AppMode;
  targets: readonly { id: string; label: string; icon: string }[];
  selectedTarget: string;
  onSelect: (targetId: string) => void;
  compact?: boolean;
}) {
  const orderedTargets = sortCatalogTargetsForDisplay(appMode, targets);
  /** Same inner sizes as legacy toggle: compact h-7, default h-8; icons stay text-sm. */
  const innerSize = compact ? "h-7 w-7" : "h-8 w-8";

  return (
    <div
      className={cn(
        "flex flex-shrink-0 items-center gap-1 rounded-full bg-white p-1.5 shadow-md",
      )}
    >
      {orderedTargets.map((row) => {
        const isActive = matchesCatalogTarget(selectedTarget, row.id);
        return (
          <button
            key={row.id}
            type="button"
            title={row.label}
            aria-pressed={isActive}
            onClick={() => onSelect(row.id)}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.97]",
              isActive
                ? "focus-visible:ring-zinc-500"
                : "focus-visible:ring-gray-300",
            )}
          >
            <span
              className={cn(
                "box-border flex items-center justify-center rounded-full text-sm leading-none",
                innerSize,
                isActive
                  ? "glass-button-active shadow-sm"
                  : "border border-gray-200 bg-white",
              )}
            >
              {row.icon}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Category icon component for service cards throughout the booking flow
function CategoryIcon({
  appMode,
  category,
  label,
  className = "h-5 w-5",
}: {
  appMode: AppMode;
  category: string;
  label?: string;
  className?: string;
}) {
  category = categoryCatalogKey(category, label);

  // Beauty icons
  if (appMode === "beauty") {
    if (category === "haircut") return <Scissors className={className} />;
    if (category === "braids")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2C8 2 5 5 5 9v6c0 1 1 2 2 2h10c1 0 2-1 2-2V9c0-4-3-7-7-7z" />
          <path d="M8 9c0-2 2-4 4-4s4 2 4 4" />
        </svg>
      );
    if (category === "beard")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2C8 2 5 5 5 9v3c0 4 3 8 7 10 4-2 7-6 7-10V9c0-4-3-7-7-7z" />
        </svg>
      );
    if (category === "nails")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v5" />
          <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v6" />
          <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v4.5" />
        </svg>
      );
    if (category === "lashes")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    if (category === "brows")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 8c2-4 8-4 10 0" />
          <path d="M8 14c2-4 8-4 10 0" />
        </svg>
      );
    if (category === "body")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="5" r="3" />
          <path d="M12 8v13" />
          <path d="M8 12l4-4 4 4" />
        </svg>
      );
  }
  // Vehicle icons
  if (appMode === "vehicle") {
    if (category === "wash")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4" />
        </svg>
      );
    if (category === "service")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    if (category === "tires")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    if (category === "interior")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <rect x="3" y="8" width="18" height="10" rx="2" />
          <path d="M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2" />
        </svg>
      );
  }
  // Pet icons
  if (appMode === "pet") {
    if (category === "grooming") return <Scissors className={className} />;
    if (category === "vet")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2v8m0 0v8m0-8H4m8 0h8" />
        </svg>
      );
    if (category === "training")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      );
    if (category === "other")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="4" r="2" />
          <circle cx="18" cy="8" r="2" />
          <circle cx="4" cy="8" r="2" />
          <path d="M12 12c-2 0-4 2-4 4v4h8v-4c0-2-2-4-4-4z" />
        </svg>
      );
  }
  // Home service icons
  if (appMode === "home_service") {
    if (category === "cleaning")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2l2 7h7l-5.5 4 2 7-5.5-4-5.5 4 2-7L3 9h7l2-7z" />
        </svg>
      );
    if (category === "plumber")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 2v6m12-6v6M6 8a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4M10 12v10M14 12v10" />
        </svg>
      );
    if (category === "electrician")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    if (category === "garden")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 22V8M5 12H2a10 10 0 0 0 10 10M22 12h-3" />
          <path d="M12 8a4 4 0 0 0-4-4 4 4 0 0 0 4 4M12 8a4 4 0 0 1 4-4 4 4 0 0 1-4 4" />
        </svg>
      );
  }
  // Health icons
  if (appMode === "health") {
    if (category === "massage")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="5" r="3" />
          <path d="M12 8v13" />
          <path d="M8 12l4-4 4 4" />
        </svg>
      );
    if (category === "physio")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="5" r="3" />
          <path d="M5 20l3-8 4 4 4-4 3 8" />
        </svg>
      );
    if (category === "mental")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 2a8 8 0 0 0-8 8v12h16V10a8 8 0 0 0-8-8z" />
          <path d="M9 10h.01M15 10h.01M9 15c1.5 1 3.5 1 5 0" />
        </svg>
      );
    if (category === "training")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="5" r="3" />
          <path d="M5 20l3-8 4 4 4-4 3 8" />
        </svg>
      );
    if (category === "wellness")
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      );
  }
  return <Scissors className={className} />;
}

// Mode icon component - returns SVG icons instead of emojis
function ModeIcon({
  mode,
  className = "h-5 w-5",
}: {
  mode: AppMode;
  className?: string;
}) {
  switch (mode) {
    case "beauty":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M12 3l1.5 4.5H18l-3.5 2.5L16 15l-4-3-4 3 1.5-5L6 7.5h4.5L12 3z" />
        </svg>
      );
    case "vehicle":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8c0 .1-.1.3-.1.4v5.4c0 .6.4 1 1 1h2" />
          <circle cx="7" cy="17" r="2" />
          <circle cx="17" cy="17" r="2" />
        </svg>
      );
    case "pet":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="4" r="2" />
          <circle cx="18" cy="8" r="2" />
          <circle cx="4" cy="8" r="2" />
          <path d="M12 12c-2 0-4 2-4 4v4h8v-4c0-2-2-4-4-4z" />
        </svg>
      );
    case "home_service":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "health":
      return (
        <svg
          className={className}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      );
  }
}

// Target types per mode
type BeautyTarget = "male" | "female";
type VehicleTarget = "motorcycle" | "car";
type PetTarget = "cat" | "dog";
type HomeTarget = "apartment" | "house";
type HealthTarget = "individual" | "group";

const MODE_TARGETS_NO = {
  beauty: [
    { id: "male", label: "Mann", icon: "👨" },
    { id: "female", label: "Kvinne", icon: "👩" },
  ],
  vehicle: [
    { id: "car", label: "Bil", icon: "🚗" },
    { id: "motorcycle", label: "Motorsykkel", icon: "🏍️" },
  ],
  pet: [
    { id: "dog", label: "Hund", icon: "🐕" },
    { id: "cat", label: "Katt", icon: "🐱" },
  ],
  home_service: [
    { id: "apartment", label: "Leilighet", icon: "🏠" },
    { id: "house", label: "Hus", icon: "🏡" },
  ],
  health: [
    { id: "individual", label: "Individuell", icon: "👤" },
    { id: "group", label: "Gruppe", icon: "👥" },
  ],
} as const;

const MODE_TARGETS_EN = {
  beauty: [
    { id: "male", label: "Male", icon: "👨" },
    { id: "female", label: "Female", icon: "👩" },
  ],
  vehicle: [
    { id: "car", label: "Car", icon: "🚗" },
    { id: "motorcycle", label: "Motorcycle", icon: "🏍️" },
  ],
  pet: [
    { id: "dog", label: "Dog", icon: "🐕" },
    { id: "cat", label: "Cat", icon: "🐱" },
  ],
  home_service: [
    { id: "apartment", label: "Apartment", icon: "🏠" },
    { id: "house", label: "House", icon: "🏡" },
  ],
  health: [
    { id: "individual", label: "Individual", icon: "👤" },
    { id: "group", label: "Group", icon: "👥" },
  ],
} as const;

// Categories per mode and target - Norwegian
const MODE_CATEGORIES_NO: Record<
  AppMode,
  Record<string, { id: string; label: string; icon: string }[]>
> = {
  beauty: {
    male: [
      { id: "haircut", label: "Harklipp", icon: "scissors" },
      { id: "braids", label: "Fletter", icon: "braids" },
      { id: "beard", label: "Skjegg", icon: "beard" },
      { id: "brows", label: "Bryn", icon: "brows" },
      { id: "body", label: "Fysikalske", icon: "body" },
    ],
    female: [
      { id: "haircut", label: "Harklipp", icon: "scissors" },
      { id: "braids", label: "Fletter", icon: "braids" },
      { id: "nails", label: "Negler", icon: "nails" },
      { id: "lashes", label: "Vipper", icon: "lashes" },
      { id: "brows", label: "Bryn", icon: "brows" },
      { id: "body", label: "Fysikalske", icon: "body" },
    ],
  },
  vehicle: {
    motorcycle: [
      { id: "wash", label: "Vask", icon: "wash" },
      { id: "service", label: "Service", icon: "wrench" },
      { id: "tires", label: "Dekk", icon: "tire" },
    ],
    car: [
      { id: "wash", label: "Vask", icon: "wash" },
      { id: "service", label: "Service", icon: "wrench" },
      { id: "tires", label: "Dekk", icon: "tire" },
      { id: "interior", label: "Interior", icon: "interior" },
    ],
  },
  pet: {
    cat: [
      { id: "grooming", label: "Stell", icon: "grooming" },
      { id: "vet", label: "Veterinar", icon: "vet" },
      { id: "other", label: "Annet", icon: "other" },
    ],
    dog: [
      { id: "grooming", label: "Stell", icon: "grooming" },
      { id: "vet", label: "Veterinar", icon: "vet" },
      { id: "training", label: "Trening", icon: "training" },
      { id: "other", label: "Annet", icon: "other" },
    ],
  },
  home_service: {
    apartment: [
      { id: "cleaning", label: "Rengjøring", icon: "cleaning" },
      { id: "plumber", label: "Rorlegger", icon: "plumber" },
      { id: "electrician", label: "Elektriker", icon: "electrician" },
    ],
    house: [
      { id: "cleaning", label: "Rengjøring", icon: "cleaning" },
      { id: "plumber", label: "Rorlegger", icon: "plumber" },
      { id: "electrician", label: "Elektriker", icon: "electrician" },
      { id: "garden", label: "Hage", icon: "garden" },
    ],
  },
  health: {
    individual: [
      { id: "massage", label: "Massasje", icon: "massage" },
      { id: "physio", label: "Fysioterapi", icon: "physio" },
      { id: "mental", label: "Mental helse", icon: "mental" },
    ],
    group: [
      { id: "training", label: "Trening", icon: "training" },
      { id: "wellness", label: "Wellness", icon: "wellness" },
    ],
  },
};

// Categories per mode and target - English
const MODE_CATEGORIES_EN: Record<
  AppMode,
  Record<string, { id: string; label: string; icon: string }[]>
> = {
  beauty: {
    male: [
      { id: "haircut", label: "Haircut", icon: "scissors" },
      { id: "braids", label: "Braids", icon: "braids" },
      { id: "beard", label: "Beard", icon: "beard" },
      { id: "brows", label: "Brows", icon: "brows" },
      { id: "body", label: "Body", icon: "body" },
    ],
    female: [
      { id: "haircut", label: "Haircut", icon: "scissors" },
      { id: "braids", label: "Braids", icon: "braids" },
      { id: "nails", label: "Nails", icon: "nails" },
      { id: "lashes", label: "Lashes", icon: "lashes" },
      { id: "brows", label: "Brows", icon: "brows" },
      { id: "body", label: "Body", icon: "body" },
    ],
  },
  vehicle: {
    motorcycle: [
      { id: "wash", label: "Wash", icon: "wash" },
      { id: "service", label: "Service", icon: "wrench" },
      { id: "tires", label: "Tires", icon: "tire" },
    ],
    car: [
      { id: "wash", label: "Wash", icon: "wash" },
      { id: "service", label: "Service", icon: "wrench" },
      { id: "tires", label: "Tires", icon: "tire" },
      { id: "interior", label: "Interior", icon: "interior" },
    ],
  },
  pet: {
    cat: [
      { id: "grooming", label: "Grooming", icon: "grooming" },
      { id: "vet", label: "Veterinary", icon: "vet" },
      { id: "other", label: "Other", icon: "other" },
    ],
    dog: [
      { id: "grooming", label: "Grooming", icon: "grooming" },
      { id: "vet", label: "Veterinary", icon: "vet" },
      { id: "training", label: "Training", icon: "training" },
      { id: "other", label: "Other", icon: "other" },
    ],
  },
  home_service: {
    apartment: [
      { id: "cleaning", label: "Cleaning", icon: "cleaning" },
      { id: "plumber", label: "Plumber", icon: "plumber" },
      { id: "electrician", label: "Electrician", icon: "electrician" },
    ],
    house: [
      { id: "cleaning", label: "Cleaning", icon: "cleaning" },
      { id: "plumber", label: "Plumber", icon: "plumber" },
      { id: "electrician", label: "Electrician", icon: "electrician" },
      { id: "garden", label: "Garden", icon: "garden" },
    ],
  },
  health: {
    individual: [
      { id: "massage", label: "Massage", icon: "massage" },
      { id: "physio", label: "Physiotherapy", icon: "physio" },
      { id: "mental", label: "Mental health", icon: "mental" },
    ],
    group: [
      { id: "training", label: "Training", icon: "training" },
      { id: "wellness", label: "Wellness", icon: "wellness" },
    ],
  },
};

// Services per mode, target, and category
const MODE_SERVICES: Record<
  AppMode,
  Record<
    string,
    Record<
      string,
      {
        id: string;
        name: string;
        price: number;
        duration: number;
        description: string;
      }[]
    >
  >
> = {
  beauty: {
    male: {
      haircut: [
        {
          id: "skin-fade",
          name: "Skin Fade",
          price: 450,
          duration: 30,
          description: "Fade down to skin for maximum contrast",
        },
        {
          id: "low-fade",
          name: "Low Fade",
          price: 370,
          duration: 25,
          description: "Subtil fade som starter lavt rundt ørene",
        },
        {
          id: "mid-fade",
          name: "Mid Fade",
          price: 400,
          duration: 25,
          description: "Ren overgang som starter midt på hodet",
        },
        {
          id: "high-fade",
          name: "High Fade",
          price: 430,
          duration: 25,
          description: "Fade starter høyt nær tinningene",
        },
        {
          id: "buzz-cut",
          name: "Buzz Cut",
          price: 250,
          duration: 15,
          description: "Kort og praktisk over hele hodet",
        },
        {
          id: "classic_cut_m",
          name: "Classic Cut",
          price: 350,
          duration: 30,
          description: "Tidløs klassisk herreklipp",
        },
      ],
      braids: [
        {
          id: "box-braids-m",
          name: "Box Braids",
          price: 800,
          duration: 120,
          description: "Individuelle fletter i boksform",
        },
        {
          id: "cornrows-m",
          name: "Cornrows",
          price: 600,
          duration: 90,
          description: "Tradisjonelle rekkefletter",
        },
      ],
      beard: [
        {
          id: "beard-trim",
          name: "Beard Trim",
          price: 150,
          duration: 15,
          description: "Trimming og forming av skjegg",
        },
        {
          id: "beard-shape",
          name: "Beard Shape",
          price: 200,
          duration: 20,
          description: "Presis forming og kantlinjer",
        },
        {
          id: "beard-dye",
          name: "Beard Dye",
          price: 300,
          duration: 30,
          description: "Farging av skjegg",
        },
      ],
      brows: [
        {
          id: "brow-shape-m",
          name: "Brow Shape",
          price: 150,
          duration: 15,
          description: "Forming av bryn",
        },
        {
          id: "brow-tint-m",
          name: "Brow Tint",
          price: 200,
          duration: 20,
          description: "Farging av bryn",
        },
      ],
      body: [
        {
          id: "massage-m",
          name: "Massage",
          price: 600,
          duration: 60,
          description: "Avslappende helkroppsmassasje",
        },
        {
          id: "waxing-m",
          name: "Waxing",
          price: 400,
          duration: 30,
          description: "Voksing av valgt område",
        },
        {
          id: "facial-m",
          name: "Facial",
          price: 500,
          duration: 45,
          description: "Dyptgående ansiktsbehandling",
        },
      ],
    },
    female: {
      haircut: [
        {
          id: "classic-cut-f",
          name: "Classic Cut",
          price: 500,
          duration: 45,
          description: "Klassisk dameklipp med styling",
        },
        {
          id: "layers",
          name: "Layers",
          price: 550,
          duration: 50,
          description: "Lagklipp for volum og bevegelse",
        },
        {
          id: "bob",
          name: "Bob",
          price: 480,
          duration: 40,
          description: "Moderne bob-klipp",
        },
        {
          id: "pixie",
          name: "Pixie Cut",
          price: 450,
          duration: 35,
          description: "Kort og sjarmerende pixie-klipp",
        },
      ],
      braids: [
        {
          id: "box-braids-f",
          name: "Box Braids",
          price: 1200,
          duration: 180,
          description: "Lange box braids",
        },
        {
          id: "cornrows-f",
          name: "Cornrows",
          price: 800,
          duration: 120,
          description: "Elegante cornrows",
        },
        {
          id: "french-braids",
          name: "French Braids",
          price: 400,
          duration: 45,
          description: "Klassiske franske fletter",
        },
        {
          id: "dutch-braids",
          name: "Dutch Braids",
          price: 400,
          duration: 45,
          description: "Hollandske fletter",
        },
      ],
      nails: [
        {
          id: "manicure",
          name: "Manicure",
          price: 350,
          duration: 45,
          description: "Komplett manikyr",
        },
        {
          id: "pedicure",
          name: "Pedicure",
          price: 400,
          duration: 50,
          description: "Komplett pedikyr",
        },
        {
          id: "gel-nails",
          name: "Gel Nails",
          price: 600,
          duration: 75,
          description: "Gel-negler med design",
        },
        {
          id: "acrylic-nails",
          name: "Acrylic Nails",
          price: 700,
          duration: 90,
          description: "Akrylnegler",
        },
      ],
      lashes: [
        {
          id: "classic-lashes",
          name: "Classic Lashes",
          price: 800,
          duration: 90,
          description: "Klassiske vipper",
        },
        {
          id: "volume-lashes",
          name: "Volume Lashes",
          price: 1000,
          duration: 120,
          description: "Volum-vipper",
        },
        {
          id: "hybrid-lashes",
          name: "Hybrid Lashes",
          price: 900,
          duration: 100,
          description: "Hybrid vipper",
        },
      ],
      brows: [
        {
          id: "brow-shape-f",
          name: "Brow Shape",
          price: 200,
          duration: 20,
          description: "Forming av bryn",
        },
        {
          id: "brow-tint-f",
          name: "Brow Tint",
          price: 250,
          duration: 25,
          description: "Farging av bryn",
        },
        {
          id: "brow-lamination",
          name: "Brow Lamination",
          price: 500,
          duration: 45,
          description: "Bryn-laminering",
        },
      ],
      body: [
        {
          id: "massage-f",
          name: "Massage",
          price: 600,
          duration: 60,
          description: "Avslappende helkroppsmassasje",
        },
        {
          id: "waxing-f",
          name: "Waxing",
          price: 400,
          duration: 30,
          description: "Voksing av valgt område",
        },
        {
          id: "facial-f",
          name: "Facial",
          price: 500,
          duration: 45,
          description: "Dyptgående ansiktsbehandling",
        },
      ],
    },
  },
  vehicle: {
    motorcycle: {
      wash: [
        {
          id: "quick-wash-mc",
          name: "Quick Wash",
          price: 199,
          duration: 20,
          description: "Rask utvendig vask",
        },
        {
          id: "full-wash-mc",
          name: "Full Wash",
          price: 349,
          duration: 40,
          description: "Komplett vask",
        },
        {
          id: "premium-detail-mc",
          name: "Premium Detailing",
          price: 799,
          duration: 90,
          description: "Premium detaljering",
        },
      ],
      service: [
        {
          id: "oil-change-mc",
          name: "Oil Change",
          price: 499,
          duration: 30,
          description: "Bytte av olje og filter",
        },
        {
          id: "brake-change-mc",
          name: "Brake Service",
          price: 899,
          duration: 60,
          description: "Bytte av bremseklosser",
        },
        {
          id: "chain-maintenance",
          name: "Chain Maintenance",
          price: 325,
          duration: 30,
          description: "Rengjoring og smoring av kjede",
        },
      ],
      tires: [
        {
          id: "tire-change-mc",
          name: "Tire Change",
          price: 399,
          duration: 30,
          description: "Skift av dekk",
        },
        {
          id: "tire-hotel-mc",
          name: "Tire Storage",
          price: 300,
          duration: 20,
          description: "Sesonglagring av dekk",
        },
        {
          id: "puncture-mc",
          name: "Puncture Repair",
          price: 199,
          duration: 20,
          description: "Reparasjon av punktering",
        },
      ],
    },
    car: {
      wash: [
        {
          id: "exterior-wash",
          name: "Exterior Wash",
          price: 299,
          duration: 30,
          description: "Utvendig bilvask",
        },
        {
          id: "interior-wash",
          name: "Interior Wash",
          price: 350,
          duration: 45,
          description: "Innvendig bilvask",
        },
        {
          id: "full-detail",
          name: "Full Detailing",
          price: 1299,
          duration: 180,
          description: "Komplett detaljering",
        },
      ],
      service: [
        {
          id: "oil-change-car",
          name: "Oil Change",
          price: 699,
          duration: 45,
          description: "Bytte av olje og filter",
        },
        {
          id: "brake-check",
          name: "Brake Check",
          price: 350,
          duration: 30,
          description: "Kontroll av bremser",
        },
        {
          id: "battery",
          name: "Battery Service",
          price: 300,
          duration: 20,
          description: "Kontroll eller bytte av batteri",
        },
        {
          id: "air-filter",
          name: "Air Filter",
          price: 200,
          duration: 20,
          description: "Bytte av luftfilter",
        },
      ],
      tires: [
        {
          id: "tire-change-car",
          name: "Tire Change",
          price: 599,
          duration: 45,
          description: "Skift av dekk",
        },
        {
          id: "tire-hotel-car",
          name: "Tire Storage",
          price: 300,
          duration: 20,
          description: "Sesonglagring av dekk",
        },
        {
          id: "wheel-alignment",
          name: "Wheel Alignment",
          price: 550,
          duration: 45,
          description: "Hjulinnstilling",
        },
      ],
      interior: [
        {
          id: "vacuum",
          name: "Vacuum",
          price: 199,
          duration: 30,
          description: "Stovsuging av interiør",
        },
        {
          id: "deep-clean",
          name: "Deep Cleaning",
          price: 599,
          duration: 60,
          description: "Dyptgående rengjøring",
        },
        {
          id: "odor-removal",
          name: "Luktsanering",
          price: 600,
          duration: 90,
          description: "Fjerning av ubehagelig lukt",
        },
      ],
    },
  },
  pet: {
    cat: {
      grooming: [
        {
          id: "cat-haircut",
          name: "Full Trim",
          price: 650,
          duration: 60,
          description: "Komplett trim av pels",
        },
        {
          id: "cat-nails",
          name: "Nail Trim",
          price: 200,
          duration: 15,
          description: "Klipping av klør",
        },
        {
          id: "cat-brush",
          name: "Brushing",
          price: 325,
          duration: 30,
          description: "Børsting av pels",
        },
      ],
      vet: [
        {
          id: "cat-vaccine",
          name: "Vaccination",
          price: 650,
          duration: 30,
          description: "Årlig vaksinering",
        },
        {
          id: "cat-health",
          name: "Health Check",
          price: 500,
          duration: 30,
          description: "Generell helsesjekk",
        },
        {
          id: "cat-dental",
          name: "Dental Check",
          price: 400,
          duration: 20,
          description: "Tannundersøkelse",
        },
      ],
      other: [
        {
          id: "cat-sitting",
          name: "Cat Sitting",
          price: 325,
          duration: 60,
          description: "Pass av katt",
        },
        {
          id: "cat-transport",
          name: "Transport",
          price: 300,
          duration: 30,
          description: "Transport av katt",
        },
      ],
    },
    dog: {
      grooming: [
        {
          id: "dog-haircut",
          name: "Full Trim",
          price: 575,
          duration: 60,
          description: "Komplett trim av pels",
        },
        {
          id: "dog-nails",
          name: "Nail Trim",
          price: 200,
          duration: 15,
          description: "Klipping av klør",
        },
        {
          id: "dog-bath",
          name: "Bathing",
          price: 450,
          duration: 45,
          description: "Bad og tørking",
        },
        {
          id: "dog-brush",
          name: "Brushing",
          price: 325,
          duration: 30,
          description: "Børsting og fjerning av løs pels",
        },
      ],
      vet: [
        {
          id: "dog-vaccine",
          name: "Vaccination",
          price: 650,
          duration: 30,
          description: "Årlig vaksinering",
        },
        {
          id: "dog-health",
          name: "Health Check",
          price: 500,
          duration: 30,
          description: "Generell helsesjekk",
        },
        {
          id: "dog-dental",
          name: "Dental Check",
          price: 450,
          duration: 25,
          description: "Tannundersøkelse",
        },
      ],
      training: [
        {
          id: "obedience",
          name: "Obedience",
          price: 650,
          duration: 60,
          description: "Grunnleggende lydighet",
        },
        {
          id: "tricks",
          name: "Tricks",
          price: 525,
          duration: 45,
          description: "Morsomme triks",
        },
        {
          id: "puppy-training",
          name: "Puppy Training",
          price: 575,
          duration: 45,
          description: "Trening for valper",
        },
      ],
      other: [
        {
          id: "dog-sitting",
          name: "Dog Sitting",
          price: 325,
          duration: 60,
          description: "Pass av hund",
        },
        {
          id: "dog-walking",
          name: "Dog Walking",
          price: 200,
          duration: 30,
          description: "Tur med hunden",
        },
        {
          id: "dog-transport",
          name: "Transport",
          price: 300,
          duration: 30,
          description: "Transport av hund",
        },
      ],
    },
  },
  home_service: {
    apartment: {
      cleaning: [
        {
          id: "deep-clean-apt",
          name: "Deep Cleaning",
          price: 2000,
          duration: 240,
          description: "Grundig rengjøring",
        },
        {
          id: "basic-clean",
          name: "Regular Cleaning",
          price: 1000,
          duration: 120,
          description: "Standard rengjøring",
        },
        {
          id: "window-clean-apt",
          name: "Window Cleaning",
          price: 550,
          duration: 60,
          description: "Vindusvask innvendig",
        },
      ],
      plumber: [
        {
          id: "drain",
          name: "Clogged Drain",
          price: 800,
          duration: 60,
          description: "Åpning av tett avløp",
        },
        {
          id: "faucet-apt",
          name: "Faucet Leak",
          price: 600,
          duration: 45,
          description: "Reparasjon av dryppende kran",
        },
        {
          id: "toilet-apt",
          name: "Toilet Issues",
          price: 675,
          duration: 45,
          description: "Reparasjon av toalett",
        },
      ],
      electrician: [
        {
          id: "light-install",
          name: "Light Installation",
          price: 475,
          duration: 45,
          description: "Installasjon av lys",
        },
        {
          id: "outlet-install",
          name: "Power Outlets",
          price: 600,
          duration: 60,
          description: "Installasjon eller reparasjon av stikkontakter",
        },
        {
          id: "fuse-apt",
          name: "Fuse Box",
          price: 550,
          duration: 60,
          description: "Service på sikringsskap",
        },
      ],
    },
    house: {
      cleaning: [
        {
          id: "basic-clean-h",
          name: "Regular Cleaning",
          price: 1500,
          duration: 180,
          description: "Standard rengjøring",
        },
        {
          id: "deep-clean-h",
          name: "Deep Cleaning",
          price: 3250,
          duration: 360,
          description: "Grundig rengjøring",
        },
        {
          id: "window-clean-house",
          name: "Window Cleaning",
          price: 800,
          duration: 90,
          description: "Vindusvask",
        },
        {
          id: "facade-clean",
          name: "Facade Cleaning",
          price: 1400,
          duration: 180,
          description: "Utvendig fasadevask",
        },
      ],
      plumber: [
        {
          id: "drain-h",
          name: "Clogged Drain",
          price: 800,
          duration: 60,
          description: "Åpning av tett avløp",
        },
        {
          id: "faucet-house",
          name: "Faucet Leak",
          price: 600,
          duration: 45,
          description: "Reparasjon av dryppende kran",
        },
        {
          id: "water-heater",
          name: "Water Heater",
          price: 1500,
          duration: 120,
          description: "Service på varmtvannsbereder",
        },
      ],
      electrician: [
        {
          id: "light-house",
          name: "Light Installation",
          price: 475,
          duration: 45,
          description: "Installasjon av lys",
        },
        {
          id: "ev-charger",
          name: "EV Charger",
          price: 4500,
          duration: 240,
          description: "Installasjon av elbillader",
        },
        {
          id: "fuse-house",
          name: "Fuse Box",
          price: 1500,
          duration: 90,
          description: "Service på sikringsskap",
        },
      ],
      garden: [
        {
          id: "lawn-mowing",
          name: "Lawn Mowing",
          price: 550,
          duration: 60,
          description: "Klipping av plen",
        },
        {
          id: "hedge",
          name: "Hedge Trimming",
          price: 800,
          duration: 90,
          description: "Klipping av hekk",
        },
        {
          id: "snow-removal",
          name: "Snow Removal",
          price: 475,
          duration: 45,
          description: "Måking av snø",
        },
      ],
    },
  },
  health: {
    individual: {
      massage: [
        {
          id: "relaxing",
          name: "Relaxation",
          price: 850,
          duration: 60,
          description: "Avslappende massasje",
        },
        {
          id: "deep-tissue",
          name: "Deep Tissue",
          price: 1025,
          duration: 60,
          description: "Dyptgående massasje",
        },
        {
          id: "sports",
          name: "Sports Massage",
          price: 950,
          duration: 60,
          description: "Sportsmassasje",
        },
      ],
      physio: [
        {
          id: "assessment",
          name: "Assessment",
          price: 750,
          duration: 45,
          description: "Innledende vurdering",
        },
        {
          id: "treatment",
          name: "Treatment",
          price: 700,
          duration: 45,
          description: "Fysioterapi-behandling",
        },
        {
          id: "rehabilitation",
          name: "Rehabilitation",
          price: 850,
          duration: 60,
          description: "Rehabiliteringsprogram",
        },
      ],
      mental: [
        {
          id: "therapy",
          name: "Talk Therapy",
          price: 1000,
          duration: 60,
          description: "Samtaleterapi",
        },
        {
          id: "stress",
          name: "Stress Management",
          price: 800,
          duration: 45,
          description: "Teknikker for stressmestring",
        },
      ],
    },
    group: {
      training: [
        {
          id: "yoga",
          name: "Yoga",
          price: 200,
          duration: 60,
          description: "Yoga-time",
        },
        {
          id: "pilates",
          name: "Pilates",
          price: 200,
          duration: 60,
          description: "Pilates-time",
        },
        {
          id: "hiit",
          name: "HIIT",
          price: 180,
          duration: 45,
          description: "Høyintensiv intervalltrening",
        },
      ],
      wellness: [
        {
          id: "meditation",
          name: "Meditation",
          price: 150,
          duration: 45,
          description: "Guidet meditasjon",
        },
        {
          id: "breathwork",
          name: "Breathing",
          price: 150,
          duration: 45,
          description: "Pusteteknikker",
        },
      ],
    },
  },
};

const SERVICE_NAME_EN_BY_ID: Record<string, string> = {
  "quick-wash-mc": "Quick Wash",
  "full-wash-mc": "Full Wash",
  "premium-detail-mc": "Premium Detailing",
  "oil-change-mc": "Oil Change",
  "brake-change-mc": "Brake Service",
  "chain-maintenance": "Chain Maintenance",
  "tire-change-mc": "Tire Change",
  "tire-hotel-mc": "Tire Storage",
  "puncture-mc": "Puncture Repair",
  "exterior-wash": "Exterior Wash",
  "interior-wash": "Interior Wash",
  "full-detail": "Full Detailing",
  "oil-change-car": "Oil Change",
  "brake-check": "Brake Check",
  battery: "Battery Service",
  "air-filter": "Air Filter",
  "tire-change-car": "Tire Change",
  "tire-hotel-car": "Tire Storage",
  "wheel-alignment": "Wheel Alignment",
  vacuum: "Vacuum",
  "deep-clean": "Deep Cleaning",
  "odor-removal": "Odor Removal",
  car_odor: "Odor Removal",
  "car-odor": "Odor Removal",
  car_odor_removal: "Odor Removal",
  "car-odor-removal": "Odor Removal",
  "cat-haircut": "Full Trim",
  "cat-nails": "Nail Trim",
  "cat-brush": "Brushing",
  "cat-vaccine": "Vaccination",
  "cat-health": "Health Check",
  "cat-dental": "Dental Check",
  "cat-sitting": "Cat Sitting",
  "cat-transport": "Transport",
  "dog-haircut": "Full Trim",
  "dog-nails": "Nail Trim",
  "dog-bath": "Bathing",
  "dog-brush": "Brushing",
  "dog-vaccine": "Vaccination",
  "dog-health": "Health Check",
  "dog-dental": "Dental Check",
  obedience: "Obedience",
  tricks: "Tricks",
  "puppy-training": "Puppy Training",
  "dog-sitting": "Dog Sitting",
  "dog-walking": "Dog Walking",
  "dog-transport": "Transport",
  "basic-clean": "Regular Cleaning",
  "deep-clean-apt": "Deep Cleaning",
  "window-clean-apt": "Window Cleaning",
  drain: "Clogged Drain",
  "faucet-apt": "Faucet Leak",
  "toilet-apt": "Toilet Issues",
  "leak-repair": "Faucet Leak",
  "light-install": "Light Installation",
  "outlet-install": "Power Outlets",
  "fuse-apt": "Fuse Box",
  "basic-clean-h": "Regular Cleaning",
  "deep-clean-h": "Deep Cleaning",
  "window-clean-house": "Window Cleaning",
  "facade-clean": "Facade Cleaning",
  "drain-h": "Clogged Drain",
  "faucet-house": "Faucet Leak",
  "water-heater": "Water Heater",
  "pipe-repair": "Pipe Repair",
  "light-house": "Light Installation",
  "ev-charger": "EV Charger",
  "fuse-house": "Fuse Box",
  "panel-service": "Fuse Box",
  "lawn-mowing": "Lawn Mowing",
  hedge: "Hedge Trimming",
  "snow-removal": "Snow Removal",
  relaxing: "Relaxation",
  "deep-tissue": "Deep Tissue",
  sports: "Sports Massage",
  assessment: "Assessment",
  treatment: "Treatment",
  rehabilitation: "Rehabilitation",
  rehab: "Rehabilitation",
  therapy: "Talk Therapy",
  stress: "Stress Management",
  coaching: "Life Coaching",
  yoga: "Yoga",
  pilates: "Pilates",
  hiit: "HIIT",
  meditation: "Meditation",
  breathwork: "Breathing",
  breathing: "Breathing",
};

function prettifyServiceNameLabel(nameOrId: string): string {
  let raw = String(nameOrId || "").trim();
  if (!raw) return "";
  if (/^[a-z0-9_-]+$/i.test(raw)) {
    const lower = raw.toLowerCase();
    for (const prefix of [
      "home_apt_",
      "home_house_",
      "vehicle_car_",
      "vehicle_mc_",
      "beauty_male_",
      "beauty_female_",
    ]) {
      if (lower.startsWith(prefix)) {
        raw = raw.slice(prefix.length);
        break;
      }
    }
  }
  const withoutGenderSuffix = raw.replace(/\s+([mf])$/i, "").trim();
  if (!withoutGenderSuffix) return "";
  const machineLike = /^[a-z0-9_-]+$/.test(withoutGenderSuffix);
  if (!machineLike) return withoutGenderSuffix;
  return withoutGenderSuffix
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function findCatalogServiceName(serviceId: string): string | null {
  const variants = new Set(serviceIdVariantsForDashboard(serviceId));
  for (const mode of Object.values(MODE_SERVICES)) {
    for (const targets of Object.values(mode)) {
      for (const categories of Object.values(targets)) {
        for (const svc of categories) {
          if (variants.has(normalizeServiceId(svc.id))) {
            return svc.name;
          }
        }
      }
    }
  }
  return null;
}

function resolveProviderOfferServiceName(
  serviceId: string,
  dbName: string | null | undefined,
  language: "en" | "no",
): string {
  const variants = serviceIdVariantsForDashboard(serviceId);
  const uiKeys = new Set<string>();

  for (const variant of variants) {
    if (SERVICE_NAME_EN_BY_ID[variant]) {
      uiKeys.add(variant);
    }
    const reverseKey = Object.entries(DASHBOARD_SERVICE_ID_ALIASES).find(
      ([, mapped]) => mapped.some((id) => normalizeServiceId(id) === variant),
    )?.[0];
    if (reverseKey) uiKeys.add(reverseKey);
  }

  for (const uiKey of uiKeys) {
    if (language === "en" && SERVICE_NAME_EN_BY_ID[uiKey]) {
      return SERVICE_NAME_EN_BY_ID[uiKey];
    }
    const catalogName = findCatalogServiceName(uiKey);
    if (catalogName) return catalogName;
  }

  const catalogName = findCatalogServiceName(serviceId);
  if (catalogName) return catalogName;

  const trimmedDb = String(dbName || "").trim();
  if (trimmedDb && !/^[a-z0-9_-]+$/.test(trimmedDb)) {
    return trimmedDb;
  }

  return prettifyServiceNameLabel(trimmedDb || serviceId);
}

type ProviderMeta = {
  id: string;
  is_online: boolean;
  home_service: boolean;
  /** Accepts salon / at-provider jobs (`delivery_modes` includes at_provider). */
  at_provider: boolean;
  status: "available" | "busy" | "unavailable";
  lat: number;
  lng: number;
  categories: string[];
  /** Active `provider_skills.service_id` with available_now. */
  serviceIds: string[];
};

function deliveryFlagsFromModes(modes: unknown): {
  home_service: boolean;
  at_provider: boolean;
} {
  const list = Array.isArray(modes)
    ? modes
        .map((v) =>
          String(v || "")
            .toLowerCase()
            .trim(),
        )
        .filter(Boolean)
    : [];
  if (list.length === 0) {
    return { home_service: true, at_provider: true };
  }
  return {
    home_service: list.includes("home"),
    at_provider: list.includes("at_provider") || list.includes("provider"),
  };
}

type BookingStyle = {
  id: string;
  /** Canonical services.id used for quote/lock/book (may differ from UI id). */
  pricingServiceId?: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  availability: string;
  availabilityMinutes: number;
  rating: number;
  bookings: number;
  tags: string[];
  demandLevel?: number;
};

function bookingPricingServiceId(
  style: Pick<BookingStyle, "id" | "pricingServiceId">,
): string {
  const explicit = String(style.pricingServiceId || "").trim();
  return explicit ? normalizeServiceId(explicit) : normalizeServiceId(style.id);
}

type ProviderActionKey =
  | "accept"
  | "start_driving"
  | "customer_arrived"
  | "mark_arrived"
  | "start_service"
  | "ready_for_next"
  | "complete_service";

function ProviderButtonContent({
  busy,
  children,
}: {
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {busy ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
      ) : null}
      {children}
    </>
  );
}

function bookingStyleFromOrderService(
  serviceId: string,
  serviceName: string,
  durationMinutes: number,
  price: number,
): BookingStyle {
  return {
    id: serviceId,
    name: serviceName || serviceId,
    description: "",
    price: Number.isFinite(price) ? price : 0,
    duration: Number.isFinite(durationMinutes) ? durationMinutes : 30,
    availability: "",
    availabilityMinutes: 0,
    rating: 4.8,
    bookings: 0,
    tags: [],
  };
}

// Complete fade styles with Lyft-style compact data
const HAIRCUT_STYLES = [
  {
    id: "skin-fade",
    name: "Skin Fade",
    description: "Fade down to skin level for maximum contrast and sharp look",
    price: 450,
    duration: 30,
    availability: "Available now",
    availabilityMinutes: 0,
    rating: 4.8,
    bookings: 1247,
    tags: ["Populær"],
    gender: "male" as const,
    category: "haircut" as const,
  },
  {
    id: "mid-fade",
    name: "Mid Fade",
    description:
      "Clean transition starting at the middle of the head, versatile for all hair types",
    price: 400,
    duration: 25,
    availability: "Available now",
    availabilityMinutes: 0,
    rating: 4.9,
    bookings: 2156,
    tags: ["Raskest"],
    gender: "male" as const,
    category: "haircut" as const,
  },
  {
    id: "high-fade",
    name: "High Fade",
    description:
      "Fade starts high up near the temples for a modern, professional appearance",
    price: 430,
    duration: 25,
    availability: "Available in 15 min",
    availabilityMinutes: 15,
    rating: 4.7,
    bookings: 1834,
    tags: [],
    gender: "male" as const,
    category: "haircut" as const,
  },
  {
    id: "low-fade",
    name: "Low Fade",
    description:
      "Subtle fade starting low around the ears, perfect for conservative styles",
    price: 370,
    duration: 20,
    availability: "Available now",
    availabilityMinutes: 0,
    rating: 4.6,
    bookings: 987,
    tags: [],
    gender: "male" as const,
    category: "haircut" as const,
  },
  {
    id: "taper-fade",
    name: "Taper Fade",
    description:
      "Gradual natural transition from long to short, classic and timeless",
    price: 350,
    duration: 20,
    availability: "Available now",
    availabilityMinutes: 0,
    rating: 4.5,
    bookings: 756,
    tags: [],
    gender: "male" as const,
    category: "haircut" as const,
  },
];

// Dynamic add-ons per mode, target, and category
const MODE_ADDONS: Record<
  AppMode,
  Record<
    string,
    Record<
      string,
      {
        id: string;
        nameNo: string;
        nameEn: string;
        price: number;
        time: number;
      }[]
    >
  >
> = {
  beauty: {
    male: {
      haircut: [
        {
          id: "hair-wash",
          nameNo: "Hårvasking",
          nameEn: "Hair wash",
          price: 80,
          time: 10,
        },
        {
          id: "beard-trim",
          nameNo: "Skjeggtrim",
          nameEn: "Beard trim",
          price: 150,
          time: 15,
        },
        {
          id: "hair-styling",
          nameNo: "Styling",
          nameEn: "Styling",
          price: 120,
          time: 10,
        },
        {
          id: "scalp-treatment",
          nameNo: "Hodebunnsbehandling",
          nameEn: "Scalp treatment",
          price: 200,
          time: 20,
        },
      ],
      braids: [
        {
          id: "hair-wash-b",
          nameNo: "Hårvasking",
          nameEn: "Hair wash",
          price: 100,
          time: 15,
        },
        {
          id: "hair-oil",
          nameNo: "Hårolje",
          nameEn: "Hair oil",
          price: 80,
          time: 10,
        },
        {
          id: "edge-control",
          nameNo: "Edge Control",
          nameEn: "Edge Control",
          price: 50,
          time: 5,
        },
      ],
      beard: [
        {
          id: "beard-oil",
          nameNo: "Skjeggolje",
          nameEn: "Beard oil",
          price: 50,
          time: 5,
        },
        {
          id: "hot-towel",
          nameNo: "Varm håndkle",
          nameEn: "Hot towel",
          price: 80,
          time: 10,
        },
        {
          id: "beard-mask",
          nameNo: "Skjeggmaske",
          nameEn: "Beard mask",
          price: 120,
          time: 15,
        },
      ],
      brows: [
        {
          id: "brow-tint-addon",
          nameNo: "Farging",
          nameEn: "Tinting",
          price: 100,
          time: 10,
        },
        {
          id: "brow-wax",
          nameNo: "Voksing",
          nameEn: "Waxing",
          price: 80,
          time: 10,
        },
      ],
      body: [
        {
          id: "extra-time",
          nameNo: "Ekstra tid",
          nameEn: "Extra time",
          price: 200,
          time: 30,
        },
        {
          id: "aromatherapy",
          nameNo: "Aromaterapi",
          nameEn: "Aromatherapy",
          price: 150,
          time: 0,
        },
      ],
    },
    female: {
      haircut: [
        {
          id: "hair-wash-f",
          nameNo: "Hårvasking",
          nameEn: "Hair wash",
          price: 100,
          time: 15,
        },
        {
          id: "blow-dry",
          nameNo: "Føning",
          nameEn: "Blow dry",
          price: 200,
          time: 20,
        },
        {
          id: "deep-condition",
          nameNo: "Kur",
          nameEn: "Deep condition",
          price: 250,
          time: 20,
        },
        {
          id: "hair-treatment",
          nameNo: "Behandling",
          nameEn: "Treatment",
          price: 300,
          time: 25,
        },
      ],
      braids: [
        {
          id: "hair-wash-bf",
          nameNo: "Hårvasking",
          nameEn: "Hair wash",
          price: 150,
          time: 20,
        },
        {
          id: "hair-extensions",
          nameNo: "Extensions",
          nameEn: "Extensions",
          price: 500,
          time: 60,
        },
        {
          id: "edge-control-f",
          nameNo: "Edge Control",
          nameEn: "Edge Control",
          price: 80,
          time: 10,
        },
      ],
      nails: [
        {
          id: "nail-art",
          nameNo: "Nail Art",
          nameEn: "Nail Art",
          price: 200,
          time: 30,
        },
        {
          id: "nail-repair",
          nameNo: "Neglreparasjon",
          nameEn: "Nail repair",
          price: 100,
          time: 15,
        },
        {
          id: "hand-massage",
          nameNo: "Håndmassasje",
          nameEn: "Hand massage",
          price: 150,
          time: 15,
        },
        {
          id: "paraffin",
          nameNo: "Paraffinbehandling",
          nameEn: "Paraffin treatment",
          price: 180,
          time: 20,
        },
      ],
      lashes: [
        {
          id: "lash-removal",
          nameNo: "Fjerning",
          nameEn: "Removal",
          price: 200,
          time: 30,
        },
        {
          id: "lash-tint",
          nameNo: "Farging",
          nameEn: "Tinting",
          price: 150,
          time: 15,
        },
        {
          id: "lash-lift",
          nameNo: "Vippe-løft",
          nameEn: "Lash lift",
          price: 300,
          time: 30,
        },
      ],
      brows: [
        {
          id: "brow-tint-f",
          nameNo: "Farging",
          nameEn: "Tinting",
          price: 150,
          time: 15,
        },
        {
          id: "brow-wax-f",
          nameNo: "Voksing",
          nameEn: "Waxing",
          price: 100,
          time: 10,
        },
        {
          id: "brow-henna",
          nameNo: "Henna",
          nameEn: "Henna",
          price: 250,
          time: 30,
        },
      ],
      body: [
        {
          id: "extra-time-f",
          nameNo: "Ekstra tid",
          nameEn: "Extra time",
          price: 200,
          time: 30,
        },
        {
          id: "aromatherapy-f",
          nameNo: "Aromaterapi",
          nameEn: "Aromatherapy",
          price: 150,
          time: 0,
        },
        {
          id: "hot-stones",
          nameNo: "Varme steiner",
          nameEn: "Hot stones",
          price: 200,
          time: 15,
        },
      ],
    },
  },
  vehicle: {
    motorcycle: {
      wash: [
        {
          id: "wax-mc",
          nameNo: "Voksing",
          nameEn: "Waxing",
          price: 150,
          time: 20,
        },
        {
          id: "chrome-polish",
          nameNo: "Krompolering",
          nameEn: "Chrome polish",
          price: 200,
          time: 30,
        },
      ],
      service: [
        {
          id: "fluid-check",
          nameNo: "Væskesjekk",
          nameEn: "Fluid check",
          price: 100,
          time: 15,
        },
        {
          id: "brake-fluid",
          nameNo: "Bremsevæske",
          nameEn: "Brake fluid",
          price: 200,
          time: 20,
        },
      ],
      tires: [
        {
          id: "wheel-clean-mc",
          nameNo: "Hjulrengjøring",
          nameEn: "Wheel cleaning",
          price: 100,
          time: 15,
        },
        {
          id: "tire-shine",
          nameNo: "Dekkglans",
          nameEn: "Tire shine",
          price: 80,
          time: 10,
        },
      ],
    },
    car: {
      wash: [
        {
          id: "wax-car",
          nameNo: "Voksing",
          nameEn: "Waxing",
          price: 300,
          time: 30,
        },
        {
          id: "glass-treatment",
          nameNo: "Glassbehandling",
          nameEn: "Glass treatment",
          price: 200,
          time: 20,
        },
        {
          id: "leather-care",
          nameNo: "Skinnpleie",
          nameEn: "Leather care",
          price: 350,
          time: 40,
        },
      ],
      service: [
        {
          id: "fluid-top-up",
          nameNo: "Væskepåfyll",
          nameEn: "Fluid top-up",
          price: 150,
          time: 15,
        },
        {
          id: "air-filter",
          nameNo: "Luftfilter",
          nameEn: "Air filter",
          price: 200,
          time: 15,
        },
        {
          id: "wiper-blades",
          nameNo: "Vindusviskere",
          nameEn: "Wiper blades",
          price: 250,
          time: 15,
        },
      ],
      tires: [
        {
          id: "wheel-clean-car",
          nameNo: "Hjulrengjøring",
          nameEn: "Wheel cleaning",
          price: 150,
          time: 20,
        },
        {
          id: "tire-pressure",
          nameNo: "Trykksjekk",
          nameEn: "Pressure check",
          price: 50,
          time: 10,
        },
      ],
      interior: [
        {
          id: "fabric-protection",
          nameNo: "Tekstilbeskyttelse",
          nameEn: "Fabric protection",
          price: 300,
          time: 30,
        },
        {
          id: "air-freshener",
          nameNo: "Luftfrisker",
          nameEn: "Air freshener",
          price: 100,
          time: 5,
        },
      ],
    },
  },
  pet: {
    cat: {
      grooming: [
        {
          id: "ear-clean-cat",
          nameNo: "Ørerens",
          nameEn: "Ear cleaning",
          price: 100,
          time: 10,
        },
        {
          id: "flea-treatment",
          nameNo: "Loppebehandling",
          nameEn: "Flea treatment",
          price: 200,
          time: 15,
        },
      ],
      vet: [
        {
          id: "microchip",
          nameNo: "Mikrochip",
          nameEn: "Microchip",
          price: 400,
          time: 15,
        },
        {
          id: "deworming",
          nameNo: "Ormekur",
          nameEn: "Deworming",
          price: 150,
          time: 10,
        },
      ],
      other: [
        {
          id: "cat-food",
          nameNo: "Premium mat",
          nameEn: "Premium food",
          price: 200,
          time: 0,
        },
      ],
    },
    dog: {
      grooming: [
        {
          id: "ear-clean-dog",
          nameNo: "Ørerens",
          nameEn: "Ear cleaning",
          price: 100,
          time: 10,
        },
        {
          id: "teeth-clean",
          nameNo: "Tannpuss",
          nameEn: "Teeth cleaning",
          price: 150,
          time: 15,
        },
        {
          id: "flea-treatment-dog",
          nameNo: "Loppebehandling",
          nameEn: "Flea treatment",
          price: 250,
          time: 15,
        },
      ],
      vet: [
        {
          id: "microchip-dog",
          nameNo: "Mikrochip",
          nameEn: "Microchip",
          price: 400,
          time: 15,
        },
        {
          id: "deworming-dog",
          nameNo: "Ormekur",
          nameEn: "Deworming",
          price: 180,
          time: 10,
        },
      ],
      training: [
        {
          id: "extra-session",
          nameNo: "Ekstra økt",
          nameEn: "Extra session",
          price: 300,
          time: 30,
        },
        {
          id: "home-visit",
          nameNo: "Hjemmebesøk",
          nameEn: "Home visit",
          price: 200,
          time: 0,
        },
      ],
      other: [
        {
          id: "dog-food",
          nameNo: "Premium mat",
          nameEn: "Premium food",
          price: 250,
          time: 0,
        },
      ],
    },
  },
  home_service: {
    apartment: {
      cleaning: [
        {
          id: "oven-clean",
          nameNo: "Stekeovn",
          nameEn: "Oven",
          price: 300,
          time: 30,
        },
        {
          id: "fridge-clean",
          nameNo: "Kjøleskap",
          nameEn: "Refrigerator",
          price: 200,
          time: 20,
        },
        {
          id: "balcony",
          nameNo: "Balkong",
          nameEn: "Balcony",
          price: 250,
          time: 30,
        },
      ],
      plumber: [
        {
          id: "inspection",
          nameNo: "Inspeksjon",
          nameEn: "Inspection",
          price: 200,
          time: 20,
        },
        {
          id: "parts",
          nameNo: "Deler inkludert",
          nameEn: "Parts included",
          price: 500,
          time: 0,
        },
      ],
      electrician: [
        {
          id: "el-inspection",
          nameNo: "El-sjekk",
          nameEn: "Electrical check",
          price: 300,
          time: 30,
        },
        {
          id: "dimmer",
          nameNo: "Dimmer",
          nameEn: "Dimmer",
          price: 400,
          time: 30,
        },
      ],
    },
    house: {
      cleaning: [
        {
          id: "garage",
          nameNo: "Garasje",
          nameEn: "Garage",
          price: 400,
          time: 45,
        },
        {
          id: "basement",
          nameNo: "Kjeller",
          nameEn: "Basement",
          price: 350,
          time: 40,
        },
        {
          id: "oven-clean-h",
          nameNo: "Stekeovn",
          nameEn: "Oven",
          price: 300,
          time: 30,
        },
      ],
      plumber: [
        {
          id: "inspection-h",
          nameNo: "Inspeksjon",
          nameEn: "Inspection",
          price: 250,
          time: 30,
        },
        {
          id: "parts-h",
          nameNo: "Deler inkludert",
          nameEn: "Parts included",
          price: 700,
          time: 0,
        },
      ],
      electrician: [
        {
          id: "el-inspection-h",
          nameNo: "El-sjekk",
          nameEn: "Electrical check",
          price: 400,
          time: 45,
        },
        {
          id: "smart-home",
          nameNo: "Smart-hjem",
          nameEn: "Smart home",
          price: 800,
          time: 60,
        },
      ],
      garden: [
        {
          id: "fertilizer",
          nameNo: "Gjødsling",
          nameEn: "Fertilizing",
          price: 200,
          time: 20,
        },
        {
          id: "weeding",
          nameNo: "Luking",
          nameEn: "Weeding",
          price: 300,
          time: 45,
        },
      ],
    },
  },
  health: {
    individual: {
      massage: [
        {
          id: "hot-stones-h",
          nameNo: "Varme steiner",
          nameEn: "Hot stones",
          price: 200,
          time: 15,
        },
        {
          id: "aroma-h",
          nameNo: "Aromaterapi",
          nameEn: "Aromatherapy",
          price: 150,
          time: 0,
        },
        {
          id: "extra-30",
          nameNo: "Ekstra 30 min",
          nameEn: "Extra 30 min",
          price: 350,
          time: 30,
        },
      ],
      physio: [
        { id: "tape", nameNo: "Teip", nameEn: "Tape", price: 150, time: 15 },
        {
          id: "ultrasound",
          nameNo: "Ultralyd",
          nameEn: "Ultrasound",
          price: 200,
          time: 15,
        },
      ],
      mental: [
        {
          id: "extra-session-m",
          nameNo: "Ekstra økt",
          nameEn: "Extra session",
          price: 500,
          time: 30,
        },
        {
          id: "online-followup",
          nameNo: "Online oppfølging",
          nameEn: "Online follow-up",
          price: 300,
          time: 0,
        },
      ],
    },
    group: {
      training: [
        {
          id: "mat-rental",
          nameNo: "Matteleie",
          nameEn: "Mat rental",
          price: 50,
          time: 0,
        },
        {
          id: "personal-guidance",
          nameNo: "Personlig veiledning",
          nameEn: "Personal guidance",
          price: 200,
          time: 15,
        },
      ],
      wellness: [
        {
          id: "tea-ceremony",
          nameNo: "Te-seremoni",
          nameEn: "Tea ceremony",
          price: 100,
          time: 15,
        },
        {
          id: "sound-bath",
          nameNo: "Lydbad",
          nameEn: "Sound bath",
          price: 150,
          time: 20,
        },
      ],
    },
  },
};

// Legacy ADDONS for backward compatibility - now dynamic
const ADDONS = [
  { id: "hair-wash", name: "Hair wash", price: 80, time: 10 },
  { id: "beard-trim", name: "Beard trim", price: 150, time: 15 },
  { id: "hair-styling", name: "Styling", price: 120, time: 10 },
  { id: "scalp-treatment", name: "Scalp treatment", price: 200, time: 20 },
];

function useGeolocation() {
  const [pos, setPos] = useState<LatLng | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError("Stedstjenester ikke tilgjengelig i nettleseren.");
      return;
    }
    if (watchId.current != null) return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setError(null);
      },
      (e) => setError(e.message || "Kunne ikke hente posisjon."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  const getGeoloc = useCallback((): Promise<LatLng | null> => {
    return new Promise((resolve) => {
      if (!("geolocation" in navigator)) {
        setError("Stedstjenester ikke tilgjengelig i nettleseren.");
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (value: LatLng | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = window.setTimeout(() => {
        setError("Kunne ikke hente posisjon (timeout).");
        finish(null);
      }, 12000);
      navigator.geolocation.getCurrentPosition(
        (p) => {
          window.clearTimeout(timer);
          const next = { lat: p.coords.latitude, lng: p.coords.longitude };
          setPos(next);
          setError(null);
          finish(next);
        },
        (e) => {
          window.clearTimeout(timer);
          setError(e.message || "Kunne ikke hente posisjon.");
          finish(null);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    });
  }, []);

  useEffect(() => {
    return () => {
      if (watchId.current != null)
        navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  return { pos, error, get: getGeoloc, startWatch, stopWatch };
}

// Add custom CSS animations with glass morphism
const floatingStyles = `
  @keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
  }
  
  @keyframes ping-slow {
    0% { transform: scale(1); opacity: 0.8; }
    75%, 100% { transform: scale(1.5); opacity: 0; }
  }
  
  @keyframes pulse-slow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 0.6; }
  }
  
  .animate-float {
    animation: float 3s ease-in-out infinite;
  }
  
  .animate-ping-slow {
    animation: ping-slow 3s cubic-bezier(0, 0, 0.2, 1) infinite;
  }
  
  .animate-pulse-slow {
    animation: pulse-slow 4s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  /* iOS 26 Glass Morphism */
  .glass-morphism {
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  .glass-morphism-dark {
    background: rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  }

  .glass-morphism-strong {
    background: rgba(255, 255, 255, 0.25);
    backdrop-filter: blur(30px);
    -webkit-backdrop-filter: blur(30px);
    border: 1px solid rgba(255, 255, 255, 0.3);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
  }

  .glass-button {
    background: rgba(255, 255, 255, 0.2);
    backdrop-filter: blur(15px);
    -webkit-backdrop-filter: blur(15px);
    border: 1px solid rgba(255, 255, 255, 0.25);
    transition: all 0.3s ease;
  }

  .glass-button:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: translateY(-2px);
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  }

  /* One active “chrome” for mode menu, filters, toggles (same tone as Beauty row) */
  .glass-button-active {
    background: #a1a1aa !important;
    border: 1px solid rgba(255, 255, 255, 0.22) !important;
    color: #ffffff !important;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .glass-button-active:hover {
    background: #9ca3af !important;
    border-color: rgba(255, 255, 255, 0.28) !important;
    color: #ffffff !important;
  }

  .scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

.animate-in {
  animation-fill-mode: both;
}

.fade-in-50 {
  animation-name: fadeIn50;
}

.slide-in-from-top-4 {
  animation-name: slideInFromTop4;
}

.slide-in-from-bottom-4 {
  animation-name: slideInFromBottom4;
}

@keyframes fadeIn50 {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInFromTop4 {
  from { 
    opacity: 0;
    transform: translateY(-16px);
  }
  to { 
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slideInFromBottom4 {
  from { 
    opacity: 0;
    transform: translateY(16px);
  }
  to { 
    opacity: 1;
    transform: translateY(0);
  }
}

/* Swipe gestures for bottom sheet */
.swipeable {
  touch-action: pan-y;
}
`;

// Add the styles to the document head
if (typeof document !== "undefined") {
  const styleSheet = document.createElement("style");
  styleSheet.textContent = floatingStyles;
  document.head.appendChild(styleSheet);
}

export default function Page() {
  // Expose env debug status in client
  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const envOk = !!(SUPA_URL && SUPA_ANON);

  const supabase = useMemo(() => createBrowserSupabaseClient() as any, []);
  const hasSupabase = useMemo(
    () => !!(supabase && typeof supabase.from === "function" && supabase.auth),
    [supabase],
  );

  // Auth state - add after supabase setup
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [showAuthFlow, setShowAuthFlow] = useState(false);
  const [authStep, setAuthStep] = useState<
    "welcome" | "phone" | "verify" | "profile" | "location" | "complete"
  >("welcome");
  const [authData, setAuthData] = useState({
    phone: "",
    verificationCode: "",
    profile: { name: "", email: "" },
  });

  // Twilio/Supabase SMS helpers
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const e164 = (p: string) => p.replace(/\s+/g, "");

  const sendCode = useCallback(async () => {
    if (!hasSupabase) {
      setAuthError(
        "Supabase client is not initialized. Check NEXT_PUBLIC_SUPABASE_URL/ANON in .env.local and restart dev server.",
      );
      return;
    }
    const phone = e164(authData.phone);
    if (!/^\+\d{7,15}$/.test(phone)) {
      setAuthError("Invalid phone format. Use E.164 like +47xxxxxxxx");
      return;
    }

    setAuthError(null);
    setIsSendingCode(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone });
      if (error) {
        setAuthError(error.message);
        return;
      }
      setAuthStep("verify");
    } catch (e: any) {
      setAuthError(e?.message ?? "Could not send code");
    } finally {
      setIsSendingCode(false);
    }
  }, [authData.phone, hasSupabase, supabase, envOk]);

  const verifyCode = useCallback(async () => {
    if (!hasSupabase) {
      setAuthError(
        "Supabase client is not initialized. Check NEXT_PUBLIC_SUPABASE_URL/ANON in .env.local and restart dev server.",
      );
      return;
    }
    const phone = e164(authData.phone);
    const token = authData.verificationCode;

    setAuthError(null);
    setIsVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token,
        type: "sms",
      });
      if (error) {
        setAuthError(error.message);
        return;
      }

      // At this point we have a session; let user proceed to profile step
      setAuthStep("profile");
      setIsAuthenticated(true);
    } catch (e: any) {
      setAuthError(e?.message ?? "Verification failed");
    } finally {
      setIsVerifying(false);
    }
  }, [authData.phone, authData.verificationCode, hasSupabase, supabase, envOk]);

  // Add profile state after other state variables (around line 200)
  const [showProfile, setShowProfile] = useState(false);

  // App startup states
  const [showSplash, setShowSplash] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [authReady, setAuthReady] = useState(!hasSupabase);
  const [forceProviderSetup, setForceProviderSetup] = useState(false);
  const [providerSignupGate, setProviderSignupGate] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setProviderSignupGate(isProviderSignupInProgress());
  }, []);

  // If an existing session is found, skip splash and land directly in-app
  // (or back into provider signup when the gate is active).
  useEffect(() => {
    if (authReady && isLoggedIn && showSplash) {
      setShowSplash(false);
    }
  }, [authReady, isLoggedIn, showSplash]);

  // Menu and navigation states
  const [showMenu, setShowMenu] = useState(false);
  const [currentPage, setCurrentPage] = useState<AppPage>("main");
  const [skillsFocusServiceId, setSkillsFocusServiceId] = useState<
    string | null
  >(null);
  const [reportContext, setReportContext] =
    useState<ReportProviderContext | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const [userAvatarUrl, setUserAvatarUrl] = useState<string>("");
  const [menuUserName, setMenuUserName] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authReady || !isLoggedIn) return;

    const syncFromUrl = () => {
      if (localStorage.getItem(PROVIDER_SETUP_REDIRECT_KEY) === "1") {
        setForceProviderSetup(true);
        setCurrentPage("skills");
        return;
      }
      const fromUrl = pageFromPathname(window.location.pathname);
      setCurrentPage(fromUrl ?? "main");
    };

    syncFromUrl();
    setRouteReady(true);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [authReady, isLoggedIn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authReady || !isLoggedIn || !routeReady) return;

    const nextPath = pathnameFromPage(currentPage);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ page: currentPage }, "", nextPath);
    }
  }, [authReady, isLoggedIn, routeReady, currentPage]);

  // Clear stale setup marker once forced setup flow has completed.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authReady || !isLoggedIn) return;
    if (forceProviderSetup || currentPage === "skills") return;
    if (localStorage.getItem(PROVIDER_SETUP_REDIRECT_KEY) === "1") {
      localStorage.removeItem(PROVIDER_SETUP_REDIRECT_KEY);
    }
  }, [authReady, isLoggedIn, forceProviderSetup, currentPage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!authReady || !isLoggedIn) return;
    if (localStorage.getItem(SKILLS_SAVED_MAIN_REDIRECT_KEY) !== "1") return;
    localStorage.removeItem(SKILLS_SAVED_MAIN_REDIRECT_KEY);
    setForceProviderSetup(false);
    setCurrentPage("main");
  }, [authReady, isLoggedIn]);

  const [userMode, setUserMode] = useState<"customer" | "provider">("customer");
  const [accountRolesUi, setAccountRolesUi] = useState<{
    has_customer: boolean;
    has_provider: boolean;
    can_switch_modes: boolean;
  }>({ has_customer: false, has_provider: false, can_switch_modes: false });
  const [language, setLanguage] = useState<Language>(
    () => readStoredLanguage() ?? "no",
  );
  const [paymentMethod, setPaymentMethod] = useState<"apple_pay" | "card">(
    "card",
  );

  useEffect(() => {
    writeStoredLanguage(language);
  }, [language]);

  // Language-aware constants
  const APP_MODES = language === "en" ? APP_MODES_EN : APP_MODES_NO;
  const FALLBACK_MODE_TARGETS =
    language === "en" ? MODE_TARGETS_EN : MODE_TARGETS_NO;
  const FALLBACK_MODE_CATEGORIES =
    language === "en" ? MODE_CATEGORIES_EN : MODE_CATEGORIES_NO;
  const FALLBACK_MODE_SERVICES = MODE_SERVICES;

  const [dbCatalog, setDbCatalog] = useState<{
    targets: { id: string; mode_id: string; name?: string }[];
    categories: {
      id: string;
      mode_id: string;
      target_id: string;
      name?: string;
    }[];
    services: {
      id: string;
      mode_id: string;
      target_id: string;
      category_id: string;
      name?: string;
      duration_minutes?: number;
      base_price_min?: number;
      base_price_max?: number;
    }[];
  } | null>(null);
  const [catalogHierarchyReady, setCatalogHierarchyReady] = useState(false);

  // FreshUp Pricing & Tier System v1.0 §2.2/§2.3:
  // Dynamic, area-aware customer prices fed by /api/pricing/quote-bulk.
  // Empty map = legacy base_price_min/max average is used (safe fallback).
  const [dynamicPrices, setDynamicPrices] = useState<
    Record<string, DashboardDynamicPriceEntry>
  >({});
  const [bulkPricesReadyKey, setBulkPricesReadyKey] = useState<string | null>(
    null,
  );

  const TARGET_ICON_BY_ID: Record<string, string> = {
    male: "👨",
    female: "👩",
    car: "🚗",
    motorcycle: "🏍️",
    dog: "🐕",
    cat: "🐱",
    apartment: "🏠",
    house: "🏡",
    individual: "👤",
    group: "👥",
  };

  const resolveTargetIcon = useCallback(
    (
      targetId: string,
      fallbackRows: readonly { id: string; icon: string }[] = [],
    ) => {
      const direct = TARGET_ICON_BY_ID[targetId];
      if (direct) return direct;
      const fromFallback = fallbackRows.find(
        (row) => row.id === targetId,
      )?.icon;
      if (fromFallback) return fromFallback;
      const suffix = String(targetId || "")
        .trim()
        .toLowerCase()
        .split("_")
        .pop();
      if (suffix && TARGET_ICON_BY_ID[suffix]) return TARGET_ICON_BY_ID[suffix];
      return "👤";
    },
    [],
  );

  const prettifyServiceName = useCallback((nameOrId: string) => {
    let raw = String(nameOrId || "").trim();
    if (!raw) return "";
    // DB ids often encode mode + target (e.g. home_apt_electrician). Strip those
    // so labels read as the leaf category ("Electrician") instead of "Home Apt …".
    if (/^[a-z0-9_-]+$/i.test(raw)) {
      const lower = raw.toLowerCase();
      for (const prefix of [
        "home_apt_",
        "home_house_",
        "vehicle_car_",
        "vehicle_mc_",
        "beauty_male_",
        "beauty_female_",
      ]) {
        if (lower.startsWith(prefix)) {
          raw = raw.slice(prefix.length);
          break;
        }
      }
    }
    const withoutGenderSuffix = raw.replace(/\s+([mf])$/i, "").trim();
    if (!withoutGenderSuffix) return "";
    const machineLike = /^[a-z0-9_-]+$/.test(withoutGenderSuffix);
    if (!machineLike) return withoutGenderSuffix;
    return withoutGenderSuffix
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }, []);

  const MODE_TARGETS = useMemo(() => {
    if (!dbCatalog?.targets?.length) return FALLBACK_MODE_TARGETS;
    const next: Record<string, { id: string; label: string; icon: string }[]> =
      {};
    Object.keys(FALLBACK_MODE_TARGETS).forEach((mode) => {
      const rows = (dbCatalog.targets || []).filter((t) => t.mode_id === mode);
      const fallbackRows = FALLBACK_MODE_TARGETS[
        mode as keyof typeof FALLBACK_MODE_TARGETS
      ] as readonly { id: string; label: string; icon: string }[];
      if (rows.length > 0) {
        const grouped = new Map<string, { id: string; label: string }>();
        rows.forEach((t) => {
          const key = normalizeCatalogTargetKey(t.id);
          const preferredId =
            fallbackRows.find(
              (row) =>
                row.id === t.id || normalizeCatalogTargetKey(row.id) === key,
            )?.id ?? key;
          const candidate = { id: t.id, label: t.name || t.id };
          const existing = grouped.get(key);
          if (!existing) {
            grouped.set(key, candidate);
            return;
          }
          const pickCandidate =
            candidate.id === preferredId && existing.id !== preferredId
              ? true
              : candidate.id !== preferredId &&
                existing.id !== preferredId &&
                catalogRowPriority(candidate.id) <
                  catalogRowPriority(existing.id);
          if (pickCandidate) grouped.set(key, candidate);
        });
        const fallbackOrder = new Map(
          fallbackRows.map((row, index) => [
            normalizeCatalogTargetKey(row.id),
            index,
          ]),
        );
        next[mode] = Array.from(grouped.values())
          .map((t) => ({
            id: t.id,
            label: t.label,
            icon: resolveTargetIcon(t.id, fallbackRows),
          }))
          .sort(
            (a, b) =>
              (fallbackOrder.get(normalizeCatalogTargetKey(a.id)) ?? 999) -
              (fallbackOrder.get(normalizeCatalogTargetKey(b.id)) ?? 999),
          );
      } else {
        next[mode] = fallbackRows.map((t) => ({
          id: t.id,
          label: t.label,
          icon: t.icon,
        }));
      }
    });
    return next;
  }, [dbCatalog, FALLBACK_MODE_TARGETS, resolveTargetIcon]);

  const MODE_CATEGORIES = useMemo(() => {
    if (!dbCatalog?.categories?.length) return FALLBACK_MODE_CATEGORIES;
    const next: Record<
      string,
      Record<string, { id: string; label: string }[]>
    > = {};
    Object.keys(FALLBACK_MODE_CATEGORIES).forEach((mode) => {
      const buckets: Record<
        string,
        Map<string, { id: string; label: string }>
      > = {};
      (dbCatalog.categories || [])
        .filter((c) => c.mode_id === mode)
        .forEach((c) => {
          const targetKey = normalizeCatalogTargetKey(
            String(c.target_id || ""),
          );
          if (!buckets[targetKey]) buckets[targetKey] = new Map();
          const categoryKey = categoryCatalogKey(
            String(c.id || ""),
            String(c.name || ""),
          );
          const candidate = {
            id: c.id,
            label: prettifyServiceName(String(c.name || c.id)),
          };
          const existing = buckets[targetKey].get(categoryKey);
          if (
            !existing ||
            catalogRowPriority(candidate.id) < catalogRowPriority(existing.id)
          ) {
            buckets[targetKey].set(categoryKey, candidate);
          }
        });
      const byTarget: Record<string, { id: string; label: string }[]> = {};
      Object.entries(buckets).forEach(([targetKey, map]) => {
        byTarget[targetKey] = Array.from(map.values());
      });
      next[mode] =
        Object.keys(byTarget).length > 0
          ? byTarget
          : FALLBACK_MODE_CATEGORIES[
              mode as keyof typeof FALLBACK_MODE_CATEGORIES
            ];
    });
    return next;
  }, [dbCatalog, FALLBACK_MODE_CATEGORIES, prettifyServiceName]);

  const MODE_SERVICES_DB = useMemo(() => {
    const result: Record<
      string,
      Record<
        string,
        Record<
          string,
          {
            id: string;
            name: string;
            duration: number;
            price: number;
            pricingServiceId?: string;
          }[]
        >
      >
    > = {};
    (dbCatalog?.services || []).forEach((s) => {
      const mode = String(s.mode_id || "");
      const target = String(s.target_id || "");
      const category = String(s.category_id || "");
      if (!result[mode]) result[mode] = {};
      if (!result[mode][target]) result[mode][target] = {};
      if (!result[mode][target][category]) result[mode][target][category] = [];
      const priceMin = Number(s.base_price_min) || 0;
      const priceMax = Number(s.base_price_max) || 0;
      // Pricing v1.0: prefer the dynamic, area-aware customer price when
      // the engine produced one for this service. Otherwise fall back to
      // the legacy services.base_price_* average so behaviour is unchanged
      // before the bulk quote arrives (or if the area lacks ≥5 providers).
      const legacyAvg =
        priceMin > 0
          ? priceMax > 0
            ? Math.round((priceMin + priceMax) / 2)
            : priceMin
          : 0;
      const pricingServiceId = normalizeServiceId(s.id);
      const resolved = resolveCatalogServicePrice(pricingServiceId, {
        providerLegacyBase: legacyAvg,
        staticListPrice: 0,
        prices: dynamicPrices,
      });
      result[mode][target][category].push({
        id: s.id,
        pricingServiceId,
        name: prettifyServiceName(String(s.name || s.id)),
        duration: Number(s.duration_minutes) || 30,
        price: resolved,
      });
    });
    return result;
  }, [dbCatalog, prettifyServiceName, dynamicPrices]);

  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      try {
        const res = await fetch("/api/services/list?hierarchy=1", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setDbCatalog({
          targets: Array.isArray(json?.targets) ? json.targets : [],
          categories: Array.isArray(json?.categories) ? json.categories : [],
          services: Array.isArray(json?.services) ? json.services : [],
        });
      } catch {
        // keep local fallback catalog
      } finally {
        if (!cancelled) setCatalogHierarchyReady(true);
      }
    };
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  // Translation helper
  const t = useCallback(
    (key: string): string => {
      return TRANSLATIONS[language][key] || key;
    },
    [language],
  );

  const formatPrice = useCallback(
    (priceNOK: number): string => formatDisplayPrice(priceNOK, language),
    [language],
  );

  /** Persist provider's job-step transition to the DB (fire-and-forget; UI
   *  state has already advanced). Idempotent server-side. */
  const postProviderTransition = useCallback(
    async (
      orderId: string,
      next: "en_route" | "arrived" | "in_progress",
      providerId: string,
    ): Promise<boolean> => {
      if (!orderId || !providerId) return false;
      try {
        const res = await fetch("/api/orders/transition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: orderId,
            provider_id: providerId,
            next_status: next,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.ok === true) return true;
        if (data?.error && data.error !== "INVALID_FROM_STATUS") {
          console.warn("[provider-transition]", data);
        }
        return false;
      } catch (err) {
        console.warn("[provider-transition]", err);
        return false;
      }
    },
    [],
  );

  // Provider-specific states
  const [isProviderOnline, setIsProviderOnline] = useState(false);
  const providerOnlineRefreshInFlightRef = useRef<Set<string>>(new Set());
  const providerOnlineRefreshLastCompletedRef = useRef<string | null>(null);
  /** Bumps whenever local online intent changes so stale DB hydrates don't overwrite. */
  const providerOnlineHydrateGenRef = useRef(0);
  const providerOfferStatusToastRef = useRef<Set<string>>(new Set());
  const providerPaintOfferRef = useRef<(row: any) => boolean>(() => false);
  const providerSyncPendingOffersRef = useRef<
    ((force?: boolean) => void) | null
  >(null);
  const providerDashboardSnapshotSyncRef = useRef<string | null>(null);
  /** Blocks stale provider profile reloads from reverting delivery/provider toggle UI. */
  const providerDeliveryModePendingRef = useRef<"home" | "provider" | null>(
    null,
  );
  const prevDashboardPageRef = useRef<AppPage>(currentPage);
  const providerSkillsRefreshGenRef = useRef(0);

  const refreshProviderOnlineFromDb = useCallback(
    (uid: string, mode: "customer" | "provider") => {
      if (!hasSupabase || mode !== "provider") {
        setIsProviderOnline(false);
        providerOnlineRefreshLastCompletedRef.current = null;
        return;
      }
      const refreshKey = `${uid}:${mode}`;
      if (providerOnlineRefreshInFlightRef.current.has(refreshKey)) {
        return;
      }
      providerOnlineRefreshInFlightRef.current.add(refreshKey);
      const hydrateGen = providerOnlineHydrateGenRef.current;
      void supabase
        .from("provider_details")
        .select("id, is_online")
        .eq("id", uid)
        .maybeSingle()
        .then(
          async (res: {
            data: { id?: string; is_online?: boolean } | null;
            error: { message?: string } | null;
          }) => {
            // Ignore if user toggled (or mode switch wrote) while this fetch was in flight.
            if (hydrateGen !== providerOnlineHydrateGenRef.current) return;
            if (res.data) {
              setIsProviderOnline(!!res.data.is_online);
              providerOnlineRefreshLastCompletedRef.current = refreshKey;
              return;
            }
            // Do not create provider_details here — that role is granted via
            // onboarding / Connect, not by opening provider mode.
            setIsProviderOnline(false);
            providerOnlineRefreshLastCompletedRef.current = refreshKey;
          },
        )
        .finally(() => {
          providerOnlineRefreshInFlightRef.current.delete(refreshKey);
        });
    },
    [hasSupabase, supabase],
  );

  const [providerEarningsToday, setProviderEarningsToday] = useState(0);
  const [onlineServices, setOnlineServices] = useState<string[]>([]);
  const [registeredServices, setRegisteredServices] = useState<string[]>([]);
  /** Per-skill delivery mode on the working screen (Munib 6 Aug). */
  const [providerSkillModes, setProviderSkillModes] = useState<
    Record<string, "home" | "provider" | "both">
  >({});
  const [providerAllowedServiceModes, setProviderAllowedServiceModes] =
    useState<{
      home: boolean;
      provider: boolean;
    }>({ home: true, provider: true });
  const [swipeProgress, setSwipeProgress] = useState(0);

  // Provider job flow states
  type ProviderJobStep =
    | "waiting"
    | "incoming"
    | "accepted"
    | "enroute"
    | "arrived"
    | "in_service"
    | "completed";
  const [providerJobStep, setProviderJobStep] =
    useState<ProviderJobStep>("waiting");
  const providerActionsInFlightRef = useRef<Set<ProviderActionKey>>(new Set());
  /** Prevents the next CTA from receiving the same click when job step swaps. */
  const providerJobActionCooldownUntilRef = useRef(0);
  const providerActiveJobRestoreDoneRef = useRef(false);
  const [incomingRequestTimer, setIncomingRequestTimer] = useState(
    PROVIDER_OFFER_EXPIRES_SECONDS,
  );
  const [providerCustomerRating, setProviderCustomerRating] = useState(0);
  const [providerDriveTimer, setProviderDriveTimer] = useState(0);
  const [providerServiceTimer, setProviderServiceTimer] = useState(0);
  const [providerServiceStartedAt, setProviderServiceStartedAt] = useState<
    string | null
  >(null);
  const [providerClockMs, setProviderClockMs] = useState(() => Date.now());
  const [providerServicePaused, setProviderServicePaused] = useState(false);
  const [providerServicePausedAt, setProviderServicePausedAt] = useState<
    string | null
  >(null);
  const [
    providerServicePausedTotalSeconds,
    setProviderServicePausedTotalSeconds,
  ] = useState(0);
  const [providerReadyForNext, setProviderReadyForNext] = useState(false);
  const providerReadyForNextAutoAttemptedRef = useRef(false);
  const providerReadyForNextOptOutRef = useRef(false);
  const [providerActionLoading, setProviderActionLoading] =
    useState<ProviderActionKey | null>(null);
  const providerJobActionsBusy = providerActionLoading !== null;
  const [providerDrivingPaused, setProviderDrivingPaused] = useState(false);
  const providerDrivingPausedRef = useRef(false);
  const providerServicePausedRef = useRef(false);
  providerDrivingPausedRef.current = providerDrivingPaused;
  providerServicePausedRef.current = providerServicePaused;
  const [providerDispatchTier, setProviderDispatchTier] = useState<
    "gold" | "silver" | "bronze"
  >("silver");
  const [providerStats, setProviderStats] = useState<{
    tier: "gold" | "silver" | "bronze";
    score: number | null;
    tierIsProvisional?: boolean;
    received?: number;
    acceptRate: number;
    completionRate: number;
    responseSpeed: number;
    responseBuckets?: {
      within3s: number;
      within6s: number;
      within9s: number;
      after9s: number;
      noResponse: number;
      acceptedWithin3s: number;
      acceptedWithin6s: number;
      acceptedWithin9s: number;
      acceptedAfter9s: number;
      totalPoints: number;
    };
  } | null>(null);
  const [providerStatsLoading, setProviderStatsLoading] = useState(false);
  const [providerMatchCode] = useState(
    `${Math.floor(100 + Math.random() * 900)}`,
  );
  type ProviderOfferCardPayload = {
    offerId: string;
    orderId: string;
    expiresAt: string | null;
    customer: {
      name: string;
      avatar: string;
      avatarUrl?: string | null;
      rating: number;
      phone: string;
      id?: string;
    };
    service: {
      id: string;
      name: string;
      category: string;
      categoryId?: string;
      appMode?: AppMode;
      price: number;
      duration: number;
      target: string;
      targetId?: string;
      targetIcon?: string;
      rating: number;
    };
    location: { address: string; distance: string; eta: string };
    customerLocation?: LatLng | null;
    matchDistanceKm?: number | null;
    addonLines: ProviderOfferAddonLine[];
    mode: "home" | "provider";
    requestedTime: string;
    providerEarnings?: number;
    providerServicePrice?: number;
    lockedDeliveryFee?: number;
    addonsCustomerTotal?: number;
    addonsProviderTotal?: number;
    /** Booked customer total from orders.price — single source for UI price labels. */
    customerOrderTotal?: number;
  };
  const [providerIncomingOffer, setProviderIncomingOffer] =
    useState<ProviderOfferCardPayload | null>(null);
  /** Second offer while already on an active job (shown as top banner + optional sheet). */
  const [providerQueuedIncomingOffer, setProviderQueuedIncomingOffer] =
    useState<ProviderOfferCardPayload | null>(null);
  const [providerQueuedOfferTimer, setProviderQueuedOfferTimer] = useState(
    PROVIDER_OFFER_EXPIRES_SECONDS,
  );
  const [showProviderQueuedOfferSheet, setShowProviderQueuedOfferSheet] =
    useState(false);
  /** Accepted next job waiting until current job finishes (banner holding state). */
  const [providerHeldNextJob, setProviderHeldNextJob] =
    useState<ProviderOfferCardPayload | null>(null);
  const providerHeldNextJobRef = useRef<ProviderOfferCardPayload | null>(null);
  providerHeldNextJobRef.current = providerHeldNextJob;
  const [customerLivePos, setCustomerLivePos] = useState<LatLng | null>(null);
  /** Authoritative booked delivery coords from orders table (server API). */
  const [providerOrderDeliveryPin, setProviderOrderDeliveryPin] =
    useState<LatLng | null>(null);
  /** Provider base/live coords from server when device GPS is at customer spot. */
  const [providerOrderProviderPin, setProviderOrderProviderPin] =
    useState<LatLng | null>(null);
  /** Customer-side booked delivery + provider shop coords for home delivery map. */
  const [customerOrderDeliveryPin, setCustomerOrderDeliveryPin] =
    useState<LatLng | null>(null);
  const [customerOrderProviderBasePin, setCustomerOrderProviderBasePin] =
    useState<LatLng | null>(null);

  const providerJobStepRef = useRef<ProviderJobStep>("waiting");
  providerJobStepRef.current = providerJobStep;
  const providerIncomingOfferRef = useRef<ProviderOfferCardPayload | null>(
    null,
  );
  providerIncomingOfferRef.current = providerIncomingOffer;
  /** Prevents pending-offer refresh from reverting UI after Accept is clicked. */
  const providerAcceptingOfferIdRef = useRef<string | null>(null);
  const incomingOfferExpiresAtRef = useRef<string | null>(null);
  /** Per-offer hydration fingerprint — avoids re-fetching order details on every poll/realtime tick. */
  const offerHydrationKeysRef = useRef<Map<string, string>>(new Map());
  const applyOfferRowInFlightRef = useRef<Set<string>>(new Set());
  const [isAcceptingProviderOffer, setIsAcceptingProviderOffer] =
    useState(false);

  // Bottom sheet state - start compressed on map so sidebar is visible
  const [isBottomSheetCompressed, setIsBottomSheetCompressed] = useState(true);
  /** Measured bottom edge of the expanded catalog filter bar (+ gap). */
  const mainContainerRef = useRef<HTMLElement>(null);
  const catalogTopChromeRef = useRef<HTMLDivElement>(null);
  const [sheetTopInsetPx, setSheetTopInsetPx] = useState(152);
  const [showChat, setShowChat] = useState(false);
  const routeFetchGenRef = useRef(0);
  const routeFetchKeyInFlightRef = useRef<string | null>(null);
  const lastRouteFromRef = useRef<LatLng | null>(null);
  const lastRouteToRef = useRef<LatLng | null>(null);
  const routeReadyKeyRef = useRef<string | null>(null);
  /** Latest GPS for provider browse presence (updated after useGeolocation). */
  const providerBrowseGeolocRef = useRef<LatLng | null>(null);
  /** Expand customer matched sheet once; polling must not re-compress it. */
  const customerMatchedSheetOpenedRef = useRef(false);
  const customerOrderStatusContextRef = useRef<{
    language: Language;
    appMode: AppMode;
    mode: "home" | "provider";
    selectedStyleDuration?: number;
    hydrateCustomerOrderDestination: (
      orderId: string,
    ) => Promise<LatLng | null>;
    refreshCustomerDrivingRoute: () => void;
  }>({
    language: "no",
    appMode: "beauty",
    mode: "home",
    hydrateCustomerOrderDestination: async () => null,
    refreshCustomerDrivingRoute: () => {},
  });
  const [showEmergency, setShowEmergency] = useState(false);

  // Touch handling for swipe gestures
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Pre-made chat messages
  const CHAT_MESSAGES =
    language === "en"
      ? [
          "I'm on my way 🚗",
          "How long will it take? ⏰",
          "Can we change the time? 📅",
          "Do you need anything special? 💼",
          "Thanks for the great service! 🙏",
          "Where are you? 📍",
        ]
      : [
          "Jeg er på vei 🚗",
          "Hvor lang tid tar det? ⏰",
          "Kan vi endre tiden? 📅",
          "Trenger du noe spesielt? 💼",
          "Takk for god service! 🙏",
          "Hvor er du? 📍",
        ];

  // Auth (minimal)
  const [loggedInUser, setUser] = useState<any | null>(null);
  useEffect(() => {
    if (!hasSupabase) {
      setAuthReady(true);
      return;
    }
    let cancelled = false;
    let unsub: any;
    const markAuthReady = () => {
      if (!cancelled) setAuthReady(true);
    };
    const applySession = (session: any) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setIsLoggedIn(!!nextUser);
      if (nextUser) {
        const token = session?.access_token as string | undefined;
        // Optimistic from cache, then correct from server roles.
        const optimistic = resolveDashboardMode(nextUser);
        setUserMode(optimistic);
        refreshProviderOnlineFromDb(nextUser.id, optimistic);
        void resolveDashboardModeFromServer(nextUser, token).then((mode) => {
          setUserMode(mode);
          refreshProviderOnlineFromDb(nextUser.id, mode);
          if (mode === "provider") {
            void supabase.auth.updateUser({ data: { app_role: "provider" } });
          }
        });
        void fetchAccountRoles({ accessToken: token }).then((roles) => {
          if (!roles) return;
          setAccountRolesUi({
            has_customer: roles.has_customer,
            has_provider: roles.has_provider,
            can_switch_modes: Boolean(roles.can_switch_modes),
          });
        });
      } else {
        setIsProviderOnline(false);
        setAccountRolesUi({
          has_customer: false,
          has_provider: false,
          can_switch_modes: false,
        });
      }
    };
    const authReadyTimeout = window.setTimeout(() => {
      markAuthReady();
    }, 10_000);
    void supabase.auth
      .getSession()
      .then(({ data }: any) => {
        if (cancelled) return;
        applySession(data?.session ?? null);
        markAuthReady();
      })
      .catch(() => {
        if (cancelled) return;
        applySession(null);
        markAuthReady();
      })
      .finally(() => {
        window.clearTimeout(authReadyTimeout);
      });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (event: any, session: any) => {
        if (cancelled) return;
        applySession(session);
        markAuthReady();
      },
    );
    unsub = listener?.subscription;
    return () => {
      cancelled = true;
      window.clearTimeout(authReadyTimeout);
      unsub?.unsubscribe?.();
    };
  }, [hasSupabase, supabase, refreshProviderOnlineFromDb]);

  useEffect(() => {
    if (!loggedInUser?.id) {
      setIsAdminUser(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;
        if (!token) {
          if (!cancelled) setIsAdminUser(false);
          return;
        }
        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!cancelled) setIsAdminUser(Boolean(body?.is_admin));
      } catch {
        if (!cancelled) setIsAdminUser(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loggedInUser?.id, supabase]);

  useEffect(() => {
    if (!loggedInUser?.id) return;
    if (userMode === "provider") {
      providerOnlineRefreshLastCompletedRef.current = null;
    }
    refreshProviderOnlineFromDb(loggedInUser.id, userMode);
    if (userMode === "provider") {
      providerSyncPendingOffersRef.current?.(true);
    }
  }, [loggedInUser?.id, userMode, refreshProviderOnlineFromDb]);

  // Menu profile header: avatar + display name from cache, then profile API.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!loggedInUser?.id) {
      setUserAvatarUrl("");
      setMenuUserName("");
      return;
    }

    const uid = loggedInUser.id;
    let cancelled = false;

    const applyCache = () => {
      try {
        const raw = localStorage.getItem(profileCacheKey(uid, userMode));
        if (!raw) return;
        const parsed = JSON.parse(raw) as {
          avatarUrl?: string;
          name?: string;
        };
        if (!cancelled && typeof parsed?.avatarUrl === "string") {
          setUserAvatarUrl(parsed.avatarUrl);
        }
        if (
          !cancelled &&
          typeof parsed?.name === "string" &&
          parsed.name.trim()
        ) {
          setMenuUserName(parsed.name.trim());
        }
      } catch {
        // ignore malformed cache
      }
    };

    applyCache();

    const loadFromApi = async () => {
      try {
        const endpoint =
          userMode === "provider" ? "/api/providers/me" : "/api/customers/me";
        const headers: Record<string, string> =
          userMode === "provider"
            ? { "x-provider-id": uid }
            : { "x-user-id": uid };
        const res = await fetch(endpoint, { cache: "no-store", headers });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const name = String(body?.contact?.name || "").trim();
        const avatarUrl = String(body?.contact?.avatarUrl || "").trim();
        if (name) setMenuUserName(name);
        if (avatarUrl) setUserAvatarUrl(avatarUrl);
        try {
          const existing = localStorage.getItem(profileCacheKey(uid, userMode));
          const prev = existing ? JSON.parse(existing) : {};
          localStorage.setItem(
            profileCacheKey(uid, userMode),
            JSON.stringify({
              ...prev,
              ...(name ? { name } : {}),
              ...(avatarUrl ? { avatarUrl } : {}),
              savedAt: Date.now(),
            }),
          );
        } catch {
          // best effort cache update
        }
      } catch {
        // keep cache / auth metadata fallbacks
      }
    };
    void loadFromApi();

    const onProfileUpdated = () => applyCache();
    window.addEventListener("storage", onProfileUpdated);
    window.addEventListener("profileUpdated", onProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onProfileUpdated);
      window.removeEventListener("profileUpdated", onProfileUpdated);
    };
    // Navigating pages must not refetch the profile — `profileUpdated` and
    // `storage` keep the header in sync after an edit.
  }, [loggedInUser?.id, userMode]);

  const hamburgerUserName = useMemo(() => {
    const fromCache = menuUserName.trim();
    if (fromCache) return fromCache;
    const meta = loggedInUser?.user_metadata ?? {};
    const fromAuth = String(
      meta.display_name || meta.full_name || meta.name || "",
    ).trim();
    if (fromAuth) return fromAuth;
    return language === "en" ? "User" : "Bruker";
  }, [menuUserName, loggedInUser, language]);

  const refreshRegisteredProviderSkills = useCallback(async () => {
    const refreshGen = ++providerSkillsRefreshGenRef.current;
    const isStale = () => refreshGen !== providerSkillsRefreshGenRef.current;

    if (!authReady || !isLoggedIn || userMode !== "provider") {
      setRegisteredServices([]);
      setOnlineServices([]);
      setProviderAllowedServiceModes({ home: true, provider: true });
      setProviderStats(null);
      setProviderStatsLoading(false);
      return;
    }
    if (!loggedInUser?.id) return;

    // Keep signup snapshot visible while the API fetch is in flight.
    // Only hydrate *registered* skills from localStorage — never force
    // available_now toggles on from the snapshot (that caused offline
    // toggles to flip back on after every refresh).
    const optimisticSkills =
      typeof window !== "undefined"
        ? mergeSkillsFromLocalSnapshot(loggedInUser.id, [], [])
        : { registered: [] as string[], online: [] as string[] };
    if (optimisticSkills.registered.length > 0) {
      setRegisteredServices(optimisticSkills.registered);
    } else {
      setRegisteredServices([]);
    }
    setProviderStats(null);
    setProviderStatsLoading(true);

    try {
      const res = await fetch("/api/providers/me", {
        cache: "no-store",
        headers: { "x-provider-id": loggedInUser.id },
      });
      if (!res.ok) {
        if (!isStale()) setProviderStats(null);
        return;
      }
      const json = await res.json();
      const deliveryModes = Array.isArray(json?.provider?.delivery_modes)
        ? (json.provider.delivery_modes as unknown[])
            .map((v) =>
              String(v || "")
                .toLowerCase()
                .trim(),
            )
            .filter(Boolean)
        : [];
      const allowHome =
        deliveryModes.length === 0 || deliveryModes.includes("home");
      const allowProvider =
        deliveryModes.length === 0 ||
        deliveryModes.includes("provider") ||
        deliveryModes.includes("at_provider");
      // Legacy capability flags only — live delivery is per skill now.
      const modeFromDb: "home" | "provider" | null =
        allowHome && !allowProvider
          ? "home"
          : allowProvider && !allowHome
            ? "provider"
            : null;

      const allSkillIds = Array.isArray(json?.skills)
        ? [
            ...new Set(
              json.skills
                .filter((s: any) => s?.is_active !== false)
                .map((s: any) => s?.service_id)
                .filter(Boolean),
            ),
          ]
        : [];
      const activeSkillIds = Array.isArray(json?.skills)
        ? [
            ...new Set(
              json.skills
                .filter(
                  (s: any) =>
                    s?.is_active !== false && s?.available_now === true,
                )
                .map((s: any) => s?.service_id)
                .filter(Boolean),
            ),
          ]
        : [];
      const skillModeMap: Record<string, "home" | "provider" | "both"> = {};
      if (Array.isArray(json?.skills)) {
        for (const s of json.skills) {
          if (s?.is_active === false) continue;
          const sid = normalizeServiceId(String(s?.service_id || ""));
          if (!sid) continue;
          const raw = String(s?.service_mode_id || "both")
            .trim()
            .toLowerCase();
          const mode: "home" | "provider" | "both" =
            raw === "home" || raw === "provider" || raw === "both"
              ? raw
              : "both";
          skillModeMap[sid] = mode;
          for (const v of serviceIdVariantsForDashboard(sid)) {
            skillModeMap[normalizeServiceId(v)] = mode;
          }
        }
      }
      if (!isStale()) setProviderSkillModes(skillModeMap);
      const normalizedAllSkillIds = [
        ...new Set(
          allSkillIds.map((id) => normalizeServiceId(id)).filter(Boolean),
        ),
      ];
      const normalizedActiveSkillIds = [
        ...new Set(
          activeSkillIds.map((id) => normalizeServiceId(id)).filter(Boolean),
        ),
      ];
      const expandedAllSkillIds = [
        ...new Set(
          normalizedAllSkillIds
            .flatMap((id) => serviceIdVariantsForDashboard(id))
            .filter(Boolean),
        ),
      ];
      const expandedActiveSkillIds = [
        ...new Set(
          normalizedActiveSkillIds
            .flatMap((id) => serviceIdVariantsForDashboard(id))
            .filter(Boolean),
        ),
      ];
      const resolveUiSelectionFromServiceId = (serviceId: string) => {
        const normalized = normalizeServiceId(serviceId);
        if (!normalized) return null;
        const variants = serviceIdVariantsForDashboard(normalized);
        const allModes = Object.keys(MODE_SERVICES_DB) as AppMode[];
        for (const modeKey of allModes) {
          const targetsForMode = MODE_SERVICES_DB[modeKey] || {};
          for (const [targetKey, categoriesForTarget] of Object.entries(
            targetsForMode,
          )) {
            for (const [categoryKey, services] of Object.entries(
              categoriesForTarget || {},
            )) {
              if (
                (services || []).some((service: any) =>
                  variants.includes(normalizeServiceId(service?.id)),
                )
              ) {
                return {
                  mode: modeKey,
                  target: targetKey,
                  category: categoryKey,
                };
              }
            }
          }
        }
        const fallbackModes = Object.keys(FALLBACK_MODE_SERVICES) as AppMode[];
        for (const modeKey of fallbackModes) {
          const targetsForMode = FALLBACK_MODE_SERVICES[modeKey] || {};
          for (const [targetKey, categoriesForTarget] of Object.entries(
            targetsForMode,
          )) {
            for (const [categoryKey, services] of Object.entries(
              categoriesForTarget || {},
            )) {
              if (
                (services || []).some((service: any) =>
                  variants.includes(normalizeServiceId(service?.id)),
                )
              ) {
                return {
                  mode: modeKey,
                  target: targetKey,
                  category: categoryKey,
                };
              }
            }
          }
        }
        return null;
      };
      const uiSelections = normalizedAllSkillIds
        .map((id) => resolveUiSelectionFromServiceId(id))
        .filter(Boolean) as Array<{
        mode: AppMode;
        target: string;
        category: string;
      }>;
      let effectiveRegisteredSkillIds = expandedAllSkillIds as string[];
      let effectiveOnlineSkillIds = expandedActiveSkillIds as string[];

      // Merge a fresh local snapshot so dashboard reflects skills saved on the
      // skills page even if the API response is empty or briefly stale.
      if (typeof window !== "undefined") {
        const merged = mergeSkillsFromLocalSnapshot(
          loggedInUser.id,
          effectiveRegisteredSkillIds,
          effectiveOnlineSkillIds,
        );
        effectiveRegisteredSkillIds = merged.registered;
        effectiveOnlineSkillIds = merged.online;
      }

      if (isStale()) return;
      const perf = json?.performanceStats;
      const perfTierRaw = String(perf?.tier || "")
        .toLowerCase()
        .trim();
      const statsTier: "gold" | "silver" | "bronze" =
        perfTierRaw === "gold" ||
        perfTierRaw === "silver" ||
        perfTierRaw === "bronze"
          ? perfTierRaw
          : (() => {
              const dbTier = String(
                json?.provider?.dispatch_performance_tier || "",
              )
                .toLowerCase()
                .trim();
              if (
                dbTier === "gold" ||
                dbTier === "silver" ||
                dbTier === "bronze"
              ) {
                return dbTier;
              }
              return "silver";
            })();
      setProviderDispatchTier(statsTier);
      if (perf) {
        setProviderStats({
          tier: statsTier,
          score:
            perf?.tierIsProvisional === true
              ? null
              : Number.isFinite(Number(perf?.score))
                ? Number(perf.score)
                : null,
          tierIsProvisional: perf?.tierIsProvisional === true,
          received: Number.isFinite(Number(perf?.received))
            ? Number(perf.received)
            : 0,
          acceptRate: Number.isFinite(Number(perf?.acceptRate))
            ? Number(perf.acceptRate)
            : 0,
          completionRate: Number.isFinite(Number(perf?.completionRate))
            ? Number(perf.completionRate)
            : 0,
          responseSpeed: Number.isFinite(Number(perf?.responseSpeed))
            ? Number(perf.responseSpeed)
            : 0,
          responseBuckets: perf?.responseBuckets ?? undefined,
        });
      } else {
        setProviderStats(null);
      }
      setProviderAllowedServiceModes({
        home: allowHome,
        provider: allowProvider,
      });
      if (modeFromDb) {
        const pendingDeliveryMode = providerDeliveryModePendingRef.current;
        if (pendingDeliveryMode === null) {
          const savedLocal =
            typeof window !== "undefined" && loggedInUser?.id
              ? localStorage.getItem(sharedDeliveryModeKey(loggedInUser.id))
              : null;
          const preferredMode: "home" | "provider" | null =
            savedLocal === "home" && allowHome
              ? "home"
              : savedLocal === "provider" && allowProvider
                ? "provider"
                : null;
          const nextMode = preferredMode ?? modeFromDb;
          setServiceMode(nextMode);
          if (typeof window !== "undefined" && loggedInUser?.id) {
            localStorage.setItem(
              sharedDeliveryModeKey(loggedInUser.id),
              nextMode,
            );
            syncDeliveryModeInSnapshots(loggedInUser.id, nextMode);
          }
        } else if (modeFromDb === pendingDeliveryMode) {
          providerDeliveryModePendingRef.current = null;
        }
      }
      setRegisteredServices(effectiveRegisteredSkillIds);
      setOnlineServices(effectiveOnlineSkillIds);
      // Clear forced-setup flag as soon as we have active skills — avoids a
      // second GET /api/providers/me from syncForcedSetupState.
      if (effectiveRegisteredSkillIds.length > 0) {
        setForceProviderSetup((prev) => (prev ? false : prev));
      }
      if (typeof window !== "undefined") {
        let existingSnapshot: Record<string, unknown> = {};
        try {
          const rawExisting = localStorage.getItem(
            providerSkillsSnapshotKey(loggedInUser.id),
          );
          if (rawExisting) {
            const parsed = JSON.parse(rawExisting);
            if (parsed && typeof parsed === "object") {
              existingSnapshot = parsed as Record<string, unknown>;
            }
          }
        } catch {
          // keep existing dashboard filters when snapshot is malformed
        }

        const existingSavedAt = Number(existingSnapshot.savedAt) || 0;
        const snapshotIsFresh =
          existingSavedAt > 0 &&
          Date.now() - existingSavedAt < PROVIDER_SKILLS_SNAPSHOT_FRESH_MS;
        const storedServices = Array.isArray(existingSnapshot.services)
          ? existingSnapshot.services
              .map((id) => normalizeServiceId(String(id)))
              .filter(Boolean)
          : [];
        const mergedSnapshotServices = snapshotIsFresh
          ? [...new Set([...storedServices, ...normalizedAllSkillIds])]
          : normalizedAllSkillIds;
        const apiRatings = Object.fromEntries(
          (Array.isArray(json?.skills) ? json.skills : [])
            .map((s: any) => [
              normalizeServiceId(String(s?.service_id || "")),
              Math.max(1, Math.min(5, Number(s?.competence_rating) || 3)),
            ])
            .filter(([id]: any[]) => Boolean(id)),
        );
        const storedRatings =
          snapshotIsFresh &&
          existingSnapshot.ratings &&
          typeof existingSnapshot.ratings === "object"
            ? (existingSnapshot.ratings as Record<string, number>)
            : {};

        const savedLocal =
          typeof window !== "undefined" && loggedInUser?.id
            ? localStorage.getItem(sharedDeliveryModeKey(loggedInUser.id))
            : null;
        const snapshotDeliveryMode: "home" | "provider" =
          savedLocal === "home" && allowHome
            ? "home"
            : savedLocal === "provider" && allowProvider
              ? "provider"
              : (modeFromDb ?? (allowHome ? "home" : "provider"));

        const snapshot = {
          ...existingSnapshot,
          categories: Array.from(
            new Set(
              uiSelections
                .map((s) => String(s?.category || "").trim())
                .filter(Boolean),
            ),
          ),
          services: mergedSnapshotServices,
          ratings: { ...storedRatings, ...apiRatings },
          deliveryMode: snapshotDeliveryMode,
          savedAt: snapshotIsFresh ? existingSavedAt : Date.now(),
        };
        localStorage.setItem(
          providerSkillsSnapshotKey(loggedInUser.id),
          JSON.stringify(snapshot),
        );
        localStorage.setItem(
          "freshup.skills.snapshot.last",
          JSON.stringify(snapshot),
        );
      }
    } catch {
      if (!isStale()) setProviderStats(null);
    } finally {
      if (!isStale()) setProviderStatsLoading(false);
    }
  }, [authReady, isLoggedIn, userMode, loggedInUser?.id]);

  useEffect(() => {
    void refreshRegisteredProviderSkills();
  }, [refreshRegisteredProviderSkills]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSkillsUpdated = () => {
      void refreshRegisteredProviderSkills();
    };
    window.addEventListener("providerSkillsUpdated", onSkillsUpdated);
    return () => {
      window.removeEventListener("providerSkillsUpdated", onSkillsUpdated);
    };
  }, [refreshRegisteredProviderSkills]);

  const refreshProviderEarningsToday = useCallback(async () => {
    if (
      !hasSupabase ||
      !isLoggedIn ||
      userMode !== "provider" ||
      !loggedInUser?.id
    ) {
      return;
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;

      const url = new URL("/api/provider/earnings", window.location.origin);
      url.searchParams.set("period", "day");
      url.searchParams.set("lang", language === "en" ? "en" : "no");

      const res = await fetch(url.toString(), {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setProviderEarningsToday(Number(data?.summary?.total) || 0);
    } catch {
      // Keep the last known value on transient failures.
    }
  }, [hasSupabase, isLoggedIn, userMode, loggedInUser?.id, language, supabase]);

  useEffect(() => {
    if (!isLoggedIn || userMode !== "provider") {
      setProviderEarningsToday(0);
      return;
    }
    void refreshProviderEarningsToday();
  }, [isLoggedIn, userMode, refreshProviderEarningsToday]);

  useEffect(() => {
    if (!isLoggedIn || userMode !== "provider") return;
    const timer = window.setInterval(
      () => void refreshProviderEarningsToday(),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [isLoggedIn, userMode, refreshProviderEarningsToday]);

  useEffect(() => {
    if (showMenu && userMode === "provider") {
      void refreshProviderEarningsToday();
    }
  }, [showMenu, userMode, refreshProviderEarningsToday]);

  // forceProviderSetup is cleared inside refreshRegisteredProviderSkills once
  // active skills are present — no separate GET /api/providers/me needed here.

  const handleLogout = useCallback(async () => {
    if (loggedInUser?.id) clearStoredDashboardMode(loggedInUser.id);
    setIsProviderOnline(false);
    if (hasSupabase) {
      await supabase.auth.signOut({ scope: "global" });
    }
    setUser(null);
    setCurrentPage("main");
    setForceProviderSetup(false);
    setShowMenu(false);
    setShowProfile(false);
    setIsLoggedIn(false);
    setProviderStats(null);
    setProviderStatsLoading(false);
    if (typeof window !== "undefined") {
      clearOAuthPending();
      clearProviderSignupInProgress();
      localStorage.removeItem(PROVIDER_SETUP_REDIRECT_KEY);
      localStorage.removeItem(SKILLS_SAVED_MAIN_REDIRECT_KEY);
      if (window.location.pathname !== "/") {
        window.history.replaceState({ page: "main" }, "", "/");
      }
    }
  }, [hasSupabase, supabase, loggedInUser?.id]);

  // Filters
  const [serviceMode, setServiceMode] = useState<ServiceMode>("home");
  const [appMode, setAppMode] = useState<AppMode>("beauty");
  const [target, setTarget] = useState<string>("male");
  const [category, setCategory] = useState<string>("haircut");
  const [showModeDropdown, setShowModeDropdown] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!loggedInUser?.id) return;
    const saved = localStorage.getItem(sharedDeliveryModeKey(loggedInUser.id));
    if (saved === "home") setServiceMode("home");
    if (saved === "provider") setServiceMode("provider" as ServiceMode);
  }, [loggedInUser?.id]);

  const setMode = useCallback(
    (nextMode: "home" | "provider") => {
      const modeChanged = serviceMode !== nextMode;

      if (modeChanged) {
        setServiceMode(nextMode as ServiceMode);
        if (typeof window !== "undefined" && loggedInUser?.id) {
          localStorage.setItem(
            sharedDeliveryModeKey(loggedInUser.id),
            nextMode,
          );
          syncDeliveryModeInSnapshots(loggedInUser.id, nextMode);
        }
      }
      // Provider delivery is per skill (working card). Header toggle is customer-only.
    },
    [loggedInUser?.id, serviceMode],
  );

  // Legacy alias for backward compatibility
  const mode = serviceMode;
  const gender = target as GenderType;
  const setGender = (g: GenderType) => setTarget(g);

  const selectCatalogTarget = useCallback(
    (targetId: string) => {
      const newCategories =
        MODE_CATEGORIES[appMode]?.[targetId] ||
        MODE_CATEGORIES[appMode]?.[normalizeCatalogTargetKey(targetId)] ||
        [];
      const nextCategoryId = resolveCategoryForTarget(
        category,
        targetId,
        newCategories,
      );
      setTarget(targetId);
      if (nextCategoryId && nextCategoryId !== category) {
        setCategory(nextCategoryId);
        setSelectedAddons([]);
      }
    },
    [appMode, category, MODE_CATEGORIES],
  );

  // Dynamic targets, categories, and services based on app mode
  const currentTargets = useMemo(() => {
    return sortCatalogTargetsForDisplay(appMode, MODE_TARGETS[appMode] || []);
  }, [appMode, MODE_TARGETS]);

  const currentCategories = useMemo(() => {
    const byTarget = MODE_CATEGORIES[appMode];
    if (!byTarget) return [];
    const targetKey = normalizeCatalogTargetKey(target);
    const raw = byTarget[target] || byTarget[targetKey] || [];
    const fallback =
      FALLBACK_MODE_CATEGORIES[appMode]?.[targetKey] ||
      FALLBACK_MODE_CATEGORIES[appMode]?.[target] ||
      [];
    if (!fallback.length) return raw;

    const byKey = new Map<string, { id: string; label: string }>();
    for (const row of raw) {
      const key = categoryCatalogKey(row.id, row.label);
      const existing = byKey.get(key);
      if (
        !existing ||
        catalogRowPriority(row.id) < catalogRowPriority(existing.id)
      ) {
        byKey.set(key, row);
      }
    }

    const ordered: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const fb of fallback) {
      const key = categoryCatalogKey(fb.id, fb.label);
      const row = byKey.get(key);
      if (row && !seen.has(key)) {
        seen.add(key);
        ordered.push(row);
      }
    }
    for (const row of raw) {
      const key = categoryCatalogKey(row.id, row.label);
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(row);
      }
    }
    return ordered.length > 0 ? ordered : raw;
  }, [appMode, target, MODE_CATEGORIES, FALLBACK_MODE_CATEGORIES]);

  /** Latest catalog labels for provider incoming-offer UI (see provider-offers effect). */
  const providerOfferUiRef = useRef({
    language: "no" as Language,
    category: "",
    target: "",
    currentCategories: [] as { id: string; label: string }[],
    currentTargets: [] as { id: string; label: string; icon: string }[],
  });
  providerOfferUiRef.current = {
    language,
    category,
    target,
    currentCategories,
    currentTargets,
  };
  const providerCatalogRef = useRef<
    ProviderCatalogSnapshot & { translate: (key: string) => string }
  >({
    dbServices: [],
    modeTargets: {},
    modeCategories: {},
    modeServicesDb: {},
    fallbackModeServices: {},
    translate: (key: string) => key,
  });
  providerCatalogRef.current = {
    dbServices: dbCatalog?.services ?? [],
    modeTargets: MODE_TARGETS,
    modeCategories: MODE_CATEGORIES,
    modeServicesDb: MODE_SERVICES_DB,
    fallbackModeServices: FALLBACK_MODE_SERVICES,
    translate: t,
  };

  const toggleProviderOnlinePersisted = useCallback(async () => {
    if (!hasSupabase || !loggedInUser?.id) return;
    const next = !isProviderOnline;
    providerOnlineHydrateGenRef.current += 1;
    setIsProviderOnline(next);
    const pos = providerBrowseGeolocRef.current;
    try {
      const res = await fetch("/api/providers/online", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-provider-id": loggedInUser.id,
        },
        body: JSON.stringify({
          is_online: next,
          ...(pos && typeof pos.lat === "number" && typeof pos.lng === "number"
            ? { lat: pos.lat, lng: pos.lng }
            : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        is_online?: boolean;
        error?: string;
        message?: string;
      };
      const live = res.ok && json.is_online === true;
      if (next && !live) {
        providerOnlineHydrateGenRef.current += 1;
        setIsProviderOnline(false);
        const code = String(json?.error || "");
        const gateMsg =
          code === "PAYOUT_SETUP_REQUIRED"
            ? language === "en"
              ? "Complete payout setup before going online."
              : "Fullfør utbetalingsoppsett før du kan gå online."
            : code === "ADMIN_PENDING"
              ? language === "en"
                ? "Waiting for FreshUp admin approval before you can go online."
                : "Venter på FreshUp-godkjenning før du kan gå online."
              : code === "SKILLS_REQUIRED"
                ? language === "en"
                  ? "Add at least one service before going online."
                  : "Legg til minst én tjeneste før du kan gå online."
                : null;
        toast.error(
          gateMsg ||
            json?.message ||
            (language === "en"
              ? "Could not go online"
              : "Kunne ikke gå online"),
        );
        return;
      }
      if (!res.ok || (typeof json.is_online === "boolean" && json.is_online !== next)) {
        providerOnlineHydrateGenRef.current += 1;
        setIsProviderOnline(json.is_online === true);
        return;
      }
      if (next) {
        providerSyncPendingOffersRef.current?.(true);
      }
    } catch {
      providerOnlineHydrateGenRef.current += 1;
      setIsProviderOnline(!next);
      toast.error(
        language === "en" ? "Could not go online" : "Kunne ikke gå online",
      );
    }
  }, [hasSupabase, loggedInUser?.id, isProviderOnline, language]);

  // Keep last_online_at fresh while online so abandoned tabs don't stay in the pool.
  useEffect(() => {
    if (
      !hasSupabase ||
      !loggedInUser?.id ||
      userMode !== "provider" ||
      !isProviderOnline
    ) {
      return;
    }
    const uid = loggedInUser.id;
    const beat = () => {
      const pos = providerBrowseGeolocRef.current;
      void fetch("/api/providers/online", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-provider-id": uid,
        },
        body: JSON.stringify({
          heartbeat: true,
          ...(pos && typeof pos.lat === "number" && typeof pos.lng === "number"
            ? { lat: pos.lat, lng: pos.lng }
            : {}),
        }),
      }).catch(() => {
        // best-effort — cron stale sweep clears if heartbeats stop
      });
    };
    beat();
    const timer = window.setInterval(beat, 45_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasSupabase, loggedInUser?.id, userMode, isProviderOnline]);

  const toggleProviderSkillActivePersisted = useCallback(
    async (serviceId: string, nextActive: boolean) => {
      if (!loggedInUser?.id) return;
      const normalized = normalizeServiceId(serviceId);
      const variants = serviceIdVariantsForDashboard(serviceId);

      const resolveModeForServiceId = (id: string): string | null => {
        const idVariants = new Set(
          serviceIdVariantsForDashboard(id).map((v) => normalizeServiceId(v)),
        );
        for (const row of dbCatalog?.services || []) {
          if (idVariants.has(normalizeServiceId(row?.id))) {
            return String(row?.mode_id || "").trim() || null;
          }
        }
        for (const modeKey of Object.keys(
          FALLBACK_MODE_SERVICES,
        ) as AppMode[]) {
          const targetsForMode = FALLBACK_MODE_SERVICES[modeKey] || {};
          for (const categoriesForTarget of Object.values(targetsForMode)) {
            for (const services of Object.values(categoriesForTarget || {})) {
              if (
                (services || []).some((service: { id: string }) =>
                  idVariants.has(normalizeServiceId(service?.id)),
                )
              ) {
                return modeKey;
              }
            }
          }
        }
        return null;
      };

      const toggledMode = resolveModeForServiceId(serviceId);

      // Optimistic UI — keep only same-mode online skills when going live.
      setOnlineServices((prev) => {
        const prevFiltered = prev.filter(
          (id) => !variants.includes(normalizeServiceId(id)),
        );
        if (!nextActive) return prevFiltered;
        const sameModeOnly = toggledMode
          ? prevFiltered.filter((id) => {
              const mode = resolveModeForServiceId(id);
              return !mode || mode === toggledMode;
            })
          : prevFiltered;
        return [...sameModeOnly, normalized];
      });

      try {
        const pos = providerBrowseGeolocRef.current;
        const res = await fetch("/api/providers/skills/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-provider-id": loggedInUser.id,
          },
          body: JSON.stringify({
            service_id: serviceId,
            is_active: nextActive,
            ...(pos &&
            typeof pos.lat === "number" &&
            typeof pos.lng === "number"
              ? { lat: pos.lat, lng: pos.lng }
              : {}),
          }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          const code = String(json?.error || "");
          if (code === "PAYOUT_SETUP_REQUIRED" || code === "ADMIN_PENDING") {
            throw new Error(code);
          }
          throw new Error(
            json?.message || json?.error || "Failed to update skill status",
          );
        }
        if (nextActive) {
          setIsProviderOnline(true);
        }
        // Sync from API so other-mode deactivations are reflected.
        void refreshRegisteredProviderSkills();
      } catch (error: any) {
        setOnlineServices((prev) => {
          const prevFiltered = prev.filter(
            (id) => !variants.includes(normalizeServiceId(id)),
          );
          return !nextActive ? [...prevFiltered, normalized] : prevFiltered;
        });
        const code = String(error?.message || "");
        const gateMsg =
          code === "PAYOUT_SETUP_REQUIRED"
            ? language === "en"
              ? "Complete payout setup before going online."
              : "Fullfør utbetalingsoppsett før du går online."
            : code === "ADMIN_PENDING"
              ? language === "en"
                ? "Waiting for FreshUp admin approval before you can go online."
                : "Venter på FreshUp-godkjenning før du kan gå online."
              : null;
        toast.error(
          gateMsg ||
            error?.message ||
            (language === "en"
              ? "Could not update skill status"
              : "Kunne ikke oppdatere ferdighetsstatus"),
        );
      }
    },
    [
      loggedInUser?.id,
      language,
      dbCatalog,
      FALLBACK_MODE_SERVICES,
      refreshRegisteredProviderSkills,
    ],
  );

  const setProviderSkillModePersisted = useCallback(
    async (serviceId: string, nextMode: "home" | "provider" | "both") => {
      if (!loggedInUser?.id) return;
      const variants = serviceIdVariantsForDashboard(serviceId);
      const previous = { ...providerSkillModes };
      setProviderSkillModes((prev) => {
        const next = { ...prev };
        for (const v of variants) {
          next[normalizeServiceId(v)] = nextMode;
        }
        return next;
      });
      try {
        const res = await fetch("/api/providers/skills/status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-provider-id": loggedInUser.id,
          },
          body: JSON.stringify({
            service_id: serviceId,
            service_mode_id: nextMode,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        setProviderSkillModes(previous);
        console.warn("[FreshUp] skill mode save failed:", error);
        toast.error(
          language === "en"
            ? "Could not update delivery mode"
            : "Kunne ikke oppdatere leveringsmodus",
        );
      }
    },
    [loggedInUser?.id, language, providerSkillModes],
  );

  const activeTarget = useMemo(
    () =>
      currentTargets.find((row) => matchesCatalogTarget(target, row.id)) ??
      null,
    [currentTargets, target],
  );

  const resolvedCategoryId = useMemo(
    () =>
      resolveCategoryForTarget(category, target, currentCategories) ?? category,
    [category, target, currentCategories],
  );

  const activeCategory = useMemo(() => {
    const exact = currentCategories.find(
      (row) => row.id === resolvedCategoryId,
    );
    if (exact) return exact;
    if (!categoryBelongsToTarget(resolvedCategoryId, target)) {
      return currentCategories[0] ?? null;
    }
    return (
      currentCategories.find((row) =>
        matchesCatalogCategory(resolvedCategoryId, row.id, row.label),
      ) ?? null
    );
  }, [resolvedCategoryId, currentCategories, target]);

  const [dbCategoryServices, setDbCategoryServices] = useState<any[]>([]);
  const [dbCategoryServicesKey, setDbCategoryServicesKey] = useState("");
  const [catalogServicesPending, setCatalogServicesPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const requestKey = `${appMode}|${target}|${resolvedCategoryId}`;
    const loadDbCategoryServices = async () => {
      setCatalogServicesPending(true);
      try {
        const res = await fetch(
          `/api/services/list?mode=${encodeURIComponent(appMode)}&target=${encodeURIComponent(target)}&category=${encodeURIComponent(resolvedCategoryId)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setDbCategoryServices(
          Array.isArray(json?.services) ? json.services : [],
        );
        setDbCategoryServicesKey(requestKey);
      } catch {
        if (!cancelled) {
          setDbCategoryServices([]);
          setDbCategoryServicesKey(requestKey);
        }
      } finally {
        if (!cancelled) setCatalogServicesPending(false);
      }
    };
    void loadDbCategoryServices();
    return () => {
      cancelled = true;
    };
  }, [appMode, target, resolvedCategoryId]);

  const liveDbCategoryServices = useMemo(() => {
    const requestKey = `${appMode}|${target}|${resolvedCategoryId}`;
    return dbCategoryServicesKey === requestKey ? dbCategoryServices : [];
  }, [
    appMode,
    target,
    resolvedCategoryId,
    dbCategoryServices,
    dbCategoryServicesKey,
  ]);

  const currentServices = useMemo(() => {
    const categoryLabel = activeCategory?.label;
    const catalogOrderServices = (
      getCatalogServices(
        FALLBACK_MODE_SERVICES[appMode],
        target,
        resolvedCategoryId,
        categoryLabel,
      ) || []
    ).filter(
      (service) =>
        userMode !== "provider" || !isHiddenProviderCatalogService(service.id),
    );
    const dbCatalogServices = getCatalogServices(
      MODE_SERVICES_DB[appMode],
      target,
      resolvedCategoryId,
      categoryLabel,
    );
    const sourceServices =
      dbCatalogServices.length > 0 ? dbCatalogServices : catalogOrderServices;
    const fallbackServices =
      catalogOrderServices.length > 0
        ? orderServicesLikeCatalog(sourceServices, catalogOrderServices)
        : sourceServices;
    const dbMappedServices =
      liveDbCategoryServices.length === 0
        ? []
        : (() => {
            const mapped = liveDbCategoryServices.map((row: any) => {
              const normalizedDbId = normalizeServiceId(row?.id);
              const matchedFallback = fallbackServices.find((s) =>
                serviceIdVariantsForDashboard(s.id).includes(normalizedDbId),
              );
              const fallbackPrice = Number(matchedFallback?.price) || 0;
              const dbPriceMin = Number(row?.base_price_min) || 0;
              const dbPriceMax = Number(row?.base_price_max) || 0;
              const legacyAvg =
                dbPriceMin > 0
                  ? dbPriceMax > 0
                    ? Math.round((dbPriceMin + dbPriceMax) / 2)
                    : dbPriceMin
                  : fallbackPrice;
              // Pricing v1.0 §2.2/§2.3: prefer the area-aware customer total
              // returned by /api/pricing/quote-bulk over the legacy avg.
              // Try every id variant the engine might have keyed by.
              const resolved = resolveCatalogServicePrice(normalizedDbId, {
                providerLegacyBase:
                  dbPriceMin > 0 || dbPriceMax > 0 ? legacyAvg : 0,
                staticListPrice: fallbackPrice,
                prices: dynamicPrices,
              });
              return {
                id: matchedFallback?.id || normalizedDbId,
                pricingServiceId: normalizedDbId,
                name: prettifyServiceName(
                  matchedFallback?.name || String(row?.name || normalizedDbId),
                ),
                price: resolved,
                duration:
                  Number(row?.duration_minutes) ||
                  Number(matchedFallback?.duration) ||
                  30,
              };
            });

            return orderServicesLikeCatalog(mapped, catalogOrderServices);
          })();
    const rawPrimary =
      dbMappedServices.length > 0 ? dbMappedServices : fallbackServices;
    // Merge static catalog templates missing from DB/API so rows like
    // air-filter stay visible (skills + customer stay aligned).
    const primaryWithStaticExtras =
      catalogOrderServices.length > 0
        ? (() => {
            const merged = [...rawPrimary];
            const includedIds = new Set(
              merged.flatMap((s: { id: string; name?: string }) => [
                ...serviceIdVariantsForDashboard(s.id).map((v) =>
                  normalizeServiceId(v),
                ),
                ...catalogServiceNameKeys(s.name),
              ]),
            );
            for (const tmpl of catalogOrderServices) {
              const alreadyPresent =
                serviceIdVariantsForDashboard(tmpl.id).some((v) =>
                  includedIds.has(normalizeServiceId(v)),
                ) ||
                catalogServiceNameKeys(tmpl.name).some((k) =>
                  includedIds.has(k),
                );
              if (alreadyPresent) continue;
              for (const v of serviceIdVariantsForDashboard(tmpl.id)) {
                includedIds.add(normalizeServiceId(v));
              }
              for (const k of catalogServiceNameKeys(tmpl.name)) {
                includedIds.add(k);
              }
              const pricingServiceId = bookingPricingServiceId({
                id: tmpl.id,
              });
              merged.push({
                ...tmpl,
                pricingServiceId,
                price: resolveCatalogDisplayPrice(
                  pricingServiceId,
                  Number(tmpl.price) || 0,
                  dynamicPrices,
                  dbCatalog,
                ),
              } as typeof tmpl & { pricingServiceId: string });
            }
            return merged;
          })()
        : rawPrimary;
    const services =
      catalogOrderServices.length > 0
        ? orderServicesLikeCatalog(
            primaryWithStaticExtras,
            catalogOrderServices,
          )
        : dbMappedServices.length > 0
          ? dbMappedServices
          : fallbackServices;

    // Keep any live DB rows that catalog alignment dropped (e.g. Pixie Cut /
    // pixie_f when static id is `pixie`, or extras like trim_f).
    const included = new Set(
      services.flatMap((s: { id: string }) =>
        serviceIdVariantsForDashboard(s.id).map((v) => normalizeServiceId(v)),
      ),
    );
    for (const row of liveDbCategoryServices) {
      const normalizedDbId = normalizeServiceId(row?.id);
      if (!normalizedDbId) continue;
      if (
        serviceIdVariantsForDashboard(normalizedDbId).some((v) =>
          included.has(normalizeServiceId(v)),
        )
      ) {
        continue;
      }
      const nameKeys = catalogServiceNameKeys(row?.name);
      if (
        nameKeys.some((k) =>
          services.some((s: { name?: string }) =>
            catalogServiceNameKeys(s.name).includes(k),
          ),
        )
      ) {
        continue;
      }
      included.add(normalizedDbId);
      services.push({
        id: normalizedDbId,
        pricingServiceId: normalizedDbId,
        name: prettifyServiceName(String(row?.name || normalizedDbId)),
        price: resolveCatalogDisplayPrice(
          normalizedDbId,
          Number(row?.base_price_min) || 0,
          dynamicPrices,
          dbCatalog,
        ),
        duration: Number(row?.duration_minutes) || 30,
      } as (typeof services)[number]);
    }

    return services
      .filter(
        (service: { id: string }) =>
          userMode !== "provider" ||
          !isHiddenProviderCatalogService(service.id),
      )
      .map((s: any) => {
        const pricingServiceId = bookingPricingServiceId(s);
        return {
          ...s,
          pricingServiceId,
          price: resolveCatalogDisplayPrice(
            pricingServiceId,
            Number(s.price) || 0,
            dynamicPrices,
            dbCatalog,
          ),
          name:
            language === "en"
              ? prettifyServiceName(
                  SERVICE_NAME_EN_BY_ID[normalizeServiceId(s.id)] ||
                    SERVICE_NAME_EN_BY_ID[
                      normalizeServiceId(pricingServiceId)
                    ] ||
                    s.name,
                )
              : prettifyServiceName(s.name),
          availability: "",
          availabilityMinutes: 0,
          // Stable pseudo-random decoration derived from service id so list
          // identity doesn't change on every recompute.
          rating: 4.5 + (s.id.charCodeAt(0) % 10) / 20,
          bookings:
            500 +
            ((s.id.charCodeAt(0) * 7 + s.id.charCodeAt(1 % s.id.length) * 13) %
              1500),
          tags:
            normalizeServiceId(s.id) ===
            normalizeServiceId(services[0]?.id ?? "")
              ? [t("popular")]
              : [],
        };
      });
  }, [
    appMode,
    target,
    category,
    resolvedCategoryId,
    userMode,
    language,
    t,
    liveDbCategoryServices,
    dynamicPrices,
    dbCatalog,
    MODE_SERVICES_DB,
    FALLBACK_MODE_SERVICES,
    prettifyServiceName,
    activeCategory?.label,
  ]);

  const lastVisibleServicesRef = useRef(currentServices);
  const visibleServices = useMemo(() => {
    if (currentServices.length > 0) {
      lastVisibleServicesRef.current = currentServices;
      return currentServices;
    }
    if (catalogServicesPending && lastVisibleServicesRef.current.length > 0) {
      return lastVisibleServicesRef.current;
    }
    return currentServices;
  }, [currentServices, catalogServicesPending]);

  const providerVisibleOnlineCount = useMemo(
    () =>
      visibleServices.filter((style) => {
        const styleVariants = serviceIdVariantsForDashboard(style.id);
        const pricingVariants = serviceIdVariantsForDashboard(
          bookingPricingServiceId(style),
        );
        return onlineServices.some((id) => {
          const normalized = normalizeServiceId(id);
          return (
            styleVariants.includes(normalized) ||
            pricingVariants.includes(normalized)
          );
        });
      }).length,
    [visibleServices, onlineServices],
  );

  /** Customer subtitle: services in this category that are bookable (not market-closed). */
  const visibleBookableServiceCount = useMemo(() => {
    if (userMode !== "customer") return visibleServices.length;
    return visibleServices.filter((style) => {
      const entry = lookupDynamicPriceEntry(
        bookingPricingServiceId(style),
        dynamicPrices,
      );
      // Until quote-bulk returns an entry, keep the service counted (matches card seed).
      return entry?.marketClosed !== true;
    }).length;
  }, [userMode, visibleServices, dynamicPrices]);

  /** Categories with at least one online provider skill (sidebar green dots). */
  const providerOnlineCategoryIds = useMemo(() => {
    const result = new Set<string>();
    if (userMode !== "provider" || onlineServices.length === 0) {
      return result;
    }

    const onlineVariants = new Set(
      onlineServices.flatMap((id) =>
        serviceIdVariantsForDashboard(id).map((v) => normalizeServiceId(v)),
      ),
    );
    const matchesOnline = (serviceId: unknown) =>
      serviceIdVariantsForDashboard(serviceId).some((v) =>
        onlineVariants.has(normalizeServiceId(v)),
      );

    const targetKey = normalizeCatalogTargetKey(target);
    const matchingTargetIds = new Set<string>([target, targetKey]);
    for (const row of currentTargets) {
      if (matchesCatalogTarget(target, row.id)) {
        matchingTargetIds.add(row.id);
      }
    }
    for (const row of dbCatalog?.targets || []) {
      const id = String(row?.id || "");
      const name = String(row?.name || "");
      if (
        matchesCatalogTarget(target, id) ||
        normalizeCatalogTargetKey(name) === targetKey ||
        name.toLowerCase() === targetKey
      ) {
        matchingTargetIds.add(id);
      }
    }

    const categoryNameById = new Map<string, string>();
    for (const cat of dbCatalog?.categories || []) {
      categoryNameById.set(String(cat?.id || ""), String(cat?.name || ""));
    }

    const onlineCategoryKeys = new Set<string>();

    for (const row of dbCatalog?.services || []) {
      if (String(row?.mode_id || "") !== appMode) continue;
      const rowTargetId = String(row?.target_id || "");
      if (
        !matchingTargetIds.has(rowTargetId) &&
        !matchesCatalogTarget(target, rowTargetId)
      ) {
        continue;
      }
      if (!matchesOnline(row?.id)) continue;
      const catId = String(row?.category_id || "");
      onlineCategoryKeys.add(
        categoryCatalogKey(catId, categoryNameById.get(catId)),
      );
    }

    for (const c of currentCategories) {
      const catalogServices = [
        ...getCatalogServices(MODE_SERVICES_DB[appMode], target, c.id, c.label),
        ...getCatalogServices(
          FALLBACK_MODE_SERVICES[appMode],
          target,
          c.id,
          c.label,
        ),
      ];
      const hasOnline = catalogServices.some(
        (s: { id: string; pricingServiceId?: string }) =>
          matchesOnline(s.id) ||
          (s.pricingServiceId ? matchesOnline(s.pricingServiceId) : false),
      );
      if (hasOnline) {
        onlineCategoryKeys.add(categoryCatalogKey(c.id, c.label));
      }
    }

    for (const c of currentCategories) {
      if (onlineCategoryKeys.has(categoryCatalogKey(c.id, c.label))) {
        result.add(c.id);
      }
    }
    return result;
  }, [
    userMode,
    onlineServices,
    dbCatalog,
    appMode,
    target,
    currentTargets,
    currentCategories,
    MODE_SERVICES_DB,
    FALLBACK_MODE_SERVICES,
  ]);

  useEffect(() => {
    const pending = pendingOrderAgainRef.current;
    if (!pending) return;
    const normalized = normalizeServiceId(pending.service_id);
    if (!normalized) return;
    const variants = serviceIdVariantsForDashboard(normalized);
    const style = visibleServices.find((s) =>
      variants.includes(normalizeServiceId(s.id)),
    );
    if (!style) return;
    pendingOrderAgainRef.current = null;
    setPriceLockId(null);
    setPriceLockLoading(false);
    confirmPriceLockAttemptedRef.current = null;
    setLockedCustomerTotal(null);
    setCustomerPriceLockBreakdown(null);
    setBookingPaymentPreparing(false);
    setPriceLockPhase("idle");
    setActiveBookingQuote(null);
    bookingQuoteLastFetchKeyRef.current = null;
    setSelectedStyle(style);
    setExpandedStyleId(style.id);
    setStep("confirm");
  }, [visibleServices, appMode, target, category]);

  const handleOrderAgain = useCallback((payload: OrderAgainPayload) => {
    pendingOrderAgainRef.current = payload;
    setAppMode(payload.mode_id as AppMode);
    if (payload.target_id) setTarget(payload.target_id);
    if (payload.category_id) setCategory(payload.category_id);
    setServiceMode(payload.delivery_mode === "home" ? "home" : "provider");
    setShowMenu(false);
    setCurrentPage("main");
    setStep("map");
    setMatchError(null);
  }, []);

  // Provider incoming request payload (real offer-driven)
  const mockIncomingRequest = useMemo(() => {
    return providerIncomingOffer;
  }, [providerIncomingOffer]);

  // Restore in-progress provider job from DB after refresh.
  useEffect(() => {
    providerActiveJobRestoreDoneRef.current = false;
  }, [loggedInUser?.id, userMode]);

  useEffect(() => {
    if (!authReady || !hasSupabase || !isLoggedIn) {
      providerActiveJobRestoreDoneRef.current = true;
      return;
    }
    if (userMode !== "provider") {
      providerActiveJobRestoreDoneRef.current = true;
      return;
    }
    const providerId = loggedInUser?.id;
    if (!providerId) {
      providerActiveJobRestoreDoneRef.current = true;
      return;
    }
    if (
      providerJobStepRef.current === "incoming" &&
      providerIncomingOfferRef.current?.offerId
    ) {
      providerActiveJobRestoreDoneRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { data: orderRows, error } = await supabase
          .from("orders")
          .select(
            "id, status, service_id, delivery_mode, customer_address, customer_lat, customer_lng, price, scheduled_at, customer_id, started_at, service_paused_at, service_paused_total_seconds, ready_for_next_request_at, accepted_at",
          )
          .eq("provider_id", providerId)
          .in("status", [...ACTIVE_JOB_ORDER_STATUSES])
          .order("accepted_at", { ascending: true })
          .limit(5);
        if (cancelled || error) return;
        const list = Array.isArray(orderRows) ? orderRows : [];
        if (list.length === 0) return;

        const statusRank = (status: string) => {
          switch (status) {
            case "in_progress":
              return 4;
            case "arrived":
              return 3;
            case "en_route":
              return 2;
            case "assigned":
              return 1;
            default:
              return 0;
          }
        };
        const progressing = list.filter(
          (o) => String(o.status || "") !== "assigned",
        );
        let currentOrder = list[0];
        let heldOrder: (typeof list)[number] | null = null;
        if (progressing.length > 0) {
          progressing.sort(
            (a, b) =>
              statusRank(String(b.status || "")) -
              statusRank(String(a.status || "")),
          );
          currentOrder = progressing[0];
          heldOrder =
            list.find(
              (o) =>
                String(o.id) !== String(currentOrder.id) &&
                String(o.status || "") === "assigned",
            ) ?? null;
        } else if (list.length > 1) {
          currentOrder = list[0];
          heldOrder = list[1];
        }

        const order = currentOrder;
        if (!order?.id) return;

        const jobStep = providerJobStepFromOrderStatus(
          String(order.status || ""),
        );
        if (!jobStep) return;

        const hydrateProviderJobPayload = async (
          jobOrder: (typeof list)[number],
        ) => {
          const [{ data: service }, { data: offerRow }, { data: sessionData }] =
            await Promise.all([
              supabase
                .from("services")
                .select("id, name, duration_minutes")
                .eq("id", jobOrder.service_id)
                .maybeSingle(),
              supabase
                .from("order_offers")
                .select("id, expires_at, provider_distance_km")
                .eq("order_id", jobOrder.id)
                .eq("provider_id", providerId)
                .in("status", ["accepted", "pending"])
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle(),
              supabase.auth.getSession(),
            ]);
          const offerPricingPayload = await fetchOfferPricing(
            String(jobOrder.id),
            sessionData?.session?.access_token ?? null,
          );
          const priceLock = offerPricingPayload.priceLock;
          const restoreMode = (
            jobOrder.delivery_mode === "home" ? "home" : "provider"
          ) as "home" | "provider";
          const restoreDistanceKm = Number(
            (offerRow as { provider_distance_km?: number } | null)
              ?.provider_distance_km,
          );
          const ui = providerOfferUiRef.current;
          const orderAddonLines = resolveProviderOfferAddonLines(
            offerPricingPayload.addonLines,
            priceLock as ProviderOfferPriceLockSlice | null,
            ui.language,
          );
          const restorePricing = pricingFromPriceLock(
            priceLock as ProviderOfferPriceLockSlice | null,
            Number(jobOrder?.price) || 0,
            restoreMode,
            Number.isFinite(restoreDistanceKm) ? restoreDistanceKm : 0,
            orderAddonLines,
          );

          const providerCatalogSnapshot = providerCatalogRef.current;
          const serviceCatalog = buildProviderOfferServiceFields(
            String(jobOrder?.service_id || ""),
            providerCatalogSnapshot,
            providerCatalogSnapshot.translate,
          );
          const orderCustomerLat = Number((jobOrder as any)?.customer_lat);
          const orderCustomerLng = Number((jobOrder as any)?.customer_lng);
          const orderCustomerLocation =
            Number.isFinite(orderCustomerLat) &&
            Number.isFinite(orderCustomerLng)
              ? { lat: orderCustomerLat, lng: orderCustomerLng }
              : null;
          const restoredCustomer = await fetchOrderCustomerParty(
            String(jobOrder.id),
            sessionData?.session?.access_token ?? null,
            String(jobOrder.customer_id || ""),
            ui.language,
          );

          return {
            offerPayload: {
              offerId: String(offerRow?.id || jobOrder.id),
              orderId: String(jobOrder.id),
              expiresAt: (offerRow as { expires_at?: string } | null)
                ?.expires_at
                ? String((offerRow as { expires_at: string }).expires_at)
                : null,
              customer: restoredCustomer,
              service: {
                id: String(jobOrder?.service_id || ""),
                name: resolveProviderOfferServiceName(
                  String(jobOrder?.service_id || ""),
                  String((service as any)?.name || ""),
                  ui.language,
                ),
                ...serviceCatalog,
                price: restorePricing.providerServicePrice,
                duration: Number((service as any)?.duration_minutes) || 30,
                rating: 4.8,
              },
              location: {
                address: String(jobOrder.customer_address || ""),
                distance: formatProviderOfferDistanceKm(
                  Number.isFinite(restoreDistanceKm) ? restoreDistanceKm : NaN,
                ),
                eta: "—",
              },
              addonLines: orderAddonLines,
              mode: restoreMode,
              requestedTime: String(jobOrder?.scheduled_at || "—"),
              customerLocation: orderCustomerLocation,
              matchDistanceKm: Number.isFinite(restoreDistanceKm)
                ? restoreDistanceKm
                : null,
              providerEarnings: restorePricing.providerEarnings,
              providerServicePrice: restorePricing.providerServicePrice,
              lockedDeliveryFee: restorePricing.lockedDeliveryFee,
              addonsCustomerTotal: restorePricing.addonsCustomerTotal,
              addonsProviderTotal: restorePricing.addonsProviderTotal,
              customerOrderTotal:
                restoreMode === "home" && Number.isFinite(restoreDistanceKm)
                  ? restorePricing.orderTotal
                  : bookedOrderTotalFromSources(
                      priceLock as ProviderOfferPriceLockSlice | null,
                      Number(jobOrder?.price) || 0,
                      restorePricing.orderTotal,
                    ),
            },
            orderCustomerLocation,
          };
        };

        const currentHydrated = await hydrateProviderJobPayload(order);
        if (cancelled) return;
        const { offerPayload, orderCustomerLocation } = currentHydrated;
        setProviderIncomingOffer(offerPayload);
        if (orderCustomerLocation) setCustomerLivePos(orderCustomerLocation);
        setProviderJobStep(jobStep);
        const startedAt =
          typeof (order as { started_at?: string | null }).started_at ===
          "string"
            ? String((order as { started_at: string }).started_at)
            : null;
        const pausedAt =
          typeof (order as { service_paused_at?: string | null })
            .service_paused_at === "string"
            ? String((order as { service_paused_at: string }).service_paused_at)
            : null;
        const pausedTotal = Number(
          (order as { service_paused_total_seconds?: number })
            .service_paused_total_seconds ?? 0,
        );
        if (startedAt) {
          setProviderServiceStartedAt(startedAt);
          setProviderServiceTimer(
            computeServiceElapsedSeconds(
              startedAt,
              pausedAt,
              Number.isFinite(pausedTotal) ? pausedTotal : 0,
              Date.now(),
            ),
          );
        } else {
          setProviderServiceStartedAt(null);
          setProviderServiceTimer(0);
        }
        setProviderServicePaused(Boolean(pausedAt));
        providerServicePausedRef.current = Boolean(pausedAt);
        setProviderServicePausedAt(pausedAt);
        setProviderServicePausedTotalSeconds(
          Number.isFinite(pausedTotal) && pausedTotal >= 0 ? pausedTotal : 0,
        );
        const hasHeldNext = Boolean(heldOrder?.id);
        setProviderReadyForNext(
          !hasHeldNext &&
            Boolean(
              (order as { ready_for_next_request_at?: string | null })
                .ready_for_next_request_at,
            ),
        );
        setProviderClockMs(Date.now());
        setCurrentPage("main");
        setIsBottomSheetCompressed(true);

        if (heldOrder?.id) {
          const heldHydrated = await hydrateProviderJobPayload(heldOrder);
          if (!cancelled) {
            setProviderHeldNextJob(heldHydrated.offerPayload);
            setShowProviderQueuedOfferSheet(false);
          }
        } else {
          setProviderHeldNextJob(null);
        }
      } catch (err) {
        console.warn("[provider-active-job] restore failed", err);
      } finally {
        if (!cancelled) providerActiveJobRestoreDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    hasSupabase,
    isLoggedIn,
    userMode,
    loggedInUser?.id,
    supabase,
  ]);

  // Guard against map-only blank state:
  // if provider job UI depends on request payload but no request is available,
  // fall back to waiting so regular dashboard controls remain visible.
  useEffect(() => {
    if (userMode !== "provider") return;
    if (!providerActiveJobRestoreDoneRef.current) return;
    if (
      providerJobStep === "waiting" ||
      providerJobStep === "incoming" ||
      providerJobStep === "accepted"
    ) {
      return;
    }
    if (mockIncomingRequest) return;
    setProviderJobStep("waiting");
    setIncomingRequestTimer(PROVIDER_OFFER_EXPIRES_SECONDS);
  }, [userMode, providerJobStep, mockIncomingRequest]);

  /** Drop pending second-offer UI when provider returns to idle (keep held next job). */
  useEffect(() => {
    if (userMode !== "provider") {
      setProviderQueuedIncomingOffer(null);
      setProviderHeldNextJob(null);
      setShowProviderQueuedOfferSheet(false);
      setProviderQueuedOfferTimer(PROVIDER_OFFER_EXPIRES_SECONDS);
      return;
    }
    if (providerJobStep !== "waiting") return;
    setProviderQueuedIncomingOffer(null);
    setShowProviderQueuedOfferSheet(false);
    setProviderQueuedOfferTimer(PROVIDER_OFFER_EXPIRES_SECONDS);
  }, [userMode, providerJobStep]);

  /** Countdown for the top-banner second offer; clears when it hits zero. */
  useEffect(() => {
    if (!providerQueuedIncomingOffer) return;
    if (providerQueuedOfferTimer <= 0) {
      const queuedId = providerQueuedIncomingOffer.offerId;
      if (queuedId) {
        clearProviderOfferDisplayExpiresAt(
          PROVIDER_QUEUED_TIMER_STORAGE_PREFIX,
          queuedId,
        );
      }
      setProviderQueuedIncomingOffer(null);
      setShowProviderQueuedOfferSheet(false);
      return;
    }
    const t = window.setTimeout(() => {
      setProviderQueuedOfferTimer((v) => Math.max(0, v - 1));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [providerQueuedIncomingOffer, providerQueuedOfferTimer]);

  /** Clear held next job if the customer cancels while provider is still on the current job. */
  useEffect(() => {
    if (!hasSupabase || userMode !== "provider") return;
    const heldOrderId = String(providerHeldNextJob?.orderId || "");
    if (!heldOrderId) return;
    const channel = supabase
      .channel(`provider-held-next-${heldOrderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${heldOrderId}`,
        },
        (payload: { new?: { status?: string } }) => {
          const nextStatus = String(payload?.new?.status || "");
          if (
            nextStatus === "cancelled" ||
            nextStatus === "canceled" ||
            nextStatus === "completed"
          ) {
            setProviderHeldNextJob((h) =>
              h?.orderId === heldOrderId ? null : h,
            );
            setShowProviderQueuedOfferSheet(false);
            if (nextStatus === "cancelled" || nextStatus === "canceled") {
              toast.error(
                language === "en"
                  ? "Upcoming job was cancelled"
                  : "Kommende jobb ble avlyst",
              );
            }
          }
        },
      )
      .subscribe();
    return () => {
      channel.unsubscribe();
    };
  }, [hasSupabase, supabase, userMode, providerHeldNextJob?.orderId, language]);

  // Reset target when app mode changes and the current target is invalid.
  useEffect(() => {
    const newTargets = MODE_TARGETS[appMode];
    if (!newTargets || newTargets.length === 0) return;

    const hasCurrentTarget = newTargets.some((t) =>
      matchesCatalogTarget(target, t.id),
    );
    if (!hasCurrentTarget) {
      setTarget(newTargets[0].id);
      setSelectedAddons([]);
    }
  }, [appMode, target, MODE_TARGETS]);

  // Keep category ids aligned with the selected target (e.g. beauty_male_body -> beauty_female_body).
  useEffect(() => {
    const newCategories =
      MODE_CATEGORIES[appMode]?.[target] ||
      MODE_CATEGORIES[appMode]?.[normalizeCatalogTargetKey(target)] ||
      [];
    const nextCategoryId = resolveCategoryForTarget(
      category,
      target,
      newCategories,
    );
    if (nextCategoryId && nextCategoryId !== category) {
      setCategory(nextCategoryId);
      setSelectedAddons([]);
    }
  }, [target, appMode, category, MODE_CATEGORIES]);

  // Close mode dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showModeDropdown) {
        setShowModeDropdown(false);
      }
    };
    if (showModeDropdown) {
      // Delay to prevent immediate close
      const timer = setTimeout(() => {
        document.addEventListener("click", handleClickOutside);
      }, 100);
      return () => {
        clearTimeout(timer);
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [showModeDropdown]);

  const resolveProviderId = useCallback(
    () => loggedInUser?.id ?? readSupabaseUserIdFromStorage(),
    [loggedInUser?.id],
  );

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;
    (
      window as unknown as { freshupDebug?: Record<string, unknown> }
    ).freshupDebug = {
      providerId: () => resolveProviderId(),
      offerState: () => ({
        userMode,
        providerJobStep,
        isLoggedIn,
        currentPage,
        incomingRequestTimer,
        hasOffer: Boolean(providerIncomingOffer),
      }),
      pendingOffers: async () => {
        const id = resolveProviderId();
        if (!id) return { error: "no provider id (not logged in?)" };
        const res = await fetch("/api/providers/me", {
          cache: "no-store",
          headers: { "x-provider-id": id },
        });
        return res.json();
      },
    };
  }, [
    resolveProviderId,
    userMode,
    providerJobStep,
    isLoggedIn,
    currentPage,
    incomingRequestTimer,
    providerIncomingOffer,
  ]);

  // Provider: Realtime incoming offers + catch-up sync + light polling fallback.
  useEffect(() => {
    if (!hasSupabase || !isLoggedIn) return;
    if (userMode !== "provider") return;
    const providerId = loggedInUser?.id ?? readSupabaseUserIdFromStorage();
    if (!providerId) return;

    let cancelled = false;
    let pollInFlight = false;
    let lastSyncAt = 0;
    let lastMeFallbackAt = 0;
    const SYNC_DEBOUNCE_MS = 15_000;
    const ME_FALLBACK_MIN_MS = 60_000;

    const shouldSkipPendingIncomingReset = (row: any) => {
      const offerId = String(row.id);
      const orderId = String(row.order_id);
      if (providerAcceptingOfferIdRef.current === offerId) {
        return true;
      }
      const stepNow = providerJobStepRef.current;
      const cur = providerIncomingOfferRef.current;
      if (
        (stepNow === "accepted" ||
          stepNow === "enroute" ||
          stepNow === "arrived" ||
          stepNow === "in_service") &&
        cur &&
        (cur.offerId === offerId || cur.orderId === orderId)
      ) {
        return true;
      }
      return false;
    };

    const offerHydrationKey = (r: {
      id?: string;
      expires_at?: string | null;
      status?: string;
      offered_price?: number | null;
    }) =>
      `${String(r.id)}:${String(r.expires_at ?? "")}:${String(r.status ?? "")}:${String(r.offered_price ?? "")}`;

    const applyOfferRow = async (row: any) => {
      if (!row?.id) return;
      const offerId = String(row.id);
      if (applyOfferRowInFlightRef.current.has(offerId)) return;
      applyOfferRowInFlightRef.current.add(offerId);
      try {
        const status = String(row.status || "");
        if (status !== "pending" && status !== "accepted") {
          offerHydrationKeysRef.current.delete(offerId);
          const toastKey = `${String(row.id)}:${status}`;
          if (!providerOfferStatusToastRef.current.has(toastKey)) {
            if (status === "declined") {
              const lang = providerOfferUiRef.current.language;
              toast.error(lang === "en" ? "Job taken" : "Jobben ble tatt");
            }
            // Do not toast "expired" — race with accept grace / late Realtime
            // shows a false banner while Accept still works; state clears below.
            providerOfferStatusToastRef.current.add(toastKey);
          }
          setProviderIncomingOffer((prev) =>
            prev?.offerId === String(row.id) ? null : prev,
          );
          setProviderQueuedIncomingOffer((q) => {
            if (q?.offerId === String(row.id)) {
              setShowProviderQueuedOfferSheet(false);
              return null;
            }
            return q;
          });
          setProviderHeldNextJob((h) => {
            if (
              h?.offerId === String(row.id) ||
              h?.orderId === String(row.order_id)
            ) {
              setShowProviderQueuedOfferSheet(false);
              return null;
            }
            return h;
          });
          setProviderJobStep((step) =>
            step === "incoming" ? "waiting" : step,
          );
          return;
        }

        const distanceKm = Number(row.provider_distance_km);
        const distanceText = formatProviderOfferDistanceKm(distanceKm);
        const etaMin =
          Number.isFinite(distanceKm) && distanceKm >= 0
            ? Math.max(1, Math.round((distanceKm / 28) * 60))
            : 5;

        const expiresAtIso = row.expires_at ? String(row.expires_at) : null;
        const expiresAtMs = expiresAtIso
          ? new Date(expiresAtIso).getTime()
          : NaN;
        const OFFER_UI_GRACE_MS = 1500;
        if (
          status === "pending" &&
          Number.isFinite(expiresAtMs) &&
          Date.now() > expiresAtMs + OFFER_UI_GRACE_MS
        ) {
          offerHydrationKeysRef.current.delete(offerId);
          return;
        }

        const hydrKey = offerHydrationKey(row);
        const uiLabels = providerOfferUiRef.current;
        const stepNow = providerJobStepRef.current;
        const curOffer = providerIncomingOfferRef.current;
        const onActiveJobCard =
          stepNow === "accepted" ||
          stepNow === "enroute" ||
          stepNow === "arrived" ||
          stepNow === "in_service";
        const queueIncomingInstead =
          status === "pending" &&
          onActiveJobCard &&
          !!curOffer?.orderId &&
          String(row.order_id) !== String(curOffer.orderId);

        if (
          status === "pending" &&
          offerHydrationKeysRef.current.get(offerId) === hydrKey
        ) {
          const hydratedOffer = providerIncomingOfferRef.current;
          if (
            !queueIncomingInstead &&
            hydratedOffer?.offerId === offerId &&
            isProviderOfferFullyHydrated(hydratedOffer, uiLabels.language)
          ) {
            const displayDeadlineIso =
              incomingOfferExpiresAtRef.current ??
              resolveProviderIncomingDisplayExpiresAt(offerId, expiresAtIso);
            if (!incomingOfferExpiresAtRef.current) {
              incomingOfferExpiresAtRef.current = displayDeadlineIso;
            }
            const seconds = offerCountdownSeconds(displayDeadlineIso);
            setIncomingRequestTimer((prev) =>
              prev === seconds ? prev : seconds,
            );
            return;
          }
        }

        const orderId = String(row.order_id);
        const nestedOrder = row.orders;
        const joinedOrder =
          nestedOrder && typeof nestedOrder === "object"
            ? Array.isArray(nestedOrder)
              ? nestedOrder[0]
              : nestedOrder
            : null;
        const hasJoinedOrder =
          joinedOrder &&
          (joinedOrder.service_id != null || joinedOrder.delivery_mode != null);

        const [{ data: fetchedOrder }, token] = await Promise.all([
          hasJoinedOrder
            ? Promise.resolve({ data: joinedOrder })
            : supabase
                .from("orders")
                .select(
                  "id, customer_id, service_id, delivery_mode, customer_address, customer_lat, customer_lng, price, scheduled_at, status, services ( name, duration_minutes )",
                )
                .eq("id", orderId)
                .maybeSingle(),
          resolveProviderAccessToken(supabase),
        ]);

        if (!token) {
          return;
        }

        const order = fetchedOrder as Record<string, unknown> | null;
        const customerIdFallback = String(order?.customer_id || "");
        const serviceFromJoin = resolveServiceRowFromOrder(order);

        const [{ data: service }, offerPricingPayload, hydratedCustomer] =
          await Promise.all([
            serviceFromJoin?.name
              ? Promise.resolve({ data: serviceFromJoin })
              : order?.service_id
                ? supabase
                    .from("services")
                    .select("id, name, duration_minutes")
                    .eq("id", String(order.service_id))
                    .maybeSingle()
                : Promise.resolve({ data: null }),
            fetchOfferPricing(orderId, token),
            (async () => {
              if (customerIdFallback) {
                const { data: profile } = await supabase
                  .from("profiles")
                  .select("id, display_name, avatar_url")
                  .eq("id", customerIdFallback)
                  .maybeSingle();
                const fromProfile = resolveCustomerPartyFromProfile(
                  profile as {
                    display_name?: string | null;
                    avatar_url?: string | null;
                  } | null,
                  customerIdFallback,
                  uiLabels.language,
                );
                if (fromProfile) return fromProfile;
              }
              return fetchOrderCustomerParty(
                orderId,
                token,
                customerIdFallback,
                uiLabels.language,
              );
            })(),
          ]);

        let offerMode: "home" | "provider" = "provider";
        const priceLock = offerPricingPayload.priceLock;
        offerMode = order?.delivery_mode === "home" ? "home" : "provider";
        const orderAddonLines = order
          ? resolveProviderOfferAddonLines(
              offerPricingPayload.addonLines,
              priceLock as ProviderOfferPriceLockSlice | null,
              uiLabels.language,
            )
          : [];
        const offerPricing = pricingFromPriceLock(
          priceLock as ProviderOfferPriceLockSlice | null,
          Number(order?.price) || Number(row.offered_price) || 0,
          offerMode,
          Number.isFinite(distanceKm) ? distanceKm : 0,
          orderAddonLines,
        );

        if (
          status === "pending" &&
          Number.isFinite(expiresAtMs) &&
          Date.now() > expiresAtMs + OFFER_UI_GRACE_MS
        ) {
          clearProviderOfferDisplayExpiresAt(
            PROVIDER_INCOMING_TIMER_STORAGE_PREFIX,
            offerId,
          );
          setProviderIncomingOffer((prev) =>
            prev?.offerId === String(row.id) ? null : prev,
          );
          setProviderQueuedIncomingOffer((q) => {
            if (q?.offerId === String(row.id)) {
              setShowProviderQueuedOfferSheet(false);
              return null;
            }
            return q;
          });
          setProviderHeldNextJob((h) => {
            if (
              h?.offerId === String(row.id) ||
              h?.orderId === String(row.order_id)
            ) {
              setShowProviderQueuedOfferSheet(false);
              return null;
            }
            return h;
          });
          setProviderJobStep((step) =>
            step === "incoming" ? "waiting" : step,
          );
          return;
        }

        const orderCustomerLat = Number((order as any)?.customer_lat);
        const orderCustomerLng = Number((order as any)?.customer_lng);
        const orderCustomerLocation =
          Number.isFinite(orderCustomerLat) && Number.isFinite(orderCustomerLng)
            ? { lat: orderCustomerLat, lng: orderCustomerLng }
            : null;

        const providerCatalogSnapshot = providerCatalogRef.current;
        const serviceCatalog = buildProviderOfferServiceFields(
          String(order?.service_id || ""),
          providerCatalogSnapshot,
          providerCatalogSnapshot.translate,
        );
        const offerPayload = {
          offerId: String(row.id),
          orderId: String(row.order_id),
          expiresAt: expiresAtIso,
          customer: hydratedCustomer,
          service: {
            id: String(order?.service_id || ""),
            name: resolveProviderOfferServiceName(
              String(order?.service_id || ""),
              String((service as any)?.name || ""),
              uiLabels.language,
            ),
            ...serviceCatalog,
            price: offerPricing.providerServicePrice,
            duration: Number((service as any)?.duration_minutes) || 30,
            rating: 4.8,
          },
          location: {
            address: order
              ? String(order.customer_address || "")
              : uiLabels.language === "en"
                ? "Details hidden by permissions"
                : "Skjult av tilganger",
            distance: distanceText,
            eta: `${etaMin} min`,
          },
          addonLines: orderAddonLines,
          mode: offerMode,
          requestedTime: String(order?.scheduled_at || "Na"),
          customerLocation: orderCustomerLocation,
          matchDistanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
          providerEarnings: offerPricing.providerEarnings,
          providerServicePrice: offerPricing.providerServicePrice,
          lockedDeliveryFee: offerPricing.lockedDeliveryFee,
          addonsCustomerTotal: offerPricing.addonsCustomerTotal,
          addonsProviderTotal: offerPricing.addonsProviderTotal,
          customerOrderTotal:
            offerMode === "home" && Number.isFinite(distanceKm)
              ? offerPricing.orderTotal
              : bookedOrderTotalFromSources(
                  priceLock as ProviderOfferPriceLockSlice | null,
                  Number(order?.price) || Number(row.offered_price) || 0,
                  offerPricing.orderTotal,
                ),
        };

        if (status === "accepted") {
          const cur = providerIncomingOfferRef.current;
          setProviderQueuedIncomingOffer((q) => {
            const hit =
              q?.offerId === String(row.id) ||
              q?.orderId === String(row.order_id);
            if (hit) setShowProviderQueuedOfferSheet(true);
            return hit ? null : q;
          });
          if (cur?.orderId && String(row.order_id) === String(cur.orderId)) {
            setProviderIncomingOffer(offerPayload);
            if (orderCustomerLocation) {
              setCustomerLivePos(orderCustomerLocation);
            }
            setProviderReadyForNext(false);
            const orderStatus = order
              ? String((order as { status?: string }).status || "")
              : "";
            const stepFromOrder = providerJobStepFromOrderStatus(orderStatus);
            setProviderJobStep((step) => {
              if (
                step === "enroute" ||
                step === "arrived" ||
                step === "in_service" ||
                step === "completed"
              ) {
                return step;
              }
              return stepFromOrder ?? "accepted";
            });
            offerHydrationKeysRef.current.set(offerId, hydrKey);
          } else if (
            onActiveJobCard &&
            cur?.orderId &&
            String(row.order_id) !== String(cur.orderId)
          ) {
            // Accepted while busy → hold in banner until current job completes.
            setProviderHeldNextJob(offerPayload);
            setProviderReadyForNext(false);
            setShowProviderQueuedOfferSheet(true);
            offerHydrationKeysRef.current.set(offerId, hydrKey);
          }
          return;
        }

        if (status !== "pending") {
          return;
        }

        if (!isProviderOfferFullyHydrated(offerPayload, uiLabels.language)) {
          return;
        }

        offerHydrationKeysRef.current.set(offerId, hydrKey);

        if (queueIncomingInstead) {
          // Max one upcoming job: skip new pending offers while a next job is already held.
          if (providerHeldNextJobRef.current) return;
          setProviderQueuedIncomingOffer(offerPayload);
          const queuedDeadlineIso =
            resolveProviderQueuedDisplayExpiresAt(offerId);
          setProviderQueuedOfferTimer(offerCountdownSeconds(queuedDeadlineIso));
          return;
        }

        setProviderIncomingOffer(offerPayload);
        if (orderCustomerLocation) {
          setCustomerLivePos(orderCustomerLocation);
        }
        const displayDeadlineIso = resolveProviderIncomingDisplayExpiresAt(
          offerId,
          expiresAtIso,
        );
        incomingOfferExpiresAtRef.current = displayDeadlineIso;
        setIncomingRequestTimer(PROVIDER_OFFER_EXPIRES_SECONDS);
        if (!shouldSkipPendingIncomingReset(row)) {
          setProviderJobStep("incoming");
        }
      } finally {
        applyOfferRowInFlightRef.current.delete(offerId);
      }
    };

    const refreshPendingOffers = async (): Promise<number> => {
      const { data, error } = await supabase
        .from("order_offers")
        .select(
          "id, order_id, expires_at, status, provider_distance_km, offered_price, orders ( delivery_mode, service_id, price, customer_id, customer_address, customer_lat, customer_lng, scheduled_at, services ( name, duration_minutes ) )",
        )
        .eq("provider_id", providerId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: true });
      if (error) {
        console.warn("[provider-offers] refresh failed", error);
        return 0;
      }
      const rows = Array.isArray(data) ? data : [];
      for (const row of rows) {
        await applyOfferRow(row);
      }
      return rows.length;
    };

    const refreshPendingOffersFromApi = async () => {
      const now = Date.now();
      if (now - lastMeFallbackAt < ME_FALLBACK_MIN_MS) return;
      lastMeFallbackAt = now;
      try {
        const res = await fetch("/api/providers/me", {
          cache: "no-store",
          headers: { "x-provider-id": providerId },
        });
        if (!res.ok) {
          if (process.env.NODE_ENV === "development") {
            console.warn("[provider-offers] api poll http", res.status);
          }
          return;
        }
        const body = await res.json().catch(() => ({}));
        const rows = Array.isArray(body?.pendingOffers)
          ? body.pendingOffers
          : [];
        if (rows.length === 0) return;
        const head = rows[0];
        if (process.env.NODE_ENV === "development") {
          console.info("[provider-offers] api poll hit", {
            providerId,
            offerId: head.id,
            jobStep: providerJobStepRef.current,
          });
        }
        await applyOfferRow(head);
        for (let i = 1; i < rows.length; i++) {
          await applyOfferRow(rows[i]);
        }
      } catch (err) {
        console.warn("[provider-offers] api poll failed", err);
      }
    };

    const syncPendingOffers = async (force = false) => {
      if (cancelled || pollInFlight) return;
      const stepNow = providerJobStepRef.current;
      const cur = providerIncomingOfferRef.current;
      if (
        !force &&
        stepNow === "incoming" &&
        cur?.offerId &&
        incomingOfferExpiresAtRef.current &&
        offerCountdownSeconds(incomingOfferExpiresAtRef.current) > 0
      ) {
        return;
      }
      const now = Date.now();
      if (!force && now - lastSyncAt < SYNC_DEBOUNCE_MS) return;
      lastSyncAt = now;
      pollInFlight = true;
      try {
        const pendingCount = await refreshPendingOffers();
        if (pendingCount === 0 && force) {
          await refreshPendingOffersFromApi();
        }
      } finally {
        pollInFlight = false;
      }
    };

    providerSyncPendingOffersRef.current = (force = false) => {
      void syncPendingOffers(force);
    };

    const channel = supabase
      .channel(`provider-offers-main-${providerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "order_offers",
          filter: `provider_id=eq.${providerId}`,
        },
        async (payload: any) => {
          const eventType = String(payload?.eventType || "").toUpperCase();
          const nextRow = payload?.new;
          if (nextRow?.id) {
            await applyOfferRow(nextRow);
            return;
          }

          const oldRow = payload?.old;
          if (!oldRow?.id) return;

          if (eventType === "DELETE") {
            await applyOfferRow({ ...oldRow, status: "expired" });
            return;
          }
          if (eventType === "UPDATE") {
            const oldStatus = String(oldRow.status || "");
            if (oldStatus !== "pending") {
              await applyOfferRow(oldRow);
            }
          }
        },
      )
      .subscribe();

    void syncPendingOffers(true);

    let pollTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const schedulePoll = () => {
      const delayMs =
        providerJobStepRef.current === "incoming" ? 60_000 : 30_000;
      pollTimer = globalThis.setTimeout(() => {
        void syncPendingOffers().finally(() => {
          if (!cancelled) schedulePoll();
        });
      }, delayMs);
    };
    schedulePoll();

    return () => {
      cancelled = true;
      providerSyncPendingOffersRef.current = null;
      if (pollTimer !== undefined) globalThis.clearTimeout(pollTimer);
      channel.unsubscribe();
    };
    // Catalog / language are read via providerOfferUiRef so this effect does not
    // re-subscribe on every render (unstable array deps were spamming order_offers).
  }, [hasSupabase, supabase, isLoggedIn, userMode, loggedInUser?.id]);

  // Dynamic add-ons based on current mode, target, category
  const currentAddons = useMemo(() => {
    const addons =
      MODE_ADDONS[appMode]?.[normalizeCatalogTargetKey(target)]?.[
        categoryCatalogKey(resolvedCategoryId, activeCategory?.label)
      ] || [];
    return addons.map((addon) => ({
      ...addon,
      name: language === "en" ? addon.nameEn : addon.nameNo,
    }));
  }, [appMode, target, resolvedCategoryId, language, activeCategory?.label]);

  const syncDashboardFiltersFromSnapshot = useCallback(
    (userId: string) => {
      if (typeof window === "undefined" || !userId) return;
      const raw = localStorage.getItem(providerSkillsSnapshotKey(userId));
      if (!raw) return;

      try {
        const snap = JSON.parse(raw) as {
          mode?: AppMode;
          target?: string;
          categories?: string[];
          services?: string[];
        };
        const mode = snap?.mode;
        if (!mode || !MODE_TARGETS[mode]) return;

        const modeTargets = MODE_TARGETS[mode] || [];

        const nextTarget = modeTargets.some((t) =>
          matchesCatalogTarget(String(snap?.target || ""), t.id),
        )
          ? (snap?.target as string)
          : modeTargets[0].id;

        const modeCategories = MODE_CATEGORIES[mode]?.[nextTarget] || [];
        let nextCategory =
          modeCategories.find((c) => (snap?.categories || []).includes(c.id))
            ?.id || null;

        if (
          !nextCategory &&
          Array.isArray(snap?.services) &&
          snap.services.length > 0
        ) {
          const normalizedServices = new Set(
            snap.services.map((id) => normalizeServiceId(id)).filter(Boolean),
          );
          nextCategory =
            modeCategories.find((cat) =>
              (FALLBACK_MODE_SERVICES[mode]?.[nextTarget]?.[cat.id] || []).some(
                (service) =>
                  normalizedServices.has(normalizeServiceId(service.id)),
              ),
            )?.id || null;
        }

        if (!nextCategory && modeCategories.length > 0) {
          nextCategory = modeCategories[0].id;
        }

        setAppMode(mode);
        setTarget(nextTarget);
        if (nextCategory) setCategory(nextCategory);
      } catch {
        // ignore malformed local snapshot payload
      }
    },
    [MODE_TARGETS, MODE_CATEGORIES, FALLBACK_MODE_SERVICES],
  );

  useEffect(() => {
    if (userMode !== "provider") return;
    if (!loggedInUser?.id) return;

    const previousPage = prevDashboardPageRef.current;
    prevDashboardPageRef.current = currentPage;
    if (currentPage !== "main") return;

    const cameFromSkills = previousPage === "skills";
    const bootKey = `${loggedInUser.id}:main`;
    if (
      !cameFromSkills &&
      providerDashboardSnapshotSyncRef.current === bootKey
    ) {
      return;
    }
    providerDashboardSnapshotSyncRef.current = bootKey;

    syncDashboardFiltersFromSnapshot(loggedInUser.id);
    void refreshRegisteredProviderSkills();
  }, [
    userMode,
    currentPage,
    loggedInUser?.id,
    syncDashboardFiltersFromSnapshot,
    refreshRegisteredProviderSkills,
  ]);

  useEffect(() => {
    if (userMode !== "provider") return;
    if (currentPage !== "main") return;
    if (!loggedInUser?.id) return;

    patchProviderSkillsSnapshotFilters(loggedInUser.id, {
      mode: appMode,
      target,
      categories: category ? [category] : [],
    });
  }, [userMode, currentPage, loggedInUser?.id, appMode, target, category]);

  // Legacy compatibility
  const categoriesForGender = currentCategories;

  // Lyft-style booking state
  const [selectedStyle, setSelectedStyle] = useState<BookingStyle | null>(null);
  const [priceLockId, setPriceLockId] = useState<string | null>(null);
  const [priceLockLoading, setPriceLockLoading] = useState(false);
  const [priceLockPhase, setPriceLockPhase] = useState<
    "idle" | "calculating" | "finding" | "ready"
  >("idle");
  const [bookingPaymentPreparing, setBookingPaymentPreparing] = useState(false);
  const confirmPriceLockAttemptedRef = useRef<string | null>(null);
  const [lockedCustomerTotal, setLockedCustomerTotal] = useState<number | null>(
    null,
  );
  const [customerPriceLockBreakdown, setCustomerPriceLockBreakdown] =
    useState<ProviderOfferPriceLockSlice | null>(null);
  const [activeBookingQuote, setActiveBookingQuote] = useState<{
    serviceId: string;
    customerServicePrice: number;
    deliveryFee: number;
    addonsCustomerTotal: number;
    customerTotal: number;
  } | null>(null);
  /** Dedupes map-preview GET /api/pricing/quote (visibleServices updates used to retrigger). */
  const bookingQuoteLastFetchKeyRef = useRef<string | null>(null);
  const [expandedStyleId, setExpandedStyleId] = useState<string | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);

  // Location
  const {
    pos: geoloc,
    error: geoError,
    get: getGeoloc,
    startWatch,
    stopWatch,
  } = useGeolocation();

  useEffect(() => {
    if (
      typeof geoloc?.lat === "number" &&
      typeof geoloc?.lng === "number" &&
      Number.isFinite(geoloc.lat) &&
      Number.isFinite(geoloc.lng)
    ) {
      providerBrowseGeolocRef.current = geoloc;
    }
  }, [geoloc?.lat, geoloc?.lng]);

  useEffect(() => {
    if (userMode !== "provider") return;
    startWatch();
  }, [userMode, startWatch]);

  useEffect(() => {
    if (
      userMode !== "provider" ||
      !isProviderOnline ||
      !hasSupabase ||
      !loggedInUser?.id
    ) {
      return;
    }
    const pos = providerBrowseGeolocRef.current;
    if (!pos || typeof pos.lat !== "number" || typeof pos.lng !== "number") {
      return;
    }
    void supabase
      .from("provider_details")
      .update({ lat: pos.lat, lng: pos.lng })
      .eq("id", loggedInUser.id)
      .eq("is_online", true);
  }, [
    userMode,
    isProviderOnline,
    hasSupabase,
    loggedInUser?.id,
    geoloc?.lat,
    geoloc?.lng,
    supabase,
  ]);

  const demandZoneServiceId = useMemo(() => {
    if (selectedStyle?.id) {
      return bookingPricingServiceId(selectedStyle);
    }
    if (userMode === "provider") {
      for (const style of visibleServices) {
        const variants = serviceIdVariantsForDashboard(style.id);
        const isOnline = onlineServices.some((id) =>
          variants.includes(normalizeServiceId(id)),
        );
        if (isOnline) return bookingPricingServiceId(style);
      }
      for (const style of visibleServices) {
        const variants = serviceIdVariantsForDashboard(style.id);
        const isRegistered = registeredServices.some((id) =>
          variants.includes(normalizeServiceId(id)),
        );
        if (isRegistered) return bookingPricingServiceId(style);
      }
    }
    const first = visibleServices[0];
    return first ? bookingPricingServiceId(first) : "";
  }, [
    selectedStyle,
    userMode,
    onlineServices,
    registeredServices,
    visibleServices,
  ]);

  const topDemandChip = useMemo((): {
    tier: DemandZoneTier;
    label: string;
  } | null => {
    if (!demandZoneServiceId) return null;
    const lang = language === "en" ? "en" : "no";
    if (userMode === "provider") {
      const tier = providerDemandTierFromPrices(
        demandZoneServiceId,
        dynamicPrices,
      );
      if (!tier) return null;
      return { tier, label: tierShortLabel(tier, "provider", lang) };
    }
    const tier = customerDemandTierFromPrices(
      demandZoneServiceId,
      dynamicPrices,
    );
    if (!tier) return null;
    return { tier, label: tierShortLabel(tier, "customer", lang) };
  }, [demandZoneServiceId, dynamicPrices, userMode, language]);

  const renderTopDemandIndicator = useCallback(
    (className = "text-xs text-gray-600") => {
      const loadingLabel =
        userMode === "provider"
          ? language === "en"
            ? "Loading demand…"
            : "Laster etterspørsel…"
          : language === "en"
            ? "Loading prices…"
            : "Laster priser…";

      if (!topDemandChip) {
        return (
          <div className={cn("flex items-center gap-1", className)}>
            <div className="w-1.5 h-1.5 bg-gray-300 rounded-full shrink-0" />
            <span className="text-gray-500">{loadingLabel}</span>
          </div>
        );
      }

      return (
        <div className={cn("flex items-center gap-1 max-w-full", className)}>
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              demandTierDotClass(topDemandChip.tier),
              userMode === "provider" &&
                topDemandChip.tier === "green" &&
                "animate-pulse",
            )}
          />
          <span className={cn("truncate", tierTextClass(topDemandChip.tier))}>
            {topDemandChip.label}
          </span>
        </div>
      );
    },
    [topDemandChip, userMode, language],
  );

  const [mapSessionToken, setMapSessionToken] = useState<string | null>(null);
  const [marketCalculating, setMarketCalculating] = useState(false);
  const marketLoadCountRef = useRef(0);
  const marketLoadStartedRef = useRef(0);
  const marketLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginMarketCalculating = useCallback(() => {
    marketLoadCountRef.current += 1;
    if (marketLoadCountRef.current === 1) {
      marketLoadStartedRef.current = Date.now();
      setMarketCalculating(true);
    }
  }, []);

  const endMarketCalculating = useCallback(() => {
    marketLoadCountRef.current = Math.max(0, marketLoadCountRef.current - 1);
    if (marketLoadCountRef.current > 0) return;
    const elapsed = Date.now() - marketLoadStartedRef.current;
    const wait = Math.max(0, 650 - elapsed);
    if (marketLoadTimerRef.current) clearTimeout(marketLoadTimerRef.current);
    marketLoadTimerRef.current = setTimeout(() => {
      setMarketCalculating(false);
      marketLoadTimerRef.current = null;
    }, wait);
  }, []);

  const handleDemandOverlayLoadingChange = useCallback(() => {
    // Demand zones load silently on the map — no center ring overlay.
  }, []);

  useEffect(() => {
    if (!hasSupabase || !isLoggedIn) {
      setMapSessionToken(null);
      return;
    }
    let cancelled = false;
    const syncToken = async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) {
        setMapSessionToken(data.session?.access_token ?? null);
      }
    };
    void syncToken();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      void syncToken();
    });
    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, [hasSupabase, isLoggedIn, supabase]);

  const mapDemandOverlay = useMemo(() => {
    if (!mapSessionToken || !demandZoneServiceId) return null;
    return {
      serviceId: demandZoneServiceId,
      audience:
        userMode === "provider" ? ("provider" as const) : ("customer" as const),
      accessToken: mapSessionToken,
    };
  }, [mapSessionToken, demandZoneServiceId, userMode]);

  const [customerSavedLocation, setCustomerSavedLocation] =
    useState<LatLng | null>(null);
  /** Avoid bulk-pricing on live GPS then jumping when saved profile location loads. */
  const [customerPricingLocReady, setCustomerPricingLocReady] = useState(false);
  /** After GPS button: use live device coords instead of saved profile pin. */
  const [preferLiveGps, setPreferLiveGps] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  /** Bumps MapView viewportResetKey so pan-lock clears and map flies to GPS. */
  const [gpsRecenterNonce, setGpsRecenterNonce] = useState(0);

  useEffect(() => {
    if (userMode !== "customer" || !loggedInUser?.id) {
      setCustomerSavedLocation(null);
      setCustomerPricingLocReady(true);
      return;
    }
    const uid = loggedInUser.id;
    const cached = readSavedProfileLocation(uid, "customer");
    if (cached) {
      setCustomerSavedLocation(cached);
      setCustomerPricingLocReady(true);
    } else {
      setCustomerPricingLocReady(false);
    }

    let cancelled = false;
    const loadFromApi = async () => {
      try {
        const res = await fetch("/api/customers/me", {
          cache: "no-store",
          headers: { "x-user-id": uid },
        });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        const lat = body?.contact?.lat ?? body?.defaultLocation?.lat;
        const lng = body?.contact?.lng ?? body?.defaultLocation?.lng;
        if (
          typeof lat === "number" &&
          typeof lng === "number" &&
          Number.isFinite(lat) &&
          Number.isFinite(lng)
        ) {
          const saved = { lat, lng };
          if (!cancelled) setCustomerSavedLocation(saved);
          try {
            const existing = localStorage.getItem(
              profileCacheKey(uid, "customer"),
            );
            const prev = existing ? JSON.parse(existing) : {};
            localStorage.setItem(
              profileCacheKey(uid, "customer"),
              JSON.stringify({
                ...prev,
                lat,
                lng,
                address:
                  body?.contact?.address ??
                  body?.defaultLocation?.address ??
                  prev?.address,
                savedAt: Date.now(),
              }),
            );
          } catch {
            // best effort cache update
          }
        }
      } catch {
        // keep cached value if API fails
      } finally {
        if (!cancelled) setCustomerPricingLocReady(true);
      }
    };
    void loadFromApi();

    const onProfileUpdated = () => {
      const updated = readSavedProfileLocation(uid, "customer");
      if (updated) setCustomerSavedLocation(updated);
      setCustomerPricingLocReady(true);
    };
    window.addEventListener("profileUpdated", onProfileUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("profileUpdated", onProfileUpdated);
    };
  }, [userMode, loggedInUser?.id]);

  const customerLoc = useMemo((): LatLng | null => {
    if (
      preferLiveGps &&
      typeof geoloc?.lat === "number" &&
      typeof geoloc?.lng === "number"
    ) {
      return geoloc;
    }
    if (userMode === "customer" && customerSavedLocation) {
      return customerSavedLocation;
    }
    if (typeof geoloc?.lat === "number" && typeof geoloc?.lng === "number") {
      return geoloc;
    }
    return null;
  }, [
    preferLiveGps,
    userMode,
    customerSavedLocation,
    geoloc?.lat,
    geoloc?.lng,
  ]);

  /** Location used for catalog pricing — waits for profile settle to avoid flash. */
  const pricingCustomerLoc = useMemo((): LatLng | null => {
    if (userMode === "customer") {
      if (!customerPricingLocReady && !preferLiveGps) return null;
      const live =
        typeof geoloc?.lat === "number" && typeof geoloc?.lng === "number"
          ? geoloc
          : null;
      if (preferLiveGps && live) return live;
      return pickMarketDetectionCoords(customerSavedLocation, live);
    }
    if (typeof geoloc?.lat === "number" && typeof geoloc?.lng === "number") {
      return geoloc;
    }
    return null;
  }, [
    userMode,
    customerPricingLocReady,
    preferLiveGps,
    customerSavedLocation,
    geoloc?.lat,
    geoloc?.lng,
  ]);

  const [followMe, setFollowMe] = useState(true);
  useEffect(() => {
    if (userMode === "customer" && customerSavedLocation && !preferLiveGps) {
      stopWatch();
      return;
    }
    if (followMe || preferLiveGps) startWatch();
    else stopWatch();
  }, [
    followMe,
    preferLiveGps,
    startWatch,
    stopWatch,
    userMode,
    customerSavedLocation,
  ]);

  const goToMyLocation = useCallback(async () => {
    setLocatingGps(true);
    setFollowMe(true);
    try {
      const pos = await getGeoloc();
      if (pos) {
        setPreferLiveGps(true);
        startWatch();
        // Clear manual pan-lock and force MapView to ease/fit to the new center.
        setGpsRecenterNonce((n) => n + 1);
      } else if (userMode === "customer" && customerSavedLocation) {
        setPreferLiveGps(false);
      }
    } catch {
      if (userMode === "customer" && customerSavedLocation) {
        setPreferLiveGps(false);
      }
    } finally {
      setLocatingGps(false);
    }
  }, [getGeoloc, startWatch, userMode, customerSavedLocation]);

  // FreshUp Pricing & Tier System v1.0 §2.3 — bulk-fetch dynamic prices
  // for all services in the customer's current area. Safe to fail: when
  // the request errors or the area has too few providers, dynamicPrices
  // stays empty and MODE_SERVICES_DB uses the legacy avg price.
  // Round customerLoc to 0.01° (~1 km) so tiny GPS jitter doesn't spam the API.
  const pricingAreaKey = useMemo(() => {
    const pos =
      userMode === "customer" ? pricingCustomerLoc : (geoloc ?? OSLO_DEFAULT);
    if (typeof pos?.lat !== "number" || typeof pos?.lng !== "number") {
      return null;
    }
    const r = (n: number) => Math.round(n * 100) / 100;
    return `${r(pos.lat)},${r(pos.lng)}`;
  }, [
    userMode,
    pricingCustomerLoc?.lat,
    pricingCustomerLoc?.lng,
    geoloc?.lat,
    geoloc?.lng,
  ]);
  const bulkQuoteServiceIds = useMemo(() => {
    const rows = dbCatalog?.services;
    if (!rows?.length) return "";
    return rows
      .filter((row) => row.mode_id === appMode)
      .map((row) => String(row.id))
      .sort()
      .join(",");
  }, [dbCatalog, appMode]);
  const [mapPriceRefreshKey, setMapPriceRefreshKey] = useState(0);
  const bulkQuoteFetchKey = useMemo(() => {
    if (!pricingAreaKey || !catalogHierarchyReady) return null;
    if (userMode === "customer" && !customerPricingLocReady) return null;
    return `${appMode}|${pricingAreaKey}|${bulkQuoteServiceIds}|${serviceMode}|r${mapPriceRefreshKey}`;
  }, [
    appMode,
    pricingAreaKey,
    bulkQuoteServiceIds,
    catalogHierarchyReady,
    mapPriceRefreshKey,
    userMode,
    customerPricingLocReady,
    serviceMode,
  ]);
  const bulkQuoteCoords = useMemo((): { lat: number; lng: number } | null => {
    const pos =
      userMode === "customer" ? pricingCustomerLoc : (geoloc ?? OSLO_DEFAULT);
    if (typeof pos?.lat !== "number" || typeof pos?.lng !== "number") {
      return null;
    }
    return { lat: pos.lat, lng: pos.lng };
  }, [
    userMode,
    pricingCustomerLoc?.lat,
    pricingCustomerLoc?.lng,
    geoloc?.lat,
    geoloc?.lng,
  ]);
  // Hold ··· until quote-bulk for this area/catalog key finishes.
  const customerBulkPricesLoading =
    userMode === "customer" &&
    (!customerPricingLocReady ||
      bulkQuoteFetchKey == null ||
      bulkPricesReadyKey !== bulkQuoteFetchKey);

  const beginMarketCalculatingRef = useRef(beginMarketCalculating);
  const endMarketCalculatingRef = useRef(endMarketCalculating);
  beginMarketCalculatingRef.current = beginMarketCalculating;
  endMarketCalculatingRef.current = endMarketCalculating;
  const bulkQuoteCoordsRef = useRef(bulkQuoteCoords);
  bulkQuoteCoordsRef.current = bulkQuoteCoords;
  const pricingAreaKeyRef = useRef(pricingAreaKey);
  pricingAreaKeyRef.current = pricingAreaKey;
  const bulkQuoteServiceIdsRef = useRef(bulkQuoteServiceIds);
  bulkQuoteServiceIdsRef.current = bulkQuoteServiceIds;
  const appModeRef = useRef(appMode);
  appModeRef.current = appMode;
  const serviceModeRef = useRef(serviceMode);
  serviceModeRef.current = serviceMode;

  useEffect(() => {
    if (!bulkQuoteFetchKey) {
      return;
    }

    const fetchKey = bulkQuoteFetchKey;
    let cancelled = false;
    let abortController: AbortController | null = null;
    let requestGen = 0;

    const fetchBulkPrices = async (background = false) => {
      abortController?.abort();
      abortController = new AbortController();
      const { signal } = abortController;
      const gen = ++requestGen;

      beginMarketCalculatingRef.current();
      try {
        const params = new URLSearchParams();
        // Service cards show the customer service price only (spec §2.2).
        params.set("delivery_mode", "provider");
        // Market closed respects the customer's selected Delivery / Hos tilbyder.
        params.set(
          "online_mode",
          serviceModeRef.current === "provider" ? "provider" : "home",
        );
        params.set("mode", appModeRef.current);
        const coords = bulkQuoteCoordsRef.current;
        const areaKey = pricingAreaKeyRef.current;
        if (coords) {
          params.set("lat", String(coords.lat));
          params.set("lng", String(coords.lng));
        } else if (areaKey) {
          const [latStr, lngStr] = areaKey.split(",");
          if (latStr) params.set("lat", latStr);
          if (lngStr) params.set("lng", lngStr);
        }
        const serviceIds = bulkQuoteServiceIdsRef.current;
        if (serviceIds) {
          params.set("service_ids", serviceIds);
        }
        const res = await fetch(
          `/api/pricing/quote-bulk?${params.toString()}`,
          { cache: "no-store", signal },
        );
        if (cancelled || signal.aborted || gen !== requestGen) return;
        if (!res.ok) {
          if (!background) setBulkPricesReadyKey(fetchKey);
          return;
        }
        const json = await res.json();
        if (cancelled || signal.aborted || gen !== requestGen) return;
        const map: Record<string, DashboardDynamicPriceEntry> = {};
        for (const item of (json?.items ?? []) as Array<{
          service_id?: string;
          customer_service_price?: number | null;
          legacy_base_price?: number | null;
          multiplier?: number | null;
          used_capacity_pct?: number | null;
          is_active?: boolean;
          market_closed?: boolean;
        }>) {
          if (!item?.service_id) continue;
          let servicePrice = Number(item.customer_service_price);
          const usedCapacityPct = Number(item.used_capacity_pct);
          const hasUsedCapacity =
            Number.isFinite(usedCapacityPct) && usedCapacityPct >= 0;
          const marketClosed = item.market_closed === true;
          if (!Number.isFinite(servicePrice) || servicePrice <= 0) {
            const legacyBase = Number(item.legacy_base_price);
            if (Number.isFinite(legacyBase) && legacyBase > 0) {
              servicePrice = legacyProviderBaseToCustomerServicePrice(
                legacyBase,
                {
                  // Closed market: base only (no dynamic multiplier).
                  usedCapacityPct: marketClosed
                    ? 50
                    : hasUsedCapacity
                      ? usedCapacityPct
                      : 50,
                  multiplier: marketClosed
                    ? 0
                    : Number.isFinite(Number(item.multiplier))
                      ? Number(item.multiplier)
                      : 0,
                },
              );
            }
          }
          if (!Number.isFinite(servicePrice) || servicePrice <= 0) continue;
          const entry: DashboardDynamicPriceEntry = {
            customer: roundMoney(servicePrice),
            multiplier: marketClosed ? 0 : Number(item.multiplier ?? 0) || 0,
            usedCapacityPct: hasUsedCapacity ? usedCapacityPct : null,
            isActive: !!item.is_active,
            marketClosed,
          };
          for (const variant of serviceIdVariantsForDashboard(
            item.service_id,
          )) {
            map[normalizeServiceId(variant)] = entry;
          }
        }
        setDynamicPrices((prev) => ({ ...prev, ...map }));
        if (!background) setBulkPricesReadyKey(fetchKey);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (gen !== requestGen) return;
        if (!background) setBulkPricesReadyKey(fetchKey);
      } finally {
        if (!cancelled && !signal.aborted && gen === requestGen) {
          endMarketCalculatingRef.current();
        }
      }
    };

    void fetchBulkPrices(false);
    // Spec §2.3: recalculate used capacity every 5–10 minutes (not per booking).
    const interval = setInterval(
      () => void fetchBulkPrices(true),
      5 * 60 * 1000,
    );
    return () => {
      cancelled = true;
      requestGen += 1;
      abortController?.abort();
      clearInterval(interval);
    };
  }, [bulkQuoteFetchKey]);

  // Providers (meta + realtime)
  const [providers, setProviders] = useState<Record<string, ProviderMeta>>({});
  const [fitKey, setFitKey] = useState(0);
  const channelsRef = useRef<any[]>([]);
  const fetchProvidersInFlightRef = useRef(false);

  const fetchProviders = useCallback(async () => {
    if (!isLoggedIn) return;
    if (fetchProvidersInFlightRef.current) return;
    if (!hasSupabase) {
      // Fallback demo
      setProviders({
        demo1: {
          id: "demo1",
          is_online: true,
          home_service: true,
          at_provider: true,
          status: "available",
          lat: OSLO_DEFAULT.lat + 0.01,
          lng: OSLO_DEFAULT.lng - 0.015,
          categories: ["haircut", "braids"],
          serviceIds: [],
        },
        demo2: {
          id: "demo2",
          is_online: true,
          home_service: false,
          at_provider: true,
          status: "available",
          lat: 59.9132,
          lng: 10.741,
          categories: ["haircut", "nails", "brows"],
          serviceIds: [],
        },
        demo3: {
          id: "demo3",
          is_online: true,
          home_service: true,
          at_provider: true,
          status: "available",
          lat: OSLO_DEFAULT.lat - 0.005,
          lng: OSLO_DEFAULT.lng + 0.01,
          categories: ["nails", "lashes"],
          serviceIds: [],
        },
        demo4: {
          id: "demo4",
          is_online: true,
          home_service: false,
          at_provider: true,
          status: "available",
          lat: OSLO_DEFAULT.lat + 0.015,
          lng: OSLO_DEFAULT.lng + 0.005,
          categories: ["brows", "body"],
          serviceIds: [],
        },
        demo5: {
          id: "demo5",
          is_online: true,
          home_service: true,
          at_provider: true,
          status: "available",
          lat: OSLO_DEFAULT.lat - 0.01,
          lng: OSLO_DEFAULT.lng - 0.01,
          categories: ["haircut", "braids"],
          serviceIds: [],
        },
      });
      setFitKey((k) => k + 1);
      return;
    }

    fetchProvidersInFlightRef.current = true;
    try {
      const [profsResult, skillsResult, catsResult] = await Promise.all([
        supabase
          .from("provider_details")
          .select("id, lat, lng, is_online, delivery_modes, last_online_at")
          .eq("is_online", true)
          .gte(
            "last_online_at",
            new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          ),
        supabase
          .from("provider_skills")
          .select("provider_id, service_id")
          .eq("is_active", true)
          .eq("available_now", true),
        supabase.from("provider_categories").select("provider_id, category"),
      ]);

      const map: Record<string, ProviderMeta> = {};
      for (const p of profsResult.data ?? []) {
        const flags = deliveryFlagsFromModes(p.delivery_modes);
        map[p.id] = {
          id: p.id,
          is_online: !!p.is_online,
          home_service: flags.home_service,
          at_provider: flags.at_provider,
          status: !!p.is_online ? "available" : "unavailable",
          lat: p.lat,
          lng: p.lng,
          categories: ["haircut"],
          serviceIds: [],
        };
      }

      if (!skillsResult.error && skillsResult.data) {
        for (const row of skillsResult.data) {
          const m = map[row.provider_id];
          if (!m) continue;
          const sid = String(row.service_id);
          if (!m.serviceIds.includes(sid)) m.serviceIds.push(sid);
        }
      }

      if (!catsResult.error && catsResult.data) {
        for (const row of catsResult.data) {
          const m = map[row.provider_id];
          if (m) {
            if (!m.categories.includes(row.category))
              m.categories.push(row.category as CategoryId);
          }
        }
      }

      setProviders(map);
      setFitKey((k) => k + 1);
    } catch {
      // ignore
    } finally {
      fetchProvidersInFlightRef.current = false;
    }
  }, [isLoggedIn, hasSupabase, supabase]);

  // Realtime subscriptions (only after login — avoids RLS errors while LoginPage is shown)
  useEffect(() => {
    if (!hasSupabase) return;
    channelsRef.current.forEach((ch) => ch.unsubscribe?.());
    channelsRef.current = [];
    if (!isLoggedIn) return;

    const ch1 = supabase
      .channel("prov-meta")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "provider_details" },
        (payload: any) => {
          const row = payload?.new;
          if (!row) return;
          setProviders((prev) => {
            const next = { ...prev };
            const id = row.id;
            const flags = deliveryFlagsFromModes(row.delivery_modes);
            const prevMeta = next[id] || {
              id,
              is_online: !!row.is_online,
              home_service: flags.home_service,
              at_provider: flags.at_provider,
              status: !!row.is_online ? "available" : "unavailable",
              lat: row.lat,
              lng: row.lng,
              categories: ["haircut"],
              serviceIds: [],
            };
            next[id] = {
              ...prevMeta,
              is_online: !!row.is_online,
              home_service: flags.home_service,
              at_provider: flags.at_provider,
              status: !!row.is_online ? "available" : "unavailable",
              lat: row.lat,
              lng: row.lng,
            };
            return next;
          });
        },
      )
      .subscribe();
    channelsRef.current.push(ch1);

    const ch2 = supabase
      .channel("prov-pos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "realtime_locations" },
        (payload: any) => {
          const row = payload?.new;
          if (!row) return;
          setProviders((prev) => {
            const next = { ...prev };
            const id = row.provider_id;
            if (next[id]) {
              next[id] = { ...next[id], lat: row.lat, lng: row.lng };
            }
            return next;
          });
        },
      )
      .subscribe();
    channelsRef.current.push(ch2);

    const ch3 = supabase
      .channel("prov-cats")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "provider_categories" },
        (payload: any) => {
          const row = payload?.new;
          if (!row) return;
          setProviders((prev) => {
            const next = { ...prev };
            const id = row.provider_id;
            if (!next[id]) return prev;
            if (!next[id].categories.includes(row.category)) {
              next[id] = {
                ...next[id],
                categories: [...next[id].categories, row.category],
              };
            }
            return next;
          });
        },
      )
      .subscribe();
    channelsRef.current.push(ch3);

    return () => {
      channelsRef.current.forEach((ch) => ch.unsubscribe?.());
      channelsRef.current = [];
    };
  }, [hasSupabase, supabase, isLoggedIn]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Visible providers with numbered markers
  const visibleProviders = useMemo(() => {
    const out = [];
    let index = 1;
    for (const p of Object.values(providers)) {
      if (!p.is_online) continue;
      if (p.status === "unavailable") continue;
      if (mode === "home" && !p.home_service) continue;
      if (mode === "provider" && !p.at_provider) continue;
      if (!p.categories.includes(category)) continue;
      out.push({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        type: mode === "home" ? "mobile" : "salon",
        status: p.status,
        number: index++,
      });
    }
    return out;
  }, [providers, mode, category]);

  // Flow state - Simplified (no separate styles step)
  type Step =
    | "map" // Map with bottom sheet for service selection
    | "confirm" // Confirm booking panel
    | "searching" // Searching for provider
    | "matched" // Provider matched
    | "in_service" // Live tracking during service
    | "rating"; // Rating after service

  const [step, setStep] = useState<Step>("map");
  const prevCustomerStepRef = useRef<Step>("map");
  useEffect(() => {
    if (
      userMode === "customer" &&
      step === "map" &&
      prevCustomerStepRef.current !== "map"
    ) {
      setMapPriceRefreshKey((k) => k + 1);
    }
    prevCustomerStepRef.current = step;
  }, [step, userMode]);
  const [status, setStatus] = useState<OrderStatus>("searching");
  const statusRef = useRef<OrderStatus>("searching");
  statusRef.current = status;

  const showLiveFleet =
    userMode === "customer" &&
    (step === "map" || step === "confirm" || step === "searching") &&
    currentPage === "main" &&
    isLoggedIn;

  /** Demand zones on the map — hide during active job tracking. */
  const showDemandZonesOnMap = useMemo(() => {
    if (currentPage !== "main" || !isLoggedIn) return false;
    if (userMode === "customer") {
      return (
        step === "map" ||
        step === "confirm" ||
        step === "searching" ||
        step === "rating"
      );
    }
    // Provider dashboard ignores customer booking `step` (can stay confirm/searching).
    if (
      providerJobStep === "enroute" ||
      providerJobStep === "arrived" ||
      providerJobStep === "in_service"
    ) {
      return false;
    }
    return true;
  }, [currentPage, isLoggedIn, step, userMode, providerJobStep]);

  const fleetFilterKey = useMemo(
    () => `${appMode}|${mode}|${category}|${target}|${pricingAreaKey ?? ""}`,
    [appMode, mode, category, target, pricingAreaKey],
  );

  const filteredRealFleetProviders = useMemo(() => {
    const visibleServiceIds = new Set(visibleServices.map((s) => s.id));
    const out: Array<{
      id: string;
      lat: number;
      lng: number;
      type: "mobile" | "salon";
      status: "available" | "busy" | "unavailable";
    }> = [];
    for (const p of Object.values(providers)) {
      if (!p.is_online) continue;
      if (p.status === "unavailable") continue;
      if (mode === "home" && !p.home_service) continue;
      if (mode === "provider" && !p.at_provider) continue;
      if (!p.categories.includes(category)) continue;
      const skillIds = p.serviceIds ?? [];
      const skillMatch =
        skillIds.length === 0 ||
        skillIds.some((sid) => visibleServiceIds.has(sid));
      if (visibleServiceIds.size > 0 && !skillMatch) continue;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      out.push({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        type: mode === "home" ? "mobile" : "salon",
        status: p.status,
      });
    }
    return out;
  }, [providers, mode, category, visibleServices]);

  const liveFleetProviders = useMemo(() => {
    if (!showLiveFleet) return [];
    // Real online providers only — no decorative/simulated markers.
    return filteredRealFleetProviders;
  }, [showLiveFleet, filteredRealFleetProviders]);

  // Order context
  const [orderId, setOrderId] = useState<string | null>(null);
  const customerActiveJobRestoreDoneRef = useRef(false);
  const [searchTimer, setSearchTimer] = useState(0);
  const [isMatching, setIsMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [serviceStartedAt, setServiceStartedAt] = useState<string | null>(null);
  const [servicePausedAt, setServicePausedAt] = useState<string | null>(null);
  const [servicePausedTotalSeconds, setServicePausedTotalSeconds] = useState(0);
  const [customerTypicalDurationMin, setCustomerTypicalDurationMin] =
    useState(30);
  const [liveClockMs, setLiveClockMs] = useState(() => Date.now());
  const [userRating, setUserRating] = useState(0);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);

  // Assigned provider + route tracking
  const [provider, setProvider] = useState<{
    id?: string;
    name: string;
    rating: number;
    code: string;
    distanceKm?: number | null;
    avatarUrl?: string | null;
    phone?: string | null;
  } | null>(null);

  // Home delivery km: 1 km default until a provider is matched; then actual driving km.
  const deliveryKmForPricing = useMemo(() => {
    const bookingLoc = userMode === "customer" ? customerLoc : geoloc;
    if (mode !== "home" || !bookingLoc) return null;
    if (
      (step === "matched" || step === "in_service" || step === "rating") &&
      provider?.distanceKm != null &&
      Number.isFinite(provider.distanceKm)
    ) {
      return provider.distanceKm;
    }
    return DEFAULT_SEARCH_DELIVERY_KM;
  }, [mode, userMode, customerLoc, geoloc, step, provider?.distanceKm]);

  const deliveryKmIsEstimate = useMemo(
    () =>
      mode === "home" &&
      !(
        (step === "matched" || step === "in_service" || step === "rating") &&
        provider?.distanceKm != null
      ),
    [mode, step, provider?.distanceKm],
  );

  const homeDeliveryFeeForDisplay = useMemo(() => {
    if (mode !== "home") return 0;
    if (
      customerPriceLockBreakdown?.delivery_fee != null &&
      priceLockId &&
      (step === "confirm" || step === "searching")
    ) {
      return Math.round(Number(customerPriceLockBreakdown.delivery_fee) || 0);
    }
    if (deliveryKmForPricing == null) return 0;
    return computeDeliveryFee(deliveryKmForPricing, true);
  }, [
    mode,
    step,
    customerPriceLockBreakdown,
    priceLockId,
    deliveryKmForPricing,
  ]);

  const deliveryReserveCeilingKr = useMemo(
    () => maxDeliveryFeeAtDispatchRadius(),
    [],
  );

  const bookingReserveAmountKr = useMemo(() => {
    if (!priceLockId) return null;
    return authorizeAmountFromPriceLock({
      delivery_mode: mode === "home" ? "home" : "provider",
      customer_service_price:
        customerPriceLockBreakdown?.customer_service_price ??
        activeBookingQuote?.customerServicePrice,
      addons_customer_total:
        customerPriceLockBreakdown?.addons_customer_total ??
        activeBookingQuote?.addonsCustomerTotal,
      customer_total:
        lockedCustomerTotal ??
        customerPriceLockBreakdown?.customer_total ??
        activeBookingQuote?.customerTotal,
    });
  }, [
    priceLockId,
    mode,
    customerPriceLockBreakdown,
    lockedCustomerTotal,
    activeBookingQuote,
  ]);

  const stripePaymentsEnabled = Boolean(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  );

  /** Stable confirm-step reserve total — same service price as line item + delivery ceiling (not min delivery). */
  const confirmBookingReserveAmountKr = useMemo(() => {
    if (bookingReserveAmountKr != null) return bookingReserveAmountKr;
    if (!stripePaymentsEnabled || step !== "confirm" || !selectedStyle) {
      return null;
    }

    const pricingServiceId = bookingPricingServiceId(selectedStyle);
    const addonsTotal = roundMoney(
      Number(
        customerPriceLockBreakdown?.addons_customer_total ??
          activeBookingQuote?.addonsCustomerTotal,
      ) ||
        selectedAddons.reduce(
          (sum, id) =>
            sum + (currentAddons.find((a) => a.id === id)?.price || 0),
          0,
        ),
    );

    let servicePrice = roundMoney(
      Number(
        customerPriceLockBreakdown?.customer_service_price ??
          activeBookingQuote?.customerServicePrice,
      ) || 0,
    );
    if (servicePrice <= 0 && activeBookingQuote) {
      servicePrice = roundMoney(
        Math.max(
          0,
          activeBookingQuote.customerTotal -
            addonsTotal -
            activeBookingQuote.deliveryFee,
        ),
      );
    }
    if (servicePrice <= 0) {
      const dynamicBase = lookupDynamicCustomerPrice(
        pricingServiceId,
        dynamicPrices,
      );
      if (dynamicBase != null) servicePrice = dynamicBase;
    }
    if (servicePrice <= 0) {
      servicePrice = roundMoney(Number(selectedStyle.price) || 0);
    }

    const customerTotal = roundMoney(
      Number(
        lockedCustomerTotal ??
          customerPriceLockBreakdown?.customer_total ??
          activeBookingQuote?.customerTotal,
      ) || 0,
    );

    if (mode === "provider") {
      if (customerTotal > 0) return customerTotal;
      if (servicePrice > 0) return roundMoney(servicePrice + addonsTotal);
      return null;
    }

    if (servicePrice <= 0) return null;
    return authorizeAmountFromPriceLock({
      delivery_mode: "home",
      customer_service_price: servicePrice,
      addons_customer_total: addonsTotal,
    });
  }, [
    bookingReserveAmountKr,
    stripePaymentsEnabled,
    step,
    mode,
    selectedStyle,
    dynamicPrices,
    customerPriceLockBreakdown,
    activeBookingQuote,
    lockedCustomerTotal,
    selectedAddons,
    currentAddons,
  ]);

  const [matchedProviders, setMatchedProviders] = useState<
    Array<{
      id: string;
      name: string;
      rating: number;
      code: string;
      distanceKm: number | null;
      avatarUrl?: string | null;
    }>
  >([]);
  const [providerPos, setProviderPos] = useState<LatLng | null>(null);
  const [route, setRoute] = useState<LatLng[] | null>(null);
  const [eta, setEta] = useState<number>(8);
  const [fitKey2, setFitKey2] = useState(0);
  const [orderRealtimeState, setOrderRealtimeState] = useState<
    "connected" | "reconnecting"
  >("connected");
  const incomingCustomerLat =
    mockIncomingRequest?.customerLocation?.lat ?? null;
  const incomingCustomerLng =
    mockIncomingRequest?.customerLocation?.lng ?? null;

  const providerPosRef = useRef<LatLng | null>(null);
  const lastProviderPostPosRef = useRef<LatLng | null>(null);
  const lastCustomerPostPosRef = useRef<LatLng | null>(null);
  const customerLivePosRef = useRef<LatLng | null>(null);
  const providerOrderDeliveryPinRef = useRef<LatLng | null>(null);
  const providerOrderProviderPinRef = useRef<LatLng | null>(null);
  const providerMatchDistanceKmRef = useRef<number | null>(null);
  const customerOrderDeliveryPinRef = useRef<LatLng | null>(null);
  const customerOrderProviderBasePinRef = useRef<LatLng | null>(null);
  const customerOrderMatchKmRef = useRef<number | null>(null);
  const orderChannelRef = useRef<any | null>(null);
  const locChannelRef = useRef<any | null>(null);
  const customerLocChannelRef = useRef<any | null>(null);
  const orderPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOrderAgainRef = useRef<OrderAgainPayload | null>(null);
  const inactiveLocationOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    customerActiveJobRestoreDoneRef.current = false;
  }, [loggedInUser?.id, userMode]);

  // Restore in-progress customer booking from DB after refresh.
  useEffect(() => {
    if (!authReady || !hasSupabase || !isLoggedIn) {
      customerActiveJobRestoreDoneRef.current = true;
      return;
    }
    if (userMode !== "customer") {
      customerActiveJobRestoreDoneRef.current = true;
      return;
    }
    const customerId = loggedInUser?.id;
    if (!customerId) {
      customerActiveJobRestoreDoneRef.current = true;
      return;
    }
    if (orderId && (step === "matched" || step === "in_service")) {
      customerActiveJobRestoreDoneRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const { data: order, error } = await supabase
          .from("orders")
          .select(
            "id, status, service_id, delivery_mode, price, provider_id, customer_address, customer_lat, customer_lng",
          )
          .eq("customer_id", customerId)
          .in("status", [...ACTIVE_JOB_ORDER_STATUSES])
          .order("accepted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled || error || !order?.id) return;

        const flow = customerFlowFromOrderStatus(String(order.status || ""));
        if (!flow) return;

        const [{ data: service }, { data: sessionData }] = await Promise.all([
          supabase
            .from("services")
            .select("id, name, duration_minutes")
            .eq("id", order.service_id)
            .maybeSingle(),
          supabase.auth.getSession(),
        ]);

        const token = sessionData?.session?.access_token;
        let statusData: {
          provider?: Record<string, unknown> | null;
          pricing?: Record<string, unknown> | null;
        } | null = null;
        if (token) {
          const statusRes = await fetch(
            `/api/orders/status?order_id=${encodeURIComponent(String(order.id))}`,
            {
              headers: { Authorization: `Bearer ${token}` },
              cache: "no-store",
            },
          );
          if (statusRes.ok) {
            statusData = await statusRes.json().catch(() => null);
          }
        }

        if (cancelled) return;

        const serviceId = String(order.service_id || "");
        const restoredStyle = bookingStyleFromOrderService(
          serviceId,
          String((service as any)?.name || serviceId),
          Number((service as any)?.duration_minutes) || 30,
          Number(order.price) || 0,
        );

        setOrderId(String(order.id));
        setServiceMode(
          String(order.delivery_mode) === "home" ? "home" : "provider",
        );
        const restoredPriceBreakdown = customerPriceLockFromApiPricing(
          (statusData?.pricing ?? null) as Record<string, unknown> | null,
        );
        setCustomerPriceLockBreakdown(restoredPriceBreakdown);
        const restoredBookedTotal = bookedOrderTotalFromSources(
          restoredPriceBreakdown,
          Number(order.price) || 0,
          0,
        );
        setLockedCustomerTotal(
          restoredBookedTotal > 0 ? restoredBookedTotal : null,
        );
        setSelectedStyle(restoredStyle);
        if (statusData?.provider?.id) {
          const providerEntry = resolveCustomerProviderFromStatus(
            statusData.provider as Record<string, unknown>,
            language,
            APP_MODES[appMode].codePrefix,
          );
          setProvider(providerEntry);
          setMatchedProviders([providerEntry]);
        }
        setStatus(flow.status);
        setStep(flow.step);
        if (flow.step === "matched" || flow.step === "in_service") {
          customerMatchedSheetOpenedRef.current = true;
          setIsBottomSheetCompressed(false);
        }
      } catch (err) {
        console.warn("[customer-active-job] restore failed", err);
      } finally {
        if (!cancelled) customerActiveJobRestoreDoneRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authReady,
    hasSupabase,
    isLoggedIn,
    userMode,
    loggedInUser?.id,
    supabase,
    orderId,
    step,
    language,
    appMode,
  ]);

  const setProviderPosIfChanged = useCallback((pos: LatLng) => {
    setProviderPos((prev) => {
      if (isSameLatLng(prev, pos)) return prev;
      providerPosRef.current = pos;
      return pos;
    });
  }, []);

  const setCustomerLivePosIfChanged = useCallback((pos: LatLng) => {
    setCustomerLivePos((prev) => {
      if (isSameLatLng(prev, pos)) return prev;
      customerLivePosRef.current = pos;
      return pos;
    });
  }, []);

  useEffect(() => {
    providerPosRef.current = providerPos;
  }, [providerPos]);

  useEffect(() => {
    customerLivePosRef.current = customerLivePos;
  }, [customerLivePos]);

  useEffect(() => {
    providerOrderDeliveryPinRef.current = providerOrderDeliveryPin;
  }, [providerOrderDeliveryPin]);

  useEffect(() => {
    providerOrderProviderPinRef.current = providerOrderProviderPin;
  }, [providerOrderProviderPin]);

  useEffect(() => {
    customerOrderDeliveryPinRef.current = customerOrderDeliveryPin;
  }, [customerOrderDeliveryPin]);

  useEffect(() => {
    customerOrderProviderBasePinRef.current = customerOrderProviderBasePin;
  }, [customerOrderProviderBasePin]);

  const resolveProviderRouteCustomerPin = useCallback((): LatLng | null => {
    return (
      providerOrderDeliveryPinRef.current ??
      providerIncomingOfferRef.current?.customerLocation ??
      null
    );
  }, []);

  const resolveProviderRouteOriginPin = useCallback((): LatLng | null => {
    const offer = providerIncomingOfferRef.current;
    const live = providerPosRef.current || geoloc;
    const customerPin = resolveProviderRouteCustomerPin();
    const shopPin = providerOrderProviderPinRef.current;
    const step = providerJobStepRef.current;
    if (
      shopPin &&
      customerPin &&
      (step === "accepted" ||
        step === "enroute" ||
        step === "arrived" ||
        step === "in_service")
    ) {
      return resolveProviderHomeMapPin(live, customerPin, shopPin, step);
    }
    const matchKm =
      providerMatchDistanceKmRef.current ??
      parseOfferMatchDistanceKm(
        offer?.location?.distance,
        offer?.matchDistanceKm ?? null,
      );
    return resolveProviderMapOrigin(
      live,
      customerPin,
      shopPin,
      matchKm,
      step === "accepted" ||
        step === "enroute" ||
        step === "arrived" ||
        step === "in_service"
        ? step
        : null,
    );
  }, [geoloc, resolveProviderRouteCustomerPin]);

  const hydrateProviderOrderDeliveryPin = useCallback(
    async (orderId: string): Promise<LatLng | null> => {
      const oid = String(orderId || "").trim();
      if (!oid || !hasSupabase) return null;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return null;

        const res = await fetch(
          `/api/orders/customer-destination?order_id=${encodeURIComponent(oid)}`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) return null;

        const body = await res.json().catch(() => ({}));
        const orderLoc = body?.order_location;
        const lat = Number(orderLoc?.lat);
        const lng = Number(orderLoc?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const pin = { lat, lng };
        setProviderOrderDeliveryPin(pin);
        providerOrderDeliveryPinRef.current = pin;

        const provBase =
          body?.provider_base_location ?? body?.provider_location;
        const pLat = Number(provBase?.lat);
        const pLng = Number(provBase?.lng);
        if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
          const providerPin = { lat: pLat, lng: pLng };
          setProviderOrderProviderPin(providerPin);
          providerOrderProviderPinRef.current = providerPin;
        }

        const matchKm = Number(body?.match_distance_km);
        if (Number.isFinite(matchKm) && matchKm >= 0) {
          providerMatchDistanceKmRef.current = matchKm;
        }

        setProviderIncomingOffer((prev) =>
          prev?.orderId === oid
            ? {
                ...prev,
                customerLocation: pin,
                matchDistanceKm:
                  body?.match_distance_km ?? prev.matchDistanceKm ?? null,
              }
            : prev,
        );
        return pin;
      } catch {
        return null;
      }
    },
    [hasSupabase, supabase],
  );

  const hydrateCustomerOrderDestination = useCallback(
    async (activeOrderId: string): Promise<LatLng | null> => {
      const oid = String(activeOrderId || "").trim();
      if (!oid || !hasSupabase) return null;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) return null;

        const res = await fetch(
          `/api/orders/customer-destination?order_id=${encodeURIComponent(oid)}`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) return null;

        const body = await res.json().catch(() => ({}));
        const orderLoc = body?.order_location;
        const lat = Number(orderLoc?.lat);
        const lng = Number(orderLoc?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const deliveryPin = { lat, lng };
        const prevDelivery = customerOrderDeliveryPinRef.current;
        if (!prevDelivery || movedAtLeastMeters(prevDelivery, deliveryPin, 1)) {
          setCustomerOrderDeliveryPin(deliveryPin);
          customerOrderDeliveryPinRef.current = deliveryPin;
        }

        const provBase =
          body?.provider_base_location ?? body?.provider_location;
        const pLat = Number(provBase?.lat);
        const pLng = Number(provBase?.lng);
        if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
          const shopPin = { lat: pLat, lng: pLng };
          const prevShop = customerOrderProviderBasePinRef.current;
          if (!prevShop || movedAtLeastMeters(prevShop, shopPin, 1)) {
            setCustomerOrderProviderBasePin(shopPin);
            customerOrderProviderBasePinRef.current = shopPin;
          }
        }

        const matchKm = Number(body?.match_distance_km);
        if (Number.isFinite(matchKm) && matchKm >= 0) {
          customerOrderMatchKmRef.current = matchKm;
        }

        return deliveryPin;
      } catch {
        return null;
      }
    },
    [hasSupabase, supabase],
  );

  const applyDrivingRoute = useCallback(async (from: LatLng, to: LatLng) => {
    if (haversineKm(from, to) < 0.05) return;

    const key = routeEndpointsKey(from, to);
    if (routeReadyKeyRef.current === key) {
      return;
    }
    if (routeFetchKeyInFlightRef.current === key) {
      return;
    }

    lastRouteFromRef.current = from;
    lastRouteToRef.current = to;
    routeFetchKeyInFlightRef.current = key;

    const gen = ++routeFetchGenRef.current;
    try {
      const routed = await fetchDrivingRoutePolylineClient(from, to);
      if (gen !== routeFetchGenRef.current) return;
      const coords = routed?.coordinates;
      if (coords && coords.length >= 2) {
        setRoute(snapRouteEndpoints(coords, from, to));
        routeReadyKeyRef.current = key;
        setFitKey2((k) => k + 1);
      }
    } finally {
      if (routeFetchKeyInFlightRef.current === key) {
        routeFetchKeyInFlightRef.current = null;
      }
    }
  }, []);

  const primeProviderHomeRouteFromOffer = useCallback(
    (offer: ProviderOfferCardPayload) => {
      if (offer.mode !== "home") return;
      const dest =
        providerOrderDeliveryPinRef.current ?? offer.customerLocation ?? null;
      if (!dest) return;
      const origin =
        providerOrderProviderPinRef.current ??
        providerPosRef.current ??
        geoloc ??
        null;
      if (!origin) return;
      const { from, to } = resolveHomeDeliveryRoute(origin, dest);
      if (from && to) void applyDrivingRoute(from, to);
    },
    [applyDrivingRoute, geoloc],
  );

  const refreshCustomerDrivingRoute = useCallback(() => {
    const shop = customerOrderProviderBasePinRef.current;
    const delivery = customerOrderDeliveryPinRef.current;
    if (!shop || !delivery) return;

    const { from, to: dest } = resolveHomeDeliveryRoute(shop, delivery);
    if (!from || !dest) return;

    const key = routeEndpointsKey(from, dest);
    if (routeReadyKeyRef.current === key) return;

    void applyDrivingRoute(from, dest);
    setEta(kmToEtaMinutes(haversineKm(from, dest)));
  }, [applyDrivingRoute]);

  const refreshProviderDrivingRoute = useCallback(() => {
    const shop = providerOrderProviderPinRef.current;
    const to = resolveProviderRouteCustomerPin();
    const isHomeJob = providerIncomingOfferRef.current?.mode === "home";

    const { from, to: dest } =
      isHomeJob && shop && to
        ? resolveHomeDeliveryRoute(shop, to)
        : {
            from: resolveProviderRouteOriginPin(),
            to,
          };

    if (!from || !dest) return;
    void applyDrivingRoute(from, dest);
    setEta(kmToEtaMinutes(haversineKm(from, dest)));
  }, [
    applyDrivingRoute,
    resolveProviderRouteCustomerPin,
    resolveProviderRouteOriginPin,
  ]);

  const applyLiveProviderLocation = useCallback(
    (pos: LatLng) => {
      setProviderPosIfChanged(pos);
      if (mode === "home") {
        return;
      }
      const destination = geoloc || OSLO_DEFAULT;
      void applyDrivingRoute(pos, destination);
      setEta(kmToEtaMinutes(haversineKm(pos, destination)));
    },
    [geoloc, mode, setProviderPosIfChanged, applyDrivingRoute],
  );

  const postProviderLocation = useCallback(
    async (
      activeOrderId: string,
      activeProviderId: string,
      pos: LatLng,
      accuracyM?: number | null,
    ) => {
      if (!activeOrderId || !activeProviderId) return;
      if (inactiveLocationOrderIdsRef.current.has(activeOrderId)) return;
      if (
        !movedAtLeastMeters(
          lastProviderPostPosRef.current,
          pos,
          LIVE_LOCATION_MIN_MOVE_M,
        )
      ) {
        return;
      }
      try {
        const res = await fetch("/api/orders/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: activeOrderId,
            provider_id: activeProviderId,
            lat: pos.lat,
            lng: pos.lng,
            accuracy_m: accuracyM ?? null,
          }),
        });
        if (res.status === 409) {
          const data = await res.json().catch(() => null);
          const currentStatus = String(data?.current_status || "");
          if (["completed", "cancelled"].includes(currentStatus)) {
            inactiveLocationOrderIdsRef.current.add(activeOrderId);
          }
        } else if (res.ok) {
          lastProviderPostPosRef.current = pos;
        }
      } catch (err) {
        console.warn("[provider-location]", err);
      }
    },
    [],
  );

  const postCustomerLocation = useCallback(
    async (
      activeOrderId: string,
      activeCustomerId: string,
      pos: LatLng,
      accuracyM?: number | null,
    ) => {
      if (!activeOrderId || !activeCustomerId) return;
      if (inactiveLocationOrderIdsRef.current.has(activeOrderId)) return;
      if (
        !movedAtLeastMeters(
          lastCustomerPostPosRef.current,
          pos,
          LIVE_LOCATION_MIN_MOVE_M,
        )
      ) {
        return;
      }
      try {
        const res = await fetch("/api/orders/customer-location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: activeOrderId,
            customer_id: activeCustomerId,
            lat: pos.lat,
            lng: pos.lng,
            accuracy_m: accuracyM ?? null,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 409 || data?.inactive === true) {
          inactiveLocationOrderIdsRef.current.add(activeOrderId);
        } else if (res.ok) {
          lastCustomerPostPosRef.current = pos;
        }
      } catch (err) {
        if (process.env.NODE_ENV === "development") {
          console.warn("[customer-location]", err);
        }
      }
    },
    [],
  );

  const calculateStylePrice = useCallback(
    (style: BookingStyle) => {
      const normalizedServiceId = normalizeServiceId(style.id);
      const pricingServiceId = bookingPricingServiceId(style);
      const addonsTotal = selectedAddons.reduce(
        (sum, id) => sum + (currentAddons.find((a) => a.id === id)?.price || 0),
        0,
      );
      const lockedAddonsTotal = Math.round(
        Number(customerPriceLockBreakdown?.addons_customer_total) || 0,
      );
      const extraAddonsTotal = Math.max(0, addonsTotal - lockedAddonsTotal);
      if (step === "matched" || step === "in_service" || step === "rating") {
        const providerKm = provider?.distanceKm ?? null;
        if (
          mode === "home" &&
          providerKm != null &&
          customerPriceLockBreakdown
        ) {
          return customerMatchedOrderTotal(
            customerPriceLockBreakdown,
            lockedCustomerTotal ?? 0,
            mode,
            providerKm,
          );
        }
        if (lockedCustomerTotal != null && lockedCustomerTotal > 0) {
          return lockedCustomerTotal + extraAddonsTotal;
        }
        const fromLock = orderTotalFromPriceLock(
          customerPriceLockBreakdown,
          lockedCustomerTotal ??
            activeBookingQuote?.customerTotal ??
            style.price,
        );
        if (fromLock > 0) return fromLock + extraAddonsTotal;
      }
      if (
        selectedStyle &&
        normalizeServiceId(selectedStyle.id) === normalizedServiceId &&
        lockedCustomerTotal != null &&
        lockedCustomerTotal > 0 &&
        (step !== "confirm" || priceLockId != null)
      ) {
        return lockedCustomerTotal + extraAddonsTotal;
      }
      if (
        activeBookingQuote &&
        activeBookingQuote.serviceId === pricingServiceId &&
        activeBookingQuote.customerTotal > 0
      ) {
        const quotedAddons = activeBookingQuote.addonsCustomerTotal || 0;
        const extraAddons =
          quotedAddons > 0
            ? Math.max(0, addonsTotal - quotedAddons)
            : addonsTotal;
        return activeBookingQuote.customerTotal + extraAddons;
      }
      const dynamicBase = lookupDynamicCustomerPrice(
        pricingServiceId,
        dynamicPrices,
      );
      const legacyService = Number(style.price) || 0;
      const servicePrice = dynamicBase ?? legacyService;
      const deliveryFee =
        mode === "home"
          ? computeDeliveryFee(deliveryKmForPricing ?? 0, true)
          : 0;
      return servicePrice + addonsTotal + deliveryFee;
    },
    [
      activeBookingQuote,
      currentAddons,
      customerPriceLockBreakdown,
      dynamicPrices,
      deliveryKmForPricing,
      lockedCustomerTotal,
      mode,
      priceLockId,
      provider?.distanceKm,
      selectedAddons,
      selectedStyle,
      step,
    ],
  );

  const customerServiceDisplayPrice = useCallback(
    (style: BookingStyle) => {
      const normalizedServiceId = normalizeServiceId(style.id);
      const pricingServiceId = bookingPricingServiceId(style);
      const isActiveBookingStyle =
        selectedStyle &&
        normalizeServiceId(selectedStyle.id) === normalizedServiceId;

      const lockedService = resolveCustomerServicePrice(
        customerPriceLockBreakdown,
        lockedCustomerTotal ?? 0,
      );
      if (
        isActiveBookingStyle &&
        lockedService > 0 &&
        (step !== "confirm" || priceLockId != null)
      ) {
        return lockedService;
      }

      if (
        activeBookingQuote &&
        activeBookingQuote.serviceId === pricingServiceId &&
        activeBookingQuote.customerServicePrice > 0
      ) {
        return activeBookingQuote.customerServicePrice;
      }

      const dynamicBase = lookupDynamicCustomerPrice(
        pricingServiceId,
        dynamicPrices,
      );
      if (dynamicBase != null) return dynamicBase;
      return roundMoney(Number(style.price) || 0);
    },
    [
      activeBookingQuote,
      customerPriceLockBreakdown,
      dynamicPrices,
      lockedCustomerTotal,
      priceLockId,
      selectedStyle,
      step,
    ],
  );

  const confirmBookingDemandTier = useMemo(() => {
    if (userMode !== "customer" || !selectedStyle) return null;
    return customerDemandTierFromPrices(
      bookingPricingServiceId(selectedStyle),
      dynamicPrices,
    );
  }, [userMode, selectedStyle, dynamicPrices]);

  const bookedOrderDisplayTotal = useMemo(() => {
    if (!selectedStyle) return 0;
    const providerKm = provider?.distanceKm ?? null;
    if (
      (step === "matched" || step === "in_service" || step === "rating") &&
      mode === "home" &&
      providerKm != null &&
      customerPriceLockBreakdown
    ) {
      return customerMatchedOrderTotal(
        customerPriceLockBreakdown,
        lockedCustomerTotal ?? 0,
        mode,
        providerKm,
      );
    }
    if (lockedCustomerTotal != null && lockedCustomerTotal > 0) {
      return lockedCustomerTotal;
    }
    const fromLock = orderTotalFromPriceLock(
      customerPriceLockBreakdown,
      activeBookingQuote?.customerTotal ?? selectedStyle.price,
    );
    if (fromLock > 0) return fromLock;
    if (
      activeBookingQuote?.customerTotal &&
      activeBookingQuote.customerTotal > 0
    ) {
      return activeBookingQuote.customerTotal;
    }
    return selectedStyle.price;
  }, [
    selectedStyle,
    lockedCustomerTotal,
    customerPriceLockBreakdown,
    activeBookingQuote,
    mode,
    provider?.distanceKm,
    step,
  ]);

  // Map preview only: home-delivery total while a service card is expanded.
  // Confirm+ uses POST /api/pricing/lock (no duplicate GET quote).
  useEffect(() => {
    if (step !== "map" || !expandedStyleId) {
      if (step === "map" && !expandedStyleId) {
        setActiveBookingQuote(null);
      }
      return;
    }

    const pricingServiceId = bookingPricingServiceId(
      visibleServices.find(
        (s) =>
          normalizeServiceId(s.id) === normalizeServiceId(expandedStyleId) ||
          bookingPricingServiceId(s) === normalizeServiceId(expandedStyleId),
      ) || { id: expandedStyleId },
    );
    const fetchKey = [
      pricingServiceId,
      mode,
      pricingAreaKey ?? "",
      [...selectedAddons].sort().join(","),
    ].join("|");
    if (bookingQuoteLastFetchKeyRef.current === fetchKey) {
      return;
    }
    bookingQuoteLastFetchKeyRef.current = fetchKey;

    let cancelled = false;
    const abortController = new AbortController();
    const syncBookingQuote = async () => {
      const params = new URLSearchParams({
        service_id: pricingServiceId,
        delivery_mode: mode === "home" ? "home" : "provider",
      });
      if (selectedAddons.length > 0) {
        params.set("addon_ids", selectedAddons.join(","));
      }
      if (customerLoc) {
        params.set("lat", String(customerLoc.lat));
        params.set("lng", String(customerLoc.lng));
      } else if (pricingAreaKey) {
        const [latStr, lngStr] = pricingAreaKey.split(",");
        if (latStr) params.set("lat", latStr);
        if (lngStr) params.set("lng", lngStr);
      }
      try {
        const res = await fetch(`/api/pricing/quote?${params.toString()}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        if (!res.ok || cancelled) return;
        const quote = await res.json();
        if (cancelled) return;
        const customerServicePrice = Number(quote?.customerServicePrice);
        const deliveryFee = Number(quote?.deliveryFee);
        const addonsCustomerTotal = Number(quote?.addonsCustomerTotal);
        const customerTotal = Number(quote?.customerTotal);
        if (!Number.isFinite(customerTotal) || customerTotal <= 0) return;
        const roundedService = Number.isFinite(customerServicePrice)
          ? roundMoney(customerServicePrice)
          : 0;
        setActiveBookingQuote({
          serviceId: pricingServiceId,
          customerServicePrice: roundedService,
          deliveryFee: Number.isFinite(deliveryFee)
            ? roundMoney(deliveryFee)
            : 0,
          addonsCustomerTotal: Number.isFinite(addonsCustomerTotal)
            ? roundMoney(addonsCustomerTotal)
            : 0,
          customerTotal: roundMoney(customerTotal),
        });
        // Keep catalog card prices aligned with the live quote.
        // Must preserve marketClosed — dropping it made Confirm go green again
        // after expand (used_capacity 0% reads as "Many available").
        if (roundedService > 0) {
          const usedCapacityPct = Number(quote?.usedCapacityPct);
          setDynamicPrices((prev) => {
            const existing = lookupDynamicPriceEntry(pricingServiceId, prev);
            const marketClosed =
              typeof quote?.marketClosed === "boolean"
                ? quote.marketClosed === true
                : !!existing?.marketClosed;
            const entry: DashboardDynamicPriceEntry = {
              customer: roundedService,
              multiplier: marketClosed
                ? 0
                : Number(quote?.multiplier ?? 0) || 0,
              usedCapacityPct: Number.isFinite(usedCapacityPct)
                ? usedCapacityPct
                : null,
              isActive: !!quote?.basePriceIsActive,
              marketClosed,
            };
            const next = { ...prev };
            for (const variant of serviceIdVariantsForDashboard(
              pricingServiceId,
            )) {
              next[normalizeServiceId(variant)] = entry;
            }
            return next;
          });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        bookingQuoteLastFetchKeyRef.current = null;
      }
    };

    void syncBookingQuote();
    return () => {
      cancelled = true;
      abortController.abort();
      if (bookingQuoteLastFetchKeyRef.current === fetchKey) {
        bookingQuoteLastFetchKeyRef.current = null;
      }
    };
  }, [
    expandedStyleId,
    mode,
    pricingAreaKey,
    customerLoc?.lat,
    customerLoc?.lng,
    selectedAddons,
    step,
    visibleServices,
  ]);

  // Spec §2.3: one price lock when customer opens confirm (OSRM km resolved server-side).
  useEffect(() => {
    if (userMode !== "customer") return;
    if (step !== "confirm" || !selectedStyle) return;
    if (!hasSupabase) return;

    let lat: number | undefined;
    let lng: number | undefined;
    // Full-precision coords align with the ~1 km demand grid; pricingAreaKey
    // rounds to 0.01° and can land in a neighboring cell.
    if (customerLoc) {
      lat = customerLoc.lat;
      lng = customerLoc.lng;
    } else if (pricingAreaKey) {
      const [latStr, lngStr] = pricingAreaKey.split(",");
      const parsedLat = Number(latStr);
      const parsedLng = Number(lngStr);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        lat = parsedLat;
        lng = parsedLng;
      }
    }
    if (
      mode === "home" &&
      (typeof lat !== "number" || typeof lng !== "number")
    ) {
      return;
    }

    const pricingServiceId = bookingPricingServiceId(selectedStyle);
    // Lock key intentionally excludes dynamicPrices so a background bulk-price
    // refresh while the confirm sheet is open doesn't re-fire the lock API.
    const lockAttemptKey = [
      pricingServiceId,
      mode,
      lat ?? "",
      lng ?? "",
      [...selectedAddons].sort().join(","),
    ].join("|");
    if (
      confirmPriceLockAttemptedRef.current === lockAttemptKey &&
      priceLockId
    ) {
      return;
    }

    let cancelled = false;
    const lockOnConfirm = async () => {
      setPriceLockLoading(true);
      setPriceLockPhase("calculating");
      beginMarketCalculating();
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (cancelled) {
        setPriceLockLoading(false);
        setPriceLockPhase("idle");
        endMarketCalculating();
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken || cancelled) {
        setPriceLockLoading(false);
        setPriceLockPhase("idle");
        endMarketCalculating();
        return;
      }

      setPriceLockPhase("finding");
      let lockSucceeded = false;
      try {
        const lockRes = await fetch("/api/pricing/lock", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            service_id: pricingServiceId,
            delivery_mode: mode === "home" ? "home" : "provider",
            customer_lat: lat,
            customer_lng: lng,
            addon_ids: selectedAddons,
          }),
        });
        if (cancelled) return;
        const lockData = await lockRes.json();
        if (!lockRes.ok) {
          return;
        }
        const lockId =
          typeof lockData?.lock_id === "string" ? lockData.lock_id.trim() : "";
        if (cancelled || !lockId) return;
        lockSucceeded = true;
        confirmPriceLockAttemptedRef.current = lockAttemptKey;
        setPriceLockId(lockId);
        const lockedTotal = Number(lockData?.breakdown?.customerTotal);
        if (Number.isFinite(lockedTotal) && lockedTotal > 0) {
          setLockedCustomerTotal(lockedTotal);
        }
        const confirmBreakdown = customerPriceLockFromQuoteBreakdown(
          lockData?.breakdown,
        );
        if (confirmBreakdown) {
          setCustomerPriceLockBreakdown(confirmBreakdown);
        }
        const breakdown = lockData?.breakdown as
          | Record<string, unknown>
          | undefined;
        if (breakdown) {
          const lockedServicePrice = roundMoney(
            Number(breakdown.customerServicePrice) || 0,
          );
          const lockedTotalRounded = roundMoney(
            Number(breakdown.customerTotal) || 0,
          );
          if (lockedServicePrice > 0 && lockedTotalRounded > 0) {
            setActiveBookingQuote({
              serviceId: pricingServiceId,
              customerServicePrice: lockedServicePrice,
              deliveryFee: roundMoney(Number(breakdown.deliveryFee) || 0),
              addonsCustomerTotal: roundMoney(
                Number(breakdown.addonsCustomerTotal) || 0,
              ),
              customerTotal: lockedTotalRounded,
            });
          }
        }
        if (!cancelled && lockSucceeded) {
          setPriceLockPhase("ready");
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      } catch {
        // quote fallback remains for display; book requires priceLockId
      } finally {
        if (!cancelled) {
          setPriceLockLoading(false);
          endMarketCalculating();
          setPriceLockPhase((prev) =>
            lockSucceeded ? "ready" : prev === "ready" ? "ready" : "idle",
          );
        }
      }
    };

    void lockOnConfirm();
    return () => {
      cancelled = true;
      endMarketCalculating();
      setPriceLockPhase("idle");
    };
  }, [
    userMode,
    step,
    priceLockId,
    selectedStyle,
    selectedAddons,
    mode,
    pricingAreaKey,
    customerLoc?.lat,
    customerLoc?.lng,
    hasSupabase,
    supabase,
    beginMarketCalculating,
    endMarketCalculating,
  ]);

  // Search timer effect
  useEffect(() => {
    if (step === "searching") {
      const interval = setInterval(() => {
        setSearchTimer((prev) => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setSearchTimer(0);
    }
  }, [step]);

  const proceedWithBooking = async () => {
    if (!selectedStyle) return;
    const pricingServiceId = bookingPricingServiceId(selectedStyle);
    setMatchError(null);

    setIsMatching(true);
    setStep("searching");
    try {
      if (!hasSupabase) {
        throw new Error("Supabase is not configured");
      }
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error(loginToBookCopy(language === "en"));
      }

      let finalPos: LatLng | null = customerLoc;
      if (!finalPos) {
        const allowLocation = window.confirm(
          language === "en"
            ? "Location is required to confirm booking and find nearby providers. Allow location access?"
            : "Lokasjon kreves for a bekrefte booking og finne tilbydere i narheten. Tillat lokasjonstilgang?",
        );
        if (!allowLocation) {
          throw new Error(
            language === "en"
              ? "Location permission is required to confirm booking."
              : "Lokasjonstilgang kreves for a bekrefte booking.",
          );
        }
        if (!("geolocation" in navigator)) {
          throw new Error(
            language === "en"
              ? "Geolocation is not available in this browser."
              : "Geolokasjon er ikke tilgjengelig i denne nettleseren.",
          );
        }
        const freshPos = await new Promise<LatLng | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
          );
        });
        const fallbackPos =
          geoloc?.lat != null && geoloc?.lng != null ? geoloc : null;
        finalPos = freshPos ?? fallbackPos;
      }
      if (!finalPos) {
        throw new Error(
          language === "en"
            ? "We could not read your location. Add a default location in your profile or allow location access."
            : "Vi kunne ikke lese lokasjonen din. Legg til standardlokasjon i profilen eller gi tilgang til lokasjon.",
        );
      }
      const lat = finalPos.lat;
      const lng = finalPos.lng;

      const addonSelections = selectedAddons
        .map((id) => {
          const addon = currentAddons.find((a) => a.id === id);
          if (!addon) return null;
          return {
            catalog_id: addon.id,
            name: addon.name,
            price: addon.price,
            extra_minutes: addon.time,
          };
        })
        .filter(Boolean) as {
        catalog_id: string;
        name: string;
        price: number;
        extra_minutes: number;
      }[];

      if (!priceLockId) {
        throw new Error(
          language === "en"
            ? "Price is still being calculated. Please wait a moment."
            : "Prisen beregnes fortsatt. Vent et oyeblikk.",
        );
      }

      const bookRes = await fetch("/api/orders/book", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          service_id: pricingServiceId,
          delivery_mode: mode === "home" ? "home" : "at_provider",
          customer_lat: lat,
          customer_lng: lng,
          price_lock_id: priceLockId,
          addon_selections: addonSelections,
        }),
      });
      const bookData = await bookRes.json();
      if (!bookRes.ok) {
        const apiError = String(bookData?.error || "").trim();
        const lockInvalid =
          apiError === "PRICE_LOCK_EXPIRED" ||
          apiError === "PRICE_LOCK_CONSUMED" ||
          apiError === "PRICE_LOCK_NOT_FOUND";
        if (lockInvalid) {
          clearBookingLockState();
          throw new Error(
            language === "en"
              ? "Price lock expired. Recalculating price, please confirm again."
              : "Prislåsen utløp. Vi beregner pris på nytt, bekreft igjen.",
          );
        }
        throw new Error(
          mapAuthGateCopy(apiError || "Could not create order", language === "en"),
        );
      }
      if (bookData?.order_id) {
        const newOrderId = String(bookData.order_id);
        inactiveLocationOrderIdsRef.current.delete(newOrderId);
        setOrderId(newOrderId);
        if (process.env.NODE_ENV === "development") {
          console.info(
            "[booking] POST /api/orders/book → order_id:",
            newOrderId,
          );
        }
      }

      if (!bookData?.order_id) {
        throw new Error(
          language === "en"
            ? "Could not create order"
            : "Kunne ikke opprette ordre",
        );
      }

      const abortOfferSearch = async (oid: string) => {
        try {
          await fetch("/api/orders/abort-search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ order_id: oid }),
          });
        } catch {
          // best-effort cleanup
        }
      };

      const startOrderRealtimeWait = async () => {
        const orderId = String(bookData.order_id);
        const startedAt = Date.now();
        const maxWaitMs = 5 * 60_000;
        let statusPollInFlight = false;
        let lastStatusPollAt = 0;

        const hydrateOnce = async (opts?: { force?: boolean }) => {
          const now = Date.now();
          if (
            statusPollInFlight ||
            (!opts?.force &&
              now - lastStatusPollAt < CUSTOMER_SEARCH_STATUS_POLL_MS)
          ) {
            return false;
          }
          statusPollInFlight = true;
          lastStatusPollAt = now;
          try {
            const statusRes = await fetch(
              `/api/orders/status?order_id=${encodeURIComponent(orderId)}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: "no-store",
              },
            );
            const statusData = await statusRes.json().catch(() => ({}));
            if (!statusRes.ok) {
              throw new Error(
                statusData?.error || "Could not check order status",
              );
            }
            const orderStatus = String(statusData?.order?.status || "");
            const providerData = statusData?.provider;
            if (orderStatus === "assigned" && providerData && providerData.id) {
              const resolved = resolveCustomerProviderFromStatus(
                providerData,
                language,
                APP_MODES[appMode].codePrefix,
              );
              setMatchedProviders([resolved]);
              setProvider(resolved);
              const statusBreakdown = customerPriceLockFromApiPricing(
                statusData?.pricing,
              );
              let matchedTotal = 0;
              if (statusBreakdown) {
                setCustomerPriceLockBreakdown(statusBreakdown);
                matchedTotal = customerMatchedOrderTotal(
                  statusBreakdown,
                  Number(statusData?.order?.price) || 0,
                  mode,
                  resolved.distanceKm,
                );
                if (matchedTotal > 0) {
                  setLockedCustomerTotal(matchedTotal);
                }
              }
              setStatus("assigned");
              setStep("matched");
              setIsMatching(false);
              customerMatchedSheetOpenedRef.current = true;
              setIsBottomSheetCompressed(false);
              if (mode === "home") {
                await hydrateCustomerOrderDestination(orderId);
                refreshCustomerDrivingRoute();
              }
              return true;
            }
            if (orderStatus === "cancelled") {
              throw new Error(
                language === "en"
                  ? "No providers available right now. Please try again."
                  : "Ingen tilbydere tilgjengelig akkurat na. Vennligst prov igjen.",
              );
            }
            return false;
          } finally {
            statusPollInFlight = false;
          }
        };

        const applyAssignedOptimistic = (row: Record<string, unknown>) => {
          const providerId = String(row.provider_id || "").trim();
          if (!providerId) return;
          const placeholder = resolveCustomerProviderFromStatus(
            { id: providerId },
            language,
            APP_MODES[appMode].codePrefix,
          );
          setMatchedProviders([placeholder]);
          setProvider((prev) => ({
            ...placeholder,
            code: prev?.code || placeholder.code,
          }));
          setStatus("assigned");
          setStep("matched");
          setIsMatching(false);
          customerMatchedSheetOpenedRef.current = true;
          setIsBottomSheetCompressed(false);
        };

        if (await hydrateOnce()) return;

        await new Promise<void>((resolve, reject) => {
          let done = false;
          let pollId: ReturnType<typeof setInterval> | null = null;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          let tryMatchTimer: ReturnType<typeof setTimeout> | null = null;

          const onFocus = () => void tryMatch({ force: true });
          const onOnline = () => void tryMatch({ force: true });

          const finish = (err?: unknown) => {
            if (done) return;
            done = true;
            if (pollId) clearInterval(pollId);
            if (tryMatchTimer) clearTimeout(tryMatchTimer);
            if (timeoutId) clearTimeout(timeoutId);
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("online", onOnline);
            document.removeEventListener("visibilitychange", onFocus);
            orderChannelRef.current?.unsubscribe?.();
            orderChannelRef.current = null;
            if (err) reject(err);
            else resolve();
          };
          const tryMatch = (opts?: { force?: boolean }) => {
            if (opts?.force && tryMatchTimer) {
              clearTimeout(tryMatchTimer);
              tryMatchTimer = null;
            }
            if (tryMatchTimer) return;
            const delayMs = opts?.force ? 0 : 250;
            tryMatchTimer = setTimeout(() => {
              tryMatchTimer = null;
              void (async () => {
                try {
                  if (await hydrateOnce(opts)) finish();
                } catch (e) {
                  finish(e);
                }
              })();
            }, delayMs);
          };

          void tryMatch();
          pollId = setInterval(() => {
            tryMatch();
          }, CUSTOMER_SEARCH_STATUS_POLL_MS);

          timeoutId = setTimeout(
            async () => {
              try {
                await abortOfferSearch(orderId);
              } finally {
                finish(
                  new Error(
                    language === "en"
                      ? "No providers available right now. Please try again."
                      : "Ingen tilbydere tilgjengelig akkurat na. Vennligst prov igjen.",
                  ),
                );
              }
            },
            Math.max(0, maxWaitMs - (Date.now() - startedAt)),
          );

          window.addEventListener("focus", onFocus);
          window.addEventListener("online", onOnline);
          document.addEventListener("visibilitychange", onFocus);

          const ch = supabase
            .channel(`order-${orderId}`)
            .on(
              "postgres_changes",
              {
                event: "UPDATE",
                schema: "public",
                table: "orders",
                filter: `id=eq.${orderId}`,
              },
              (payload: any) => {
                const row = payload?.new;
                const st = String(row?.status || "");
                if (st === "assigned") {
                  applyAssignedOptimistic(row);
                  void tryMatch({ force: true });
                } else if (st === "cancelled") {
                  finish(
                    new Error(
                      language === "en"
                        ? "No providers available right now. Please try again."
                        : "Ingen tilbydere tilgjengelig akkurat na. Vennligst prov igjen.",
                    ),
                  );
                }
              },
            )
            .subscribe((s: any) => {
              if (String(s) === "SUBSCRIBED") {
                setOrderRealtimeState("connected");
                void tryMatch({ force: true });
              } else if (
                String(s) === "CHANNEL_ERROR" ||
                String(s) === "TIMED_OUT" ||
                String(s) === "CLOSED"
              ) {
                setOrderRealtimeState("reconnecting");
                void tryMatch({ force: true });
              }
            });

          orderChannelRef.current = ch;
        });
      };

      await startOrderRealtimeWait();
    } catch (e) {
      const message = mapAuthGateCopy(
        e instanceof Error ? e.message : "Could not match providers",
        language === "en",
      );
      const noProviderError =
        message.includes("No providers available right now") ||
        message.includes("Ingen tilbydere tilgjengelig akkurat na");
      if (noProviderError) {
        clearBookingLockState();
        setOrderId(null);
      }
      setMatchError(message);
      setStep((prev) =>
        prev === "matched" || prev === "in_service" ? prev : "confirm",
      );
    } finally {
      setIsMatching(false);
    }
  };

  const handleConfirmBooking = async () => {
    if (!selectedStyle) return;
    if (!priceLockId) {
      setMatchError(
        language === "en"
          ? "Price is still being calculated. Please wait a moment."
          : "Prisen beregnes fortsatt. Vent et oyeblikk.",
      );
      return;
    }

    const stripePaymentsEnabled = Boolean(
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    );

    if (stripePaymentsEnabled && hasSupabase) {
      setBookingPaymentPreparing(true);
      setMatchError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) {
          throw new Error(loginToBookCopy(language === "en"));
        }
        await runBookingPaymentFlow({
          accessToken,
          priceLockId,
          paymentMethod,
          serviceLabel: selectedStyle.name,
          noCardMessage:
            language === "en"
              ? "Add a card under Payment in the menu first."
              : "Legg til et kort under Betaling i menyen først.",
          applePayUnavailableMessage:
            language === "en"
              ? "Apple Pay is not available. Choose Card instead."
              : "Apple Pay er ikke tilgjengelig. Velg Kort i stedet.",
        });
        await proceedWithBooking();
      } catch (err) {
        setMatchError(
          mapAuthGateCopy(
            err instanceof Error
              ? err.message
              : language === "en"
                ? "Payment failed"
                : "Betaling mislyktes",
            language === "en",
          ),
        );
      } finally {
        setBookingPaymentPreparing(false);
      }
      return;
    }

    await proceedWithBooking();
  };

  // Provider: Countdown from when the offer sheet is shown (full 60s to decide).
  useEffect(() => {
    if (providerJobStep !== "incoming") return;

    const tick = () => {
      const seconds = offerCountdownSeconds(incomingOfferExpiresAtRef.current);
      setIncomingRequestTimer(seconds);
      if (seconds <= 0) {
        const expiredId = providerIncomingOfferRef.current?.offerId;
        if (expiredId) {
          offerHydrationKeysRef.current.delete(expiredId);
          clearProviderOfferDisplayExpiresAt(
            PROVIDER_INCOMING_TIMER_STORAGE_PREFIX,
            expiredId,
          );
        }
        setProviderIncomingOffer(null);
        incomingOfferExpiresAtRef.current = null;
        setProviderReadyForNext(false);
        setProviderJobStep("waiting");
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [providerJobStep, providerIncomingOffer?.offerId]);

  // Provider: Drive timer when enroute (pausable)
  useEffect(() => {
    if (providerJobStep !== "enroute") return;
    const interval = setInterval(() => {
      if (!providerDrivingPausedRef.current) {
        setProviderDriveTimer((prev) => prev + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [providerJobStep]);

  // Provider: Service timer when in_service (pausable) — fallback until started_at is set.
  useEffect(() => {
    if (providerJobStep !== "in_service") return;
    if (providerServiceStartedAt) return;
    const interval = setInterval(() => {
      if (!providerServicePausedRef.current) {
        setProviderServiceTimer((prev) => prev + 1);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [providerJobStep, providerServiceStartedAt]);

  // Reset the "ready for next request" flag whenever a new job begins or
  // the previous one ends, so the button is fresh per-job.
  useEffect(() => {
    if (providerJobStep !== "in_service") {
      setProviderReadyForNext(false);
      setProviderServiceStartedAt(null);
      setProviderServicePausedAt(null);
      setProviderServicePausedTotalSeconds(0);
    }
  }, [providerJobStep]);

  // Provider: tick elapsed-time clock for the full in-service step (independent of ready-for-next).
  useEffect(() => {
    if (providerJobStep !== "in_service") return;
    if (providerServicePaused) return;
    const id = setInterval(() => setProviderClockMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [providerJobStep, providerServicePaused]);

  // Customer: tick clock during in-service for elapsed-time display
  useEffect(() => {
    if (step !== "in_service") return;
    if (servicePausedAt) return;
    const id = setInterval(() => setLiveClockMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [step, servicePausedAt]);

  const serviceElapsedSeconds = useMemo(() => {
    return computeServiceElapsedSeconds(
      serviceStartedAt,
      servicePausedAt,
      servicePausedTotalSeconds,
      liveClockMs,
    );
  }, [
    serviceStartedAt,
    servicePausedAt,
    servicePausedTotalSeconds,
    liveClockMs,
  ]);

  const serviceTypicalDurationMin = useMemo(() => {
    const fromOrder = customerTypicalDurationMin;
    const fromStyle = selectedStyle?.duration;
    if (Number.isFinite(fromOrder) && fromOrder > 0) return fromOrder;
    if (Number.isFinite(fromStyle) && fromStyle! > 0) return fromStyle!;
    return 30;
  }, [customerTypicalDurationMin, selectedStyle?.duration]);

  const serviceTimeProgressPct = useMemo(() => {
    const typicalSec = Math.max(60, serviceTypicalDurationMin * 60);
    return Math.min(100, (serviceElapsedSeconds / typicalSec) * 100);
  }, [serviceElapsedSeconds, serviceTypicalDurationMin]);

  const customerEstimatedDurationLabel = useMemo(
    () =>
      language === "en"
        ? `Estimated duration: ${serviceTypicalDurationMin} min`
        : `Estimert varighet: ${serviceTypicalDurationMin} min`,
    [language, serviceTypicalDurationMin],
  );

  const providerTypicalDurationMin = useMemo(() => {
    const fromService = Number(mockIncomingRequest?.service?.duration);
    if (Number.isFinite(fromService) && fromService > 0) return fromService;
    return 30;
  }, [mockIncomingRequest?.service?.duration]);

  const providerElapsedSeconds = useMemo(() => {
    if (providerServiceStartedAt) {
      return computeServiceElapsedSeconds(
        providerServiceStartedAt,
        providerServicePausedAt,
        providerServicePausedTotalSeconds,
        providerClockMs,
      );
    }
    if (providerJobStep === "in_service") {
      return providerServiceTimer;
    }
    return 0;
  }, [
    providerJobStep,
    providerServiceTimer,
    providerServiceStartedAt,
    providerServicePausedAt,
    providerServicePausedTotalSeconds,
    providerClockMs,
  ]);

  const providerElapsedTime = useMemo(
    () => formatMmSs(providerElapsedSeconds),
    [providerElapsedSeconds],
  );

  const providerEstimatedDurationLabel = useMemo(
    () =>
      language === "en"
        ? `Estimated duration: ${providerTypicalDurationMin} min`
        : `Estimert varighet: ${providerTypicalDurationMin} min`,
    [language, providerTypicalDurationMin],
  );

  const providerInServiceReadyUnlocked = useMemo(
    () =>
      providerJobStep === "in_service" &&
      isReadyForNextUnlocked(
        providerServiceStartedAt,
        providerTypicalDurationMin,
        providerClockMs,
      ),
    [
      providerJobStep,
      providerServiceStartedAt,
      providerTypicalDurationMin,
      providerClockMs,
    ],
  );

  /** ON immediately at halfway unless the provider opted out; API syncs in background. */
  const providerReadyForNextToggleOn = useMemo(() => {
    if (providerHeldNextJob) return false;
    if (providerReadyForNextOptOutRef.current) {
      return providerReadyForNext;
    }
    return (
      providerReadyForNext ||
      (providerJobStep === "in_service" && providerInServiceReadyUnlocked)
    );
  }, [
    providerHeldNextJob,
    providerReadyForNext,
    providerJobStep,
    providerInServiceReadyUnlocked,
    providerClockMs,
  ]);

  useEffect(() => {
    customerOrderStatusContextRef.current = {
      language,
      appMode,
      mode,
      selectedStyleDuration: selectedStyle?.duration,
      hydrateCustomerOrderDestination,
      refreshCustomerDrivingRoute,
    };
  }, [
    language,
    appMode,
    mode,
    selectedStyle?.duration,
    hydrateCustomerOrderDestination,
    refreshCustomerDrivingRoute,
  ]);

  // Customer: follow order status after match (searching is handled by book flow).
  useEffect(() => {
    if (!hasSupabase || !orderId) return;
    if (step !== "matched" && step !== "in_service") return;

    let cancelled = false;
    let statusPollInFlight = false;
    let lastStatusPollAt = 0;
    let lastAppliedDbStatus = "";

    const applyStatus = (payload: {
      status?: string;
      started_at?: string | null;
      service_paused_at?: string | null;
      service_paused_total_seconds?: number | null;
      service_duration_minutes?: number | null;
      provider?: Record<string, unknown> | null;
      pricing?: Record<string, unknown> | null;
      payment?: {
        charged_amount_kr?: number | null;
      } | null;
    }) => {
      const ctx = customerOrderStatusContextRef.current;
      const st = String(payload.status || "");
      if (st) lastAppliedDbStatus = st;
      if (payload.started_at) {
        setServiceStartedAt(String(payload.started_at));
      }
      if ("service_paused_at" in payload) {
        const pausedAt = payload.service_paused_at
          ? String(payload.service_paused_at)
          : null;
        setServicePausedAt(pausedAt);
        if (pausedAt) {
          setLiveClockMs(Date.now());
        }
      }
      if ("service_paused_total_seconds" in payload) {
        const total = Number(payload.service_paused_total_seconds);
        if (Number.isFinite(total) && total >= 0) {
          setServicePausedTotalSeconds(total);
        }
      }
      const dur = Number(payload.service_duration_minutes);
      if (Number.isFinite(dur) && dur > 0) {
        setCustomerTypicalDurationMin(dur);
      } else if (ctx.selectedStyleDuration) {
        setCustomerTypicalDurationMin(ctx.selectedStyleDuration);
      }
      if (st === "completed") {
        setStep("rating");
        setStatus("completed");
        return;
      }
      const flow = customerFlowFromOrderStatus(st);
      if (flow) {
        setStep(flow.step);
        setStatus(flow.status);
        if (flow.step === "matched" && !customerMatchedSheetOpenedRef.current) {
          customerMatchedSheetOpenedRef.current = true;
          setIsBottomSheetCompressed(false);
        }
      }
      if (payload.provider?.id) {
        const resolved = resolveCustomerProviderFromStatus(
          payload.provider as Record<string, unknown>,
          ctx.language,
          APP_MODES[ctx.appMode].codePrefix,
        );
        setMatchedProviders([resolved]);
        setProvider((prev) => ({
          ...resolved,
          code: prev?.code || resolved.code,
          avatarUrl: resolved.avatarUrl ?? prev?.avatarUrl ?? null,
        }));
      }
      const statusBreakdown = customerPriceLockFromApiPricing(payload.pricing);
      let statusMatchedTotal = 0;
      if (statusBreakdown) {
        setCustomerPriceLockBreakdown(statusBreakdown);
        const providerKm = readProviderDistanceKm(payload.provider);
        statusMatchedTotal = customerMatchedOrderTotal(
          statusBreakdown,
          0,
          ctx.mode,
          providerKm,
        );
        if (statusMatchedTotal > 0) {
          setLockedCustomerTotal(statusMatchedTotal);
        }
      }
      if (
        ctx.mode === "home" &&
        orderId &&
        payload.provider?.id &&
        (st === "assigned" || st === "en_route")
      ) {
        void (async () => {
          const pin = await ctx.hydrateCustomerOrderDestination(orderId);
          if (pin) ctx.refreshCustomerDrivingRoute();
        })();
      }
    };

    const hydrate = async (opts?: { force?: boolean }) => {
      const now = Date.now();
      if (
        statusPollInFlight ||
        (!opts?.force &&
          now - lastStatusPollAt < CUSTOMER_ACTIVE_STATUS_POLL_MS)
      ) {
        return;
      }
      statusPollInFlight = true;
      lastStatusPollAt = now;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token || cancelled) return;
        const res = await fetch(
          `/api/orders/status?order_id=${encodeURIComponent(orderId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        applyStatus({
          status: data?.order?.status,
          started_at: data?.order?.started_at,
          service_paused_at: data?.order?.service_paused_at ?? null,
          service_paused_total_seconds:
            data?.order?.service_paused_total_seconds ?? 0,
          service_duration_minutes: data?.order?.service_duration_minutes,
          provider: data?.provider ?? null,
          pricing: data?.pricing ?? null,
          payment: data?.payment ?? null,
        });
      } catch {
        // best-effort
      } finally {
        statusPollInFlight = false;
      }
    };

    void hydrate();

    // Realtime `orders` UPDATEs are the live path; polling is the fallback.
    const poll = createAdaptivePoll({
      run: () => void hydrate(),
      fallbackMs: CUSTOMER_ACTIVE_STATUS_POLL_MS,
      connectedMs: REALTIME_SAFETY_POLL_MS,
    });

    const ch = supabase
      .channel(`customer-order-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload: { new?: Record<string, unknown> }) => {
          const row = payload?.new;
          if (!row) return;
          const dbStatus = String(row.status || "");
          const isTransition =
            Boolean(dbStatus) && dbStatus !== lastAppliedDbStatus;
          applyStatus({
            status: dbStatus,
            started_at: (row.started_at as string | null | undefined) ?? null,
            service_paused_at:
              (row.service_paused_at as string | null | undefined) ?? null,
            service_paused_total_seconds:
              (row.service_paused_total_seconds as number | null | undefined) ??
              null,
          });
          // Provider and pricing only change on a status transition, so skip
          // the extra status fetch for pause/resume and timer-only updates.
          if (isTransition) void hydrate({ force: true });
        },
      )
      .subscribe((channelStatus: string) => {
        if (channelStatus === "SUBSCRIBED") {
          poll.setRealtimeConnected(true);
        } else if (isRealtimeDownStatus(channelStatus)) {
          poll.setRealtimeConnected(false);
        }
      });

    return () => {
      cancelled = true;
      poll.stop();
      ch.unsubscribe();
    };
  }, [hasSupabase, orderId, step, supabase]);

  // Customer-side: live provider location for the active order.
  useEffect(() => {
    if (!hasSupabase) return;
    if (!orderId) return;
    if (userMode !== "customer") return;
    if (step !== "matched" && step !== "in_service") return;
    if (!customerUiStatusShowsProviderLiveLocation(status)) return;

    let cancelled = false;
    let hydrateInFlight = false;
    const applyRow = (row: any) => {
      const lat = Number(row?.lat);
      const lng = Number(row?.lng);
      if (cancelled || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      applyLiveProviderLocation({ lat, lng });
    };

    const hydrateOnce = async () => {
      if (cancelled || hydrateInFlight) return;
      hydrateInFlight = true;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token) {
          const res = await fetch(
            `/api/orders/provider-location?order_id=${encodeURIComponent(orderId)}`,
            {
              cache: "no-store",
              headers: { Authorization: `Bearer ${token}` },
            },
          );
          if (res.ok) {
            const body = await res.json().catch(() => ({}));
            const loc = body?.location;
            const lat = Number(loc?.lat);
            const lng = Number(loc?.lng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              applyRow({ lat, lng });
              return;
            }
          }
        }

        const { data, error } = await supabase
          .from("provider_realtime_locations")
          .select("lat,lng,recorded_at")
          .eq("order_id", orderId)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) applyRow(data);
      } catch {
        // best effort
      } finally {
        hydrateInFlight = false;
      }
    };
    void hydrateOnce();

    // The provider publishes GPS on the same cadence and every row lands on
    // this channel, so polling only needs to cover a dead channel.
    const poll = createAdaptivePoll({
      run: () => void hydrateOnce(),
      fallbackMs: LIVE_LOCATION_PUBLISH_MS,
      connectedMs: REALTIME_SAFETY_POLL_MS,
    });

    locChannelRef.current?.unsubscribe?.();
    const channel = supabase
      .channel(`order-location-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "provider_realtime_locations",
          filter: `order_id=eq.${orderId}`,
        },
        (payload: any) => {
          const row = payload?.new ?? payload?.old;
          if (row) applyRow(row);
        },
      )
      .subscribe((channelStatus: string) => {
        if (channelStatus === "SUBSCRIBED") {
          setOrderRealtimeState("connected");
          poll.setRealtimeConnected(true);
          void hydrateOnce();
        } else if (isRealtimeDownStatus(channelStatus)) {
          setOrderRealtimeState("reconnecting");
          poll.setRealtimeConnected(false);
        }
      });

    locChannelRef.current = channel;

    // `focus` and `visibilitychange` overlap; `runNow` also resets the timer.
    const onResume = () => {
      if (document.visibilityState === "hidden") return;
      poll.runNow();
    };
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);

    return () => {
      cancelled = true;
      poll.stop();
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      channel.unsubscribe();
      if (locChannelRef.current === channel) locChannelRef.current = null;
    };
  }, [
    hasSupabase,
    supabase,
    orderId,
    step,
    status,
    userMode,
    applyLiveProviderLocation,
  ]);

  // Fallback position for the publish loop, read through a ref so a moving GPS
  // watch does not tear down and restart the interval on every fix.
  const customerPublishFallbackRef = useRef<LatLng | null>(null);
  customerPublishFallbackRef.current = geoloc ?? customerSavedLocation;

  // Customer-side: publish live customer GPS for the active order.
  useEffect(() => {
    if (userMode !== "customer") return;
    if (!["matched", "in_service"].includes(step)) return;
    if (!customerUiStatusPublishesLiveLocation(status)) return;
    const activeOrderId = String(orderId || "");
    const activeCustomerId = String(loggedInUser?.id || "");
    if (!activeOrderId || !activeCustomerId) return;
    if (inactiveLocationOrderIdsRef.current.has(activeOrderId)) return;

    let cancelled = false;
    const send = () => {
      if (cancelled) return;
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (cancelled) return;
            const pos = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            setCustomerLivePosIfChanged(pos);
            void postCustomerLocation(
              activeOrderId,
              activeCustomerId,
              pos,
              position.coords.accuracy,
            );
          },
          () => {
            const fallback = customerPublishFallbackRef.current;
            if (fallback) {
              setCustomerLivePosIfChanged(fallback);
              void postCustomerLocation(
                activeOrderId,
                activeCustomerId,
                fallback,
              );
            }
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
        );
      } else {
        const fallback = customerPublishFallbackRef.current;
        if (fallback) {
          setCustomerLivePosIfChanged(fallback);
          void postCustomerLocation(activeOrderId, activeCustomerId, fallback);
        }
      }
    };

    send();
    const intervalId = window.setInterval(send, LIVE_LOCATION_PUBLISH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    userMode,
    step,
    status,
    orderId,
    loggedInUser?.id,
    postCustomerLocation,
    setCustomerLivePosIfChanged,
  ]);

  // Provider-side: subscribe to customer live location for the active order.
  useEffect(() => {
    if (!hasSupabase) return;
    if (userMode !== "provider") return;
    if (
      !["accepted", "enroute", "arrived", "in_service"].includes(
        providerJobStep,
      )
    ) {
      return;
    }
    const activeOrderId = String(mockIncomingRequest?.orderId || "");
    if (!activeOrderId) return;

    let cancelled = false;
    const applyCustomerLocation = (row: any) => {
      const lat = Number(row?.lat);
      const lng = Number(row?.lng);
      if (cancelled || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setCustomerLivePosIfChanged({ lat, lng });
    };

    const hydrateOnce = async () => {
      try {
        const { data, error } = await supabase
          .from("customer_realtime_locations")
          .select("lat,lng,recorded_at")
          .eq("order_id", activeOrderId)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) applyCustomerLocation(data);
      } catch {
        // best effort
      }
    };
    void hydrateOnce();

    customerLocChannelRef.current?.unsubscribe?.();
    const channel = supabase
      .channel(`customer-location-${activeOrderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "customer_realtime_locations",
          filter: `order_id=eq.${activeOrderId}`,
        },
        (payload: any) => applyCustomerLocation(payload?.new),
      )
      .subscribe();

    customerLocChannelRef.current = channel;

    const onFocus = () => void hydrateOnce();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      channel.unsubscribe();
      if (customerLocChannelRef.current === channel) {
        customerLocChannelRef.current = null;
      }
    };
  }, [
    hasSupabase,
    supabase,
    userMode,
    providerJobStep,
    mockIncomingRequest?.orderId,
    incomingCustomerLat,
    incomingCustomerLng,
    setCustomerLivePosIfChanged,
  ]);

  // Provider-side: publish GPS during en_route and in_progress only.
  useEffect(() => {
    if (userMode !== "provider") return;
    if (!providerJobStepPublishesLiveLocation(providerJobStep)) return;
    const activeOrderId = String(mockIncomingRequest?.orderId || "");
    const activeProviderId = String(loggedInUser?.id || "");
    if (!activeOrderId || !activeProviderId) return;

    let cancelled = false;
    const send = () => {
      if (cancelled) return;
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (cancelled) return;
            const pos = {
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            };
            setProviderPosIfChanged(pos);
            void postProviderLocation(
              activeOrderId,
              activeProviderId,
              pos,
              position.coords.accuracy,
            );
          },
          () => {
            if (geoloc) {
              setProviderPosIfChanged(geoloc);
              void postProviderLocation(
                activeOrderId,
                activeProviderId,
                geoloc,
              );
            }
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
        );
      } else if (geoloc) {
        setProviderPosIfChanged(geoloc);
        void postProviderLocation(activeOrderId, activeProviderId, geoloc);
      }
    };

    send();
    const intervalId = window.setInterval(send, LIVE_LOCATION_PUBLISH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    userMode,
    providerJobStep,
    mockIncomingRequest?.orderId,
    incomingCustomerLat,
    incomingCustomerLng,
    loggedInUser?.id,
    geoloc,
    postProviderLocation,
    setProviderPosIfChanged,
  ]);

  // Provider home delivery: load booked customer coords from server (same source as dispatch).
  useEffect(() => {
    if (userMode !== "provider") return;
    if (
      !["accepted", "enroute", "arrived", "in_service"].includes(
        providerJobStep,
      )
    ) {
      return;
    }
    if (mockIncomingRequest?.mode !== "home") return;
    const activeOrderId = String(mockIncomingRequest?.orderId || "");
    if (!activeOrderId) return;

    let cancelled = false;
    const run = async () => {
      const prevDelivery = providerOrderDeliveryPinRef.current;
      const prevShop = providerOrderProviderPinRef.current;
      const pin = await hydrateProviderOrderDeliveryPin(activeOrderId);
      if (cancelled || !pin) return;
      const shop = providerOrderProviderPinRef.current;
      if (!isSameLatLng(prevDelivery, pin) || !isSameLatLng(prevShop, shop)) {
        refreshProviderDrivingRoute();
        setFitKey2((k) => k + 1);
      }
    };

    void run();
    const intervalId = window.setInterval(() => void run(), 30_000);
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [
    userMode,
    providerJobStep,
    mockIncomingRequest?.orderId,
    mockIncomingRequest?.mode,
    hydrateProviderOrderDeliveryPin,
    refreshProviderDrivingRoute,
  ]);

  useEffect(() => {
    if (userMode !== "provider") return;
    if (mockIncomingRequest?.mode !== "home") return;
    if (
      !["accepted", "enroute", "arrived", "in_service"].includes(
        providerJobStep,
      )
    ) {
      return;
    }
    if (!providerOrderDeliveryPin && !mockIncomingRequest?.customerLocation) {
      return;
    }
    refreshProviderDrivingRoute();
  }, [
    userMode,
    providerOrderDeliveryPin,
    providerOrderProviderPin,
    mockIncomingRequest?.mode,
    mockIncomingRequest?.customerLocation,
    providerJobStep,
    refreshProviderDrivingRoute,
  ]);

  // Customer home delivery: load booked coords + provider shop from server.
  useEffect(() => {
    if (userMode !== "customer") return;
    if (mode !== "home") return;
    if (!orderId) return;
    if (step !== "matched" && step !== "in_service") return;

    let cancelled = false;
    const run = async () => {
      const pin = await hydrateCustomerOrderDestination(orderId);
      if (cancelled || !pin) return;
      refreshCustomerDrivingRoute();
    };

    void run();
    const intervalId = window.setInterval(() => void run(), 30_000);
    const onFocus = () => void run();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [
    userMode,
    mode,
    orderId,
    step,
    hydrateCustomerOrderDestination,
    refreshCustomerDrivingRoute,
  ]);

  useEffect(() => {
    if (userMode !== "customer") return;
    if (mode !== "home") return;
    if (!orderId) return;
    if (step !== "matched" && step !== "in_service") return;
    if (!["assigned", "enroute", "arrived", "in_service"].includes(status)) {
      return;
    }
    if (!customerOrderDeliveryPin || !customerOrderProviderBasePin) return;
    refreshCustomerDrivingRoute();
  }, [
    userMode,
    mode,
    orderId,
    step,
    status,
    customerOrderDeliveryPin,
    customerOrderProviderBasePin,
    refreshCustomerDrivingRoute,
  ]);

  // Customer home delivery: zoom to delivery pin when provider arrives.
  useEffect(() => {
    if (userMode !== "customer") return;
    if (mode !== "home") return;
    if (status !== "arrived" && status !== "in_service") return;
    if (routeReadyKeyRef.current) {
      setFitKey2((k) => k + 1);
      return;
    }
    refreshCustomerDrivingRoute();
    setFitKey2((k) => k + 1);
  }, [userMode, mode, status, refreshCustomerDrivingRoute]);

  const clearBookingLockState = () => {
    setPriceLockId(null);
    setPriceLockLoading(false);
    confirmPriceLockAttemptedRef.current = null;
    setLockedCustomerTotal(null);
    setCustomerPriceLockBreakdown(null);
    setBookingPaymentPreparing(false);
    setPriceLockPhase("idle");
  };

  const clearBookingPricingState = () => {
    clearBookingLockState();
    setActiveBookingQuote(null);
    bookingQuoteLastFetchKeyRef.current = null;
  };

  const resetAll = () => {
    clearBookingPricingState();
    setStep("map");
    setStatus("searching");
    setSelectedStyle(null);
    setExpandedStyleId(null);
    setSelectedAddons([]);
    setOrderId(null);
    inactiveLocationOrderIdsRef.current.clear();
    setMatchError(null);
    setIsMatching(false);
    setProvider(null);
    setMatchedProviders([]);
    setProviderPos(null);
    setCustomerLivePos(null);
    setProviderOrderDeliveryPin(null);
    providerOrderDeliveryPinRef.current = null;
    setProviderOrderProviderPin(null);
    providerOrderProviderPinRef.current = null;
    providerMatchDistanceKmRef.current = null;
    setCustomerOrderDeliveryPin(null);
    customerOrderDeliveryPinRef.current = null;
    setCustomerOrderProviderBasePin(null);
    customerOrderProviderBasePinRef.current = null;
    customerOrderMatchKmRef.current = null;
    lastRouteFromRef.current = null;
    lastRouteToRef.current = null;
    routeReadyKeyRef.current = null;
    setRoute(null);
    setSearchTimer(0);
    setServiceStartedAt(null);
    setServicePausedAt(null);
    setServicePausedTotalSeconds(0);
    setCustomerTypicalDurationMin(30);
    setUserRating(0);
    customerMatchedSheetOpenedRef.current = false;
    setIsBottomSheetCompressed(false);
    orderChannelRef.current?.unsubscribe?.();
    locChannelRef.current?.unsubscribe?.();
    customerLocChannelRef.current?.unsubscribe?.();
    if (orderPollTimerRef.current) {
      clearTimeout(orderPollTimerRef.current);
      orderPollTimerRef.current = null;
    }
    orderChannelRef.current = null;
    locChannelRef.current = null;
    customerLocChannelRef.current = null;
  };

  const submitCustomerRating = async () => {
    if (!orderId || userRating < 1 || ratingSubmitting) return;
    setRatingSubmitting(true);
    try {
      if (hasSupabase) {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token) {
          await fetch("/api/ratings/create", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              order_id: orderId,
              rating: userRating,
            }),
          });
        }
      }
      resetAll();
    } finally {
      setRatingSubmitting(false);
    }
  };

  const exitSearching = async () => {
    const oid = orderId;
    if (oid && hasSupabase) {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (token) {
          await fetch("/api/orders/abort-search", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ order_id: oid }),
          });
        }
      } catch {
        // best-effort
      }
    }
    resetAll();
  };

  const persistStartService = async (): Promise<boolean> => {
    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) {
      setAuthError(
        language === "en" ? "Missing order details" : "Mangler ordredetaljer",
      );
      return false;
    }
    try {
      const res = await fetch("/api/orders/start_service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: oid, provider_id: pid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setAuthError(
          data?.error ||
            (language === "en"
              ? "Could not start service"
              : "Kunne ikke starte tjeneste"),
        );
        return false;
      }
      const startedIso =
        typeof data?.started_at === "string"
          ? data.started_at
          : new Date().toISOString();
      setProviderServiceStartedAt(startedIso);
      setProviderClockMs(Date.now());
      setProviderReadyForNext(false);
      return true;
    } catch (e) {
      setAuthError(
        e instanceof Error
          ? e.message
          : language === "en"
            ? "Could not start service"
            : "Kunne ikke starte tjeneste",
      );
      return false;
    }
  };

  const toggleProviderServicePause = useCallback(async () => {
    const nextPaused = !providerServicePaused;
    const previousPausedAt = providerServicePausedAt;
    const previousPausedTotal = providerServicePausedTotalSeconds;
    setProviderServicePaused(nextPaused);
    providerServicePausedRef.current = nextPaused;
    if (nextPaused) {
      setProviderServicePausedAt(new Date().toISOString());
      setProviderClockMs(Date.now());
    } else {
      setProviderServicePausedAt(null);
    }

    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) return;

    try {
      const res = await fetch("/api/orders/service-pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: oid,
          provider_id: pid,
          paused: nextPaused,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setProviderServicePaused(!nextPaused);
        providerServicePausedRef.current = !nextPaused;
        setProviderServicePausedAt(previousPausedAt);
        setProviderServicePausedTotalSeconds(previousPausedTotal);
        return;
      }
      const pausedAt =
        typeof data?.service_paused_at === "string"
          ? data.service_paused_at
          : null;
      const pausedTotal = Number(data?.service_paused_total_seconds);
      setProviderServicePausedAt(pausedAt);
      if (Number.isFinite(pausedTotal) && pausedTotal >= 0) {
        setProviderServicePausedTotalSeconds(pausedTotal);
      }
      if (!nextPaused) {
        setProviderClockMs(Date.now());
      }
    } catch {
      setProviderServicePaused(!nextPaused);
      providerServicePausedRef.current = !nextPaused;
      setProviderServicePausedAt(previousPausedAt);
      setProviderServicePausedTotalSeconds(previousPausedTotal);
    }
  }, [
    loggedInUser?.id,
    mockIncomingRequest?.orderId,
    providerServicePaused,
    providerServicePausedAt,
    providerServicePausedTotalSeconds,
  ]);

  const acceptProviderOffer = useCallback(
    async (offer: ProviderOfferCardPayload): Promise<boolean> => {
      if (!loggedInUser?.id || !offer?.offerId) return false;
      if (isAcceptingProviderOffer) return false;

      const offerId = offer.offerId;
      providerAcceptingOfferIdRef.current = offerId;
      setIsAcceptingProviderOffer(true);
      setProviderReadyForNext(false);
      setProviderJobStep("accepted");
      primeProviderHomeRouteFromOffer(offer);

      try {
        const res = await fetch("/api/orders/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer_id: offerId,
            provider_id: loggedInUser.id,
            offer_shown_at: (() => {
              const expiresMs = new Date(
                String(offer.expiresAt || ""),
              ).getTime();
              if (!Number.isFinite(expiresMs)) return null;
              return new Date(
                expiresMs - PROVIDER_OFFER_EXPIRES_MS,
              ).toISOString();
            })(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success !== true) {
          providerAcceptingOfferIdRef.current = null;
          setProviderJobStep("incoming");
          setAuthError(
            data?.error ||
              (language === "en"
                ? "Could not accept request"
                : "Kunne ikke akseptere foresporsel"),
          );
          return false;
        }

        clearProviderOfferDisplayExpiresAt(
          PROVIDER_INCOMING_TIMER_STORAGE_PREFIX,
          offerId,
        );
        await hydrateProviderOrderDeliveryPin(String(offer.orderId || ""));
        refreshProviderDrivingRoute();
        setFitKey2((k) => k + 1);
        providerAcceptingOfferIdRef.current = null;
        return true;
      } catch {
        providerAcceptingOfferIdRef.current = null;
        setProviderJobStep("incoming");
        setAuthError(
          language === "en"
            ? "Could not accept request"
            : "Kunne ikke akseptere foresporsel",
        );
        return false;
      } finally {
        setIsAcceptingProviderOffer(false);
      }
    },
    [
      isAcceptingProviderOffer,
      language,
      loggedInUser?.id,
      hydrateProviderOrderDeliveryPin,
      primeProviderHomeRouteFromOffer,
      refreshProviderDrivingRoute,
    ],
  );

  const persistReadyForNext = async (enabled: boolean): Promise<boolean> => {
    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) {
      setAuthError(
        language === "en" ? "Missing order details" : "Mangler ordredetaljer",
      );
      return false;
    }
    try {
      const res = await fetch("/api/orders/ready_for_next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: oid,
          provider_id: pid,
          enabled,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        if (enabled) {
          const errCode = String(data?.error || "");
          if (errCode === "TOO_EARLY") {
            const retrySec = Number(data?.retry_after_seconds);
            const waitLabel = Number.isFinite(retrySec)
              ? formatMmSs(retrySec)
              : formatMmSs(600);
            setAuthError(
              language === "en"
                ? `Please wait ${waitLabel} after starting the service before opting in.`
                : `Vent ${waitLabel} etter at du startet tjenesten før du melder deg klar.`,
            );
          } else {
            setAuthError(
              data?.error ||
                (language === "en"
                  ? "Could not update availability"
                  : "Kunne ikke oppdatere tilgjengelighet"),
            );
          }
        } else {
          setAuthError(
            data?.error ||
              (language === "en"
                ? "Could not update availability"
                : "Kunne ikke oppdatere tilgjengelighet"),
          );
        }
        return false;
      }
      setProviderReadyForNext(enabled);
      return true;
    } catch (e) {
      setAuthError(
        e instanceof Error
          ? e.message
          : language === "en"
            ? "Could not update availability"
            : "Kunne ikke oppdatere tilgjengelighet",
      );
      return false;
    }
  };

  useEffect(() => {
    if (providerJobStep !== "in_service") {
      providerReadyForNextAutoAttemptedRef.current = false;
      providerReadyForNextOptOutRef.current = false;
      return;
    }
    if (providerReadyForNextOptOutRef.current) return;
    if (providerHeldNextJob) return;
    if (!providerServiceStartedAt) return;
    if (
      !isReadyForNextUnlocked(
        providerServiceStartedAt,
        providerTypicalDurationMin,
        providerClockMs,
      )
    ) {
      return;
    }
    if (providerReadyForNextAutoAttemptedRef.current) return;
    providerReadyForNextAutoAttemptedRef.current = true;
    void (async () => {
      const ok = await persistReadyForNext(true);
      if (!ok) {
        providerReadyForNextAutoAttemptedRef.current = false;
        providerReadyForNextOptOutRef.current = true;
        setProviderReadyForNext(false);
      }
    })();
  }, [
    providerJobStep,
    providerServiceStartedAt,
    providerTypicalDurationMin,
    providerClockMs,
    providerHeldNextJob,
  ]);

  const handleReadyForNextToggle = useCallback(() => {
    if (!providerInServiceReadyUnlocked) return;
    if (providerHeldNextJob) return;

    if (providerReadyForNext) {
      providerReadyForNextOptOutRef.current = true;
      const wasReady = providerReadyForNext;
      setProviderReadyForNext(false);
      void (async () => {
        const ok = await persistReadyForNext(false);
        if (!ok) {
          providerReadyForNextOptOutRef.current = false;
          setProviderReadyForNext(wasReady);
        }
      })();
      return;
    }

    providerReadyForNextOptOutRef.current = false;
    setProviderReadyForNext(true);
    void (async () => {
      const ok = await persistReadyForNext(true);
      if (!ok) setProviderReadyForNext(false);
    })();
  }, [
    providerInServiceReadyUnlocked,
    providerReadyForNext,
    providerHeldNextJob,
    persistReadyForNext,
  ]);

  const persistCompleteService = useCallback(async (): Promise<boolean> => {
    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) {
      setAuthError(
        language === "en" ? "Missing order details" : "Mangler ordredetaljer",
      );
      return false;
    }
    try {
      const priceFinal = Number(mockIncomingRequest?.service?.price ?? 0);
      const res = await fetch("/api/rpc/complete_order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: oid,
          price_final: priceFinal,
          provider_id: pid,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok !== true) {
        setAuthError(
          data?.error ||
            (language === "en"
              ? "Could not complete order"
              : "Kunne ikke fullføre ordre"),
        );
        return false;
      }
      inactiveLocationOrderIdsRef.current.add(oid);
      return true;
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : language === "en"
            ? "Could not complete order"
            : "Kunne ikke fullføre ordre",
      );
      return false;
    }
  }, [language, loggedInUser?.id, mockIncomingRequest]);

  const beginProviderAction = useCallback((key: ProviderActionKey): boolean => {
    if (Date.now() < providerJobActionCooldownUntilRef.current) return false;
    const inFlight = providerActionsInFlightRef.current;
    if (inFlight.size > 0) return false;
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    setProviderActionLoading(key);
    return true;
  }, []);

  const endProviderAction = useCallback((key: ProviderActionKey) => {
    providerActionsInFlightRef.current.delete(key);
    setProviderActionLoading((cur) => (cur === key ? null : cur));
    providerJobActionCooldownUntilRef.current = Date.now() + 450;
  }, []);

  const scheduleProviderJobStep = useCallback((next: ProviderJobStep) => {
    window.setTimeout(() => setProviderJobStep(next), 80);
  }, []);

  const providerCanStartHeldNextJob =
    providerJobStep === "waiting" || providerJobStep === "completed";

  const handleStartHeldNextJob = useCallback(() => {
    const held = providerHeldNextJob;
    if (!held || !providerCanStartHeldNextJob) return;
    setProviderHeldNextJob(null);
    setShowProviderQueuedOfferSheet(false);
    setProviderQueuedIncomingOffer(null);
    setProviderIncomingOffer(held);
    if (held.customerLocation) setCustomerLivePos(held.customerLocation);
    setProviderReadyForNext(false);
    providerReadyForNextAutoAttemptedRef.current = false;
    providerReadyForNextOptOutRef.current = false;
    setProviderCustomerRating(0);
    setProviderDriveTimer(0);
    setProviderServiceTimer(0);
    setProviderDrivingPaused(false);
    providerDrivingPausedRef.current = false;
    setProviderServicePaused(false);
    providerServicePausedRef.current = false;
    setProviderServicePausedAt(null);
    setProviderServicePausedTotalSeconds(0);
    setProviderServiceStartedAt(null);
    setIsBottomSheetCompressed(false);
    setCurrentPage("main");
    scheduleProviderJobStep("accepted");
    primeProviderHomeRouteFromOffer(held);
    void hydrateProviderOrderDeliveryPin(String(held.orderId || "")).then(
      () => {
        refreshProviderDrivingRoute();
        setFitKey2((k) => k + 1);
      },
    );
  }, [
    providerHeldNextJob,
    providerCanStartHeldNextJob,
    primeProviderHomeRouteFromOffer,
    hydrateProviderOrderDeliveryPin,
    refreshProviderDrivingRoute,
    scheduleProviderJobStep,
  ]);

  const handleAcceptOffer = useCallback(() => {
    if (!beginProviderAction("accept")) return;
    if (!loggedInUser?.id || !mockIncomingRequest?.offerId) {
      endProviderAction("accept");
      return;
    }

    const prevStep = providerJobStepRef.current;
    const offer = mockIncomingRequest;

    providerAcceptingOfferIdRef.current = offer.offerId;
    setProviderReadyForNext(false);
    scheduleProviderJobStep("accepted");
    primeProviderHomeRouteFromOffer(offer);

    void (async () => {
      try {
        const res = await fetch("/api/orders/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            offer_id: offer.offerId,
            provider_id: loggedInUser.id,
            offer_shown_at: (() => {
              const expiresMs = new Date(
                String(offer.expiresAt || ""),
              ).getTime();
              if (!Number.isFinite(expiresMs)) return null;
              return new Date(
                expiresMs - PROVIDER_OFFER_EXPIRES_MS,
              ).toISOString();
            })(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.success !== true) {
          providerAcceptingOfferIdRef.current = null;
          setProviderJobStep(prevStep);
          setAuthError(
            data?.error ||
              (language === "en"
                ? "Could not accept request"
                : "Kunne ikke akseptere foresporsel"),
          );
          return;
        }
        providerAcceptingOfferIdRef.current = null;
        await hydrateProviderOrderDeliveryPin(String(offer.orderId || ""));
        refreshProviderDrivingRoute();
        setFitKey2((k) => k + 1);
      } catch {
        providerAcceptingOfferIdRef.current = null;
        setProviderJobStep(prevStep);
        setAuthError(
          language === "en"
            ? "Could not accept request"
            : "Kunne ikke akseptere foresporsel",
        );
      } finally {
        endProviderAction("accept");
      }
    })();
  }, [
    beginProviderAction,
    endProviderAction,
    language,
    loggedInUser?.id,
    mockIncomingRequest,
    hydrateProviderOrderDeliveryPin,
    primeProviderHomeRouteFromOffer,
    refreshProviderDrivingRoute,
    scheduleProviderJobStep,
  ]);

  const handleStartDriving = useCallback(() => {
    if (!beginProviderAction("start_driving")) return;
    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) {
      endProviderAction("start_driving");
      return;
    }

    const prevStep = providerJobStepRef.current;
    scheduleProviderJobStep("enroute");
    setProviderDriveTimer(0);
    // Release UI lock immediately — enroute step is already shown; async sync runs in background.
    endProviderAction("start_driving");

    void (async () => {
      await hydrateProviderOrderDeliveryPin(oid);
      refreshProviderDrivingRoute();
      setFitKey2((k) => k + 1);
      try {
        const ok = await postProviderTransition(oid, "en_route", pid);
        if (!ok && providerJobStepRef.current === "enroute") {
          setProviderJobStep(prevStep);
          toast.error(
            language === "en"
              ? "Could not start driving — try again"
              : "Kunne ikke starte kjoring — prov igjen",
          );
        }
      } catch {
        if (providerJobStepRef.current === "enroute") {
          setProviderJobStep(prevStep);
          toast.error(
            language === "en"
              ? "Could not start driving — try again"
              : "Kunne ikke starte kjoring — prov igjen",
          );
        }
      }
    })();
  }, [
    beginProviderAction,
    endProviderAction,
    language,
    loggedInUser?.id,
    mockIncomingRequest?.orderId,
    postProviderTransition,
    hydrateProviderOrderDeliveryPin,
    refreshProviderDrivingRoute,
    scheduleProviderJobStep,
  ]);

  const handleCustomerArrived = useCallback(() => {
    if (!beginProviderAction("customer_arrived")) return;
    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) {
      endProviderAction("customer_arrived");
      return;
    }

    const prevStep = providerJobStepRef.current;
    scheduleProviderJobStep("arrived");
    endProviderAction("customer_arrived");

    void (async () => {
      try {
        const ok = await postProviderTransition(oid, "arrived", pid);
        if (!ok) setProviderJobStep(prevStep);
      } catch {
        setProviderJobStep(prevStep);
      }
    })();
  }, [
    beginProviderAction,
    endProviderAction,
    loggedInUser?.id,
    mockIncomingRequest?.orderId,
    postProviderTransition,
    scheduleProviderJobStep,
  ]);

  const handleMarkArrived = useCallback(() => {
    if (!beginProviderAction("mark_arrived")) return;
    const oid = String(mockIncomingRequest?.orderId || "");
    const pid = String(loggedInUser?.id || "");
    if (!oid || !pid) {
      endProviderAction("mark_arrived");
      return;
    }

    const prevStep = providerJobStepRef.current;
    scheduleProviderJobStep("arrived");
    endProviderAction("mark_arrived");

    void (async () => {
      try {
        const ok = await postProviderTransition(oid, "arrived", pid);
        if (!ok) setProviderJobStep(prevStep);
      } catch {
        setProviderJobStep(prevStep);
      }
    })();
  }, [
    beginProviderAction,
    endProviderAction,
    loggedInUser?.id,
    mockIncomingRequest?.orderId,
    postProviderTransition,
    scheduleProviderJobStep,
  ]);

  const handleStartService = useCallback(() => {
    if (!beginProviderAction("start_service")) return;

    const prevStep = providerJobStepRef.current;
    scheduleProviderJobStep("in_service");
    const optimisticStartedAt = new Date().toISOString();
    setProviderServiceStartedAt(optimisticStartedAt);
    setProviderServiceTimer(0);
    setProviderServicePaused(false);
    setProviderServicePausedAt(null);
    setProviderServicePausedTotalSeconds(0);
    providerServicePausedRef.current = false;
    setProviderReadyForNext(false);
    providerReadyForNextOptOutRef.current = false;
    endProviderAction("start_service");

    void (async () => {
      try {
        const ok = await persistStartService();
        if (!ok) setProviderJobStep(prevStep);
      } catch {
        setProviderJobStep(prevStep);
      }
    })();
  }, [
    beginProviderAction,
    endProviderAction,
    persistStartService,
    scheduleProviderJobStep,
  ]);

  const clearProviderJobMapState = useCallback(() => {
    setCustomerLivePos(null);
    setProviderOrderDeliveryPin(null);
    providerOrderDeliveryPinRef.current = null;
    setProviderOrderProviderPin(null);
    providerOrderProviderPinRef.current = null;
    providerMatchDistanceKmRef.current = null;
    lastRouteFromRef.current = null;
    lastRouteToRef.current = null;
    routeReadyKeyRef.current = null;
    routeFetchGenRef.current += 1;
    setRoute(null);
    setFitKey2((k) => k + 1);
  }, []);

  const resetProviderToWaitingDashboard = useCallback(() => {
    const oid = String(providerIncomingOfferRef.current?.orderId || "");
    if (oid) inactiveLocationOrderIdsRef.current.add(oid);
    const clearedOfferId = String(
      providerIncomingOfferRef.current?.offerId || "",
    );
    if (clearedOfferId) {
      clearProviderOfferDisplayExpiresAt(
        PROVIDER_INCOMING_TIMER_STORAGE_PREFIX,
        clearedOfferId,
      );
    }
    setProviderIncomingOffer(null);
    incomingOfferExpiresAtRef.current = null;
    setProviderReadyForNext(false);
    providerReadyForNextAutoAttemptedRef.current = false;
    providerReadyForNextOptOutRef.current = false;
    setProviderCustomerRating(0);
    setProviderDriveTimer(0);
    setProviderServiceTimer(0);
    setProviderDrivingPaused(false);
    providerDrivingPausedRef.current = false;
    setProviderServicePaused(false);
    providerServicePausedRef.current = false;
    setProviderServicePausedAt(null);
    setProviderServicePausedTotalSeconds(0);
    setProviderServiceStartedAt(null);
    setProviderPos(null);
    providerPosRef.current = null;
    clearProviderJobMapState();
    setProviderJobStep("waiting");
    setIsBottomSheetCompressed(true);
  }, [clearProviderJobMapState]);

  const handleCompleteService = useCallback(() => {
    if (!beginProviderAction("complete_service")) return;

    const prevStep = providerJobStepRef.current;
    const prevReady = providerReadyForNext;
    setProviderReadyForNext(false);
    setIsBottomSheetCompressed(false);
    scheduleProviderJobStep("completed");
    clearProviderJobMapState();
    setProviderDriveTimer(0);
    setProviderServiceTimer(0);
    setProviderDrivingPaused(false);
    providerDrivingPausedRef.current = false;
    setProviderServicePaused(false);
    providerServicePausedRef.current = false;
    setProviderServicePausedAt(null);
    setProviderServicePausedTotalSeconds(0);
    setProviderServiceStartedAt(null);

    void (async () => {
      try {
        const ok = await persistCompleteService();
        if (!ok) {
          setProviderJobStep(prevStep);
          setProviderReadyForNext(prevReady);
        } else {
          void refreshProviderEarningsToday();
        }
      } finally {
        endProviderAction("complete_service");
      }
    })();
  }, [
    beginProviderAction,
    clearProviderJobMapState,
    endProviderAction,
    persistCompleteService,
    providerReadyForNext,
    refreshProviderEarningsToday,
    scheduleProviderJobStep,
  ]);

  // Touch handlers for swipe gestures - oppdater disse funksjonene
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientY);
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isUpSwipe = distance > 50;
    const isDownSwipe = distance < -50;

    if (isUpSwipe && isBottomSheetCompressed) {
      setIsBottomSheetCompressed(false);
    }
    if (isDownSwipe && !isBottomSheetCompressed) {
      setIsBottomSheetCompressed(true);
    }
  };

  // Cap expanded service sheet below the measured catalog filter bar (Haircut/Braids row).
  const measureSheetTopInset = useCallback(() => {
    if (step !== "map" || isBottomSheetCompressed) return;
    const chrome = catalogTopChromeRef.current;
    const mainEl = mainContainerRef.current;
    if (!chrome || !mainEl) return;
    const chromeBottom = chrome.getBoundingClientRect().bottom;
    const mainTop = mainEl.getBoundingClientRect().top;
    if (!Number.isFinite(chromeBottom) || !Number.isFinite(mainTop)) return;
    const inset = Math.ceil(chromeBottom - mainTop + 20);
    if (inset <= 0) return;
    setSheetTopInsetPx(inset);
  }, [
    step,
    isBottomSheetCompressed,
    appMode,
    target,
    category,
    resolvedCategoryId,
    language,
  ]);

  useLayoutEffect(() => {
    if (step !== "map" || isBottomSheetCompressed) return;

    measureSheetTopInset();
    const raf1 = requestAnimationFrame(() => {
      measureSheetTopInset();
      requestAnimationFrame(measureSheetTopInset);
    });
    const afterAnimate = window.setTimeout(measureSheetTopInset, 320);
    window.addEventListener("resize", measureSheetTopInset);
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measureSheetTopInset)
        : null;
    const chrome = catalogTopChromeRef.current;
    if (ro && chrome) ro.observe(chrome);
    const mainEl = mainContainerRef.current;
    if (ro && mainEl) ro.observe(mainEl);
    return () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(afterAnimate);
      window.removeEventListener("resize", measureSheetTopInset);
      ro?.disconnect();
    };
  }, [step, isBottomSheetCompressed, measureSheetTopInset]);

  // Progress bar component - only for confirm step now
  const ProgressBar = ({ currentStep }: { currentStep: Step }) => {
    // Only show on confirm step
    if (currentStep !== "confirm") return null;

    const customerSteps = ["map", "confirm"]; // Velg tjeneste -> Bekreft
    const currentIndex = customerSteps.indexOf(currentStep);

    return (
      <div className="flex items-center justify-center gap-2 py-3">
        {customerSteps.map((stepName, index) => (
          <div
            key={stepName}
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              index <= currentIndex ? "bg-green-500" : "bg-gray-300",
              "w-8",
            )}
          />
        ))}
      </div>
    );
  };

  // Show splash screen
  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  if (!authReady) {
    return (
      <main className="mx-auto h-[100dvh] w-full max-w-md bg-gradient-to-br from-orange-200 via-purple-200 to-purple-300 relative overflow-hidden flex items-center justify-center">
        <p className="text-sm text-gray-700">Checking session...</p>
      </main>
    );
  }

  // Show login page if not logged in, or mid phone-first provider signup
  // (OTP/OAuth already created a session before profile→payment→services).
  if (!isLoggedIn || providerSignupGate) {
    return (
      <LoginPage
        onProviderSignupGateChange={setProviderSignupGate}
        onLogin={(userType) => {
          clearProviderSignupInProgress();
          setProviderSignupGate(false);
          void supabase.auth.getSession().then(async ({ data }: any) => {
            const session = data?.session;
            const uid = session?.user?.id;
            const token = session?.access_token as string | undefined;
            let mode: "customer" | "provider" = userType;
            if (uid && session?.user) {
              mode = await resolveDashboardModeFromServer(
                session.user,
                token,
                userType,
              );
              writeStoredDashboardMode(uid, mode);
              setUser(session.user);
              if (mode === "provider") {
                const hydrated = mergeSkillsFromLocalSnapshot(uid, [], []);
                if (hydrated.registered.length > 0) {
                  setRegisteredServices(hydrated.registered);
                }
                void supabase.auth.updateUser({
                  data: { app_role: "provider" },
                });
              }
            }
            setIsLoggedIn(true);
            setUserMode(mode);
            if (typeof window !== "undefined") {
              localStorage.removeItem(PROVIDER_SETUP_REDIRECT_KEY);
              if (mode === "provider") {
                window.dispatchEvent(new CustomEvent("providerSkillsUpdated"));
              }
            }
            setForceProviderSetup(false);
            setCurrentPage("main");
          });
        }}
        onSkip={(userType) => {
          const mode = userType || "customer";
          setIsLoggedIn(true);
          setUserMode(mode);
          void supabase.auth.getSession().then(({ data }: any) => {
            const uid = data?.session?.user?.id;
            if (uid) writeStoredDashboardMode(uid, mode);
          });
          setCurrentPage("main");
        }}
        language={language}
        onLanguageChange={setLanguage}
      />
    );
  }

  // Handle navigation
  const handleNavigate = (
    page:
      | "orders"
      | "support"
      | "about"
      | "payment"
      | "earnings"
      | "wallet"
      | "skills"
      | "profile"
      | "stats"
      | "admin",
  ) => {
    setSkillsFocusServiceId(null);
    setCurrentPage(page);
  };

  const handleModeChange = (mode: "customer" | "provider") => {
    if (loggedInUser?.id && !accountRolesUi.can_switch_modes) return;
    if (loggedInUser?.id) writeStoredDashboardMode(loggedInUser.id, mode);
    if (hasSupabase && loggedInUser?.id) {
      void (async () => {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const claim = await setActiveRoleClaim(mode, { accessToken: token });
        if (claim.ok) {
          await supabase.auth.refreshSession();
        }
        if (mode === "customer" && userMode === "provider") {
          providerOnlineHydrateGenRef.current += 1;
          setIsProviderOnline(false);
          await fetch("/api/providers/online", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-provider-id": loggedInUser.id,
            },
            body: JSON.stringify({ is_online: false }),
          }).catch(() => {});
        } else if (mode === "provider" && userMode === "customer") {
          providerOnlineHydrateGenRef.current += 1;
          const pos = providerBrowseGeolocRef.current;
          await fetch("/api/providers/online", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-provider-id": loggedInUser.id,
            },
            body: JSON.stringify({
              is_online: true,
              ...(pos &&
              typeof pos.lat === "number" &&
              typeof pos.lng === "number"
                ? { lat: pos.lat, lng: pos.lng }
                : {}),
            }),
          })
            .then(async (res) => {
              const json = (await res.json().catch(() => ({}))) as {
                is_online?: boolean;
              };
              const live = res.ok && json.is_online === true;
              providerOnlineHydrateGenRef.current += 1;
              setIsProviderOnline(live);
              if (live) providerSyncPendingOffersRef.current?.(true);
            })
            .catch(() => {
              providerOnlineHydrateGenRef.current += 1;
              setIsProviderOnline(false);
            });
        }
      })();
    }
    setUserMode(mode);
    setStep("map");
    setShowMenu(false);
  };

  // Back to menu handler
  const handleBackToMenu = () => {
    setSkillsFocusServiceId(null);
    setCurrentPage("main");
    setShowMenu(true);
  };

  const showIncomingOfferSheet =
    isLoggedIn &&
    userMode === "provider" &&
    providerJobStep === "incoming" &&
    Boolean(mockIncomingRequest);

  const incomingOfferPortal =
    showIncomingOfferSheet &&
    currentPage !== "main" &&
    mockIncomingRequest &&
    typeof document !== "undefined"
      ? createPortal(
          <div className="fixed bottom-0 left-1/2 z-[200] w-full max-w-md -translate-x-1/2 glass-morphism-strong rounded-t-3xl shadow-2xl border-0 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {t("new_request")}
              </h2>
              <span className="text-lg font-bold text-green-600">
                {incomingRequestTimer}s
              </span>
            </div>
            <p className="text-sm font-medium text-gray-800 mb-1">
              {mockIncomingRequest.service.name}
            </p>
            <p className="text-sm text-gray-600 mb-4">
              {formatPrice(providerOfferOrderTotal(mockIncomingRequest))} ·{" "}
              {mockIncomingRequest.location.distance}
            </p>
            <Button
              className="w-full h-12 rounded-xl border-0 ring-2 ring-green-500 font-semibold"
              disabled={providerJobActionsBusy}
              onClick={() => void handleAcceptOffer()}
            >
              <ProviderButtonContent busy={providerActionLoading === "accept"}>
                {t("accept")}
              </ProviderButtonContent>
            </Button>
          </div>,
          document.body,
        )
      : null;

  const wrapWithIncomingOffer = (page: React.ReactNode) => (
    <>
      {page}
      {incomingOfferPortal}
    </>
  );

  // Show subpages
  if (currentPage === "orders") {
    return wrapWithIncomingOffer(
      <OrdersPage
        onBack={handleBackToMenu}
        language={language}
        userType={userMode === "provider" ? "provider" : "customer"}
        onOrderAgain={handleOrderAgain}
        onOpenSupport={() => setCurrentPage("support")}
        onReportProvider={(order: OrderHistoryCardData) => {
          setReportContext({
            orderId: order.id,
            providerId: order.provider_id,
            providerName: order.counterparty_name,
            serviceName: order.service_name,
          });
          setCurrentPage("report");
        }}
      />,
    );
  }

  if (currentPage === "report") {
    if (!reportContext) {
      return wrapWithIncomingOffer(
        <OrdersPage
          onBack={handleBackToMenu}
          language={language}
          userType={userMode === "provider" ? "provider" : "customer"}
          onOrderAgain={handleOrderAgain}
          onOpenSupport={() => setCurrentPage("support")}
          onReportProvider={(order: OrderHistoryCardData) => {
            setReportContext({
              orderId: order.id,
              providerId: order.provider_id,
              providerName: order.counterparty_name,
              serviceName: order.service_name,
            });
            setCurrentPage("report");
          }}
        />,
      );
    }
    return wrapWithIncomingOffer(
      <ReportProviderPage
        onBack={() => {
          setCurrentPage("orders");
          setReportContext(null);
        }}
        language={language}
        context={reportContext}
        onSubmitted={() => {
          setCurrentPage("orders");
          setReportContext(null);
        }}
      />,
    );
  }

  if (currentPage === "support") {
    return wrapWithIncomingOffer(
      <SupportPage
        onBack={handleBackToMenu}
        language={language}
        onOpenChat={() => setCurrentPage("support-chat")}
      />,
    );
  }

  if (currentPage === "support-chat") {
    return wrapWithIncomingOffer(
      <SupportChatPage
        onBack={() => setCurrentPage("support")}
        language={language}
        userRole={userMode === "provider" ? "provider" : "customer"}
      />,
    );
  }

  if (currentPage === "about") {
    return wrapWithIncomingOffer(
      <AboutPage
        onBack={handleBackToMenu}
        language={language}
        onOpenSupport={() => setCurrentPage("support")}
      />,
    );
  }

  if (currentPage === "payment") {
    return wrapWithIncomingOffer(
      <PaymentPage onBack={handleBackToMenu} language={language} />,
    );
  }

  if (currentPage === "earnings") {
    return wrapWithIncomingOffer(
      <EarningsPage onBack={handleBackToMenu} language={language} />,
    );
  }

  if (currentPage === "wallet") {
    return wrapWithIncomingOffer(
      <WalletPage onBack={handleBackToMenu} language={language} />,
    );
  }

  if (currentPage === "admin") {
    return wrapWithIncomingOffer(
      <AdminVerificationsPage onBack={handleBackToMenu} language={language} />,
    );
  }

  if (currentPage === "skills") {
    return wrapWithIncomingOffer(
      <SkillsPage
        onBack={() => {
          setForceProviderSetup(false);
          handleBackToMenu();
        }}
        language={language}
        providerId={loggedInUser?.id ?? null}
        initialMode={appMode}
        initialTarget={target}
        initialCategory={category}
        initialServiceId={skillsFocusServiceId}
      />,
    );
  }

  if (currentPage === "profile") {
    return wrapWithIncomingOffer(
      <ProfilePage
        onBack={handleBackToMenu}
        userMode={userMode}
        language={language}
      />,
    );
  }

  if (currentPage === "chat") {
    return wrapWithIncomingOffer(
      <ChatPage
        onBack={handleBackToMenu}
        otherPartyName={
          userMode === "provider"
            ? mockIncomingRequest?.customer?.name ||
              (language === "en" ? "Customer" : "Kunde")
            : provider?.name || (language === "en" ? "Provider" : "Tilbyder")
        }
        orderId={
          userMode === "provider"
            ? mockIncomingRequest?.orderId || null
            : orderId
        }
        language={language}
      />,
    );
  }

  if (forceProviderSetup) {
    return wrapWithIncomingOffer(
      <SkillsPage
        onBack={() => {
          setForceProviderSetup(false);
          handleBackToMenu();
        }}
        language={language}
        providerId={loggedInUser?.id ?? null}
      />,
    );
  }

  const activeProviderMapJob =
    userMode === "provider" &&
    ["accepted", "enroute", "arrived", "in_service", "completed"].includes(
      providerJobStep,
    ) &&
    Boolean(mockIncomingRequest);
  const customerActiveMapJob =
    userMode === "customer" &&
    (step === "matched" || step === "in_service" || step === "rating") &&
    Boolean(orderId);
  const providerLivePosForMap = providerPos || geoloc;
  const providerMatchKmForMap = parseOfferMatchDistanceKm(
    mockIncomingRequest?.location?.distance,
    mockIncomingRequest?.matchDistanceKm ?? null,
  );
  const providerCustomerTarget =
    providerOrderDeliveryPin ??
    mockIncomingRequest?.customerLocation ??
    (incomingCustomerLat != null && incomingCustomerLng != null
      ? { lat: incomingCustomerLat, lng: incomingCustomerLng }
      : null);
  const providerHomeDeliveryJob =
    activeProviderMapJob && mockIncomingRequest?.mode === "home";
  const providerHomeJobStep =
    providerJobStep === "completed"
      ? "in_service"
      : providerJobStep === "accepted" ||
          providerJobStep === "enroute" ||
          providerJobStep === "arrived" ||
          providerJobStep === "in_service"
        ? providerJobStep
        : null;
  const providerMapOrigin =
    providerHomeDeliveryJob &&
    providerOrderProviderPin &&
    providerCustomerTarget &&
    providerHomeJobStep
      ? resolveProviderHomeMapPin(
          providerLivePosForMap,
          providerCustomerTarget,
          providerOrderProviderPin,
          providerHomeJobStep,
        )
      : resolveProviderMapOrigin(
          providerLivePosForMap,
          providerCustomerTarget,
          providerOrderProviderPin,
          providerMatchKmForMap,
          providerHomeJobStep,
        );
  const providerShowsDualMarkers =
    providerHomeDeliveryJob &&
    Boolean(providerCustomerTarget) &&
    (Boolean(providerMapOrigin || providerOrderProviderPin) ||
      providerJobStep === "arrived" ||
      providerJobStep === "in_service");
  const customerHomeDeliveryJob =
    userMode === "customer" && customerActiveMapJob && mode === "home";
  const customerMapJobStep = customerStatusToMapStep(status);
  const customerBrowseLoc = customerLoc ?? geoloc;
  const customerMapCustomerPos =
    customerOrderDeliveryPin ?? customerBrowseLoc ?? null;
  const customerMapProviderPos = customerHomeDeliveryJob
    ? resolveProviderHomeMapPin(
        providerPos,
        customerMapCustomerPos,
        customerOrderProviderBasePin,
        customerMapJobStep,
      )
    : providerPos;
  const customerShowsDualMarkers =
    customerHomeDeliveryJob &&
    isValidLatLng(customerMapCustomerPos) &&
    (isValidLatLng(customerMapProviderPos) ||
      customerMapJobStep === "arrived" ||
      customerMapJobStep === "in_service" ||
      step === "rating");
  const mapCustomerPos = (() => {
    if (userMode === "provider") {
      if (
        providerHomeDeliveryJob &&
        providerCustomerTarget &&
        (providerJobStep === "arrived" || providerJobStep === "in_service")
      ) {
        return providerCustomerTarget;
      }
      if (!providerShowsDualMarkers) return null;
      const routeDest =
        route && route.length >= 2 ? route[route.length - 1] : null;
      return providerCustomerTarget ?? routeDest;
    }
    if (customerHomeDeliveryJob) {
      const routeDest =
        route && route.length >= 2 ? route[route.length - 1] : null;
      const meetPin =
        customerOrderDeliveryPin ??
        customerMapCustomerPos ??
        customerBrowseLoc ??
        null;
      if (
        customerMapJobStep === "arrived" ||
        customerMapJobStep === "in_service"
      ) {
        return meetPin || customerBrowseLoc || OSLO_DEFAULT;
      }
      if (step === "rating") {
        const target = meetPin || customerBrowseLoc || OSLO_DEFAULT;
        return providerPos ?? target;
      }
      const dest = meetPin ?? routeDest;
      if (!dest) return customerBrowseLoc || OSLO_DEFAULT;
      return customerShowsDualMarkers
        ? dest
        : dest || customerBrowseLoc || OSLO_DEFAULT;
    }
    return customerBrowseLoc || OSLO_DEFAULT;
  })();
  const mapCenter = (() => {
    if (
      customerHomeDeliveryJob &&
      customerMapCustomerPos &&
      (customerMapJobStep === "arrived" ||
        customerMapJobStep === "in_service" ||
        step === "rating")
    ) {
      return customerMapCustomerPos;
    }
    const providerOrigin =
      providerMapOrigin || providerOrderProviderPin || null;
    if (providerShowsDualMarkers && providerOrigin && mapCustomerPos) {
      return {
        lat: (providerOrigin.lat + mapCustomerPos.lat) / 2,
        lng: (providerOrigin.lng + mapCustomerPos.lng) / 2,
      };
    }
    if (
      customerShowsDualMarkers &&
      customerMapCustomerPos &&
      customerMapProviderPos
    ) {
      return {
        lat: (customerMapProviderPos.lat + customerMapCustomerPos.lat) / 2,
        lng: (customerMapProviderPos.lng + customerMapCustomerPos.lng) / 2,
      };
    }
    return (
      (activeProviderMapJob || customerActiveMapJob
        ? providerPos || mapCustomerPos
        : mapCustomerPos || geoloc) || OSLO_DEFAULT
    );
  })();
  const mapProviderPos = (() => {
    if (userMode === "provider") {
      if (providerJobStep === "completed" && providerCustomerTarget) {
        return providerCustomerTarget;
      }
      if (
        providerHomeDeliveryJob &&
        providerCustomerTarget &&
        (providerJobStep === "arrived" || providerJobStep === "in_service")
      ) {
        return providerLivePosForMap ?? providerCustomerTarget;
      }
    }
    if (userMode === "customer") {
      if (customerHomeDeliveryJob) {
        const meetPin =
          customerOrderDeliveryPin ?? customerMapCustomerPos ?? geoloc ?? null;
        const arrivedLike =
          customerMapJobStep === "arrived" ||
          customerMapJobStep === "in_service";
        if (arrivedLike && isValidLatLng(meetPin)) {
          const live = providerPos;
          if (live && haversineKm(live, meetPin) < 0.5) {
            return live;
          }
          return meetPin;
        }
        if (step === "rating" && isValidLatLng(meetPin)) {
          return meetPin;
        }
        return (
          customerMapProviderPos ?? customerOrderProviderBasePin ?? providerPos
        );
      }
      return providerPos;
    }
    if (
      providerHomeDeliveryJob &&
      providerOrderProviderPin &&
      providerCustomerTarget
    ) {
      const routeOrigin = route && route.length >= 2 ? route[0] : null;
      const live = providerLivePosForMap;
      if (
        providerHomeJobStep === "arrived" ||
        providerHomeJobStep === "in_service"
      ) {
        return live ?? providerOrderProviderPin;
      }
      if (live && haversineKm(live, providerCustomerTarget) >= 0.5) {
        return live;
      }
      return routeOrigin ?? providerOrderProviderPin;
    }
    if (providerHomeDeliveryJob) {
      const shop = providerOrderProviderPin ?? providerMapOrigin;
      if (shop) return shop;
      const live = providerPos || geoloc;
      if (
        live &&
        providerCustomerTarget &&
        haversineKm(live, providerCustomerTarget) < 0.5 &&
        providerHomeJobStep !== "arrived" &&
        providerHomeJobStep !== "in_service"
      ) {
        return null;
      }
      return live ?? null;
    }
    if (activeProviderMapJob) return providerPos || geoloc;
    return geoloc || providerPos || mapCenter;
  })();
  const mapRoute = (() => {
    if (!(activeProviderMapJob || customerActiveMapJob) || !route) return null;
    if (userMode === "provider" && providerJobStep === "completed") return null;
    if (
      userMode === "provider" &&
      (providerJobStep === "arrived" || providerJobStep === "in_service")
    ) {
      return null;
    }
    if (userMode === "customer" && step === "rating") return null;
    if (
      userMode === "customer" &&
      customerHomeDeliveryJob &&
      (customerMapJobStep === "arrived" || customerMapJobStep === "in_service")
    ) {
      return null;
    }
    return route;
  })();
  const mapDisplayPins = (() => {
    const atDelivery =
      (userMode === "provider" &&
        (providerJobStep === "arrived" || providerJobStep === "in_service")) ||
      (userMode === "customer" &&
        customerHomeDeliveryJob &&
        (customerMapJobStep === "arrived" ||
          customerMapJobStep === "in_service"));
    if (
      atDelivery &&
      isValidLatLng(mapCustomerPos) &&
      isValidLatLng(mapProviderPos)
    ) {
      return separateArrivedMapPins(mapCustomerPos, mapProviderPos);
    }
    return { customer: mapCustomerPos, provider: mapProviderPos };
  })();
  const providerMarkerTone = "provider" as const;
  const mapFollowCenter =
    userMode === "customer"
      ? customerHomeDeliveryJob &&
        (customerMapJobStep === "arrived" ||
          customerMapJobStep === "in_service" ||
          step === "rating")
        ? true
        : !customerShowsDualMarkers
      : !(providerShowsDualMarkers || providerHomeDeliveryJob);

  const mapLockToOneKmGrid =
    currentPage === "main" &&
    (userMode === "customer"
      ? (step === "map" || step === "confirm" || step === "searching") &&
        !customerShowsDualMarkers
      : providerJobStep === "waiting" && !mockIncomingRequest);

  return (
    <main
      ref={mainContainerRef}
      className="mx-auto h-[100dvh] w-full max-w-md bg-gradient-to-br from-orange-200 via-purple-200 to-purple-300 relative overflow-hidden"
      style={
        {
          "--sheet-top-inset": `${sheetTopInsetPx}px`,
        } as React.CSSProperties
      }
    >
      <Toaster richColors position="top-center" />
      {/* Hamburger Menu */}
      <HamburgerMenu
        isOpen={showMenu}
        onClose={() => setShowMenu(false)}
        onNavigate={handleNavigate}
        onModeChange={handleModeChange}
        onLogout={() => {
          void handleLogout();
        }}
        signedIn={Boolean(loggedInUser?.id)}
        onLogin={() => {
          setShowMenu(false);
          setIsLoggedIn(false);
        }}
        currentMode={userMode}
        canSwitchModes={
          accountRolesUi.can_switch_modes || !loggedInUser?.id
        }
        hasCustomerRole={accountRolesUi.has_customer}
        hasProviderRole={accountRolesUi.has_provider}
        onBecomeProvider={() => {
          window.location.href = "/?provider_signup=1";
        }}
        onBookAService={() => {
          void (async () => {
            try {
              const { data } = await supabase.auth.getSession();
              const token = data?.session?.access_token as string | undefined;
              await fetch("/api/customers/ensure", {
                method: "POST",
                headers: token
                  ? { Authorization: `Bearer ${token}` }
                  : {},
              });
              const roles = await fetchAccountRoles({
                accessToken: token,
                intent: "customer",
              });
              if (roles) {
                setAccountRolesUi({
                  has_customer: roles.has_customer,
                  has_provider: roles.has_provider,
                  can_switch_modes: Boolean(roles.can_switch_modes),
                });
              }
              if (loggedInUser?.id) {
                writeStoredDashboardMode(loggedInUser.id, "customer");
              }
              if (token) {
                const claim = await setActiveRoleClaim("customer", {
                  accessToken: token,
                });
                if (claim.ok) await supabase.auth.refreshSession();
              }
            } catch {
              /* still open the map */
            }
            setUserMode("customer");
            setStep("map");
            setShowMenu(false);
          })();
        }}
        userName={hamburgerUserName}
        userAvatarUrl={userAvatarUrl}
        userRating={4.5}
        rewardProgress={3}
        providerEarningsToday={providerEarningsToday}
        providerEarningsWeek={8750}
        providerCompletedJobs={47}
        providerStats={providerStats ?? undefined}
        providerStatsLoading={providerStatsLoading}
        providerTier={providerDispatchTier}
        language={language}
        onLanguageChange={setLanguage}
        showAdminVerifications={isAdminUser}
      />

      {/* Second / next job while on an active job: top banner + dropdown. */}
      {step === "map" &&
        userMode === "provider" &&
        (providerQueuedIncomingOffer || providerHeldNextJob) &&
        (() => {
          const bannerOffer =
            providerQueuedIncomingOffer || providerHeldNextJob!;
          const bannerIsHeld =
            !providerQueuedIncomingOffer && !!providerHeldNextJob;
          return (
            <div
              className="pointer-events-none fixed inset-x-0 top-0 z-[58] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))]"
              role="region"
              aria-label={bannerIsHeld ? t("next_job") : t("new_request")}
            >
              <div className="pointer-events-auto w-full max-w-md shadow-2xl">
                <button
                  type="button"
                  className={cn(
                    "w-full border-0 glass-morphism-strong px-4 py-3 text-left transition-transform active:scale-[0.99]",
                    showProviderQueuedOfferSheet
                      ? "rounded-t-2xl rounded-b-none"
                      : "rounded-2xl",
                  )}
                  aria-expanded={showProviderQueuedOfferSheet}
                  aria-controls="queued-offer-panel"
                  onClick={() =>
                    setShowProviderQueuedOfferSheet((expanded) => !expanded)
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {bannerIsHeld ? t("next_job") : t("new_request")}
                      </p>
                      <p className="truncate text-base font-semibold text-gray-900">
                        {bannerOffer.service.name}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {bannerIsHeld
                          ? providerCanStartHeldNextJob
                            ? t("next_job_ready_hint")
                            : t("next_job_waiting_hint")
                          : showProviderQueuedOfferSheet
                            ? t("new_request_banner_collapse_hint")
                            : t("new_request_banner_hint")}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {!bannerIsHeld ? (
                        <div className="rounded-xl bg-green-500 px-2.5 py-1.5 text-sm font-bold tabular-nums text-white">
                          {providerQueuedOfferTimer}s
                        </div>
                      ) : null}
                      {showProviderQueuedOfferSheet ? (
                        <ChevronUp className="h-5 w-5 text-gray-500" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-500" />
                      )}
                    </div>
                  </div>
                </button>

                {showProviderQueuedOfferSheet && (
                  <div
                    id="queued-offer-panel"
                    className="max-h-[min(55dvh,28rem)] overflow-y-auto rounded-b-2xl border-0 border-t border-white/20 glass-morphism-strong animate-in slide-in-from-top-2 duration-200"
                  >
                    {!bannerIsHeld ? (
                      <div className="shrink-0 px-4 pb-2 pt-2">
                        <div className="flex justify-center gap-2">
                          <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200">
                            <div
                              className="h-full bg-green-500 transition-all duration-1000 ease-linear"
                              style={{
                                width: `${(providerQueuedOfferTimer / PROVIDER_OFFER_EXPIRES_SECONDS) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className={cn("p-4", !bannerIsHeld && "pt-0")}>
                      <div className="mb-4 flex items-center gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="glass-button h-8 w-8 flex-shrink-0 border-0 text-gray-700"
                          onClick={() => setShowProviderQueuedOfferSheet(false)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                        <h2
                          id="queued-offer-title"
                          className="flex-1 text-lg font-semibold text-gray-900"
                        >
                          {bannerIsHeld ? t("next_job") : t("new_request")}
                        </h2>
                        {!bannerIsHeld ? (
                          <div className="text-lg font-bold text-green-600 tabular-nums">
                            {providerQueuedOfferTimer}s
                          </div>
                        ) : null}
                      </div>

                      <div className="glass-morphism space-y-3 rounded-2xl border-0 p-4">
                        <div className="flex items-center gap-2 border-b border-white/10 pb-1 text-xs text-gray-500">
                          <div className="flex items-center gap-1">
                            <CategoryIcon
                              appMode={bannerOffer.service.appMode ?? appMode}
                              category={
                                bannerOffer.service.categoryId ?? category
                              }
                              label={bannerOffer.service.category}
                              className="h-3.5 w-3.5"
                            />
                            <span>{bannerOffer.service.category}</span>
                          </div>
                          {bannerOffer.service.target ? (
                            <>
                              <span>•</span>
                              <span>
                                {bannerOffer.service.targetIcon}{" "}
                                {bannerOffer.service.target}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl glass-morphism border-0 text-gray-700">
                            <CategoryIcon
                              appMode={bannerOffer.service.appMode ?? appMode}
                              category={
                                bannerOffer.service.categoryId ?? category
                              }
                              label={bannerOffer.service.category}
                              className="h-6 w-6"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-semibold text-gray-900">
                              {bannerOffer.service.name}
                            </h3>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Star className="h-3 w-3 fill-current text-yellow-500" />
                              <span>
                                {bannerOffer.service.rating?.toFixed(1) ||
                                  "4.8"}
                              </span>
                              <span>•</span>
                              <span>{bannerOffer.service.duration} min</span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-lg font-bold text-gray-900">
                              {formatPrice(
                                providerOfferDisplayServicePrice(bannerOffer),
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="border-t border-white/20 pt-3">
                          <div className="flex items-center gap-3">
                            <CustomerProviderAvatar
                              avatarUrl={bannerOffer.customer.avatarUrl}
                              name={bannerOffer.customer.name}
                              className="h-10 w-10"
                              iconClassName="h-4 w-4"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900">
                                {bannerOffer.customer.name}
                              </p>
                              <div className="flex items-center gap-2 text-xs text-gray-600">
                                <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                                <span>{bannerOffer.customer.rating}</span>
                                <span>•</span>
                                <span>
                                  {language === "en" ? "Code" : "Kode"}:{" "}
                                  {providerMatchCode}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {bannerOffer.addonLines.length > 0 && (
                          <div className="border-t border-white/20 pt-3">
                            <h4 className="mb-2 text-sm font-medium text-gray-700">
                              {t("addons_label")}
                            </h4>
                            <div className="space-y-1">
                              {bannerOffer.addonLines.map((addon) => (
                                <div
                                  key={addon.id}
                                  className="flex items-center justify-between text-sm"
                                >
                                  <span className="text-gray-600">
                                    {addon.name}
                                  </span>
                                  <span className="font-medium text-green-600">
                                    +{formatPrice(addon.price)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2 border-t border-white/20 pt-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600">
                              {t("location")}
                            </span>
                            <span className="font-medium text-gray-900">
                              {bannerOffer.mode === "home"
                                ? t("delivery")
                                : t("at_provider")}
                            </span>
                          </div>
                          {bannerOffer.mode === "home" && (
                            <>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">
                                  {t("distance")}
                                </span>
                                <span className="font-medium text-gray-900">
                                  {bannerOffer.location.distance}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-gray-600">
                                  {t("delivery_fee")}
                                </span>
                                <span className="font-medium text-green-600">
                                  +
                                  {formatPrice(
                                    providerOfferDeliveryFee(bannerOffer),
                                  )}
                                </span>
                              </div>
                            </>
                          )}
                          <p className="text-xs text-gray-600">
                            {bannerOffer.location.address}
                          </p>
                        </div>

                        <div className="border-t border-white/20 pt-3">
                          <div className="flex items-center justify-between text-base">
                            <span className="font-semibold text-gray-800">
                              {t("total")}
                            </span>
                            <span className="font-bold text-green-600 text-lg">
                              {formatPrice(
                                providerOfferOrderTotal(bannerOffer),
                              )}
                            </span>
                          </div>
                        </div>
                      </div>

                      {bannerIsHeld ? (
                        <Button
                          type="button"
                          disabled={!providerCanStartHeldNextJob}
                          className={cn(
                            "mt-4 h-12 w-full rounded-xl border-0 text-lg font-semibold text-white shadow-md transition-all duration-300",
                            providerCanStartHeldNextJob
                              ? "bg-green-500 ring-2 ring-green-500/30 animate-pulse hover:bg-green-600 hover:scale-[1.01]"
                              : "bg-gray-400 cursor-not-allowed opacity-70",
                          )}
                          onClick={() => handleStartHeldNextJob()}
                        >
                          {t("start_service")}
                        </Button>
                      ) : (
                        <div className="mt-4 flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-12 flex-1 rounded-xl border-0 glass-button text-lg font-semibold text-gray-800"
                            onClick={() => {
                              const offerId =
                                providerQueuedIncomingOffer?.offerId;
                              setProviderQueuedIncomingOffer(null);
                              setShowProviderQueuedOfferSheet(false);
                              if (offerId && hasSupabase) {
                                void supabase
                                  .from("order_offers")
                                  .update({
                                    status: "declined",
                                    responded_at: new Date().toISOString(),
                                  })
                                  .eq("id", offerId)
                                  .eq("status", "pending");
                              }
                            }}
                          >
                            {t("decline")}
                          </Button>
                          <Button
                            type="button"
                            className="h-12 flex-[1.4] rounded-xl border-0 bg-green-500 text-lg font-semibold text-white shadow-md ring-2 ring-green-500/30 transition-all duration-300 animate-pulse hover:bg-green-600 hover:scale-[1.01]"
                            onClick={async () => {
                              if (
                                !loggedInUser?.id ||
                                !providerQueuedIncomingOffer?.offerId
                              )
                                return;
                              const acceptedOffer = providerQueuedIncomingOffer;
                              try {
                                const res = await fetch("/api/orders/accept", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    offer_id: acceptedOffer.offerId,
                                    provider_id: loggedInUser.id,
                                    offer_shown_at: (() => {
                                      const expiresMs = new Date(
                                        String(acceptedOffer.expiresAt || ""),
                                      ).getTime();
                                      if (!Number.isFinite(expiresMs))
                                        return null;
                                      return new Date(
                                        expiresMs - PROVIDER_OFFER_EXPIRES_MS,
                                      ).toISOString();
                                    })(),
                                  }),
                                });
                                const data = await res.json().catch(() => ({}));
                                if (!res.ok || data?.success !== true) {
                                  setAuthError(
                                    data?.error ||
                                      (language === "en"
                                        ? "Could not accept request"
                                        : "Kunne ikke akseptere foresporsel"),
                                  );
                                  return;
                                }
                                setProviderQueuedIncomingOffer(null);
                                setProviderHeldNextJob(acceptedOffer);
                                setShowProviderQueuedOfferSheet(true);
                                setProviderReadyForNext(false);
                                providerReadyForNextOptOutRef.current = true;
                                const currentOrderId = String(
                                  providerIncomingOfferRef.current?.orderId ||
                                    "",
                                );
                                if (currentOrderId && loggedInUser.id) {
                                  void persistReadyForNext(false);
                                }
                                toast.success(
                                  language === "en"
                                    ? "Request accepted — start when ready"
                                    : "Forespørsel akseptert — start når du er klar",
                                );
                              } catch {
                                setAuthError(
                                  language === "en"
                                    ? "Could not accept request"
                                    : "Kunne ikke akseptere foresporsel",
                                );
                              }
                            }}
                          >
                            {t("accept")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {/* Map */}
      <div className="absolute inset-0 z-0">
        <MapView
          center={mapCenter}
          customer={mapDisplayPins.customer}
          providers={showLiveFleet ? liveFleetProviders : []}
          providerPos={mapDisplayPins.provider}
          route={mapRoute}
          fitKey={fitKey + fitKey2}
          providerMarkerTone={providerMarkerTone}
          followCenter={mapFollowCenter}
          lockViewportToGridCell={mapLockToOneKmGrid}
          viewportResetKey={`${orderId || mockIncomingRequest?.orderId || "browse"}:${gpsRecenterNonce}`}
          customerMarkerOnTop={
            userMode === "customer" &&
            step === "rating" &&
            customerHomeDeliveryJob
          }
          language={language}
          demandOverlay={mapDemandOverlay}
          showDemandOverlay={showDemandZonesOnMap}
          fleetMarkerStyle={showLiveFleet ? "live" : "numbered"}
          fleetVariant={
            mode === "provider"
              ? "salon"
              : appMode === "vehicle"
                ? "vehicle"
                : "car"
          }
          marketCalculating={marketCalculating || priceLockLoading}
          marketActivityLabel={null}
          onDemandOverlayLoadingChange={handleDemandOverlayLoadingChange}
        />
      </div>

      {/* GPS recenter — browse home only; hide over active job sheets. */}
      {(step === "map" || step === "confirm") &&
        !(
          userMode === "provider" &&
          providerJobStep !== "waiting" &&
          Boolean(mockIncomingRequest)
        ) && (
          <button
            type="button"
            disabled={locatingGps}
            aria-label={language === "en" ? "My location" : "Min posisjon"}
            title={language === "en" ? "My location" : "Min posisjon"}
            onClick={() => void goToMyLocation()}
            className="pointer-events-auto absolute z-40 flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-gray-800 shadow-md disabled:opacity-60"
            style={{
              right: 16,
              bottom: isBottomSheetCompressed
                ? userMode === "provider"
                  ? 230 // sit above the online toggle (175px)
                  : 190
                : 360,
            }}
          >
            {locatingGps ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <LocateFixed className="h-5 w-5" strokeWidth={2.25} />
            )}
          </button>
        )}

      {/* Top Navigation Bar - Profile, Mode, Target all aligned - hide during active provider job */}
      {step === "map" &&
        isBottomSheetCompressed &&
        !(
          userMode === "provider" &&
          providerJobStep !== "waiting" &&
          Boolean(mockIncomingRequest)
        ) && (
          <div className="absolute top-0 left-0 right-0 z-30 pt-14 px-4">
            <div className="flex items-center justify-between">
              {/* Menu icon - left */}
              <Button
                variant="ghost"
                size="sm"
                className="pointer-events-auto rounded-full h-10 w-10 p-0 glass-morphism border-0 text-gray-700 hover:text-gray-900"
                title="Meny"
                onClick={() => setShowMenu(true)}
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </Button>

              {/* Mode Dropdown / Provider Earnings - center */}
              <div className="pointer-events-auto relative">
                {userMode === "provider" ? (
                  <div className="glass-morphism-strong rounded-full h-10 border-0 flex items-center">
                    {/* Earnings section */}
                    <div className="flex items-center gap-2 px-3 border-r border-gray-300/50">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full",
                          isProviderOnline
                            ? "bg-green-500 animate-pulse"
                            : "bg-gray-400",
                        )}
                      />
                      <span className="font-bold text-sm text-gray-900">
                        {formatPrice(providerEarningsToday)}
                      </span>
                    </div>
                    {/* Mode section - clickable */}
                    <button
                      className="flex items-center gap-1.5 px-3 h-full hover:bg-white/20 rounded-r-full transition-colors"
                      onClick={() => setShowModeDropdown(!showModeDropdown)}
                    >
                      <ModeIcon
                        mode={appMode}
                        className="h-4 w-4 text-gray-700"
                      />
                      <ChevronDown
                        className={cn(
                          "h-3 w-3 text-gray-600 transition-transform",
                          showModeDropdown && "rotate-180",
                        )}
                      />
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    className="glass-morphism-strong rounded-full px-3 h-10 border-0 text-gray-800 hover:text-gray-900 flex items-center gap-1.5 text-sm"
                    onClick={() => setShowModeDropdown(!showModeDropdown)}
                  >
                    <ModeIcon mode={appMode} className="h-4 w-4" />
                    <span className="font-semibold text-xs">Mode</span>
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform",
                        showModeDropdown && "rotate-180",
                      )}
                    />
                  </Button>
                )}

                {/* Dropdown menu */}
                {showModeDropdown && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 glass-morphism-strong rounded-2xl p-2 min-w-[160px] animate-in fade-in-50 slide-in-from-top-4 duration-200 z-50">
                    {(Object.keys(APP_MODES_NO) as AppMode[]).map((key) => {
                      const m = APP_MODES[key];
                      return (
                        <button
                          key={m.id}
                          className={cn(
                            "w-full px-3 py-2.5 rounded-lg text-left transition-all duration-200 flex items-center gap-2 text-sm",
                            appMode === m.id
                              ? "glass-button-active"
                              : "hover:bg-white/20 text-gray-800",
                          )}
                          onClick={() => {
                            setAppMode(m.id as AppMode);
                            setShowModeDropdown(false);
                          }}
                        >
                          <ModeIcon
                            mode={m.id as AppMode}
                            className={cn(
                              "h-4 w-4",
                              appMode === m.id ? "text-white" : "text-gray-800",
                            )}
                          />
                          <span
                            className={cn(
                              "font-medium",
                              appMode === m.id ? "text-white" : "text-gray-800",
                            )}
                          >
                            {m.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Target Switch - right */}
              <div className="pointer-events-auto">
                <TargetSwitchButtons
                  appMode={appMode}
                  targets={currentTargets}
                  selectedTarget={target}
                  onSelect={selectCatalogTarget}
                />
              </div>
            </div>
          </div>
        )}

      {/* Fixed Top Filter Bar - Visible when bottom sheet is expanded on map step - hide during active provider job */}
      {step === "map" &&
        !isBottomSheetCompressed &&
        !(
          userMode === "provider" &&
          providerJobStep !== "waiting" &&
          Boolean(mockIncomingRequest)
        ) && (
          <div
            ref={catalogTopChromeRef}
            className="absolute top-0 left-0 right-0 z-50 pt-12 pb-4 px-4"
          >
            <div className="glass-morphism-strong rounded-2xl p-3 animate-in slide-in-from-top-4 duration-300">
              <div className="flex items-center justify-between gap-3">
                {/* Compact Target Switch - Dynamic based on mode */}
                <TargetSwitchButtons
                  appMode={appMode}
                  targets={currentTargets}
                  selectedTarget={target}
                  onSelect={selectCatalogTarget}
                  compact
                />

                {/* Horizontal Category Scroll - Dynamic based on mode */}
                <div className="flex-1 min-w-0">
                  <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
                    {currentCategories.map((c) => (
                      <Button
                        key={c.id}
                        variant="ghost"
                        className={cn(
                          "relative h-7 flex-shrink-0 rounded-full border-0 px-3 text-xs font-medium ring-2 transition-colors duration-200",
                          matchesCatalogCategory(
                            resolvedCategoryId,
                            c.id,
                            c.label,
                          )
                            ? "glass-button-active ring-white/40"
                            : "glass-button text-gray-700 ring-transparent",
                        )}
                        onClick={() => {
                          setCategory(c.id);
                          setSelectedAddons([]);
                        }}
                      >
                        <div className="flex items-center gap-1">
                          <CategoryIcon
                            appMode={appMode}
                            category={c.id}
                            className="h-3 w-3"
                          />
                          <span>{c.label}</span>
                        </div>
                        <div
                          className={cn(
                            "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-green-500",
                            matchesCatalogCategory(
                              resolvedCategoryId,
                              c.id,
                              c.label,
                            )
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Category sidebar - right side, below top bar - hide during active provider job */}
      {step === "map" &&
        isBottomSheetCompressed &&
        !(
          userMode === "provider" &&
          providerJobStep !== "waiting" &&
          Boolean(mockIncomingRequest)
        ) && (
          <aside className="pointer-events-none absolute right-4 top-28 z-30 flex flex-col items-end gap-2 animate-in fade-in-50 duration-300">
            {currentCategories.length > 0 && (
              <div className="pointer-events-auto rounded-[1.75rem] glass-morphism border border-white/50 shadow-sm p-1.5">
                <div className="flex flex-col gap-1.5">
                  {currentCategories.map((c) => {
                    const isActive = matchesCatalogCategory(
                      resolvedCategoryId,
                      c.id,
                      c.label,
                    );
                    const hasOnlineServices =
                      userMode === "provider" &&
                      providerOnlineCategoryIds.has(c.id);

                    return (
                      <Button
                        key={c.id}
                        variant="ghost"
                        className={cn(
                          "relative flex h-8 w-8 shrink-0 items-center justify-center overflow-visible border p-0 transition-colors duration-200",
                          isActive
                            ? "glass-button-active rounded-lg shadow-sm hover:text-white"
                            : "rounded-lg border-transparent bg-white/35 text-zinc-700 hover:bg-white/50 hover:text-zinc-800",
                        )}
                        onClick={() => {
                          setCategory(c.id);
                          setSelectedAddons([]);
                          setFitKey((k) => k + 1);
                        }}
                        title={c.label}
                      >
                        <CategoryIcon
                          appMode={appMode}
                          category={categoryCatalogKey(c.id, c.label)}
                          className="h-4 w-4"
                        />
                        {hasOnlineServices && (
                          <div className="pointer-events-none absolute -top-0.5 -right-0.5 z-10 h-3 w-3 rounded-full border border-white bg-green-500" />
                        )}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </aside>
        )}

      {/* Provider Incoming Request - SAME STYLE AS CONFIRM STEP */}
      {userMode === "provider" &&
        providerJobStep === "incoming" &&
        mockIncomingRequest && (
          <div className="fixed bottom-0 left-1/2 z-[200] w-full max-w-md -translate-x-1/2 glass-morphism-strong rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border-0">
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
            </div>

            {/* Progress Bar with timer */}
            <div className="px-4 pb-2">
              <div className="flex justify-center gap-2">
                <div className="h-1 flex-1 rounded-full overflow-hidden bg-gray-200">
                  <div
                    className="h-full bg-green-500 transition-all duration-1000 ease-linear"
                    style={{
                      width: `${(incomingRequestTimer / PROVIDER_OFFER_EXPIRES_SECONDS) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="p-4">
              {/* Header with back button - same as confirm */}
              <div className="flex items-center gap-3 mb-4">
                <Button
                  variant="ghost"
                  size="icon"
                  className="glass-button border-0 text-gray-700 h-8 w-8 flex-shrink-0"
                  onClick={() => setProviderJobStep("waiting")}
                >
                  <X className="h-4 w-4" />
                </Button>
                <h2 className="text-lg font-semibold text-gray-900">
                  {t("new_request")}
                </h2>
                <div className="ml-auto text-lg font-bold text-green-600">
                  {incomingRequestTimer}s
                </div>
              </div>

              {/* Service card - SAME AS CONFIRM STEP */}
              <div className="glass-morphism rounded-2xl p-4 space-y-3 border-0">
                {/* Category + Target row — from booked service, not active dashboard tab */}
                <div className="flex items-center gap-2 text-xs text-gray-500 pb-1 border-b border-white/10">
                  <div className="flex items-center gap-1">
                    <CategoryIcon
                      appMode={mockIncomingRequest.service.appMode ?? appMode}
                      category={
                        mockIncomingRequest.service.categoryId ?? category
                      }
                      label={mockIncomingRequest.service.category}
                      className="h-3.5 w-3.5"
                    />
                    <span>{mockIncomingRequest.service.category}</span>
                  </div>
                  {mockIncomingRequest.service.target ? (
                    <>
                      <span>•</span>
                      <span>
                        {mockIncomingRequest.service.targetIcon}{" "}
                        {mockIncomingRequest.service.target}
                      </span>
                    </>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 glass-morphism rounded-xl flex items-center justify-center border-0 text-gray-700">
                    <CategoryIcon
                      appMode={mockIncomingRequest.service.appMode ?? appMode}
                      category={
                        mockIncomingRequest.service.categoryId ?? category
                      }
                      label={mockIncomingRequest.service.category}
                      className="h-6 w-6"
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">
                      {mockIncomingRequest.service.name}
                    </h3>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Star className="h-3 w-3 fill-current text-yellow-500" />
                      <span>
                        {mockIncomingRequest.service.rating?.toFixed(1) ||
                          "4.8"}
                      </span>
                      <span>•</span>
                      <span>{mockIncomingRequest.service.duration} min</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg text-gray-900">
                      {formatPrice(
                        providerOfferDisplayServicePrice(mockIncomingRequest),
                      )}
                    </div>
                  </div>
                </div>

                {mockIncomingRequest.addonLines.length > 0 && (
                  <div className="border-t border-white/20 pt-3">
                    <h4 className="mb-2 text-sm font-medium text-gray-700">
                      {t("addons_label")}
                    </h4>
                    <div className="space-y-1">
                      {mockIncomingRequest.addonLines.map((addon) => (
                        <div
                          key={addon.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="text-gray-600">{addon.name}</span>
                          <span className="font-medium text-green-600">
                            +{formatPrice(addon.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Customer info */}
                <div className="border-t border-white/20 pt-3">
                  <div className="flex items-center gap-3">
                    <CustomerProviderAvatar
                      avatarUrl={mockIncomingRequest.customer.avatarUrl}
                      name={mockIncomingRequest.customer.name}
                      className="h-10 w-10"
                      iconClassName="h-4 w-4"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900 text-sm">
                        {mockIncomingRequest.customer.name}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                        <span>{mockIncomingRequest.customer.rating}</span>
                        <span>•</span>
                        <span>
                          {language === "en" ? "Code" : "Kode"}:{" "}
                          {providerMatchCode}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Location and delivery */}
                <div className="border-t border-white/20 pt-3 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{t("location")}</span>
                    <span className="font-medium text-gray-900">
                      {mockIncomingRequest.mode === "home"
                        ? t("delivery")
                        : t("at_your_location")}
                    </span>
                  </div>
                  {mockIncomingRequest.mode === "home" && (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">{t("distance")}</span>
                        <span className="font-medium text-gray-900">
                          {mockIncomingRequest.location.distance}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">
                          {t("delivery_fee")}
                        </span>
                        <span className="font-medium text-green-600">
                          +
                          {formatPrice(
                            providerOfferDeliveryFee(mockIncomingRequest),
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">
                          {language === "en" ? "Address" : "Adresse"}
                        </span>
                        <span className="text-gray-900 text-right text-xs">
                          {mockIncomingRequest.location.address}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Total price */}
                <div className="border-t border-white/20 pt-3">
                  <div className="flex items-center justify-between text-base">
                    <span className="font-semibold text-gray-800">
                      {t("total")}
                    </span>
                    <span className="font-bold text-green-600 text-lg">
                      {formatPrice(
                        providerOfferOrderTotal(mockIncomingRequest),
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Accept CTA - same style as confirm button but with pulse */}
              <Button
                type="button"
                disabled={isAcceptingProviderOffer}
                className="w-full glass-morphism-strong hover:glass-morphism-strong hover:scale-105 text-gray-800 h-12 text-lg font-semibold rounded-xl mt-4 border-0 transition-all duration-300 animate-pulse ring-2 ring-green-500 disabled:opacity-60 disabled:animate-none"
                onClick={() => {
                  if (mockIncomingRequest) {
                    void acceptProviderOffer(mockIncomingRequest);
                  }
                }}
              >
                {t("accept")}
              </Button>
            </div>
          </div>
        )}

      {/* Provider Action Buttons - SAME AS CUSTOMER (matched/in_service) */}
      {userMode === "provider" &&
        (providerJobStep === "accepted" ||
          providerJobStep === "enroute" ||
          providerJobStep === "arrived" ||
          providerJobStep === "in_service") &&
        mockIncomingRequest && (
          <div className="absolute top-16 right-4 z-50 flex flex-col gap-3">
            {/* Emergency Button - same as customer */}
            <Button
              size="icon"
              className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg border-0"
              onClick={() => setShowEmergency(true)}
            >
              <span className="text-lg">🚨</span>
            </Button>
            {/* Phone Button - same as customer */}
            <Button
              size="icon"
              className="h-12 w-12 rounded-full glass-morphism-strong hover:glass-morphism-strong text-gray-800 shadow-lg border-0"
              onClick={() => {
                const tel = String(mockIncomingRequest?.customer?.phone || "")
                  .trim()
                  .replace(/[^\d+]/g, "");
                if (!tel || tel === "+") {
                  alert(
                    language === "en"
                      ? "No phone number saved in profile"
                      : "Ingen telefonnummer lagret i profilen",
                  );
                  return;
                }
                window.location.href = `tel:${tel}`;
              }}
            >
              <Phone className="h-5 w-5" />
            </Button>
            {/* Chat Button - same as customer */}
            <Button
              size="icon"
              className="h-12 w-12 rounded-full glass-morphism-strong hover:glass-morphism-strong text-gray-800 shadow-lg border-0"
              onClick={() => setShowChat(true)}
            >
              <MessageCircle className="h-5 w-5" strokeWidth={2.25} />
            </Button>
          </div>
        )}

      {/* Provider Job Flow - SAME SWIPEABLE BOTTOM SHEET AS CUSTOMER */}
      {userMode === "provider" &&
        providerJobStep !== "waiting" &&
        providerJobStep !== "incoming" &&
        mockIncomingRequest && (
          <div
            className={cn(
              "absolute left-4 right-4 z-30 transition-all duration-300 ease-out swipeable",
              isBottomSheetCompressed ? "bottom-6" : "bottom-0",
            )}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {isBottomSheetCompressed ? (
              /* Compressed Card - SAME STYLE AS CUSTOMER */
              <div
                className="glass-morphism-strong rounded-2xl p-4 shadow-lg border-0 cursor-pointer"
                onClick={() => setIsBottomSheetCompressed(false)}
              >
                {/* Swipe up indicator - same as customer */}
                <div className="flex justify-center mb-2">
                  <div className="flex flex-col items-center">
                    <ChevronUp className="h-4 w-4 text-gray-400 animate-bounce" />
                    <div className="w-8 h-0.5 bg-gray-300 rounded-full"></div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Service icon - same as customer */}
                  <div className="w-10 h-10 glass-morphism rounded-lg flex items-center justify-center border-0 text-gray-700">
                    <CategoryIcon
                      appMode={mockIncomingRequest.service.appMode ?? appMode}
                      category={
                        mockIncomingRequest.service.categoryId ?? category
                      }
                      label={mockIncomingRequest.service.category}
                      className="h-5 w-5"
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900 text-sm">
                          {mockIncomingRequest.service.name}
                        </h3>
                        <p className="text-xs text-gray-600">
                          {mockIncomingRequest.customer.name} •{" "}
                          {formatPrice(
                            providerOfferOrderTotal(mockIncomingRequest),
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <span className="font-medium">
                            {formatProviderJobStepTitle(
                              providerJobStep,
                              language,
                              {
                                servicePaused: providerServicePaused,
                                deliveryMode:
                                  mockIncomingRequest.mode === "provider"
                                    ? "at_provider"
                                    : "home",
                              },
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {providerJobStep === "accepted" &&
                            (mockIncomingRequest.mode === "home"
                              ? `${t("eta")}: ${mockIncomingRequest.location.eta}`
                              : t("customer_coming"))}
                          {providerJobStep === "enroute" &&
                            `${Math.floor(providerDriveTimer / 60)}:${(providerDriveTimer % 60).toString().padStart(2, "0")}`}
                          {providerJobStep === "in_service" &&
                            providerElapsedTime}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick action button in compressed view */}
                <div className="mt-3">
                  {providerJobStep === "accepted" &&
                    mockIncomingRequest.mode === "home" && (
                      <Button
                        className="w-full bg-blue-500 hover:bg-blue-600 text-white h-10 text-sm font-semibold rounded-xl border-0"
                        disabled={providerJobActionsBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleStartDriving();
                        }}
                      >
                        <ProviderButtonContent
                          busy={providerActionLoading === "start_driving"}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          {t("start_driving")}
                        </ProviderButtonContent>
                      </Button>
                    )}
                  {providerJobStep === "accepted" &&
                    mockIncomingRequest.mode === "provider" && (
                      <Button
                        className="w-full bg-green-500 hover:bg-green-600 text-white h-10 text-sm font-semibold rounded-xl border-0"
                        disabled={providerJobActionsBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCustomerArrived();
                        }}
                      >
                        <ProviderButtonContent
                          busy={providerActionLoading === "customer_arrived"}
                        >
                          {t("customer_arrived")}
                        </ProviderButtonContent>
                      </Button>
                    )}
                  {providerJobStep === "enroute" && (
                    <div className="flex gap-2 w-full">
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 h-10 text-sm font-medium rounded-xl border-0",
                          providerDrivingPaused
                            ? "bg-amber-500 text-white"
                            : "glass-morphism text-gray-700",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setProviderDrivingPaused(!providerDrivingPaused);
                        }}
                      >
                        {providerDrivingPaused ? (
                          <Play className="h-4 w-4" />
                        ) : (
                          <Pause className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        className="flex-1 bg-green-500 hover:bg-green-600 text-white h-10 text-sm font-semibold rounded-xl border-0"
                        disabled={providerJobActionsBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleMarkArrived();
                        }}
                      >
                        <ProviderButtonContent
                          busy={providerActionLoading === "mark_arrived"}
                        >
                          {t("arrived")}
                        </ProviderButtonContent>
                      </Button>
                    </div>
                  )}
                  {providerJobStep === "arrived" && (
                    <Button
                      className="w-full bg-green-500 hover:bg-green-600 text-white h-10 text-sm font-semibold rounded-xl border-0"
                      disabled={providerJobActionsBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleStartService();
                      }}
                    >
                      <ProviderButtonContent
                        busy={providerActionLoading === "start_service"}
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {t("start_service")}
                      </ProviderButtonContent>
                    </Button>
                  )}
                  {providerJobStep === "in_service" && (
                    <ProviderOnlineToggle
                      isOnline={providerReadyForNextToggleOn}
                      onlineLabel={t("ready_for_next_request")}
                      offlineLabel={t("ready_for_next_request")}
                      disabled={
                        !providerInServiceReadyUnlocked ||
                        Boolean(providerHeldNextJob)
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReadyForNextToggle();
                      }}
                    />
                  )}
                  {providerJobStep === "in_service" && (
                    <Button
                      className="w-full glass-morphism-strong hover:glass-morphism-strong text-gray-800 h-10 text-sm font-semibold rounded-xl border-0"
                      disabled={providerJobActionsBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompleteService();
                      }}
                    >
                      {t("complete_service")}
                    </Button>
                  )}
                  {providerJobStep === "completed" && (
                    <div
                      className="w-full space-y-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs text-center text-gray-600">
                        {t("rate_customer")}
                      </p>
                      <div className="flex justify-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            className="p-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProviderCustomerRating(star);
                              setIsBottomSheetCompressed(false);
                            }}
                          >
                            <Star
                              className={cn(
                                "h-6 w-6",
                                star <= providerCustomerRating
                                  ? "text-yellow-500 fill-current"
                                  : "text-gray-300",
                              )}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-center mt-2">
                  <p className="text-xs text-gray-500">{t("swipe_more")}</p>
                </div>
              </div>
            ) : (
              /* Expanded Bottom Sheet - SAME STYLE AS CUSTOMER */
              <div className="glass-morphism-strong rounded-t-3xl shadow-2xl border-0 min-h-[60vh] max-h-[85vh] overflow-hidden flex flex-col">
                {/* Handle - same as customer */}
                <div
                  className="flex justify-center pt-3 pb-2 cursor-pointer bg-white/10 rounded-t-3xl"
                  onClick={() =>
                    setIsBottomSheetCompressed(!isBottomSheetCompressed)
                  }
                >
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-1 bg-gray-400 rounded-full mb-1"></div>
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <div className="p-4 space-y-4 pb-8">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {formatProviderJobStepTitle(providerJobStep, language, {
                        servicePaused: providerServicePaused,
                        deliveryMode:
                          mockIncomingRequest.mode === "provider"
                            ? "at_provider"
                            : "home",
                      })}
                    </h3>

                    {providerJobStep === "completed" ? (
                      <div className="space-y-6">
                        <div className="text-center space-y-2">
                          <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto border-0">
                            <span className="text-2xl">🎉</span>
                          </div>
                          <p className="text-2xl font-bold text-green-600">
                            {formatPrice(
                              providerOfferOrderTotal(mockIncomingRequest),
                            )}
                          </p>
                          <p className="text-gray-600">
                            {t("how_was_experience")}{" "}
                            {mockIncomingRequest.customer.name}?
                          </p>
                        </div>

                        <div className="space-y-4">
                          <div className="text-center">
                            <p className="text-sm font-medium text-gray-700 mb-3">
                              {t("rate_customer")}
                            </p>
                            <div className="flex justify-center gap-2">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                  key={star}
                                  className="p-1 transition-all duration-200"
                                  onClick={() =>
                                    setProviderCustomerRating(star)
                                  }
                                >
                                  <Star
                                    className={cn(
                                      "h-8 w-8 transition-colors duration-200",
                                      star <= providerCustomerRating
                                        ? "text-yellow-500 fill-current"
                                        : "text-gray-300 hover:text-yellow-400",
                                    )}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>

                          <div className="glass-morphism rounded-xl p-4 border-0">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 glass-morphism rounded-lg flex items-center justify-center border-0 text-gray-700">
                                <CategoryIcon
                                  appMode={
                                    mockIncomingRequest.service.appMode ??
                                    appMode
                                  }
                                  category={
                                    mockIncomingRequest.service.categoryId ??
                                    category
                                  }
                                  label={mockIncomingRequest.service.category}
                                  className="h-5 w-5"
                                />
                              </div>
                              <div className="flex-1">
                                <h4 className="font-medium text-gray-900">
                                  {mockIncomingRequest.service.name}
                                </h4>
                                <p className="text-sm text-gray-600">
                                  {mockIncomingRequest.customer.name}
                                </p>
                              </div>
                              <div className="text-right">
                                <div className="font-bold text-lg text-gray-900">
                                  {formatPrice(
                                    providerOfferOrderTotal(
                                      mockIncomingRequest,
                                    ),
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        <Button
                          className="w-full glass-morphism-strong hover:glass-morphism-strong hover:scale-105 text-gray-800 h-12 text-lg font-semibold rounded-xl border-0 transition-all duration-300"
                          onClick={() => {
                            resetProviderToWaitingDashboard();
                          }}
                          disabled={providerCustomerRating === 0}
                        >
                          {t("done")}
                        </Button>
                      </div>
                    ) : (
                      <>
                        {/* Customer info - same style as provider info on customer side */}
                        <div className="flex items-center gap-3">
                          <CustomerProviderAvatar
                            avatarUrl={mockIncomingRequest.customer.avatarUrl}
                            name={mockIncomingRequest.customer.name}
                            className="w-12 h-12"
                            iconClassName="h-5 w-5"
                          />
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">
                              {mockIncomingRequest.customer.name}
                            </h3>
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Star className="h-4 w-4 fill-current text-yellow-500" />
                              <span>{mockIncomingRequest.customer.rating}</span>
                              <span>•</span>
                              <span>
                                {language === "en" ? "Code" : "Kode"}:{" "}
                                {providerMatchCode}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* ETA info - same as customer */}
                        {(providerJobStep === "accepted" ||
                          providerJobStep === "arrived") && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <MapPin className="h-4 w-4" />
                              <span>
                                {mockIncomingRequest.location.address}
                              </span>
                              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            </div>
                          </div>
                        )}

                        {/* Service Card - same as customer */}
                        <div className="glass-morphism rounded-xl p-3 border-0">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 glass-morphism rounded-lg flex items-center justify-center border-0 text-gray-700">
                              <CategoryIcon
                                appMode={
                                  mockIncomingRequest.service.appMode ?? appMode
                                }
                                category={
                                  mockIncomingRequest.service.categoryId ??
                                  category
                                }
                                label={mockIncomingRequest.service.category}
                                className="h-4 w-4"
                              />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <div>
                                  <h3 className="font-medium text-gray-900 text-sm">
                                    {mockIncomingRequest.service.name}
                                  </h3>
                                  <p className="text-xs text-gray-600">
                                    {mockIncomingRequest.mode === "home"
                                      ? t("delivery")
                                      : t("at_your_location")}{" "}
                                    •{" "}
                                    {formatPrice(
                                      providerOfferOrderTotal(
                                        mockIncomingRequest,
                                      ),
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Instructions - different based on mode */}
                        {providerJobStep === "accepted" &&
                          mockIncomingRequest.mode === "home" && (
                            <div className="glass-morphism rounded-xl p-3 border-0">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                                  <span className="text-lg">🚗</span>
                                  <span>
                                    {language === "en"
                                      ? "Drive to customer"
                                      : "Kjor til kunden"}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600 space-y-1">
                                  <p>
                                    •{" "}
                                    {language === "en"
                                      ? "Drive carefully to the address"
                                      : "Kjor forsiktig til adressen"}
                                  </p>
                                  <p>
                                    •{" "}
                                    {language === "en"
                                      ? "Contact the customer on arrival"
                                      : "Kontakt kunden ved ankomst"}
                                  </p>
                                  <p>
                                    •{" "}
                                    {language === "en"
                                      ? "Have your equipment ready"
                                      : "Ha utstyr klart"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                        {providerJobStep === "accepted" &&
                          mockIncomingRequest.mode === "provider" && (
                            <div className="glass-morphism rounded-xl p-3 border-0">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                                  <span className="text-lg">🏠</span>
                                  <span>
                                    {language === "en"
                                      ? "Get ready"
                                      : "Forbered deg"}
                                  </span>
                                </div>
                                <div className="text-xs text-gray-600 space-y-1">
                                  <p>
                                    •{" "}
                                    {language === "en"
                                      ? "The customer is on their way"
                                      : "Kunden er pa vei til deg"}
                                  </p>
                                  <p>
                                    •{" "}
                                    {language === "en"
                                      ? "Prepare your workstation"
                                      : "Gjor klar arbeidsplassen"}
                                  </p>
                                  <p>
                                    •{" "}
                                    {language === "en"
                                      ? "Have your equipment ready"
                                      : "Ha utstyr klart"}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                        {providerJobStep === "arrived" && (
                          <div className="glass-morphism rounded-xl p-3 border-0">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                                <span className="text-lg">📋</span>
                                <span>
                                  {language === "en"
                                    ? "Before you start"
                                    : "For du starter"}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600 space-y-1">
                                <p>• {t("confirm_identity")}</p>
                                <p>• {t("review_order")}</p>
                                <p>
                                  •{" "}
                                  {language === "en"
                                    ? "Check that you have all equipment"
                                    : "Sjekk at du har alt utstyr"}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Timer for enroute */}
                        {providerJobStep === "enroute" && (
                          <div className="glass-morphism rounded-xl p-3 border-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                <span className="text-sm font-medium text-gray-800">
                                  {formatProviderJobStepTitle(
                                    "enroute",
                                    language,
                                  )}
                                </span>
                              </div>
                              <span className="text-lg font-bold text-blue-600">
                                {Math.floor(providerDriveTimer / 60)}:
                                {(providerDriveTimer % 60)
                                  .toString()
                                  .padStart(2, "0")}
                              </span>
                            </div>
                          </div>
                        )}

                        {providerJobStep === "arrived" && (
                          <div className="space-y-3">
                            <button
                              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                              onClick={() =>
                                alert(
                                  language === "en"
                                    ? "Opening camera for before photo"
                                    : "Apner kamera for for-bilde",
                                )
                              }
                            >
                              <Camera className="h-4 w-4" />
                              <span>{t("take_before_photo")}</span>
                            </button>
                            <Button
                              className="w-full bg-green-500 hover:bg-green-600 text-white h-12 text-lg font-semibold rounded-xl border-0 transition-all duration-300"
                              disabled={providerJobActionsBusy}
                              onClick={() => void handleStartService()}
                            >
                              <ProviderButtonContent
                                busy={providerActionLoading === "start_service"}
                              >
                                <Play className="h-5 w-5 mr-2" />
                                {t("start_service")}
                              </ProviderButtonContent>
                            </Button>
                          </div>
                        )}

                        {providerJobStep === "in_service" && (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <div className="glass-morphism rounded-xl p-3 border-0">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div
                                      className={cn(
                                        "w-2 h-2 rounded-full shrink-0",
                                        providerServicePaused
                                          ? "bg-yellow-500"
                                          : "bg-green-500 animate-pulse",
                                      )}
                                    />
                                    <span className="text-sm font-medium text-gray-800 truncate">
                                      {formatProviderJobStepTitle(
                                        "in_service",
                                        language,
                                        {
                                          servicePaused: providerServicePaused,
                                          deliveryMode:
                                            mockIncomingRequest.mode ===
                                            "provider"
                                              ? "at_provider"
                                              : "home",
                                        },
                                      )}
                                    </span>
                                  </div>
                                  <span className="text-xl font-bold text-green-600 tabular-nums shrink-0">
                                    {providerElapsedTime}
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-gray-500 px-1">
                                {providerEstimatedDurationLabel}
                              </p>
                            </div>

                            <ProviderOnlineToggle
                              isOnline={providerReadyForNextToggleOn}
                              onlineLabel={t("ready_for_next_request")}
                              offlineLabel={t("ready_for_next_request")}
                              disabled={
                                !providerInServiceReadyUnlocked ||
                                Boolean(providerHeldNextJob)
                              }
                              onClick={() => handleReadyForNextToggle()}
                            />

                            {/* Control buttons */}
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                className={cn(
                                  "flex-1 h-10 rounded-xl border-0 transition-all",
                                  providerServicePaused
                                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                                    : "glass-morphism text-gray-700 hover:bg-white/40",
                                )}
                                onClick={() =>
                                  void toggleProviderServicePause()
                                }
                              >
                                {providerServicePaused ? (
                                  <>
                                    <Play className="h-4 w-4 mr-1" />{" "}
                                    {t("continue")}
                                  </>
                                ) : (
                                  <>
                                    <Pause className="h-4 w-4 mr-1" />{" "}
                                    {t("pause")}
                                  </>
                                )}
                              </Button>
                              <Button
                                variant="outline"
                                className="h-10 rounded-xl border-0 glass-morphism text-red-600 hover:bg-red-50"
                                onClick={() => {
                                  if (confirm(t("confirm_cancel_service"))) {
                                    setProviderReadyForNext(false);
                                    setProviderJobStep("waiting");
                                    setProviderServiceTimer(0);
                                    setProviderServiceStartedAt(null);
                                    setProviderServicePausedAt(null);
                                    setProviderServicePausedTotalSeconds(0);
                                  }
                                }}
                              >
                                <XCircle className="h-4 w-4 mr-1" />{" "}
                                {t("cancel")}
                              </Button>
                            </div>

                            {/* Before completing */}
                            <button
                              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                              onClick={() =>
                                alert(
                                  language === "en"
                                    ? "Opening camera for after photo"
                                    : "Apner kamera for etter-bilde",
                                )
                              }
                            >
                              <Camera className="h-4 w-4" />
                              <span>{t("take_after_photo")}</span>
                            </button>

                            <Button
                              className="w-full glass-morphism-strong hover:glass-morphism-strong hover:scale-105 text-gray-800 h-12 text-lg font-semibold rounded-xl border-0 transition-all duration-300"
                              disabled={providerJobActionsBusy}
                              onClick={() => handleCompleteService()}
                            >
                              <ProviderButtonContent
                                busy={
                                  providerActionLoading === "complete_service"
                                }
                              >
                                {t("complete_service")}
                              </ProviderButtonContent>
                            </Button>
                          </div>
                        )}
                        {/* Action buttons */}
                        {providerJobStep === "accepted" &&
                          mockIncomingRequest.mode === "home" && (
                            <>
                              <Button
                                className="w-full glass-morphism-strong hover:glass-morphism-strong rounded-xl h-10 text-sm border-0 text-gray-800"
                                onClick={() => {
                                  if (providerCustomerTarget) {
                                    openExternalMapsDirections(
                                      providerCustomerTarget,
                                      providerMapOrigin ??
                                        providerOrderProviderPin ??
                                        providerPos,
                                    );
                                  }
                                }}
                              >
                                <MapPin className="h-4 w-4 mr-2" />
                                {t("directions")}
                              </Button>
                              <Button
                                className="w-full bg-blue-500 hover:bg-blue-600 text-white h-12 text-lg font-semibold rounded-xl border-0 transition-all duration-300"
                                disabled={providerJobActionsBusy}
                                onClick={() => void handleStartDriving()}
                              >
                                <ProviderButtonContent
                                  busy={
                                    providerActionLoading === "start_driving"
                                  }
                                >
                                  <Play className="h-5 w-5 mr-2" />
                                  {t("start_driving")}
                                </ProviderButtonContent>
                              </Button>
                            </>
                          )}

                        {providerJobStep === "accepted" &&
                          mockIncomingRequest.mode === "provider" && (
                            <Button
                              className="w-full bg-green-500 hover:bg-green-600 text-white h-12 text-lg font-semibold rounded-xl border-0 transition-all duration-300"
                              disabled={providerJobActionsBusy}
                              onClick={() => void handleCustomerArrived()}
                            >
                              <ProviderButtonContent
                                busy={
                                  providerActionLoading === "customer_arrived"
                                }
                              >
                                {t("customer_arrived")}
                              </ProviderButtonContent>
                            </Button>
                          )}

                        {providerJobStep === "enroute" && (
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              className={cn(
                                "flex-1 h-12 rounded-xl border-0 font-medium transition-all",
                                providerDrivingPaused
                                  ? "bg-amber-500 text-white hover:bg-amber-600"
                                  : "glass-morphism text-gray-700 hover:bg-white/40",
                              )}
                              disabled={providerJobActionsBusy}
                              onClick={() =>
                                setProviderDrivingPaused(!providerDrivingPaused)
                              }
                            >
                              {providerDrivingPaused ? (
                                <>
                                  <Play className="h-4 w-4 mr-2" />
                                  {language === "en" ? "Resume" : "Fortsett"}
                                </>
                              ) : (
                                <>
                                  <Pause className="h-4 w-4 mr-2" />
                                  {language === "en" ? "Pause" : "Pause"}
                                </>
                              )}
                            </Button>
                            <Button
                              className="flex-1 bg-green-500 hover:bg-green-600 text-white h-12 rounded-xl border-0 transition-all duration-300 font-semibold"
                              disabled={providerJobActionsBusy}
                              onClick={() => void handleMarkArrived()}
                            >
                              <ProviderButtonContent
                                busy={providerActionLoading === "mark_arrived"}
                              >
                                <MapPin className="h-4 w-4 mr-2" />
                                {language === "en" ? "Arrived" : "Fremme"}
                              </ProviderButtonContent>
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Provider Online Toggle - integrated minimal pill above bottom sheet */}
      {step === "map" &&
        userMode === "provider" &&
        providerJobStep === "waiting" &&
        isBottomSheetCompressed && (
          <div
            className="absolute left-4 right-4 z-30 transition-all duration-300"
            style={{ bottom: "175px" }}
          >
            <ProviderOnlineToggle
              isOnline={isProviderOnline}
              onlineLabel={t("online")}
              offlineLabel={t("offline")}
              onClick={() => void toggleProviderOnlinePersisted()}
            />
          </div>
        )}

      {/* Always-visible Bottom Sheet for service selection - hide when provider has active job */}
      {step === "map" &&
        !(
          userMode === "provider" &&
          providerJobStep !== "waiting" &&
          Boolean(mockIncomingRequest)
        ) && (
          <div
            className={cn(
              "absolute left-0 right-0 z-40 swipeable min-h-0",
              isBottomSheetCompressed
                ? "bottom-0 transition-all duration-300 ease-out"
                : "bottom-0 flex h-full min-h-0 flex-col overflow-hidden",
            )}
            style={
              isBottomSheetCompressed
                ? undefined
                : {
                    bottom: 0,
                    height:
                      "min(calc(100dvh - var(--sheet-top-inset, 8.5rem)), 580px)",
                    maxHeight:
                      "min(calc(100dvh - var(--sheet-top-inset, 8.5rem)), 580px)",
                  }
            }
            onTouchStart={
              isBottomSheetCompressed ? handleTouchStart : undefined
            }
            onTouchMove={isBottomSheetCompressed ? handleTouchMove : undefined}
            onTouchEnd={isBottomSheetCompressed ? handleTouchEnd : undefined}
          >
            {isBottomSheetCompressed ? (
              /* Compressed state - small peek */
              <div
                className="glass-morphism-strong rounded-t-3xl shadow-2xl cursor-pointer"
                onClick={() => setIsBottomSheetCompressed(false)}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-2">
                  <div className="flex flex-col items-center">
                    <ChevronUp className="h-4 w-4 text-gray-400 animate-bounce" />
                    <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
                  </div>
                </div>

                {/* Demand indicator - center */}
                <div className="flex justify-center pb-1 px-4">
                  {renderTopDemandIndicator()}
                </div>

                <div className="px-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                          <CategoryIcon
                            appMode={appMode}
                            category={resolvedCategoryId}
                            label={activeCategory?.label}
                            className="h-3 w-3"
                          />
                          <span>
                            {t(activeCategory?.label || "") ||
                              prettifyServiceName(resolvedCategoryId)}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">•</span>
                        <span className="text-xs text-gray-500">
                          {activeTarget?.icon} {activeTarget?.label}
                        </span>
                      </div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {userMode === "provider"
                          ? t("your_services")
                          : `${t("select")} ${t(activeCategory?.label || "") || t("service")}`}
                      </h2>
                      <p className="text-xs text-gray-600">
                        {userMode === "provider"
                          ? `${providerVisibleOnlineCount} / ${visibleServices.length} online`
                          : `${visibleBookableServiceCount} ${language === "en" ? "services available" : "tjenester tilgjengelig"}`}
                      </p>
                    </div>
                    {userMode === "customer" ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <div className="glass-morphism rounded-full p-1 flex">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "h-7 px-2 rounded-full font-medium border-0 transition-all duration-300 text-xs",
                              mode === "home"
                                ? "glass-button-active"
                                : "glass-button text-gray-700",
                            )}
                            title={
                              mode === "home"
                                ? language === "en"
                                  ? "You are currently providing delivery."
                                  : "Du tilbyr for øyeblikket Delivery."
                                : language === "en"
                                  ? "Switch to delivery."
                                  : "Bytt til Delivery."
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              setMode("home");
                            }}
                          >
                            Delivery
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "h-7 px-2 rounded-full font-medium border-0 transition-all duration-300 text-xs",
                              mode === "provider"
                                ? "glass-button-active"
                                : "glass-button text-gray-700",
                            )}
                            title={
                              mode === "provider"
                                ? language === "en"
                                  ? "You are currently providing at provider."
                                  : "Du tilbyr for øyeblikket hos tilbyder."
                                : language === "en"
                                  ? "Switch to at provider."
                                  : "Bytt til hos tilbyder."
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              setMode("provider");
                            }}
                          >
                            {t("at_provider")}
                          </Button>
                        </div>
                        {mode === "home" && (
                          <span className="text-xs text-gray-500">
                            +{formatDeliveryRateLabel(language)}
                          </span>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              /* Expanded: capped sheet, fixed header, cards scroll underneath */
              <div className="glass-morphism-strong rounded-t-3xl shadow-2xl flex h-full min-h-0 flex-col overflow-hidden">
                {/* Fixed header — handle, demand, title, toggle */}
                <div className="shrink-0 bg-[#F8F8F8]/95 backdrop-blur-md rounded-t-3xl">
                  <div
                    className="flex justify-center pt-3 pb-2 cursor-pointer"
                    onClick={() => setIsBottomSheetCompressed(true)}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  >
                    <div className="flex flex-col items-center">
                      <div className="w-10 h-1 bg-gray-300 rounded-full mb-1"></div>
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    </div>
                  </div>

                  <div className="flex justify-center pb-2 px-4">
                    {renderTopDemandIndicator()}
                  </div>

                  <div className="px-4 pb-3">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <div className="flex items-center gap-1 text-xs text-gray-500">
                            <CategoryIcon
                              appMode={appMode}
                              category={resolvedCategoryId}
                              label={activeCategory?.label}
                              className="h-3 w-3"
                            />
                            <span>
                              {t(activeCategory?.label || "") ||
                                prettifyServiceName(resolvedCategoryId)}
                            </span>
                          </div>
                          <span className="text-xs text-gray-400">•</span>
                          <span className="text-xs text-gray-500">
                            {activeTarget?.icon} {activeTarget?.label}
                          </span>
                        </div>
                        <h2 className="text-lg font-semibold text-gray-900">
                          {userMode === "provider"
                            ? t("your_services")
                            : `${t("select")} ${t(activeCategory?.label || "") || t("service")}`}
                        </h2>
                        <p className="text-sm text-gray-600">
                          {userMode === "provider"
                            ? `${providerVisibleOnlineCount} / ${visibleServices.length} online`
                            : `${visibleBookableServiceCount} ${language === "en" ? "services available" : "tjenester tilgjengelig"}`}
                        </p>
                      </div>
                      {userMode === "customer" ? (
                        <div className="flex flex-col items-end gap-1">
                          <div className="glass-morphism rounded-full p-1 flex">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 px-3 rounded-full font-medium border-0 transition-all duration-300 text-sm",
                                mode === "home"
                                  ? "glass-button-active"
                                  : "glass-button text-gray-700",
                              )}
                              title={
                                mode === "home"
                                  ? language === "en"
                                    ? "Delivery selected."
                                    : "Delivery valgt."
                                  : language === "en"
                                    ? "Switch to delivery."
                                    : "Bytt til Delivery."
                              }
                              onClick={() => setMode("home")}
                            >
                              Delivery
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn(
                                "h-8 px-3 rounded-full font-medium border-0 transition-all duration-300 text-sm",
                                mode === "provider"
                                  ? "glass-button-active"
                                  : "glass-button text-gray-700",
                              )}
                              title={
                                mode === "provider"
                                  ? language === "en"
                                    ? "At provider selected."
                                    : "Hos tilbyder valgt."
                                  : language === "en"
                                    ? "Switch to at provider."
                                    : "Bytt til hos tilbyder."
                              }
                              onClick={() => setMode("provider")}
                            >
                              {t("at_provider")}
                            </Button>
                          </div>
                          {mode === "home" && (
                            <span className="text-xs text-gray-500">
                              +{formatDeliveryRateLabel(language)}
                            </span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Scrollable service list — header above stays put */}
                <div className="relative min-h-0 flex-1">
                  <div className="absolute inset-0 overflow-y-auto overscroll-contain touch-pan-y px-4 space-y-2 py-2">
                    {visibleServices.length > 0 ? (
                      visibleServices.map((style, index) => {
                        const isExpanded = expandedStyleId === style.id;
                        const styleVariants = serviceIdVariantsForDashboard(
                          style.id,
                        );
                        const matchedRegisteredServiceId =
                          registeredServices.find((id) =>
                            styleVariants.includes(normalizeServiceId(id)),
                          ) || null;
                        const isStyleOnline = onlineServices.some((id) =>
                          styleVariants.includes(normalizeServiceId(id)),
                        );
                        const canProviderUseService =
                          userMode !== "provider" ||
                          Boolean(matchedRegisteredServiceId);
                        const addonsTotal = selectedAddons.reduce(
                          (sum, id) =>
                            sum +
                            (currentAddons.find((a) => a.id === id)?.price ||
                              0),
                          0,
                        );
                        const cardServicePrice =
                          userMode === "customer"
                            ? customerServiceDisplayPrice(style)
                            : Number(style.price) || 0;
                        const basePrice =
                          cardServicePrice +
                          (isExpanded && userMode === "customer"
                            ? addonsTotal
                            : 0);
                        const totalPrice = calculateStylePrice(style); // includes delivery fee for final calculation
                        const stylePricingServiceId =
                          bookingPricingServiceId(style);
                        const customerDemandTier =
                          userMode === "customer"
                            ? customerDemandTierFromPrices(
                                stylePricingServiceId,
                                dynamicPrices,
                              )
                            : null;
                        const providerDemandTier =
                          userMode === "provider"
                            ? providerDemandTierFromPrices(
                                stylePricingServiceId,
                                dynamicPrices,
                              )
                            : null;
                        const displayAvailability =
                          userMode === "provider"
                            ? providerDemandTier
                              ? tierShortLabel(
                                  providerDemandTier,
                                  "provider",
                                  language === "en" ? "en" : "no",
                                )
                              : language === "en"
                                ? "Loading demand…"
                                : "Laster etterspørsel…"
                            : userMode === "customer"
                              ? customerDemandTier
                                ? tierShortLabel(
                                    customerDemandTier,
                                    "customer",
                                    language === "en" ? "en" : "no",
                                  )
                                : language === "en"
                                  ? "Loading prices…"
                                  : "Laster priser…"
                              : style.availability;
                        const statusTier =
                          userMode === "provider"
                            ? providerDemandTier
                            : customerDemandTier;
                        const skillModeKey = normalizeServiceId(
                          matchedRegisteredServiceId || style.id,
                        );
                        const skillDeliveryMode =
                          providerSkillModes[skillModeKey] ||
                          providerSkillModes[normalizeServiceId(style.id)] ||
                          "both";
                        const cardDimmed =
                          userMode === "customer" && statusTier === "closed";

                        return (
                          <div
                            key={style.id}
                            className={cn(
                              "glass-morphism rounded-xl overflow-hidden border-0",
                              cardDimmed && "opacity-50",
                            )}
                          >
                            {/* Compact card */}
                            <div
                              role="button"
                              tabIndex={0}
                              className="w-full p-3 text-left transition-all duration-300 hover:bg-white/10"
                              onClick={() => {
                                if (isExpanded) {
                                  setExpandedStyleId(null);
                                } else {
                                  setExpandedStyleId(style.id);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  if (isExpanded) {
                                    setExpandedStyleId(null);
                                  } else {
                                    setExpandedStyleId(style.id);
                                  }
                                }
                              }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  {/* Category-specific icon */}
                                  <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-[#F3F4F2] border-0 text-gray-700">
                                    <CategoryIcon
                                      appMode={appMode}
                                      category={category}
                                      label={activeCategory?.label}
                                      className="h-5 w-5"
                                    />
                                  </div>

                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <h3 className="font-medium text-gray-900 text-sm">
                                        {style.name}
                                      </h3>
                                      {appMode === "vehicle" && (
                                        <span className="text-sm">
                                          {resolveTargetIcon(
                                            normalizeCatalogTargetKey(target),
                                            MODE_TARGETS[appMode] || [],
                                          )}
                                        </span>
                                      )}
                                      {style.tags.map((tag: string) => (
                                        <span
                                          key={tag}
                                          className="px-2 py-0.5 glass-morphism text-gray-700 text-xs font-medium rounded-full border-0"
                                        >
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
                                      <span
                                        className={cn(
                                          "flex items-center gap-1",
                                          statusTier
                                            ? tierTextClass(statusTier)
                                            : "text-gray-500",
                                        )}
                                      >
                                        <div
                                          className={cn(
                                            "w-1.5 h-1.5 rounded-full",
                                            statusTier
                                              ? demandTierDotClass(statusTier)
                                              : "bg-gray-300",
                                            userMode === "provider" &&
                                              statusTier === "green" &&
                                              "animate-pulse",
                                          )}
                                        />
                                        {displayAvailability}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="text-right flex items-center gap-2">
                                  {userMode === "provider" ? (
                                    /* Online toggle for provider - locked if not registered */
                                    canProviderUseService ? (
                                      <button
                                        className={cn(
                                          "w-12 h-7 rounded-full transition-all duration-300 relative touch-manipulation",
                                          isStyleOnline
                                            ? "bg-green-500"
                                            : "bg-gray-300",
                                        )}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          const nextActive = !isStyleOnline;
                                          void toggleProviderSkillActivePersisted(
                                            matchedRegisteredServiceId ||
                                              style.id,
                                            nextActive,
                                          );
                                        }}
                                        onTouchStart={(e) =>
                                          e.stopPropagation()
                                        }
                                        onTouchMove={(e) => e.stopPropagation()}
                                      >
                                        <div
                                          className={cn(
                                            "absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-all duration-300 pointer-events-none",
                                            isStyleOnline
                                              ? "right-1"
                                              : "left-1",
                                          )}
                                        />
                                      </button>
                                    ) : (
                                      /* Locked - not registered */
                                      <button
                                        type="button"
                                        className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          e.preventDefault();
                                          setSkillsFocusServiceId(style.id);
                                          setCurrentPage("skills");
                                        }}
                                      >
                                        <Lock className="h-4 w-4" />
                                        <span className="text-xs">
                                          {t("add_to_skills")}
                                        </span>
                                      </button>
                                    )
                                  ) : (
                                    /* Price stays visible even when no providers are nearby. */
                                    <div className="flex items-center gap-1.5">
                                      {customerDemandTier ? (
                                        <span
                                          className={cn(
                                            "text-sm font-semibold leading-none",
                                            tierTextClass(customerDemandTier),
                                          )}
                                          aria-hidden
                                        >
                                          {tierPriceArrow(customerDemandTier)}
                                        </span>
                                      ) : null}
                                      <div
                                        className={cn(
                                          "font-bold text-base tabular-nums min-w-[3.5rem] text-right",
                                          customerBulkPricesLoading
                                            ? "text-gray-400"
                                            : "text-gray-900",
                                        )}
                                      >
                                        {customerBulkPricesLoading
                                          ? "···"
                                          : formatPrice(basePrice)}
                                      </div>
                                    </div>
                                  )}
                                  {isExpanded ? (
                                    <ChevronUp className="h-4 w-4 text-gray-400" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                  )}
                                </div>
                              </div>
                              {userMode === "provider" &&
                              canProviderUseService ? (
                                <div
                                  className="mt-2 flex flex-nowrap items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => e.stopPropagation()}
                                >
                                  <div
                                    className={cn(
                                      "glass-morphism flex shrink-0 rounded-full p-0.5",
                                      skillDeliveryMode === "both" &&
                                        "opacity-40",
                                    )}
                                  >
                                    <button
                                      type="button"
                                      className={cn(
                                        "h-6 shrink-0 whitespace-nowrap rounded-full px-2 text-[11px] font-medium transition-all",
                                        skillDeliveryMode === "home"
                                          ? "bg-white text-gray-900 shadow-sm"
                                          : "text-gray-600",
                                      )}
                                      onClick={() =>
                                        void setProviderSkillModePersisted(
                                          matchedRegisteredServiceId ||
                                            style.id,
                                          "home",
                                        )
                                      }
                                    >
                                      Delivery
                                    </button>
                                    <button
                                      type="button"
                                      className={cn(
                                        "h-6 shrink-0 whitespace-nowrap rounded-full px-2 text-[11px] font-medium transition-all",
                                        skillDeliveryMode === "provider"
                                          ? "bg-white text-gray-900 shadow-sm"
                                          : "text-gray-600",
                                      )}
                                      onClick={() =>
                                        void setProviderSkillModePersisted(
                                          matchedRegisteredServiceId ||
                                            style.id,
                                          "provider",
                                        )
                                      }
                                    >
                                      {t("at_provider")}
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className={cn(
                                      "h-6 shrink-0 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium transition-all",
                                      skillDeliveryMode === "both"
                                        ? "border-green-500 bg-green-500 text-white"
                                        : "border-white/40 bg-white/50 text-gray-600",
                                    )}
                                    onClick={() =>
                                      void setProviderSkillModePersisted(
                                        matchedRegisteredServiceId || style.id,
                                        "both",
                                      )
                                    }
                                  >
                                    {language === "en" ? "Both" : "Begge"}
                                  </button>
                                </div>
                              ) : null}
                            </div>

                            {/* Expanded details - minimalist */}
                            {isExpanded && (
                              <div className="border-t border-white/20 p-3 space-y-3">
                                {/* Description and details */}
                                <div>
                                  <p className="text-xs text-gray-600 mb-2">
                                    {style.description}
                                  </p>
                                  <div className="flex items-center gap-3 text-xs text-gray-600">
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      <span>{style.duration} min</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Star className="h-3 w-3 fill-current text-yellow-500" />
                                      <span>{style.rating.toFixed(1)}</span>
                                    </div>
                                    <span>
                                      {style.bookings.toLocaleString()}{" "}
                                      {language === "en"
                                        ? "bookings"
                                        : "bestillinger"}
                                    </span>
                                  </div>
                                </div>

                                {/* Dynamic Add-ons based on category */}
                                {currentAddons.length > 0 && (
                                  <div>
                                    <h4 className="font-medium text-gray-900 mb-2 text-sm">
                                      {t("addons")}
                                    </h4>
                                    <div className="space-y-1">
                                      {currentAddons.map((addon) => {
                                        const isSelected =
                                          selectedAddons.includes(addon.id);
                                        return (
                                          <button
                                            key={addon.id}
                                            className={cn(
                                              "w-full p-2 rounded-lg text-left transition-all duration-200 text-xs glass-morphism border-0",
                                              isSelected
                                                ? "bg-green-500/20 text-green-800"
                                                : "text-gray-700 hover:bg-white/10",
                                            )}
                                            onClick={() => {
                                              setSelectedAddons((prev) =>
                                                prev.includes(addon.id)
                                                  ? prev.filter(
                                                      (id) => id !== addon.id,
                                                    )
                                                  : [...prev, addon.id],
                                              );
                                            }}
                                          >
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-2">
                                                <div
                                                  className={cn(
                                                    "w-4 h-4 rounded-full border flex items-center justify-center",
                                                    isSelected
                                                      ? "bg-green-500 border-green-500"
                                                      : "border-gray-300",
                                                  )}
                                                >
                                                  {isSelected && (
                                                    <Check className="h-2 w-2 text-white" />
                                                  )}
                                                </div>
                                                <span className="font-medium">
                                                  {addon.name}
                                                </span>
                                                <span className="text-gray-500">
                                                  +{addon.time} min
                                                </span>
                                              </div>
                                              <span className="font-semibold">
                                                +{formatPrice(addon.price)}
                                              </span>
                                            </div>
                                            {mode === "home" &&
                                            isEquipmentDependentAddon(
                                              addon.id,
                                            ) ? (
                                              <p className="text-[10px] text-gray-400 mt-1 pl-6">
                                                {t("addon_home_visit_may_vary")}
                                              </p>
                                            ) : null}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      // Coming Soon message
                      <div className="text-center py-8 space-y-3">
                        <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto border-0">
                          <Clock className="h-8 w-8 text-gray-400" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-1">
                            {language === "en"
                              ? "No services"
                              : "Ingen tjenester"}
                          </h3>
                          <p className="text-gray-600 text-sm">
                            {language === "en"
                              ? "Select a different category or mode"
                              : "Velg en annen kategori eller modus"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          className="glass-button text-gray-700 hover:bg-white/20 border-0"
                          onClick={() => {
                            setAppMode("beauty");
                            setTarget("male");
                            setCategory("haircut");
                          }}
                        >
                          {language === "en" ? "Try Beauty" : "Prøv Beauty"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom section with payment and confirm - Fixed positioning - only for customer */}
                {userMode === "customer" &&
                  (() => {
                    const expandedStyle = expandedStyleId
                      ? visibleServices.find((s) => s.id === expandedStyleId)
                      : null;
                    const expandedClosed =
                      !!expandedStyle &&
                      customerDemandTierFromPrices(
                        bookingPricingServiceId(expandedStyle),
                        dynamicPrices,
                      ) === "closed";
                    return (
                      <div className="shrink-0 border-t border-white/20 p-4 space-y-2 bg-white/20 backdrop-blur-md pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
                        <div className="flex items-center justify-end">
                          <button
                            className="flex items-center gap-1.5 px-2 py-1 glass-morphism border-0 rounded-lg hover:bg-white/30 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPaymentMethod(
                                paymentMethod === "apple_pay"
                                  ? "card"
                                  : "apple_pay",
                              );
                            }}
                          >
                            {paymentMethod === "apple_pay" ? (
                              <>
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                >
                                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                                </svg>
                                <span className="text-xs font-medium text-gray-700">
                                  Pay
                                </span>
                              </>
                            ) : (
                              <>
                                <svg
                                  className="h-3.5 w-3.5"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <rect
                                    x="1"
                                    y="4"
                                    width="22"
                                    height="16"
                                    rx="2"
                                    ry="2"
                                  />
                                  <line x1="1" y1="10" x2="23" y2="10" />
                                </svg>
                                <span className="text-xs font-medium text-gray-700">
                                  {language === "no" ? "Kort" : "Card"}
                                </span>
                              </>
                            )}
                          </button>
                        </div>

                        {/* Confirm button - Always visible */}
                        <Button
                          className={cn(
                            "w-full h-12 text-base font-semibold rounded-xl border-0 transition-all duration-300",
                            expandedStyleId && !expandedClosed
                              ? "bg-green-500 hover:bg-green-600 text-white"
                              : "glass-morphism text-gray-500 cursor-not-allowed",
                          )}
                          disabled={!expandedStyleId || expandedClosed}
                          onClick={() => {
                            if (!expandedStyle || expandedClosed) return;
                            // Clear any previous provider-matching error when starting a fresh selection.
                            setMatchError(null);
                            clearBookingLockState();
                            setSelectedStyle(expandedStyle);
                            setStep("confirm");
                          }}
                        >
                          {expandedClosed
                            ? language === "en"
                              ? "No providers available right now"
                              : "Ingen tilbydere tilgjengelig nå"
                            : expandedStyleId
                              ? t("confirm_selection")
                              : t("select_service")}
                        </Button>
                      </div>
                    );
                  })()}
              </div>
            )}
          </div>
        )}

      {/* Bottom Sheet - Confirm Step */}
      {step === "confirm" && selectedStyle && (
        <div className="absolute bottom-0 left-0 right-0 z-40 glass-morphism-strong rounded-t-3xl shadow-2xl animate-in slide-in-from-bottom-4 duration-500 border-0">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
          </div>

          {/* Progress Bar */}
          <ProgressBar currentStep={step} />

          <div className="p-4">
            {/* Header with back button */}
            <div className="flex items-center gap-3 mb-4">
              <Button
                variant="ghost"
                size="icon"
                className="glass-button border-0 text-gray-700 h-8 w-8 flex-shrink-0"
                onClick={() => {
                  // Leaving confirm should not carry stale errors into the next confirm attempt.
                  setMatchError(null);
                  setIsMatching(false);
                  clearBookingPricingState();
                  setStep("map");
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h2 className="text-lg font-semibold text-gray-900">
                {t("confirm_booking")}
              </h2>
            </div>

            {/* Selected style card with expanded info */}
            <div className="glass-morphism rounded-2xl p-4 space-y-3 border-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 glass-morphism rounded-xl flex items-center justify-center border-0 text-gray-700">
                  <CategoryIcon
                    appMode={appMode}
                    category={category}
                    className="h-6 w-6"
                  />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">
                    {selectedStyle.name}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Star className="h-3 w-3 fill-current text-yellow-500" />
                    <span>{selectedStyle.rating.toFixed(1)}</span>
                    <span>•</span>
                    <span>{selectedStyle.duration} min</span>
                  </div>
                </div>
                <div className="text-right flex items-center justify-end gap-1.5">
                  {confirmBookingDemandTier ? (
                    <span
                      className={cn(
                        "text-sm font-semibold leading-none",
                        tierTextClass(confirmBookingDemandTier),
                      )}
                      aria-hidden
                    >
                      {tierPriceArrow(confirmBookingDemandTier)}
                    </span>
                  ) : null}
                  <div className="font-bold text-lg text-gray-900 tabular-nums">
                    {formatPrice(customerServiceDisplayPrice(selectedStyle))}
                  </div>
                </div>
              </div>

              {/* Add-ons if selected */}
              {selectedAddons.length > 0 && (
                <div className="border-t border-white/20 pt-3">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    {t("addons_label")}
                  </h4>
                  <div className="space-y-1">
                    {selectedAddons.map((addonId) => {
                      const addon = currentAddons.find((a) => a.id === addonId);
                      if (!addon) return null;
                      return (
                        <div
                          key={addonId}
                          className="flex justify-between text-sm"
                        >
                          <span className="text-gray-600">{addon.name}</span>
                          <span className="text-gray-900">
                            +{formatPrice(addon.price)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Location and delivery fee */}
              <div className="border-t border-white/20 pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t("location")}</span>
                  <span className="font-medium text-gray-900">
                    {mode === "home" ? t("delivery") : t("at_provider")}
                  </span>
                </div>
                {mode === "home" && (
                  <div className="flex items-start justify-between text-sm">
                    <span className="text-gray-600">{t("delivery")}</span>
                    <div className="text-right">
                      <div className="text-gray-900">
                        {formatDeliveryRateLabel(language)}
                      </div>
                      <div className="text-xs text-gray-500">
                        {language === "en"
                          ? `${formatPrice(deliveryReserveCeilingKr)} reserved`
                          : `${formatPrice(deliveryReserveCeilingKr)} reservert`}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment */}
              <div className="border-t border-white/20 pt-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t("payment")}</span>
                  <div className="flex items-center gap-2">
                    {paymentMethod === "apple_pay" ? (
                      <>
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                        </svg>
                        <span className="font-medium text-gray-900">
                          Apple Pay
                        </span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect
                            x="1"
                            y="4"
                            width="22"
                            height="16"
                            rx="2"
                            ry="2"
                          />
                          <line x1="1" y1="10" x2="23" y2="10" />
                        </svg>
                        <span className="font-medium text-gray-900">
                          {language === "no" ? "Kort" : "Card"}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Comment/Note */}
              <div className="border-t border-white/20 pt-3">
                <button
                  className="flex items-center justify-between text-sm w-full"
                  onClick={() => {
                    const comment = prompt(
                      language === "en"
                        ? "Add a comment for the provider (optional):"
                        : "Legg til en kommentar til tilbyderen (valgfritt):",
                    );
                    if (comment) {
                      alert(`Kommentar lagret: "${comment}"`);
                    }
                  }}
                >
                  <span className="text-gray-600">{t("comment")}</span>
                  <div className="flex items-center gap-2 text-gray-500">
                    <span className="text-xs">{t("add")}</span>
                    <MessageSquare className="h-4 w-4" />
                  </div>
                </button>
              </div>

              {/* Total + card hold (home delivery authorises the 10 km ceiling). */}
              <div className="border-t border-white/20 pt-3">
                <div className="flex items-center justify-between text-base">
                  <span className="font-semibold text-gray-800">
                    {t("total")}
                  </span>
                  <span className="font-bold text-green-600 text-lg">
                    {formatPrice(calculateStylePrice(selectedStyle))}
                  </span>
                </div>
                {mode === "home" &&
                confirmBookingReserveAmountKr != null &&
                confirmBookingReserveAmountKr >
                  calculateStylePrice(selectedStyle) ? (
                  <p className="mt-1.5 text-xs text-gray-500 leading-snug">
                    {t("card_hold_disclosure")
                      .replace(
                        "{quoted}",
                        formatPrice(calculateStylePrice(selectedStyle)),
                      )
                      .replace(
                        "{hold}",
                        formatPrice(confirmBookingReserveAmountKr),
                      )}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Final CTA */}
            {matchError && (
              <p className="mt-4 text-sm text-red-600">{matchError}</p>
            )}
            <Button
              className="w-full glass-morphism-strong hover:glass-morphism-strong hover:scale-105 text-gray-800 h-12 text-lg font-semibold rounded-xl mt-4 border-0 transition-all duration-300"
              onClick={() => void handleConfirmBooking()}
              disabled={
                isMatching ||
                bookingPaymentPreparing ||
                (priceLockLoading && !priceLockId)
              }
            >
              {isMatching ? (
                language === "en" ? (
                  "Matching..."
                ) : (
                  "Matcher..."
                )
              ) : bookingPaymentPreparing ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  {language === "en"
                    ? "Authorizing payment…"
                    : "Autoriserer betaling…"}
                </span>
              ) : priceLockLoading && !priceLockId ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  {language === "en" ? "Locking price…" : "Låser pris…"}
                </span>
              ) : (
                t("confirm_booking")
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Service Card - Only for Searching */}
      {step === "searching" && selectedStyle && (
        <div className="absolute bottom-6 left-4 right-4 z-40 animate-in fade-in-50 duration-500">
          <ServiceCard
            title={selectedStyle.name}
            subtitle={`${orderRealtimeState === "reconnecting" ? `${language === "en" ? "Reconnecting…" : "Kobler til på nytt…"} • ` : ""}${mode === "home" ? t("delivery") : t("at_provider")} • ${formatPrice(calculateStylePrice(selectedStyle))}${process.env.NODE_ENV === "development" && orderId ? ` • #${orderId.slice(0, 8)}` : ""}`}
            onCancel={() => {
              void exitSearching();
            }}
            isSearching={true}
            icon={
              <CategoryIcon
                appMode={appMode}
                category={category}
                className="h-5 w-5"
              />
            }
          />
        </div>
      )}

      {(step === "matched" || step === "in_service") &&
        orderRealtimeState === "reconnecting" && (
          <div className="absolute top-16 left-4 right-4 z-50">
            <div className="glass-morphism-strong rounded-xl px-3 py-2 text-xs text-amber-800 border border-amber-200/60 text-center">
              {language === "en"
                ? "Reconnecting to live updates…"
                : "Kobler til live-oppdateringer på nytt…"}
            </div>
          </div>
        )}

      {/* Action Buttons - Grouped on Map for Matched/In-Service */}
      {(step === "matched" || step === "in_service") && (
        <div className="absolute top-16 right-4 z-50 flex flex-col gap-3">
          {/* Emergency Button */}
          <Button
            size="icon"
            className="h-12 w-12 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg border-0"
            onClick={() => setShowEmergency(true)}
          >
            <span className="text-lg">🚨</span>
          </Button>

          {/* Phone Button */}
          <Button
            size="icon"
            className="h-12 w-12 rounded-full glass-morphism-strong hover:glass-morphism-strong text-gray-800 shadow-lg border-0"
            onClick={() => {
              const tel = String(provider?.phone || "")
                .trim()
                .replace(/[^\d+]/g, "");
              if (!tel || tel === "+") {
                alert(
                  language === "en"
                    ? "No phone number saved in profile"
                    : "Ingen telefonnummer lagret i profilen",
                );
                return;
              }
              window.location.href = `tel:${tel}`;
            }}
          >
            <Phone className="h-5 w-5" />
          </Button>

          {/* Chat Button */}
          <Button
            size="icon"
            className="h-12 w-12 rounded-full glass-morphism-strong hover:glass-morphism-strong text-gray-800 shadow-lg border-0"
            onClick={() => setShowChat(true)}
          >
            <MessageCircle className="h-5 w-5" strokeWidth={2.25} />
          </Button>
        </div>
      )}

      {/* Swipeable Service Card - Matched/In Service */}
      {(step === "matched" || step === "in_service") &&
        provider &&
        selectedStyle && (
          <div
            className={cn(
              "absolute left-4 right-4 z-30 transition-all duration-300 ease-out swipeable",
              isBottomSheetCompressed ? "bottom-6" : "bottom-0", // Changed from bottom-16 to bottom-0
            )}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {isBottomSheetCompressed ? (
              /* Compressed Service Card med swipe-indikator */
              <div
                className="glass-morphism-strong rounded-2xl p-4 shadow-lg border-0 cursor-pointer"
                onClick={() => setIsBottomSheetCompressed(false)}
              >
                {/* Swipe up indikator */}
                <div className="flex justify-center mb-2">
                  <div className="flex flex-col items-center">
                    <ChevronUp className="h-4 w-4 text-gray-400 animate-bounce" />
                    <div className="w-8 h-0.5 bg-gray-300 rounded-full"></div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Service icon */}
                  <div className="w-10 h-10 glass-morphism rounded-lg flex items-center justify-center border-0 text-gray-700">
                    <CategoryIcon
                      appMode={appMode}
                      category={category}
                      className="h-5 w-5"
                    />
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900 text-sm">
                          {selectedStyle.name}
                        </h3>
                        <p className="text-xs text-gray-600">
                          {mode === "home" ? t("delivery") : t("at_provider")}
                          {mode === "home" && provider?.distanceKm != null && (
                            <> • {provider.distanceKm.toFixed(1)} km</>
                          )}{" "}
                          • {formatPrice(bookedOrderDisplayTotal)}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <span className="font-medium">
                            {formatCustomerJobTitleFromUi(
                              step === "in_service" ? "in_service" : status,
                              language,
                              mode === "provider" ? "at_provider" : "home",
                            )}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {step === "in_service"
                            ? formatMmSs(serviceElapsedSeconds)
                            : status === "arrived"
                              ? language === "en"
                                ? "At your location"
                                : "Pa din adresse"
                              : `${t("eta")}: ${eta} ${t("min")}`}
                        </p>
                      </div>
                    </div>

                    {/* Progress bar for in_service - integrated into card */}
                    {step === "in_service" && (
                      <div className="mt-3">
                        <div className="w-full glass-morphism rounded-full h-2 border-0 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full transition-all duration-1000 ease-out"
                            style={{ width: `${serviceTimeProgressPct}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {step === "matched" && status === "arrived" && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      disabled
                      className="w-full bg-green-500 text-white h-10 text-sm font-semibold rounded-xl border-0 opacity-90 cursor-default"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {language === "en"
                        ? "Service starting soon"
                        : "Tjeneste starter snart"}
                    </Button>
                  </div>
                )}

                {/* Hint text */}
                <div className="text-center mt-2">
                  <p className="text-xs text-gray-500">
                    {language === "en"
                      ? "Tap or swipe up for details"
                      : "Trykk eller swipe opp for detaljer"}
                  </p>
                </div>
              </div>
            ) : (
              /* Expanded Bottom Sheet med bedre høyde */
              <div className="glass-morphism-strong rounded-t-3xl shadow-2xl border-0 min-h-[60vh] max-h-[85vh] overflow-hidden flex flex-col">
                {/* Handle for swiping med bedre synlighet */}
                <div
                  className="flex justify-center pt-3 pb-2 cursor-pointer bg-white/10 rounded-t-3xl"
                  onClick={() =>
                    setIsBottomSheetCompressed(!isBottomSheetCompressed)
                  }
                >
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-1 bg-gray-400 rounded-full mb-1"></div>
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <div className="p-4 space-y-4 pb-8">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {formatCustomerJobTitleFromUi(
                        step === "in_service" ? "in_service" : status,
                        language,
                        mode === "provider" ? "at_provider" : "home",
                      )}
                    </h3>

                    {/* Provider info */}
                    <div className="flex items-center gap-3">
                      <CustomerProviderAvatar
                        avatarUrl={provider.avatarUrl}
                        name={provider.name}
                        className="w-12 h-12"
                        iconClassName="h-5 w-5"
                      />
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">
                          {provider.name}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Star className="h-4 w-4 fill-current text-yellow-500" />
                          <span>{provider.rating.toFixed(1)}</span>
                          <span>•</span>
                          <span>{provider.code}</span>
                        </div>
                        {provider.distanceKm != null && (
                          <p className="text-xs text-gray-500 mt-1">
                            {provider.distanceKm.toFixed(1)} km
                          </p>
                        )}
                      </div>
                    </div>

                    {/* ETA info */}
                    {status !== "arrived" && step !== "in_service" && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <MapPin className="h-4 w-4" />
                          <span>
                            {t("eta")}: {eta} {t("minutes")}
                          </span>
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        </div>
                      </div>
                    )}

                    {step === "matched" && status === "arrived" && (
                      <Button
                        type="button"
                        disabled
                        className="w-full bg-green-500 text-white h-12 text-lg font-semibold rounded-xl border-0 opacity-90 cursor-default"
                      >
                        <Play className="h-4 w-4 mr-2" />
                        {language === "en"
                          ? "Service starting soon"
                          : "Tjeneste starter snart"}
                      </Button>
                    )}

                    {/* Selected Service Card - smaller size */}
                    <div className="space-y-1">
                      <div className="glass-morphism rounded-xl p-3 border-0">
                        <div className="flex items-center gap-3">
                          {/* Service icon */}
                          <div className="w-8 h-8 glass-morphism rounded-lg flex items-center justify-center border-0 text-gray-700">
                            <CategoryIcon
                              appMode={appMode}
                              category={category}
                              className="h-4 w-4"
                            />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="font-medium text-gray-900 text-sm">
                                  {selectedStyle.name}
                                </h3>
                                <p className="text-xs text-gray-600">
                                  {mode === "home"
                                    ? t("delivery")
                                    : t("at_provider")}
                                  {mode === "home" &&
                                    provider?.distanceKm != null && (
                                      <>
                                        {" "}
                                        • {provider.distanceKm.toFixed(1)} km
                                      </>
                                    )}{" "}
                                  • {formatPrice(bookedOrderDisplayTotal)}
                                </p>
                              </div>
                              {step === "in_service" && (
                                <span className="text-xl font-bold text-green-600 tabular-nums shrink-0">
                                  {formatMmSs(serviceElapsedSeconds)}
                                </span>
                              )}
                            </div>

                            {/* Progress bar for in_service */}
                            {step === "in_service" && (
                              <div className="mt-2">
                                <div className="w-full glass-morphism rounded-full h-1.5 border-0 overflow-hidden">
                                  <div
                                    className="bg-gradient-to-r from-green-400 to-green-600 h-1.5 rounded-full transition-all duration-1000 ease-out"
                                    style={{
                                      width: `${serviceTimeProgressPct}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {step === "in_service" && (
                        <p className="text-xs text-gray-500 px-1">
                          {customerEstimatedDurationLabel}
                        </p>
                      )}
                    </div>

                    {/* Instructions for matched step */}
                    {step === "matched" && (
                      <div className="space-y-3">
                        {/* Instructions */}
                        <div className="glass-morphism rounded-xl p-3 border-0">
                          {mode === "home" ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                                <span className="text-lg">🏠</span>
                                <span>
                                  {language === "no"
                                    ? "Delivery instruksjoner"
                                    : "Delivery instructions"}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600 space-y-1">
                                <p>
                                  •{" "}
                                  {status === "arrived"
                                    ? language === "no"
                                      ? `${provider.name} har ankommet din adresse`
                                      : `${provider.name} has arrived at your address`
                                    : status === "enroute"
                                      ? language === "no"
                                        ? `${provider.name} er pa vei til din adresse`
                                        : `${provider.name} is on their way to your address`
                                      : language === "no"
                                        ? `${provider.name} har akseptert og forbereder avreise`
                                        : `${provider.name} has accepted and is preparing to leave`}
                                </p>
                                {status !== "arrived" && (
                                  <p>
                                    •{" "}
                                    {language === "no"
                                      ? "Du vil fa beskjed nar tilbyderen ankommer"
                                      : "You will be notified when the provider arrives"}
                                  </p>
                                )}
                                <p>
                                  •{" "}
                                  {language === "no"
                                    ? "Sorg for god belysning og plass til a jobbe"
                                    : "Ensure good lighting and space to work"}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
                                <span className="text-lg">🏪</span>
                                <span>
                                  {language === "no"
                                    ? `Mot hos ${APP_MODES[appMode].providerName}`
                                    : `Meet at ${APP_MODES[appMode].providerName}`}
                                </span>
                              </div>
                              <div className="text-xs text-gray-600 space-y-1">
                                <p>
                                  {status === "arrived"
                                    ? language === "no"
                                      ? "• Du har ankommet"
                                      : "• You have arrived"
                                    : status === "enroute"
                                      ? language === "no"
                                        ? `• ${provider.name} er pa vei til ${APP_MODES[appMode].locationName} (ETA ${eta} min)`
                                        : `• ${provider.name} is on the way to the ${APP_MODES[appMode].locationName} (ETA ${eta} min)`
                                      : language === "no"
                                        ? `• Mot ${provider.name} pa ${APP_MODES[appMode].locationName} innen ${eta} minutter`
                                        : `• Meet ${provider.name} at the ${APP_MODES[appMode].locationName} within ${eta} minutes`}
                                </p>
                                <p>
                                  •{" "}
                                  {language === "no"
                                    ? "Adresse: Fresh Up Sentrum, Karl Johans gate 1"
                                    : "Address: Fresh Up Sentrum, Karl Johans gate 1"}
                                </p>
                                <p>
                                  •{" "}
                                  {language === "no"
                                    ? `Oppgi kode ${provider.code} ved ankomst`
                                    : `Provide code ${provider.code} on arrival`}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action button */}
                        <Button
                          className="w-full glass-morphism-strong hover:glass-morphism-strong rounded-xl h-10 text-sm border-0 text-gray-800"
                          onClick={() => {
                            const dest =
                              mode === "home"
                                ? (customerLivePos ?? geoloc)
                                : (providerPos ?? geoloc);
                            if (dest) {
                              openExternalMapsDirections(dest, providerPos);
                            }
                          }}
                        >
                          <MapPin className="h-4 w-4 mr-2" />
                          {t("directions")}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      {/* Chat Modal — server-backed order conversation */}
      <OrderChatModal
        open={showChat}
        onClose={() => setShowChat(false)}
        orderId={
          userMode === "provider"
            ? mockIncomingRequest?.orderId || null
            : orderId
        }
        language={language}
        otherPartyName={
          userMode === "provider"
            ? mockIncomingRequest?.customer?.name ||
              (language === "en" ? "Customer" : "Kunde")
            : provider?.name || (language === "en" ? "Provider" : "Tilbyder")
        }
        otherPartyAvatarUrl={
          userMode === "provider" ? null : provider?.avatarUrl
        }
        quickMessages={CHAT_MESSAGES}
        AvatarComponent={CustomerProviderAvatar}
      />

      {/* Emergency Modal */}
      {showEmergency && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="glass-morphism-strong rounded-3xl p-6 w-full max-w-sm border-0">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-red-500 rounded-full flex items-center justify-center mx-auto">
                <span className="text-2xl text-white">🚨</span>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {language === "en" ? "Emergency" : "Nødsituasjon"}
                </h3>
                <p className="text-sm text-gray-600">
                  {language === "en"
                    ? "Do you need help or want to cancel the service?"
                    : "Trenger du hjelp eller vil du avbryte tjenesten?"}
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  className="w-full bg-red-500 hover:bg-red-600 text-white h-12 rounded-xl border-0"
                  onClick={() => {
                    alert(
                      language === "en"
                        ? "Calling emergency services..."
                        : "Ringer nødnummer...",
                    );
                    setShowEmergency(false);
                  }}
                >
                  Ring 112 (Nodnummer)
                </Button>

                <Button
                  variant="ghost"
                  className="w-full glass-button text-gray-700 h-12 rounded-xl border-0"
                  onClick={() => {
                    if (confirm(t("confirm_cancel_service"))) {
                      resetAll();
                      setShowEmergency(false);
                    }
                  }}
                >
                  {language === "en" ? "Cancel service" : "Avbryt tjeneste"}
                </Button>

                <Button
                  variant="ghost"
                  className="w-full glass-button text-gray-700 border-0"
                  onClick={() => setShowEmergency(false)}
                >
                  {language === "en" ? "Close" : "Lukk"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sheet - Rating Step */}
      {step === "rating" && provider && selectedStyle && (
        <div className="absolute bottom-0 left-0 right-0 z-40 glass-morphism-strong rounded-t-3xl shadow-xl animate-in slide-in-from-bottom-4 duration-500 border-0">
          {/* Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-gray-300 rounded-full"></div>
          </div>

          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
              <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto border-0">
                <span className="text-2xl">🎉</span>
              </div>
              <h3 className="text-xl font-semibold text-gray-900">
                {t("service_completed")}
              </h3>
              <p className="text-gray-600">
                {t("how_was_experience")} {provider.name}?
              </p>
            </div>

            {/* Rating stars */}
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-sm font-medium text-gray-700 mb-3">
                  {t("rate_service")}
                </p>
                <div className="flex justify-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      className="p-1 transition-all duration-200"
                      onClick={() => setUserRating(star)}
                    >
                      <Star
                        className={cn(
                          "h-8 w-8 transition-colors duration-200",
                          star <= userRating
                            ? "text-yellow-500 fill-current"
                            : "text-gray-300 hover:text-yellow-400",
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Service summary */}
              <div className="glass-morphism rounded-xl p-4 border-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 glass-morphism rounded-xl flex items-center justify-center border-0 text-gray-700">
                    <CategoryIcon
                      appMode={appMode}
                      category={category}
                      className="h-5 w-5"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-gray-900 truncate">
                      {selectedStyle.name}
                    </h4>
                  </div>
                  <div className="font-bold text-lg text-gray-900 tabular-nums">
                    {formatPrice(bookedOrderDisplayTotal)}
                  </div>
                </div>

                {selectedAddons.length > 0 && (
                  <div className="border-t border-white/20 pt-3 mt-3">
                    <p className="text-xs text-gray-600 mb-1">
                      {t("addons_label")}
                    </p>
                    {selectedAddons.map((addonId) => {
                      const addon = currentAddons.find((a) => a.id === addonId);
                      if (!addon) return null;
                      return (
                        <div
                          key={addonId}
                          className="flex justify-between text-sm"
                        >
                          <span className="text-gray-600">{addon.name}</span>
                          <span className="text-gray-900">
                            +{formatPrice(addon.price)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="space-y-3">
              <Button
                className={cn(
                  "w-full h-12 text-lg font-semibold rounded-xl border-0 transition-all duration-300",
                  userRating > 0
                    ? "bg-green-500 hover:bg-green-600 text-white"
                    : "glass-morphism text-gray-500 cursor-not-allowed",
                )}
                disabled={userRating === 0 || ratingSubmitting}
                onClick={() => void submitCustomerRating()}
              >
                {ratingSubmitting
                  ? t("confirming")
                  : userRating > 0
                    ? t("submit_rating")
                    : t("select_rating_first")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Screen - restore original content with glass morphism */}
      {showProfile && (
        <div className="absolute inset-0 z-50 glass-morphism-strong">
          <div className="p-4 space-y-6 h-full overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon"
                className="glass-button border-0 text-gray-700"
                onClick={() => setShowProfile(false)}
              >
                <X className="h-5 w-5" />
              </Button>
              <h1 className="text-lg font-semibold text-gray-800">Profile</h1>
              <div className="w-10" />
            </div>

            {/* User Info */}
            <div className="text-center space-y-4 py-6">
              <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center mx-auto">
                <span className="text-3xl text-white font-bold">
                  {currentUser?.name
                    ? currentUser.name.charAt(0).toUpperCase()
                    : isAuthenticated
                      ? "U"
                      : "G"}
                </span>
              </div>

              <div>
                <h2 className="text-2xl font-semibold text-gray-800">
                  {currentUser?.name ||
                    (isAuthenticated ? "User" : "Guest User")}
                </h2>
                <p className="text-gray-600 mt-1">
                  {currentUser?.phone ||
                    currentUser?.email ||
                    "guest@freshup.com"}
                </p>
                {!isAuthenticated && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      className="glass-morphism-strong hover:glass-morphism-strong text-gray-800 rounded-xl border-0"
                      onClick={() => {
                        setShowProfile(false);
                        setShowAuthFlow(true);
                      }}
                    >
                      Sign Up for Full Access
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-morphism rounded-2xl p-4 text-center border-0">
                <div className="text-2xl font-bold text-gray-800">12</div>
                <div className="text-sm text-gray-600">Bookings</div>
              </div>
              <div className="glass-morphism rounded-2xl p-4 text-center border-0">
                <div className="text-2xl font-bold text-gray-800">4.9</div>
                <div className="text-sm text-gray-600">Rating</div>
              </div>
            </div>

            {/* Menu Items */}
            <div className="space-y-3">
              <Button
                variant="ghost"
                className="w-full glass-morphism h-12 rounded-2xl border-0 text-gray-700 hover:glass-morphism-strong transition-all duration-300 justify-start"
              >
                <svg
                  className="h-5 w-5 mr-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                Booking History
              </Button>

              <Button
                variant="ghost"
                className="w-full glass-morphism h-12 rounded-2xl border-0 text-gray-700 hover:glass-morphism-strong transition-all duration-300 justify-start"
              >
                <svg
                  className="h-5 w-5 mr-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                Edit Profile
              </Button>

              <Button
                variant="ghost"
                className="w-full glass-morphism h-12 rounded-2xl border-0 text-gray-700 hover:glass-morphism-strong transition-all duration-300 justify-start"
              >
                <svg
                  className="h-5 w-5 mr-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h.09A1.65 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V6a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2V11a2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                Settings
              </Button>

              <Button
                variant="ghost"
                className="w-full glass-morphism h-12 rounded-2xl border-0 text-gray-700 hover:glass-morphism-strong transition-all duration-300 justify-start"
              >
                <svg
                  className="h-5 w-5 mr-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16,17 21,12 16,7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Help & Support
              </Button>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pb-6">
              {isAuthenticated ? (
                <Button
                  variant="ghost"
                  className="w-full glass-morphism h-12 rounded-2xl border-0 text-gray-700 hover:glass-morphism-strong transition-all duration-300"
                  onClick={() => {
                    setIsAuthenticated(false);
                    setCurrentUser(null);
                    setShowProfile(false);
                    resetAll();
                  }}
                >
                  Sign Out
                </Button>
              ) : (
                <Button
                  className="w-full glass-morphism-strong hover:glass-morphism-strong text-gray-800 h-12 rounded-2xl border-0 transition-all duration-300"
                  onClick={() => {
                    setShowProfile(false);
                    setShowAuthFlow(true);
                  }}
                >
                  Sign Up Now
                </Button>
              )}

              <div className="text-center text-xs text-gray-500 pt-4">
                Fresh Up v1.0.0
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
