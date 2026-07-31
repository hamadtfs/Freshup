"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  ChevronLeft,
  User,
  Phone,
  Mail,
  MapPin,
  Bell,
  Shield,
  ChevronRight,
  Camera,
  LocateFixed,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import MapView from "@/components/map-view";
import { cn } from "@/lib/utils";

function SkeletonBone({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("animate-pulse rounded-md bg-gray-200/80", className)} />
  );
}

/** Matches mobile ProfileSkeleton: avatar + fields + settings rows. */
function ProfileSkeleton() {
  return (
    <div className="pb-8">
      <div className="flex flex-col items-center mb-6">
        <SkeletonBone className="h-24 w-24 rounded-full" />
        <SkeletonBone className="mt-3 h-3.5 w-28" />
      </div>

      <SkeletonBone className="mb-3 h-2.5 w-24" />
      <div className="mb-6 space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBone className="h-9 w-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <SkeletonBone className="h-2.5 w-[28%]" />
              <SkeletonBone className="h-3.5 w-[70%]" />
            </div>
          </div>
        ))}
      </div>

      <SkeletonBone className="mb-3 h-2.5 w-20" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4"
          >
            <SkeletonBone className="h-9 w-9 rounded-lg" />
            <SkeletonBone className="h-3.5 flex-1 max-w-[50%]" />
            <SkeletonBone className="h-3.5 w-3.5 rounded" />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-center space-y-2">
        <SkeletonBone className="mx-auto h-3 w-[70%]" />
        <SkeletonBone className="mx-auto h-3.5 w-[40%]" />
      </div>
    </div>
  );
}
interface ProfilePageProps {
  onBack: () => void;
  userMode: "customer" | "provider";
  language: "no" | "en";
}

interface ProviderContact {
  name: string;
  phone: string;
  email: string;
  avatarUrl: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

interface SettingsLocation {
  address: string;
  lat: number | null;
  lng: number | null;
}

type LocationTarget = "default" | "service";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeAvatar(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

const INITIAL_CONTACT: ProviderContact = {
  name: "",
  phone: "",
  email: "",
  avatarUrl: "",
  address: "",
  lat: null,
  lng: null,
};

const INITIAL_SETTINGS_LOCATION: SettingsLocation = {
  address: "",
  lat: null,
  lng: null,
};

function profileCacheKey(userId: string, userMode: "customer" | "provider") {
  return `freshup.profile.contact.${userMode}.${userId}`;
}

function settingsLocationCacheKey(
  userId: string,
  userMode: "customer" | "provider",
) {
  return `freshup.profile.settings.location.${userMode}.${userId}`;
}

function locationLabel(location: SettingsLocation): string {
  if (location.address) return location.address;
  if (typeof location.lat === "number" && typeof location.lng === "number") {
    return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
  }
  return "-";
}

export default function ProfilePage({
  onBack,
  userMode,
  language,
}: ProfilePageProps) {
  const supabase = useMemo(() => createBrowserSupabaseClient() as any, []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [contact, setContact] = useState<ProviderContact>(INITIAL_CONTACT);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [settingsLocation, setSettingsLocation] = useState<SettingsLocation>(
    INITIAL_SETTINGS_LOCATION,
  );
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [mapPickerResolving, setMapPickerResolving] = useState(false);
  const [mapPickerLocating, setMapPickerLocating] = useState(false);
  const [mapPickerRecenterNonce, setMapPickerRecenterNonce] = useState(0);
  const [mapPickerTarget, setMapPickerTarget] =
    useState<LocationTarget>("default");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = useMemo(() => {
    if (language === "en") {
      return {
        profile: "My Profile",
        saving: "Saving...",
        save: "Save",
        edit: "Edit",
        loadingProfile: "Loading profile...",
        changePhoto: "Change photo",
        contactInfo: "Contact Info",
        name: "Name",
        phone: "Phone",
        email: "Email",
        location: "Location",
        addressPlaceholder: "Address",
        fetching: "Fetching...",
        settings: "Settings",
        notifications: "Notifications",
        privacy: "Privacy",
        defaultLocation: "Default location",
        mapPickerTitle: "Select location",
        mapPickerHint: "Tap on the map to pin your location, or use GPS.",
        mapPickerLocating: "Finding your area…",
        mapPickerGps: "Use current GPS location",
        mapPickerGpsFailed: "Could not get location. Check that GPS is enabled.",
        selectedCoords: "Selected",
        done: "Done",
        on: "On",
        loggedInAs: "You are logged in as",
        provider: "Provider",
        customer: "Customer",
        profileSaved: "Profile saved",
        profileLoadFailed: "Could not load profile",
        profileSaveFailed: "Could not save profile",
        imageProcessFailed: "Could not process image",
        geoNotAvailable: "Geolocation is not available",
        currentLocationUpdated: "Current location updated",
        geoReadFailed: "Could not read current location",
        allowMapsTitle: "Allow Google Maps location?",
        allowMapsBody:
          "Do you allow Google Maps to open and use your current location?",
        cancel: "Cancel",
        allow: "Allow",
      } as const;
    }
    return {
      profile: "Min profil",
      saving: "Lagrer...",
      save: "Lagre",
      edit: "Rediger",
      loadingProfile: "Laster profil...",
      changePhoto: "Endre bilde",
      contactInfo: "Kontaktinfo",
      name: "Navn",
      phone: "Telefon",
      email: "E-post",
      location: "Lokasjon",
      addressPlaceholder: "Adresse",
      fetching: "Henter...",
      settings: "Innstillinger",
      notifications: "Varsler",
      privacy: "Personvern",
      defaultLocation: "Standardlokasjon",
      mapPickerTitle: "Velg lokasjon",
      mapPickerHint: "Trykk på kartet for å markere lokasjonen, eller bruk GPS.",
      mapPickerLocating: "Finner området…",
      mapPickerGps: "Bruk nåværende GPS-posisjon",
      mapPickerGpsFailed:
        "Kunne ikke hente posisjon. Sjekk at GPS er på og prøv igjen.",
      selectedCoords: "Valgt",
      done: "Ferdig",
      on: "På",
      loggedInAs: "Du er logget inn som",
      provider: "Tilbyder",
      customer: "Kunde",
      profileSaved: "Profil lagret",
      profileLoadFailed: "Kunne ikke laste profil",
      profileSaveFailed: "Kunne ikke lagre profil",
      imageProcessFailed: "Kunne ikke behandle bildet",
      geoNotAvailable: "Geolocation er ikke tilgjengelig",
      currentLocationUpdated: "Nåværende lokasjon oppdatert",
      geoReadFailed: "Kunne ikke hente nåværende lokasjon",
      allowMapsTitle: "Tillat Google Maps lokasjon?",
      allowMapsBody:
        "Tillater du at Google Maps åpner og bruker nåværende lokasjon?",
      cancel: "Avbryt",
      allow: "Tillat",
    } as const;
  }, [language]);

  const OSLO_FALLBACK = { lat: 59.9139, lng: 10.7522 } as const;

  const settingsItems = [
    { id: "notifications", icon: Bell, label: t.notifications, value: t.on },
    { id: "privacy", icon: Shield, label: t.privacy, value: "" },
    {
      id: "location",
      icon: MapPin,
      label: t.defaultLocation,
      value: locationLabel(settingsLocation),
    },
  ];

  const providerSettings = [
    {
      id: "provider-location",
      icon: MapPin,
      label: language === "en" ? "Service location" : "Tjenestelokasjon",
      value: locationLabel({
        address: contact.address,
        lat: contact.lat,
        lng: contact.lng,
      }),
      status: "default" as const,
    },
    {
      id: "provider-notifications",
      icon: Bell,
      label: t.notifications,
      value: t.on,
      status: "success" as const,
    },
    {
      id: "provider-privacy",
      icon: Shield,
      label: t.privacy,
      value: "",
      status: "default" as const,
    },
  ];

  // Load profile on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);
        setError(null);
        setMessage(null);

        const { data: authData } = await supabase.auth.getUser();
        const uid = authData?.user?.id || null;
        setUserId(uid);

        if (!uid) {
          setLoading(false);
          return;
        }

        const endpoint =
          userMode === "provider" ? "/api/providers/me" : "/api/customers/me";
        const userIdHeader =
          userMode === "provider" ? "x-provider-id" : "x-user-id";

        const res = await fetch(endpoint, {
          cache: "no-store",
          headers: { [userIdHeader]: uid },
        });

        if (!res.ok) {
          throw new Error(t.profileLoadFailed);
        }

        const body = await res.json();
        const serverContact = body?.contact || {};
        const serverDefaultLocation = body?.defaultLocation || {};

        // Load from localStorage as backup
        let localName = "";
        let localAvatarUrl = "";
        let localAddress = "";
        let localLat = null;
        let localLng = null;

        try {
          const cached = localStorage.getItem(profileCacheKey(uid, userMode));
          if (cached) {
            const parsed = JSON.parse(cached);
            localName = parsed?.name || "";
            localAvatarUrl = parsed?.avatarUrl || "";
            localAddress = parsed?.address || "";
            localLat = parsed?.lat || null;
            localLng = parsed?.lng || null;
          }
        } catch (e) {}

        // Set contact (displayed address)
        const finalContact: ProviderContact = {
          name: serverContact.name || localName || "",
          phone: serverContact.phone || "",
          email: serverContact.email || "",
          avatarUrl: serverContact.avatarUrl || localAvatarUrl || "",
          address: serverContact.address || localAddress || "",
          lat: serverContact.lat ?? localLat,
          lng: serverContact.lng ?? localLng,
        };

        setContact(finalContact);

        // Update localStorage
        localStorage.setItem(
          profileCacheKey(uid, userMode),
          JSON.stringify({
            name: finalContact.name,
            phone: finalContact.phone,
            email: finalContact.email,
            avatarUrl: finalContact.avatarUrl,
            address: finalContact.address,
            lat: finalContact.lat,
            lng: finalContact.lng,
            savedAt: Date.now(),
          }),
        );

        // Set settings location (default location for delivery)
        let settingsAddress = serverDefaultLocation.address || "";
        let settingsLat = toFiniteNumber(serverDefaultLocation.lat);
        let settingsLng = toFiniteNumber(serverDefaultLocation.lng);

        // Merge localStorage only when server is missing default coordinates.
        // Do not let cached address/coords override valid DB values.
        const needsDefaultFromCache =
          settingsLat == null ||
          settingsLng == null ||
          !Number.isFinite(Number(settingsLat)) ||
          !Number.isFinite(Number(settingsLng));
        if (needsDefaultFromCache) {
          const cachedSettings = localStorage.getItem(
            settingsLocationCacheKey(uid, userMode),
          );
          if (cachedSettings) {
            try {
              const s = JSON.parse(cachedSettings);
              if (!settingsAddress && typeof s.address === "string" && s.address.trim()) {
                settingsAddress = s.address;
              }
              if (
                (settingsLat == null ||
                  !Number.isFinite(Number(settingsLat))) &&
                typeof s.lat === "number" &&
                Number.isFinite(s.lat)
              ) {
                settingsLat = s.lat;
              }
              if (
                (settingsLng == null ||
                  !Number.isFinite(Number(settingsLng))) &&
                typeof s.lng === "number" &&
                Number.isFinite(s.lng)
              ) {
                settingsLng = s.lng;
              }
            } catch (e) {}
          }
        }

        setSettingsLocation({
          address: settingsAddress,
          lat: settingsLat,
          lng: settingsLng,
        });
      } catch (err: any) {
        console.error("Load profile error:", err);
        setError(err?.message || t.profileLoadFailed);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [supabase, userMode, t.profileLoadFailed]);

  const saveProfile = async () => {
    if (!userId) return;

    const endpoint =
      userMode === "provider" ? "/api/providers/me" : "/api/customers/me";
    const userIdHeader =
      userMode === "provider" ? "x-provider-id" : "x-user-id";

    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const payload: Record<string, unknown> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        avatarUrl: contact.avatarUrl,
        address: contact.address,
      };
      if (
        typeof contact.lat === "number" &&
        Number.isFinite(contact.lat) &&
        typeof contact.lng === "number" &&
        Number.isFinite(contact.lng)
      ) {
        payload.lat = contact.lat;
        payload.lng = contact.lng;
      }

      const res = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [userIdHeader]: userId,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error || t.profileSaveFailed);
      }

      const saved = body?.contact || {};

      setContact((prev) => ({
        ...prev,
        name: saved.name || prev.name,
        phone: saved.phone || prev.phone,
        email: saved.email || prev.email,
        avatarUrl: saved.avatarUrl || prev.avatarUrl,
        address: saved.address || prev.address,
        lat: saved.lat ?? prev.lat,
        lng: saved.lng ?? prev.lng,
      }));

      localStorage.setItem(
        profileCacheKey(userId, userMode),
        JSON.stringify({
          name: saved.name || contact.name,
          phone: saved.phone || contact.phone,
          email: saved.email || contact.email,
          avatarUrl: saved.avatarUrl || contact.avatarUrl,
          address: saved.address || contact.address,
          lat: saved.lat ?? contact.lat,
          lng: saved.lng ?? contact.lng,
          savedAt: Date.now(),
        }),
      );

      window.dispatchEvent(
        new CustomEvent("profileUpdated", {
          detail: { userMode, userId },
        }),
      );

      setMessage(t.profileSaved);
      setIsEditing(false);
    } catch (err: any) {
      setError(err?.message || t.profileSaveFailed);
    } finally {
      setSaving(false);
    }
  };

  const saveDefaultLocation = async () => {
    if (!userId) return;

    const endpoint =
      userMode === "provider" ? "/api/providers/me" : "/api/customers/me";
    const userIdHeader =
      userMode === "provider" ? "x-provider-id" : "x-user-id";

    try {
      const hasPin =
        typeof settingsLocation.lat === "number" &&
        Number.isFinite(settingsLocation.lat) &&
        typeof settingsLocation.lng === "number" &&
        Number.isFinite(settingsLocation.lng);

      const res = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [userIdHeader]: userId,
        },
        body: JSON.stringify({
          defaultLat: settingsLocation.lat,
          defaultLng: settingsLocation.lng,
          defaultAddress: settingsLocation.address,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const savedDefault = body?.defaultLocation || {};
        const nextSettingsLocation = {
          address:
            typeof savedDefault.address === "string"
              ? savedDefault.address
              : settingsLocation.address,
          lat: toFiniteNumber(savedDefault.lat) ?? settingsLocation.lat,
          lng: toFiniteNumber(savedDefault.lng) ?? settingsLocation.lng,
        };
        setSettingsLocation(nextSettingsLocation);
        localStorage.setItem(
          settingsLocationCacheKey(userId, userMode),
          JSON.stringify({
            address: nextSettingsLocation.address,
            lat: nextSettingsLocation.lat,
            lng: nextSettingsLocation.lng,
            savedAt: Date.now(),
          }),
        );

        // Hard-refresh from DB to avoid stale fallback/cached coordinates in UI.
        try {
          const freshRes = await fetch("/api/providers/me", {
            cache: "no-store",
            headers: { "x-provider-id": userId },
          });
          if (freshRes.ok) {
            const freshBody = await freshRes.json().catch(() => ({}));
            const freshDefault = freshBody?.defaultLocation || {};
            setSettingsLocation({
              address:
                typeof freshDefault.address === "string"
                  ? freshDefault.address
                  : nextSettingsLocation.address,
              lat: toFiniteNumber(freshDefault.lat) ?? nextSettingsLocation.lat,
              lng: toFiniteNumber(freshDefault.lng) ?? nextSettingsLocation.lng,
            });
          }
        } catch {
          // keep optimistic state if refresh fails
        }
        return true;
      }

      // Still cache pin locally so UI + testing works if server columns/API reject save
      if (hasPin) {
        localStorage.setItem(
          settingsLocationCacheKey(userId, userMode),
          JSON.stringify({
            address: settingsLocation.address,
            lat: settingsLocation.lat,
            lng: settingsLocation.lng,
            savedAt: Date.now(),
          }),
        );
      }
      return false;
    } catch (error) {
      console.error("Save settings location error:", error);
      return false;
    }
  };

  const saveServiceLocation = async () => {
    if (!userId) return false;
    const endpoint =
      userMode === "provider" ? "/api/providers/me" : "/api/customers/me";
    const userIdHeader =
      userMode === "provider" ? "x-provider-id" : "x-user-id";
    const hasPin =
      typeof contact.lat === "number" &&
      Number.isFinite(contact.lat) &&
      typeof contact.lng === "number" &&
      Number.isFinite(contact.lng);
    const payload: Record<string, unknown> = {
      address: contact.address,
    };
    if (hasPin) {
      payload.lat = contact.lat;
      payload.lng = contact.lng;
    }
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          [userIdHeader]: userId,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return false;
      const savedContact = body?.contact || {};
      setContact((prev) => ({
        ...prev,
        address:
          typeof savedContact.address === "string"
            ? savedContact.address
            : prev.address,
        lat: toFiniteNumber(savedContact.lat) ?? prev.lat,
        lng: toFiniteNumber(savedContact.lng) ?? prev.lng,
      }));

      // Hard-refresh from DB to keep service location tile in sync.
      try {
        const freshRes = await fetch("/api/providers/me", {
          cache: "no-store",
          headers: { "x-provider-id": userId },
        });
        if (freshRes.ok) {
          const freshBody = await freshRes.json().catch(() => ({}));
          const freshContact = freshBody?.contact || {};
          setContact((prev) => ({
            ...prev,
            address:
              typeof freshContact.address === "string"
                ? freshContact.address
                : prev.address,
            lat: toFiniteNumber(freshContact.lat) ?? prev.lat,
            lng: toFiniteNumber(freshContact.lng) ?? prev.lng,
          }));
          const freshDefault = freshBody?.defaultLocation || {};
          setSettingsLocation((prev) => ({
            address:
              typeof freshDefault.address === "string"
                ? freshDefault.address
                : prev.address,
            lat: toFiniteNumber(freshDefault.lat) ?? prev.lat,
            lng: toFiniteNumber(freshDefault.lng) ?? prev.lng,
          }));
        }
      } catch {
        // keep optimistic state if refresh fails
      }
      return true;
    } catch (error) {
      console.error("Save service location error:", error);
      return false;
    }
  };

  const toCompressedDataUrl = async (file: File): Promise<string> => {
    const maxSide = 512;
    const quality = 0.85;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  };

  const onPhotoFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError(t.imageProcessFailed);
      return;
    }
    try {
      setProcessingImage(true);
      setError(null);
      const avatarUrl = await toCompressedDataUrl(file);
      setContact((prev) => ({ ...prev, avatarUrl }));
      setMessage(null);
    } catch {
      setError(t.imageProcessFailed);
    } finally {
      setProcessingImage(false);
      if (event.target) event.target.value = "";
    }
  };

  const geocodeFreeText = async (
    q: string,
  ): Promise<{ lat: number; lng: number } | null> => {
    const query = q.trim();
    if (!query) return null;

    const lower = query.toLowerCase();
    const wantsPakistanBias =
      /\blahore\b/.test(lower) ||
      /\bkarachi\b/.test(lower) ||
      /\bislamabad\b/.test(lower) ||
      /\brawalpindi\b/.test(lower) ||
      /\bfaisalabad\b/.test(lower) ||
      /\bmultan\b/.test(lower) ||
      /\bpakistan\b/.test(lower);

    const tryOnce = async (params: Record<string, string>) => {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "3");
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
      const res = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      for (const row of data ?? []) {
        const lat = Number(row?.lat);
        const lng = Number(row?.lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
      }
      return null;
    };

    try {
      if (wantsPakistanBias) {
        const withCountry = /\b(pakistan|pk)\b/i.test(query)
          ? query
          : `${query}, Pakistan`;
        const biased =
          (await tryOnce({ q: withCountry, countrycodes: "pk" })) ||
          (await tryOnce({ q: withCountry }));
        if (biased) return biased;
      }

      const generic = await tryOnce({ q: query });
      if (generic) return generic;
    } catch {
      /* ignore */
    }
    return null;
  };

  const tryDeviceLocation = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => resolve(null),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 12_000 },
      );
    });

  const applyPickerPin = (target: LocationTarget, lat: number, lng: number) => {
    const coordLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (target === "service") {
      setContact((prev) => ({
        ...prev,
        lat,
        lng,
        address: prev.address.trim().length > 0 ? prev.address : coordLabel,
      }));
    } else {
      setSettingsLocation((prev) => ({
        ...prev,
        lat,
        lng,
        address: prev.address.trim().length > 0 ? prev.address : coordLabel,
      }));
    }
  };

  const goToPickerGps = async () => {
    setMapPickerLocating(true);
    setError(null);
    try {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setError(t.geoNotAvailable);
        return;
      }
      const fromGps = await tryDeviceLocation();
      if (!fromGps) {
        setError(t.mapPickerGpsFailed);
        return;
      }
      applyPickerPin(mapPickerTarget, fromGps.lat, fromGps.lng);
      setMapPickerRecenterNonce((n) => n + 1);
    } finally {
      setMapPickerLocating(false);
    }
  };

  const openLocationPicker = async (target: LocationTarget = "default") => {
    setError(null);
    setMessage(null);
    setMapPickerTarget(target);
    setShowLocationPicker(true);
    setMapPickerResolving(true);

    const currentLocation =
      target === "service"
        ? { address: contact.address, lat: contact.lat, lng: contact.lng }
        : settingsLocation;

    const hasSavedPin =
      typeof currentLocation.lat === "number" &&
      typeof currentLocation.lng === "number";

    try {
      if (!hasSavedPin) {
        const fromGps = await tryDeviceLocation();
        if (fromGps) {
          applyPickerPin(target, fromGps.lat, fromGps.lng);
          setMapPickerRecenterNonce((n) => n + 1);
          return;
        }

        const addressHint =
          currentLocation.address?.trim() ||
          (target === "service"
            ? settingsLocation.address?.trim()
            : contact.address?.trim()) ||
          "";
        if (addressHint) {
          const geo = await geocodeFreeText(addressHint);
          if (geo) {
            applyPickerPin(target, geo.lat, geo.lng);
            setMapPickerRecenterNonce((n) => n + 1);
            return;
          }
        }
      }
    } finally {
      setMapPickerResolving(false);
    }
  };

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-14 pb-4">
        <button
          onClick={onBack}
          className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">{t.profile}</h1>
        <button
          onClick={() => {
            if (isEditing) {
              void saveProfile();
              return;
            }
            setMessage(null);
            setError(null);
            setIsEditing(true);
          }}
          className="text-sm font-medium text-gray-700 disabled:opacity-60"
          disabled={saving || loading}
        >
          {saving ? t.saving : isEditing ? t.save : t.edit}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        {message && <p className="text-sm text-green-700 mb-4">{message}</p>}

        {loading ? (
          <ProfileSkeleton />
        ) : (
          <>
        {/* Avatar */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative w-24 h-24 mb-3">
            <div className="w-24 h-24 glass-morphism-strong rounded-full flex items-center justify-center overflow-hidden">
              {contact.avatarUrl ? (
                <img
                  src={contact.avatarUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="h-12 w-12 text-gray-600" />
              )}
            </div>
            {isEditing && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={processingImage || saving}
                className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-md disabled:opacity-60"
                title={t.changePhoto}
              >
                <Camera className="h-4 w-4" />
              </button>
            )}
          </div>
          {isEditing && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onPhotoFileChange}
                className="hidden"
              />
              <button
                type="button"
                className="text-sm text-gray-700 font-medium disabled:opacity-60"
                onClick={() => fileInputRef.current?.click()}
                disabled={processingImage || saving}
              >
                {processingImage ? t.fetching : t.changePhoto}
              </button>
            </>
          )}
        </div>

        {/* Contact Info */}
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
          {t.contactInfo}
        </p>
        <div className="bg-white rounded-xl p-4 space-y-4 mb-6 border border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t.name}</p>
              {isEditing ? (
                <input
                  type="text"
                  value={contact.name}
                  onChange={(e) =>
                    setContact((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none border-b border-gray-300 py-1"
                />
              ) : (
                <p className="text-sm font-medium text-gray-900">
                  {contact.name || "-"}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
              <Phone className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t.phone}</p>
              {isEditing ? (
                <input
                  type="tel"
                  value={contact.phone}
                  onChange={(e) =>
                    setContact((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none border-b border-gray-300 py-1"
                />
              ) : (
                <p className="text-sm font-medium text-gray-900">
                  {contact.phone || "-"}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t.email}</p>
              {isEditing ? (
                <input
                  type="email"
                  value={contact.email}
                  onChange={(e) =>
                    setContact((prev) => ({ ...prev, email: e.target.value }))
                  }
                  className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none border-b border-gray-300 py-1"
                />
              ) : (
                <p className="text-sm font-medium text-gray-900">
                  {contact.email || "-"}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center">
              <MapPin className="h-5 w-5 text-gray-700" />
            </div>
            <div className="flex-1">
              <p className="text-xs text-gray-500">{t.location}</p>
              {isEditing ? (
                <input
                  type="text"
                  value={contact.address}
                  onChange={(e) =>
                    setContact((prev) => ({ ...prev, address: e.target.value }))
                  }
                  className="w-full bg-transparent text-sm font-medium text-gray-900 outline-none border-b border-gray-300 py-1"
                  placeholder={t.addressPlaceholder}
                />
              ) : (
                <p className="text-sm font-medium text-gray-900">
                  {contact.address || "-"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Settings */}
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
          {t.settings}
        </p>
        <div className="space-y-2">
          {settingsItems.map((item) => (
            <button
              key={item.id}
              className="w-full flex items-center gap-3 bg-white border border-gray-200 p-4 rounded-xl hover:bg-gray-50 transition-colors"
              onClick={() => {
                if (item.id === "location") {
                  openLocationPicker("default");
                }
              }}
            >
              <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                <item.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-foreground">
                  {item.label}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {item.value && (
                  <span className="text-xs text-gray-500">{item.value}</span>
                )}
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
            </button>
          ))}
        </div>

        {/* Provider Settings */}
        {userMode === "provider" && (
          <>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 mt-6">
              {language === "en"
                ? "Provider settings"
                : "Tilbyderinnstillinger"}
            </p>
            <div className="space-y-2">
              {providerSettings.map((item) => (
                <button
                  key={item.id}
                  className="w-full flex items-center gap-3 bg-white border border-gray-200 p-4 rounded-xl hover:bg-gray-50 transition-colors"
                  onClick={() => {
                    if (item.id === "provider-location") {
                      openLocationPicker("service");
                    }
                  }}
                >
                  <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                    <item.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-foreground">
                      {item.label}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.value && (
                      <span
                        className={cn(
                          "text-xs",
                          item.status === "success"
                              ? "text-green-500"
                              : "text-muted-foreground",
                        )}
                      >
                        {item.value}
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Mode Badge */}
        <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-500">{t.loggedInAs}</p>
          <p className="text-sm font-semibold text-gray-900">
            {userMode === "provider" ? t.provider : t.customer}
          </p>
        </div>
          </>
        )}
      </div>

      {/* Location Picker Modal */}
      {showLocationPicker && (
        <div className="fixed inset-0 z-50 bg-black/40 p-4">
          <div className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {t.mapPickerTitle}
                </h2>
                <p className="text-xs text-gray-600">{t.mapPickerHint}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8"
                onClick={() => setShowLocationPicker(false)}
              >
                {t.cancel}
              </Button>
            </div>
            <div className="relative min-h-[220px] flex-1">
              <div className="absolute inset-0">
                {mapPickerResolving && (
                  <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
                    <span className="rounded-full bg-white/90 px-3 py-1 text-xs text-gray-700 shadow">
                      {t.mapPickerLocating}
                    </span>
                  </div>
                )}
                <MapView
                  center={{
                    lat:
                      typeof (mapPickerTarget === "service"
                        ? contact.lat
                        : settingsLocation.lat) === "number"
                        ? mapPickerTarget === "service"
                          ? (contact.lat as number)
                          : (settingsLocation.lat as number)
                        : OSLO_FALLBACK.lat,
                    lng:
                      typeof (mapPickerTarget === "service"
                        ? contact.lng
                        : settingsLocation.lng) === "number"
                        ? mapPickerTarget === "service"
                          ? (contact.lng as number)
                          : (settingsLocation.lng as number)
                        : OSLO_FALLBACK.lng,
                  }}
                  customer={
                    typeof (mapPickerTarget === "service"
                      ? contact.lat
                      : settingsLocation.lat) === "number" &&
                    typeof (mapPickerTarget === "service"
                      ? contact.lng
                      : settingsLocation.lng) === "number"
                      ? {
                          lat:
                            mapPickerTarget === "service"
                              ? (contact.lat as number)
                              : (settingsLocation.lat as number),
                          lng:
                            mapPickerTarget === "service"
                              ? (contact.lng as number)
                              : (settingsLocation.lng as number),
                        }
                      : null
                  }
                  onMapClick={(pt) => {
                    applyPickerPin(mapPickerTarget, pt.lat, pt.lng);
                  }}
                  recenterNonce={mapPickerRecenterNonce}
                  language={language}
                />
              </div>
              <button
                type="button"
                className="absolute bottom-4 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-900 shadow-lg disabled:opacity-60"
                onClick={() => void goToPickerGps()}
                disabled={mapPickerLocating || mapPickerResolving}
                title={t.mapPickerGps}
                aria-label={t.mapPickerGps}
              >
                {mapPickerLocating ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <LocateFixed className="h-5 w-5" strokeWidth={2.25} />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
              <p className="text-xs text-gray-600">
                {typeof (mapPickerTarget === "service"
                  ? contact.lat
                  : settingsLocation.lat) === "number" &&
                typeof (mapPickerTarget === "service"
                  ? contact.lng
                  : settingsLocation.lng) === "number"
                  ? `${t.selectedCoords}: ${
                      mapPickerTarget === "service"
                        ? (contact.lat as number).toFixed(5)
                        : (settingsLocation.lat as number).toFixed(5)
                    }, ${
                      mapPickerTarget === "service"
                        ? (contact.lng as number).toFixed(5)
                        : (settingsLocation.lng as number).toFixed(5)
                    }`
                  : t.mapPickerHint}
              </p>
              <Button
                type="button"
                className="h-9 bg-gray-900 text-white hover:bg-gray-800"
                onClick={async () => {
                  setShowLocationPicker(false);
                  const success =
                    mapPickerTarget === "service"
                      ? await saveServiceLocation()
                      : await saveDefaultLocation();
                  // Ensure UI reflects what was just picked even before any async refetch settles.
                  if (mapPickerTarget === "service") {
                    setContact((prev) => ({ ...prev }));
                  } else {
                    setSettingsLocation((prev) => ({ ...prev }));
                  }
                  if (success) {
                    setMessage(t.profileSaved);
                    setTimeout(() => setMessage(null), 3000);
                  }
                }}
              >
                {t.done}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
