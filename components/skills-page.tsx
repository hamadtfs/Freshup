"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronDown, Star, Scissors } from "lucide-react";
import { SERVICE_ID_ALIASES } from "@/lib/service-id";
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr";
type AppMode = "beauty" | "vehicle" | "pet" | "home_service" | "health";

function dashboardDeliveryModeKey(providerId: string): string {
  return `freshup.deliveryMode.${providerId}`;
}

/** Preserve dashboard Delivery / At provider toggle when saving skills. */
function resolveDeliveryModesForSkillsSave(
  providerId: string,
  selectedMode: AppMode,
): string[] {
  if (typeof window !== "undefined" && providerId) {
    const saved = localStorage.getItem(dashboardDeliveryModeKey(providerId));
    if (saved === "home") return ["home"];
    if (saved === "provider") return ["at_provider"];
  }
  return selectedMode === "home_service" ? ["home"] : ["at_provider"];
}

// ── Same data structures as login-page & page.tsx ─────────────────────────────
const APP_MODES_NO = {
  beauty: { label: "Skjønnhet" },
  vehicle: { label: "Kjøretøy" },
  pet: { label: "Kjæledyr" },
  home_service: { label: "Hjem" },
  health: { label: "Helse" },
} as const;

const APP_MODES_EN = {
  beauty: { label: "Beauty" },
  vehicle: { label: "Vehicle" },
  pet: { label: "Pet" },
  home_service: { label: "Home" },
  health: { label: "Health" },
} as const;

const MODE_TARGETS_NO: Record<
  AppMode,
  { id: string; label: string; icon: string }[]
> = {
  beauty: [
    { id: "male", label: "Mann", icon: "👨" },
    { id: "female", label: "Kvinne", icon: "👩" },
  ],
  vehicle: [
    { id: "car", label: "Bil", icon: "🚗" },
    { id: "motorcycle", label: "MC", icon: "🏍️" },
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
};

const MODE_TARGETS_EN: Record<
  AppMode,
  { id: string; label: string; icon: string }[]
> = {
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
};

const MODE_CATEGORIES_NO: Record<
  AppMode,
  Record<string, { id: string; label: string }[]>
> = {
  beauty: {
    male: [
      { id: "haircut", label: "Hårklipp" },
      { id: "braids", label: "Fletter" },
      { id: "beard", label: "Skjegg" },
      { id: "brows", label: "Bryn" },
      { id: "body", label: "Kropp" },
    ],
    female: [
      { id: "haircut", label: "Hårklipp" },
      { id: "braids", label: "Fletter" },
      { id: "nails", label: "Negler" },
      { id: "lashes", label: "Vipper" },
      { id: "brows", label: "Bryn" },
      { id: "body", label: "Kropp" },
    ],
  },
  vehicle: {
    motorcycle: [
      { id: "wash", label: "Vask" },
      { id: "service", label: "Service" },
      { id: "tires", label: "Dekk" },
    ],
    car: [
      { id: "wash", label: "Vask" },
      { id: "service", label: "Service" },
      { id: "tires", label: "Dekk" },
      { id: "interior", label: "Interiør" },
    ],
  },
  pet: {
    cat: [
      { id: "grooming", label: "Stell" },
      { id: "vet", label: "Veterinær" },
      { id: "other", label: "Annet" },
    ],
    dog: [
      { id: "grooming", label: "Stell" },
      { id: "vet", label: "Veterinær" },
      { id: "training", label: "Trening" },
      { id: "other", label: "Annet" },
    ],
  },
  home_service: {
    apartment: [
      { id: "cleaning", label: "Rengjøring" },
      { id: "plumber", label: "Rørlegger" },
      { id: "electrician", label: "Elektriker" },
    ],
    house: [
      { id: "cleaning", label: "Rengjøring" },
      { id: "plumber", label: "Rørlegger" },
      { id: "electrician", label: "Elektriker" },
      { id: "garden", label: "Hage" },
    ],
  },
  health: {
    individual: [
      { id: "massage", label: "Massasje" },
      { id: "physio", label: "Fysioterapi" },
      { id: "mental", label: "Mental helse" },
    ],
    group: [
      { id: "training", label: "Trening" },
      { id: "wellness", label: "Wellness" },
    ],
  },
};

const MODE_CATEGORIES_EN: Record<
  AppMode,
  Record<string, { id: string; label: string }[]>
> = {
  beauty: {
    male: [
      { id: "haircut", label: "Haircut" },
      { id: "braids", label: "Braids" },
      { id: "beard", label: "Beard" },
      { id: "brows", label: "Brows" },
      { id: "body", label: "Body" },
    ],
    female: [
      { id: "haircut", label: "Haircut" },
      { id: "braids", label: "Braids" },
      { id: "nails", label: "Nails" },
      { id: "lashes", label: "Lashes" },
      { id: "brows", label: "Brows" },
      { id: "body", label: "Body" },
    ],
  },
  vehicle: {
    motorcycle: [
      { id: "wash", label: "Wash" },
      { id: "service", label: "Service" },
      { id: "tires", label: "Tires" },
    ],
    car: [
      { id: "wash", label: "Wash" },
      { id: "service", label: "Service" },
      { id: "tires", label: "Tires" },
      { id: "interior", label: "Interior" },
    ],
  },
  pet: {
    cat: [
      { id: "grooming", label: "Grooming" },
      { id: "vet", label: "Veterinary" },
      { id: "other", label: "Other" },
    ],
    dog: [
      { id: "grooming", label: "Grooming" },
      { id: "vet", label: "Veterinary" },
      { id: "training", label: "Training" },
      { id: "other", label: "Other" },
    ],
  },
  home_service: {
    apartment: [
      { id: "cleaning", label: "Cleaning" },
      { id: "plumber", label: "Plumber" },
      { id: "electrician", label: "Electrician" },
    ],
    house: [
      { id: "cleaning", label: "Cleaning" },
      { id: "plumber", label: "Plumber" },
      { id: "electrician", label: "Electrician" },
      { id: "garden", label: "Garden" },
    ],
  },
  health: {
    individual: [
      { id: "massage", label: "Massage" },
      { id: "physio", label: "Physiotherapy" },
      { id: "mental", label: "Mental health" },
    ],
    group: [
      { id: "training", label: "Training" },
      { id: "wellness", label: "Wellness" },
    ],
  },
};

// No price — duration only
const MODE_SERVICES: Record<
  AppMode,
  Record<
    string,
    Record<string, { id: string; name: string; duration: number }[]>
  >
> = {
  beauty: {
    male: {
      haircut: [
        { id: "skin-fade", name: "Skin Fade", duration: 30 },
        { id: "low-fade", name: "Low Fade", duration: 25 },
        { id: "mid-fade", name: "Mid Fade", duration: 25 },
        { id: "high-fade", name: "High Fade", duration: 25 },
        { id: "buzz-cut", name: "Buzz Cut", duration: 15 },
        { id: "classic_cut_m", name: "Classic Cut", duration: 30 },
      ],
      braids: [
        { id: "box-braids-m", name: "Box Braids", duration: 120 },
        { id: "cornrows-m", name: "Cornrows", duration: 90 },
      ],
      beard: [
        { id: "beard-trim", name: "Beard Trim", duration: 15 },
        { id: "beard-shape", name: "Beard Shape", duration: 20 },
        { id: "beard-dye", name: "Beard Dye", duration: 30 },
      ],
      brows: [
        { id: "brow-shape-m", name: "Brow Shape", duration: 15 },
        { id: "brow-tint-m", name: "Brow Tint", duration: 20 },
      ],
      body: [
        { id: "massage-m", name: "Massage", duration: 60 },
        { id: "waxing-m", name: "Waxing", duration: 30 },
        { id: "facial-m", name: "Facial", duration: 45 },
      ],
    },
    female: {
      haircut: [
        { id: "classic-cut-f", name: "Classic Cut", duration: 45 },
        { id: "layers", name: "Layers", duration: 50 },
        { id: "bob", name: "Bob", duration: 40 },
        { id: "pixie", name: "Pixie Cut", duration: 35 },
      ],
      braids: [
        { id: "box-braids-f", name: "Box Braids", duration: 180 },
        { id: "cornrows-f", name: "Cornrows", duration: 120 },
        { id: "french-braids", name: "French Braids", duration: 45 },
        { id: "dutch-braids", name: "Dutch Braids", duration: 45 },
      ],
      nails: [
        { id: "pedicure", name: "Pedicure", duration: 50 },
        { id: "gel-nails", name: "Gel Nails", duration: 75 },
        { id: "acrylic-nails", name: "Acrylic Nails", duration: 90 },
      ],
      lashes: [
        { id: "classic-lashes", name: "Classic Lashes", duration: 90 },
        { id: "volume-lashes", name: "Volume Lashes", duration: 120 },
        { id: "hybrid-lashes", name: "Hybrid Lashes", duration: 100 },
      ],
      brows: [
        { id: "brow-shape-f", name: "Brow Shape", duration: 20 },
        { id: "brow-tint-f", name: "Brow Tint", duration: 25 },
        { id: "brow-lamination", name: "Brow Lamination", duration: 45 },
      ],
      body: [
        { id: "massage-f", name: "Massage", duration: 60 },
        { id: "waxing-f", name: "Waxing", duration: 30 },
        { id: "facial-f", name: "Facial", duration: 45 },
      ],
    },
  },
  vehicle: {
    motorcycle: {
      wash: [
        { id: "quick-wash-mc", name: "Quick Wash", duration: 20 },
        { id: "full-wash-mc", name: "Full Wash", duration: 40 },
        { id: "premium-detail-mc", name: "Premium Detailing", duration: 90 },
      ],
      service: [
        { id: "oil-change-mc", name: "Oil Change", duration: 30 },
        { id: "brake-change-mc", name: "Brake Service", duration: 60 },
        { id: "chain-maintenance", name: "Chain Maintenance", duration: 30 },
      ],
      tires: [
        { id: "tire-change-mc", name: "Tire Change", duration: 30 },
        { id: "tire-hotel-mc", name: "Tire Storage", duration: 20 },
        { id: "puncture-mc", name: "Puncture Repair", duration: 20 },
      ],
    },
    car: {
      wash: [
        { id: "exterior-wash", name: "Exterior Wash", duration: 30 },
        { id: "interior-wash", name: "Interior Wash", duration: 45 },
        { id: "full-detail", name: "Full Detailing", duration: 180 },
      ],
      service: [
        { id: "oil-change-car", name: "Oil Change", duration: 45 },
        { id: "brake-check", name: "Brake Check", duration: 30 },
        { id: "battery", name: "Battery Service", duration: 20 },
        { id: "air-filter", name: "Air Filter", duration: 20 },
      ],
      tires: [
        { id: "tire-change-car", name: "Tire Change", duration: 45 },
        { id: "tire-hotel-car", name: "Tire Storage", duration: 20 },
        { id: "wheel-alignment", name: "Wheel Alignment", duration: 45 },
      ],
      interior: [
        { id: "vacuum", name: "Vacuum", duration: 30 },
        { id: "deep-clean", name: "Deep Cleaning", duration: 60 },
        { id: "odor-removal", name: "Luktsanering", duration: 90 },
      ],
    },
  },
  pet: {
    cat: {
      grooming: [
        { id: "cat-haircut", name: "Full Trim", duration: 60 },
        { id: "cat-nails", name: "Nail Trim", duration: 15 },
        { id: "cat-brush", name: "Brushing", duration: 30 },
      ],
      vet: [
        { id: "cat-vaccine", name: "Vaccination", duration: 30 },
        { id: "cat-health", name: "Health Check", duration: 30 },
        { id: "cat-dental", name: "Dental Check", duration: 20 },
      ],
      other: [
        { id: "cat-sitting", name: "Cat Sitting", duration: 60 },
        { id: "cat-transport", name: "Transport", duration: 30 },
      ],
    },
    dog: {
      grooming: [
        { id: "dog-haircut", name: "Full Trim", duration: 60 },
        { id: "dog-nails", name: "Nail Trim", duration: 15 },
        { id: "dog-bath", name: "Bathing", duration: 45 },
        { id: "dog-brush", name: "Brushing", duration: 30 },
      ],
      vet: [
        { id: "dog-vaccine", name: "Vaccination", duration: 30 },
        { id: "dog-health", name: "Health Check", duration: 30 },
        { id: "dog-dental", name: "Dental Check", duration: 25 },
      ],
      training: [
        { id: "obedience", name: "Obedience", duration: 60 },
        { id: "tricks", name: "Tricks", duration: 45 },
        { id: "puppy-training", name: "Puppy Training", duration: 45 },
      ],
      other: [
        { id: "dog-sitting", name: "Dog Sitting", duration: 60 },
        { id: "dog-walking", name: "Dog Walking", duration: 30 },
        { id: "dog-transport", name: "Transport", duration: 30 },
      ],
    },
  },
  home_service: {
    apartment: {
      cleaning: [
        { id: "deep-clean-apt", name: "Deep Cleaning", duration: 240 },
        { id: "basic-clean", name: "Regular Cleaning", duration: 120 },
        { id: "window-clean-apt", name: "Window Cleaning", duration: 60 },
      ],
      plumber: [
        { id: "drain", name: "Clogged Drain", duration: 60 },
        { id: "faucet-apt", name: "Faucet Leak", duration: 45 },
        { id: "toilet-apt", name: "Toilet Issues", duration: 45 },
      ],
      electrician: [
        { id: "light-install", name: "Light Installation", duration: 45 },
        { id: "outlet-install", name: "Power Outlets", duration: 60 },
        { id: "fuse-apt", name: "Fuse Box", duration: 60 },
      ],
    },
    house: {
      cleaning: [
        { id: "basic-clean-h", name: "Regular Cleaning", duration: 180 },
        { id: "deep-clean-h", name: "Deep Cleaning", duration: 360 },
        { id: "window-clean-house", name: "Window Cleaning", duration: 90 },
        { id: "facade-clean", name: "Facade Cleaning", duration: 180 },
      ],
      plumber: [
        { id: "drain-h", name: "Clogged Drain", duration: 60 },
        { id: "faucet-house", name: "Faucet Leak", duration: 45 },
        { id: "water-heater", name: "Water Heater", duration: 120 },
      ],
      electrician: [
        { id: "light-house", name: "Light Installation", duration: 45 },
        { id: "ev-charger", name: "EV Charger", duration: 240 },
        { id: "fuse-house", name: "Fuse Box", duration: 90 },
      ],
      garden: [
        { id: "lawn-mowing", name: "Lawn Mowing", duration: 60 },
        { id: "hedge", name: "Hedge Trimming", duration: 90 },
        { id: "snow-removal", name: "Snow Removal", duration: 45 },
      ],
    },
  },
  health: {
    individual: {
      massage: [
        { id: "relaxing", name: "Relaxation", duration: 60 },
        { id: "deep-tissue", name: "Deep Tissue", duration: 60 },
        { id: "sports", name: "Sports Massage", duration: 60 },
      ],
      physio: [
        { id: "assessment", name: "Assessment", duration: 45 },
        { id: "treatment", name: "Treatment", duration: 45 },
        { id: "rehabilitation", name: "Rehabilitation", duration: 60 },
      ],
      mental: [
        { id: "therapy", name: "Talk Therapy", duration: 60 },
        { id: "stress", name: "Stress Management", duration: 45 },
      ],
    },
    group: {
      training: [
        { id: "yoga", name: "Yoga", duration: 60 },
        { id: "pilates", name: "Pilates", duration: 60 },
        { id: "hiit", name: "HIIT", duration: 45 },
      ],
      wellness: [
        { id: "meditation", name: "Meditation", duration: 45 },
        { id: "breathwork", name: "Breathing", duration: 45 },
      ],
    },
  },
};

// ── Icons — identical to page.tsx ─────────────────────────────────────────────
function ModeIcon({
  mode,
  className = "h-4 w-4",
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

function CategoryIcon({
  mode,
  category,
  className = "h-3.5 w-3.5",
}: {
  mode: AppMode;
  category: string;
  className?: string;
}) {
  if (mode === "beauty") {
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
  if (mode === "vehicle") {
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
  if (mode === "pet") {
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
  if (mode === "home_service") {
    if (category === "cleaning")
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
  if (mode === "health") {
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

function readCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

async function readDeviceLocation(): Promise<{
  lat: number;
  lng: number;
} | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 12_000 },
    );
  });
}

async function resolvePriceLocationCoords(
  providerId: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch("/api/providers/me", {
      cache: "no-store",
      headers: { "x-provider-id": providerId },
    });
    if (res.ok) {
      const body = await res.json();
      const defaultLocation = body?.defaultLocation || {};
      const contact = body?.contact || {};
      const lat =
        readCoordinate(defaultLocation.lat) ?? readCoordinate(contact.lat);
      const lng =
        readCoordinate(defaultLocation.lng) ?? readCoordinate(contact.lng);
      if (lat != null && lng != null) return { lat, lng };
    }
  } catch {
    /* fall through to device GPS */
  }
  return readDeviceLocation();
}

// ── Props ─────────────────────────────────────────────────────────────────────
type SkillsSnapshot = {
  mode?: AppMode;
  target?: string;
  categories?: string[];
  services?: string[];
  ratings?: Record<string, number>;
  savedAt?: number;
};

const APP_MODE_IDS = [
  "beauty",
  "vehicle",
  "pet",
  "home_service",
  "health",
] as const;

function isAppMode(value: string): value is AppMode {
  return (APP_MODE_IDS as readonly string[]).includes(value);
}

const DEFAULT_TARGET_BY_MODE: Record<AppMode, string> = {
  beauty: "male",
  vehicle: "car",
  pet: "dog",
  home_service: "apartment",
  health: "individual",
};

const DEFAULT_CATEGORY_BY_MODE: Record<AppMode, Record<string, string>> = {
  beauty: { male: "haircut", female: "haircut" },
  vehicle: { car: "wash", motorcycle: "wash" },
  pet: { dog: "grooming", cat: "grooming" },
  home_service: { apartment: "cleaning", house: "cleaning" },
  health: { individual: "massage", group: "training" },
};

function normalizeServiceId(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function serviceIdVariants(value: unknown): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const dash = raw.replace(/_/g, "-");
  const underscore = raw.replace(/-/g, "_");
  return [...new Set([raw, dash, underscore])];
}

function serviceIdVariantsForSkills(value: unknown): string[] {
  const normalized = normalizeServiceId(value);
  if (!normalized) return [];
  const direct = serviceIdVariants(normalized);
  const aliases = SERVICE_ID_ALIASES[normalized] || [];
  const reverseAliases = Object.entries(SERVICE_ID_ALIASES)
    .filter(([, mapped]) =>
      mapped.some((id) => normalizeServiceId(id) === normalized),
    )
    .map(([uiId]) => uiId);
  const aliasVariants = [...aliases, ...reverseAliases].flatMap((id) =>
    serviceIdVariants(id),
  );
  return [
    ...new Set(
      [...direct, ...aliasVariants].map((id) => normalizeServiceId(id)),
    ),
  ];
}

function catalogPriceAnchorKr(durationMinutes: number): number {
  return Math.max(150, Math.round((durationMinutes || 30) * 12));
}

function findServiceDurationMinutes(mode: AppMode, serviceId: string): number {
  const variants = new Set(serviceIdVariantsForSkills(serviceId));
  const targets = MODE_SERVICES[mode] || {};
  for (const categories of Object.values(targets)) {
    for (const services of Object.values(categories)) {
      const hit = services.find((service) =>
        serviceIdVariantsForSkills(service.id).some((variant) =>
          variants.has(variant),
        ),
      );
      if (hit) return hit.duration;
    }
  }
  return 30;
}

function applyPriceToVariants(
  target: Record<string, number>,
  serviceId: string,
  price: number,
) {
  for (const variant of serviceIdVariantsForSkills(serviceId)) {
    target[variant] = price;
  }
}

function PriceSliderSkeleton() {
  return (
    <div className="animate-pulse space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 rounded-full bg-gray-200" />
        <div className="h-4 w-14 rounded bg-gray-200" />
      </div>
      <div className="flex justify-between">
        <div className="h-3 w-10 rounded bg-gray-200" />
        <div className="h-3 w-10 rounded bg-gray-200" />
      </div>
    </div>
  );
}

function readStoredSkillsSnapshot(
  providerId: string | null,
): SkillsSnapshot | null {
  if (typeof window === "undefined" || !providerId) return null;
  const keys = [
    `freshup.skills.snapshot.${providerId}`,
    "freshup.skills.snapshot.last",
  ];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as SkillsSnapshot;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore malformed snapshot
    }
  }
  return null;
}

function resolveInitialSkillsNavigation(
  providerId: string | null,
  initialMode?: AppMode,
  initialTarget?: string,
  initialCategory?: string,
) {
  const snap = readStoredSkillsSnapshot(providerId);
  const mode =
    (snap?.mode && isAppMode(snap.mode) ? snap.mode : null) ||
    (initialMode && isAppMode(initialMode) ? initialMode : null) ||
    "beauty";
  const modeTargets = MODE_TARGETS_NO[mode] || [];
  const snapshotTarget = String(snap?.target || "");
  const target =
    modeTargets.find((entry) => entry.id === snapshotTarget)?.id ||
    (initialTarget && modeTargets.some((entry) => entry.id === initialTarget)
      ? initialTarget
      : null) ||
    modeTargets[0]?.id ||
    DEFAULT_TARGET_BY_MODE[mode];
  const modeCategories = MODE_CATEGORIES_NO[mode]?.[target] || [];
  const category =
    modeCategories.find((entry) => (snap?.categories || []).includes(entry.id))
      ?.id ||
    (initialCategory &&
    modeCategories.some((entry) => entry.id === initialCategory)
      ? initialCategory
      : null) ||
    modeCategories[0]?.id ||
    DEFAULT_CATEGORY_BY_MODE[mode]?.[target] ||
    "";
  return { mode, target, category };
}

interface SkillsPageProps {
  onBack: () => void;
  language?: "no" | "en";
  providerId?: string | null;
  initialMode?: AppMode;
  initialTarget?: string;
  initialCategory?: string;
}

export default function SkillsPage({
  onBack,
  language = "no",
  providerId = null,
  initialMode,
  initialTarget,
  initialCategory,
}: SkillsPageProps) {
  const isEn = language === "en";
  const APP_MODES = isEn ? APP_MODES_EN : APP_MODES_NO;
  const MODE_TARGETS = isEn ? MODE_TARGETS_EN : MODE_TARGETS_NO;
  const MODE_CATEGORIES = isEn ? MODE_CATEGORIES_EN : MODE_CATEGORIES_NO;

  const initialNav = resolveInitialSkillsNavigation(
    providerId,
    initialMode,
    initialTarget,
    initialCategory,
  );

  const [selectedMode, setSelectedMode] = useState<AppMode>(initialNav.mode);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState(initialNav.target);
  const [selectedCategory, setSelectedCategory] = useState(initialNav.category);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [serviceRatings, setServiceRatings] = useState<Record<string, number>>(
    {},
  );
  // FreshUp Pricing & Tier System v1.0 §2.1 — typical price per service (NOK).
  const [servicePrices, setServicePrices] = useState<Record<string, number>>(
    {},
  );
  const [servicePriceAnchors, setServicePriceAnchors] = useState<
    Record<string, number>
  >({});
  const [servicePricesLoading, setServicePricesLoading] = useState(
    Boolean(providerId),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isLoadingSkills, setIsLoadingSkills] = useState(Boolean(providerId));

  const currentTargets = MODE_TARGETS[selectedMode];

  const normalizeName = (value: string) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const normalizeTargetId = (value: string) => {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    if (!raw) return raw;
    const parts = raw.split("_");
    return parts[parts.length - 1] || raw;
  };
  const normalizeCategoryId = (value: string) => {
    const raw = String(value || "")
      .trim()
      .toLowerCase();
    if (!raw) return raw;
    const parts = raw.split("_");
    return parts[parts.length - 1] || raw;
  };

  useEffect(() => {
    const loadSavedSkills = async () => {
      if (!providerId) {
        setIsLoadingSkills(false);
        return;
      }

      const storedSnapshot = readStoredSkillsSnapshot(providerId);

      const applyNavigationForMode = (mode: AppMode) => {
        const modeTargets = MODE_TARGETS[mode] || [];
        const snapshotTarget = String(storedSnapshot?.target || "");
        const nextTarget =
          modeTargets.find(
            (entry) =>
              normalizeTargetId(entry.id) === normalizeTargetId(snapshotTarget),
          )?.id ||
          (initialTarget &&
          modeTargets.some(
            (entry) =>
              normalizeTargetId(entry.id) === normalizeTargetId(initialTarget),
          )
            ? initialTarget
            : null) ||
          modeTargets[0]?.id ||
          DEFAULT_TARGET_BY_MODE[mode];

        const modeCategories = MODE_CATEGORIES[mode]?.[nextTarget] || [];
        let nextCategory =
          modeCategories.find((entry) =>
            (storedSnapshot?.categories || []).includes(entry.id),
          )?.id || null;

        if (!nextCategory && storedSnapshot?.services?.length) {
          const normalizedServices = new Set(
            storedSnapshot.services.flatMap((id) =>
              serviceIdVariantsForSkills(id),
            ),
          );
          nextCategory =
            modeCategories.find((entry) =>
              (MODE_SERVICES[mode]?.[nextTarget]?.[entry.id] || []).some(
                (service) =>
                  normalizedServices.has(normalizeServiceId(service.id)),
              ),
            )?.id || null;
        }

        if (
          !nextCategory &&
          initialCategory &&
          modeCategories.some((entry) => entry.id === initialCategory)
        ) {
          nextCategory = initialCategory;
        }

        if (!nextCategory) {
          nextCategory =
            modeCategories[0]?.id ||
            DEFAULT_CATEGORY_BY_MODE[mode]?.[nextTarget] ||
            "";
        }

        setSelectedMode(mode);
        setSelectedTarget(nextTarget);
        setSelectedCategory(nextCategory);

        if (storedSnapshot?.services?.length) {
          setSelectedServices([...new Set(storedSnapshot.services)]);
        }
        if (storedSnapshot?.ratings) {
          setServiceRatings(storedSnapshot.ratings);
        }
      };

      try {
        const res = await fetch("/api/providers/me", {
          cache: "no-store",
          headers: { "x-provider-id": providerId },
        });
        if (!res.ok) {
          if (storedSnapshot?.mode && isAppMode(storedSnapshot.mode)) {
            applyNavigationForMode(storedSnapshot.mode);
          } else if (initialMode && isAppMode(initialMode)) {
            applyNavigationForMode(initialMode);
          }
          return;
        }
        const body = await res.json();
        const skills = Array.isArray(body?.skills) ? body.skills : [];
        const activeSkills = skills.filter((s: any) => s?.is_active !== false);
        if (activeSkills.length === 0) {
          if (storedSnapshot?.mode && isAppMode(storedSnapshot.mode)) {
            applyNavigationForMode(storedSnapshot.mode);
          } else if (initialMode && isAppMode(initialMode)) {
            applyNavigationForMode(initialMode);
          }
          return;
        }

        const serviceIndex = new Map<
          string,
          { id: string; mode: AppMode; target: string; category: string }
        >();
        const serviceNameIndex = new Map<
          string,
          { id: string; mode: AppMode; target: string; category: string }
        >();
        (Object.keys(MODE_SERVICES) as AppMode[]).forEach((mode) => {
          Object.entries(MODE_SERVICES[mode] || {}).forEach(
            ([target, categories]) => {
              Object.entries(categories || {}).forEach(
                ([category, services]) => {
                  (services || []).forEach((service) => {
                    const mapped = {
                      id: service.id,
                      mode,
                      target,
                      category,
                    };
                    serviceIdVariantsForSkills(service.id).forEach((id) => {
                      serviceIndex.set(id, mapped);
                    });
                    serviceNameIndex.set(
                      `${mode}|${target}|${category}|${normalizeName(service.name)}`,
                      mapped,
                    );
                  });
                },
              );
            },
          );
        });

        const catalogRes = await fetch("/api/services/list?hierarchy=1", {
          cache: "no-store",
        });
        const catalogJson = catalogRes.ok
          ? await catalogRes.json().catch(() => ({}))
          : {};
        const catalogServices = Array.isArray(catalogJson?.services)
          ? catalogJson.services
          : [];
        const catalogById = new Map<string, any>();
        catalogServices.forEach((row: any) => {
          const key = normalizeServiceId(String(row?.id || ""));
          if (key) catalogById.set(key, row);
        });

        const resolved = activeSkills
          .map((s: any) => {
            const serviceId = normalizeServiceId(String(s?.service_id || ""));
            const direct = serviceIndex.get(serviceId);
            if (direct)
              return { ...direct, rating: Number(s?.competence_rating) || 3 };
            const catalogRow = catalogById.get(serviceId);
            if (catalogRow) {
              const mode = String(catalogRow?.mode_id || "").trim() as AppMode;
              const target = normalizeTargetId(
                String(catalogRow?.target_id || ""),
              );
              const category = normalizeCategoryId(
                String(catalogRow?.category_id || ""),
              );
              const nameKey = normalizeName(String(catalogRow?.name || ""));
              const byName = serviceNameIndex.get(
                `${mode}|${target}|${category}|${nameKey}`,
              );
              if (byName)
                return { ...byName, rating: Number(s?.competence_rating) || 3 };
            }
            return null;
          })
          .filter(Boolean) as Array<{
          id: string;
          mode: AppMode;
          target: string;
          category: string;
          rating: number;
        }>;

        if (resolved.length === 0) {
          if (storedSnapshot?.mode && isAppMode(storedSnapshot.mode)) {
            applyNavigationForMode(storedSnapshot.mode);
          } else if (initialMode && isAppMode(initialMode)) {
            applyNavigationForMode(initialMode);
          }
          return;
        }

        const validModes = Object.keys(APP_MODES) as AppMode[];
        let nextMode: AppMode = selectedMode;
        if (storedSnapshot?.mode && isAppMode(storedSnapshot.mode)) {
          nextMode = storedSnapshot.mode;
        } else if (initialMode && isAppMode(initialMode)) {
          nextMode = initialMode;
        } else {
          const modeCounts = new Map<AppMode, number>();
          for (const entry of resolved) {
            modeCounts.set(entry.mode, (modeCounts.get(entry.mode) || 0) + 1);
          }
          let bestMode = resolved[0]?.mode;
          let bestCount = 0;
          for (const [mode, count] of modeCounts) {
            if (count > bestCount) {
              bestCount = count;
              bestMode = mode;
            }
          }
          if (bestMode && validModes.includes(bestMode)) {
            nextMode = bestMode;
          }
        }

        const modeResolved = resolved.filter(
          (entry) => entry.mode === nextMode,
        );
        const targets = [...new Set(modeResolved.map((entry) => entry.target))];
        const categories = [
          ...new Set(modeResolved.map((entry) => entry.category)),
        ];
        const services = [...new Set(resolved.map((entry) => entry.id))];
        const ratings = Object.fromEntries(
          resolved.map((entry) => [
            entry.id,
            Math.max(1, Math.min(5, Number(entry.rating) || 3)),
          ]),
        );

        const modeTargets = MODE_TARGETS[nextMode] || [];
        const snapshotTarget = String(storedSnapshot?.target || "");
        const nextTarget =
          modeTargets.find(
            (entry) =>
              normalizeTargetId(entry.id) === normalizeTargetId(snapshotTarget),
          )?.id ||
          (initialTarget &&
          modeTargets.some(
            (entry) =>
              normalizeTargetId(entry.id) === normalizeTargetId(initialTarget),
          )
            ? initialTarget
            : null) ||
          targets[0] ||
          modeTargets[0]?.id ||
          DEFAULT_TARGET_BY_MODE[nextMode];

        const modeCategories = MODE_CATEGORIES[nextMode]?.[nextTarget] || [];
        let nextCategory =
          modeCategories.find((entry) =>
            (storedSnapshot?.categories || []).includes(entry.id),
          )?.id || null;

        if (!nextCategory && storedSnapshot?.services?.length) {
          const normalizedServices = new Set(
            storedSnapshot.services.flatMap((id) =>
              serviceIdVariantsForSkills(id),
            ),
          );
          nextCategory =
            modeCategories.find((entry) =>
              (MODE_SERVICES[nextMode]?.[nextTarget]?.[entry.id] || []).some(
                (service) =>
                  normalizedServices.has(normalizeServiceId(service.id)),
              ),
            )?.id || null;
        }

        if (
          !nextCategory &&
          initialCategory &&
          modeCategories.some((entry) => entry.id === initialCategory)
        ) {
          nextCategory = initialCategory;
        }

        if (!nextCategory) {
          nextCategory =
            categories[0] ||
            modeCategories[0]?.id ||
            DEFAULT_CATEGORY_BY_MODE[nextMode]?.[nextTarget] ||
            "";
        }

        setSelectedMode(nextMode);
        setSelectedTarget(nextTarget);
        setSelectedCategory(nextCategory);
        setSelectedServices(services);
        setServiceRatings(ratings);
      } catch {
        if (storedSnapshot?.mode && isAppMode(storedSnapshot.mode)) {
          applyNavigationForMode(storedSnapshot.mode);
        } else if (initialMode && isAppMode(initialMode)) {
          applyNavigationForMode(initialMode);
        }
      } finally {
        setIsLoadingSkills(false);
      }
    };

    void loadSavedSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, initialMode, initialTarget, initialCategory]);

  const currentCategories = useMemo(
    () => MODE_CATEGORIES[selectedMode]?.[selectedTarget] || [],
    [selectedMode, selectedTarget, MODE_CATEGORIES],
  );

  const availableServices = useMemo(() => {
    const targetKey = normalizeTargetId(selectedTarget);
    const categoryKey = normalizeCategoryId(selectedCategory);
    const byTarget =
      MODE_SERVICES[selectedMode]?.[selectedTarget] ||
      MODE_SERVICES[selectedMode]?.[targetKey] ||
      {};
    const catServices =
      byTarget[selectedCategory] || byTarget[categoryKey] || [];
    return catServices.map((service) => ({
      ...service,
      target: selectedTarget,
      category: selectedCategory,
    }));
  }, [selectedMode, selectedTarget, selectedCategory]);

  const selectTarget = (id: string) => {
    setSelectedTarget(id);
    const cats = MODE_CATEGORIES[selectedMode]?.[id] || [];
    setSelectedCategory((prev) => {
      if (cats.some((cat) => cat.id === prev)) return prev;
      return cats[0]?.id || "";
    });
  };

  const selectCategory = (id: string) => {
    setSelectedCategory(id);
  };

  const resolveSkillSelections = useCallback(() => {
    const targets = new Set<string>();
    const categories = new Set<string>();
    for (const serviceId of selectedServices) {
      const selectedVariants = serviceIdVariantsForSkills(serviceId);
      let matched = false;
      for (const [target, categoriesByTarget] of Object.entries(
        MODE_SERVICES[selectedMode] || {},
      )) {
        for (const [category, services] of Object.entries(
          categoriesByTarget || {},
        )) {
          if (
            services.some((service) =>
              serviceIdVariantsForSkills(service.id).some((id) =>
                selectedVariants.includes(id),
              ),
            )
          ) {
            targets.add(target);
            categories.add(category);
            matched = true;
          }
        }
      }
      if (!matched) {
        targets.add(selectedTarget);
        categories.add(selectedCategory);
      }
    }
    return {
      targets: Array.from(targets),
      categories: Array.from(categories),
    };
  }, [selectedCategory, selectedMode, selectedServices, selectedTarget]);

  const toggleService = (id: string) => {
    const variants = serviceIdVariantsForSkills(id);
    setSelectedServices((prev) => {
      const isSelected = prev.some((serviceId) =>
        serviceIdVariantsForSkills(serviceId).some((variant) =>
          variants.includes(variant),
        ),
      );
      if (isSelected) {
        const newRatings = { ...serviceRatings };
        Object.keys(newRatings).forEach((ratingId) => {
          if (
            serviceIdVariantsForSkills(ratingId).some((variant) =>
              variants.includes(variant),
            )
          ) {
            delete newRatings[ratingId];
          }
        });
        setServiceRatings(newRatings);
        return prev.filter(
          (serviceId) =>
            !serviceIdVariantsForSkills(serviceId).some((variant) =>
              variants.includes(variant),
            ),
        );
      }
      setServiceRatings((r) => ({ ...r, [id]: 3 }));
      return [...prev, id];
    });
  };

  const setRating = (serviceId: string, rating: number) => {
    setServiceRatings((prev) => ({ ...prev, [serviceId]: rating }));
  };

  const setPriceKr = (serviceId: string, value: number) => {
    const next = Math.max(0, Math.round(Number(value) || 0));
    setServicePrices((prev) => ({ ...prev, [serviceId]: next }));
  };

  // Pre-fill servicePrices with whatever the provider previously submitted.
  useEffect(() => {
    if (!providerId || selectedServices.length === 0) {
      setServicePricesLoading(false);
      return;
    }
    let cancelled = false;
    const loadPrices = async () => {
      setServicePricesLoading(true);
      try {
        const tasks = selectedServices.map(async (id) => {
          try {
            const res = await fetch(
              `/api/pricing/submit-base?service_id=${encodeURIComponent(id)}`,
              { cache: "no-store", headers: { "x-provider-id": providerId } },
            );
            if (!res.ok) return null;
            const body = await res.json();
            const price = body?.submitted?.price;
            return typeof price === "number" && price > 0
              ? ([id, price] as const)
              : null;
          } catch {
            return null;
          }
        });
        const results = await Promise.all(tasks);
        if (cancelled) return;

        const savedByService = new Map<string, number>();
        for (const r of results) {
          if (r) savedByService.set(r[0], r[1]);
        }

        setServicePrices((prev) => {
          const next = { ...prev };
          for (const [serviceId, price] of savedByService) {
            applyPriceToVariants(next, serviceId, price);
          }
          for (const serviceId of selectedServices) {
            const variants = serviceIdVariantsForSkills(serviceId);
            const hasPrice = variants.some(
              (v) => next[v] != null && next[v] > 0,
            );
            if (hasPrice) continue;
            const anchor = catalogPriceAnchorKr(
              findServiceDurationMinutes(selectedMode, serviceId),
            );
            applyPriceToVariants(next, serviceId, anchor);
          }
          return next;
        });

        setServicePriceAnchors((prev) => {
          const next = { ...prev };
          for (const [serviceId, price] of savedByService) {
            applyPriceToVariants(next, serviceId, price);
          }
          for (const serviceId of selectedServices) {
            const variants = serviceIdVariantsForSkills(serviceId);
            const hasAnchor = variants.some(
              (v) => next[v] != null && next[v] > 0,
            );
            if (hasAnchor) continue;
            const anchor = catalogPriceAnchorKr(
              findServiceDurationMinutes(selectedMode, serviceId),
            );
            applyPriceToVariants(next, serviceId, anchor);
          }
          return next;
        });
      } finally {
        if (!cancelled) setServicePricesLoading(false);
      }
    };
    void loadPrices();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, selectedMode, selectedServices.join(",")]);

  const handleSaveSkills = async () => {
    if (!providerId) {
      setSaveError(
        isEn
          ? "Please log in again before saving skills."
          : "Logg inn pa nytt for a lagre ferdigheter.",
      );
      return;
    }
    if (selectedServices.length === 0) {
      setSaveError(
        isEn ? "Select at least one service." : "Velg minst en tjeneste.",
      );
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const delivery_modes = resolveDeliveryModesForSkillsSave(
        providerId,
        selectedMode,
      );
      const { targets, categories } = resolveSkillSelections();
      const payload = {
        delivery_modes,
        mode_selections: [
          {
            mode_id: selectedMode,
            targets,
            categories,
            services: selectedServices.map((serviceId) => ({
              service_id: serviceId,
              competence_rating: serviceRatings[serviceId] || 3,
            })),
          },
        ],
      };

      const res = await fetch("/api/providers/onboard", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-provider-id": providerId,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = isEn
          ? "Failed to save skills."
          : "Klarte ikke a lagre ferdigheter.";
        try {
          const data = await res.json();
          if (data?.error && typeof data.error === "string") msg = data.error;
        } catch {}
        throw new Error(msg);
      }

      if (typeof window !== "undefined") {
        const snapshot = {
          mode: selectedMode,
          target: selectedTarget,
          categories: resolveSkillSelections().categories,
          services: selectedServices,
          ratings: serviceRatings,
          deliveryMode: delivery_modes.includes("home") ? "home" : "provider",
          savedAt: Date.now(),
        };
        localStorage.setItem(
          `freshup.skills.snapshot.${providerId}`,
          JSON.stringify(snapshot),
        );
        localStorage.setItem(
          "freshup.skills.snapshot.last",
          JSON.stringify(snapshot),
        );
        window.dispatchEvent(new CustomEvent("providerSkillsUpdated"));
      }

      // FreshUp Pricing & Tier System v1.0 §2.1 — submit each provider's
      // typical price for each activated service. Failures here are NOT
      // fatal: the skill record is already saved, the provider can re-enter
      // prices later from this same screen. We only POST when the provider
      // typed something parseable; blanks are left for the next visit.
      const priceSubmissions = selectedServices
        .map((serviceId) => {
          const price = servicePrices[serviceId];
          if (price == null || !Number.isFinite(price) || price <= 0)
            return null;
          return { serviceId, price };
        })
        .filter(
          (entry): entry is { serviceId: string; price: number } =>
            entry !== null,
        );

      // Track per-call failures so we can show a clear, actionable message.
      const priceFailures: Array<{ serviceId: string; reason: string }> = [];
      const priceCoords =
        priceSubmissions.length > 0
          ? await resolvePriceLocationCoords(providerId)
          : null;
      if (priceSubmissions.length > 0) {
        await Promise.all(
          priceSubmissions.map(async ({ serviceId, price }) => {
            try {
              const res = await fetch("/api/pricing/submit-base", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-provider-id": providerId,
                },
                body: JSON.stringify({
                  service_id: serviceId,
                  price,
                  source: "signup",
                  ...(priceCoords
                    ? { lat: priceCoords.lat, lng: priceCoords.lng }
                    : {}),
                }),
              });
              if (!res.ok) {
                let body: any = null;
                try {
                  body = await res.json();
                } catch {}
                priceFailures.push({
                  serviceId,
                  reason: String(
                    body?.reason || body?.error || `HTTP ${res.status}`,
                  ),
                });
              }
            } catch (priceErr) {
              console.error(
                "[skills] submit-base failed for",
                serviceId,
                priceErr,
              );
              priceFailures.push({
                serviceId,
                reason: "NETWORK_ERROR",
              });
            }
          }),
        );
      }

      // If anything failed, surface a single, actionable warning instead of
      // navigating away silently. Skills are already saved at this point —
      // the provider just needs to know their prices weren't recorded.
      if (priceFailures.length > 0) {
        const reasons = new Set(priceFailures.map((f) => f.reason));
        const isAreaIssue =
          reasons.has("AREA_UNKNOWN") ||
          reasons.has("missing_coordinates") ||
          reasons.has("area_resolution_failed");
        const summary = isAreaIssue
          ? reasons.has("missing_coordinates")
            ? isEn
              ? "Skills saved, but prices were not. We couldn't read your location — allow location access or set a map pin in Profile, then re-enter your prices here."
              : "Ferdighetene ble lagret, men prisene ble ikke det. Vi fant ikke posisjonen din – tillat posisjon eller sett et kartpunkt i Profil, og legg så inn prisene her igjen."
            : isEn
              ? "Skills saved, but prices were not. We couldn't determine your service area from your current location — check Profile, then re-enter your prices here."
              : "Ferdighetene ble lagret, men prisene ble ikke det. Vi fant ikke tjenesteområdet fra nåværende posisjon – sjekk Profil, og legg så inn prisene her igjen."
          : isEn
            ? `Skills saved, but ${priceFailures.length} price${priceFailures.length === 1 ? "" : "s"} could not be saved. Please try again later.`
            : `Ferdighetene ble lagret, men ${priceFailures.length} pris${priceFailures.length === 1 ? "" : "er"} kunne ikke lagres. Prøv igjen senere.`;
        setSaveError(summary);
        // Don't navigate away — keep the user on the page so they can fix it.
        return;
      }

      onBack();
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : isEn
            ? "Failed to save skills."
            : "Klarte ikke a lagre ferdigheter.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Check if mode has any services enabled
  const getModeHasServices = (mode: AppMode) =>
    selectedServices.length > 0 && selectedMode === mode;

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-transparent to-slate-100 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-14 pb-3">
        <button
          onClick={onBack}
          className="w-10 h-10 glass-morphism rounded-xl flex items-center justify-center border-0"
        >
          <ChevronLeft className="h-5 w-5 text-gray-700" />
        </button>
        <h1 className="text-lg font-bold text-gray-900">Skills</h1>
        <div className="w-10" />
      </div>

      {/* Intro text */}
      <div className="px-4 pb-4">
        <p className="text-sm text-gray-600">
          {isEn
            ? "Manage your services. Toggle on the ones you can provide and set your skill level."
            : "Administrer dine tjenester. Slå på de du kan tilby og sett ferdighetsnivå."}
        </p>
      </div>

      {/* Mode dropdown - like in signup */}
      <div className="px-4 pb-2 relative">
        <Button
          variant="ghost"
          className="glass-morphism-strong rounded-full px-3 h-10 border-0 text-gray-800 hover:text-gray-900 flex items-center gap-1.5 text-sm"
          onClick={(e) => {
            e.stopPropagation();
            setShowModeDropdown(!showModeDropdown);
          }}
        >
          <ModeIcon mode={selectedMode} className="h-4 w-4" />
          <span className="font-semibold text-xs">Mode</span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              showModeDropdown && "rotate-180",
            )}
          />
        </Button>

        {showModeDropdown && (
          <div className="absolute top-full left-4 mt-2 glass-morphism-strong rounded-2xl p-2 min-w-[180px] z-50 animate-in fade-in-50 slide-in-from-top-4 duration-200 border-0">
            {(Object.keys(APP_MODES) as AppMode[]).map((m) => (
              <button
                key={m}
                className={cn(
                  "w-full px-3 py-2.5 rounded-xl text-left transition-all duration-200 flex items-center gap-2 text-sm",
                  selectedMode === m
                    ? "glass-button-active"
                    : "hover:bg-white/20 text-gray-800",
                )}
                onClick={() => {
                  setSelectedMode(m);
                  setShowModeDropdown(false);
                  const nextTarget = MODE_TARGETS[m][0].id;
                  setSelectedTarget(nextTarget);
                  const cats = MODE_CATEGORIES[m]?.[nextTarget];
                  if (cats?.length) setSelectedCategory(cats[0].id);
                }}
              >
                <ModeIcon mode={m} className="h-4 w-4" />
                <span className="font-medium flex-1">{APP_MODES[m].label}</span>
                {getModeHasServices(m) && (
                  <svg
                    className="h-4 w-4 text-green-600"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Target + Categories - one row in glass panel */}
      <div className="px-4 pb-3">
        <div className="glass-morphism-strong rounded-2xl px-3 py-2 border-0 flex items-center gap-2">
          {/* Target Switch - single select like dashboard */}
          <div className="glass-morphism rounded-full p-1 flex gap-0.5 border-0 flex-shrink-0">
            {currentTargets.map((t) => {
              const isSelected = selectedTarget === t.id;
              return (
                <Button
                  key={t.id}
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "relative h-8 w-8 rounded-full border-0 p-0 ring-2 transition-colors duration-200",
                    isSelected
                      ? cn(
                          "glass-button-active",
                          t.id === "female" || t.id === "cat"
                            ? "ring-pink-400"
                            : "ring-blue-400",
                        )
                      : "glass-button text-gray-700 ring-transparent",
                  )}
                  onClick={() => selectTarget(t.id)}
                  title={t.label}
                >
                  <span className="text-sm">{t.icon}</span>
                  <div
                    className={cn(
                      "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-green-500",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </Button>
              );
            })}
          </div>

          {/* Divider */}
          <div className="w-px h-6 bg-white/30 flex-shrink-0" />

          {/* Category chips - scrollable, multi-select */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {currentCategories.map((c) => {
              const isSelected = selectedCategory === c.id;
              return (
                <Button
                  key={c.id}
                  variant="ghost"
                  className={cn(
                    "relative h-7 flex-shrink-0 rounded-full border-0 px-3 text-xs font-medium ring-2 transition-colors duration-200",
                    isSelected
                      ? "glass-button-active ring-white/40"
                      : "glass-button text-gray-700 ring-transparent",
                  )}
                  onClick={() => selectCategory(c.id)}
                >
                  <div className="flex items-center gap-1">
                    <CategoryIcon
                      mode={selectedMode}
                      category={c.id}
                      className="h-3 w-3"
                    />
                    <span>{c.label}</span>
                  </div>
                  <div
                    className={cn(
                      "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-green-500",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Services list - glass cards like signup */}
      <div className="flex-1 overflow-y-auto px-4 space-y-4 pb-4">
        {isLoadingSkills ? (
          <>
            {[1, 2, 3, 4].map((skeletonId) => (
              <div
                key={skeletonId}
                className="rounded-2xl border-0 bg-white/60 p-4 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-gray-200" />
                  <div className="flex-1">
                    <div className="h-4 w-40 rounded bg-gray-200 mb-2" />
                    <div className="h-3 w-20 rounded bg-gray-200" />
                  </div>
                  <div className="h-7 w-12 rounded-full bg-gray-200" />
                </div>
              </div>
            ))}
          </>
        ) : !selectedCategory ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">
              {isEn
                ? "Select a category to see services"
                : "Velg en kategori for å se tjenester"}
            </p>
          </div>
        ) : availableServices.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">
              {isEn ? "No services found" : "Ingen tjenester funnet"}
            </p>
          </div>
        ) : (
          <>
            <div>
              {(() => {
                const catId = selectedCategory;
                const catServices = availableServices;
                const catInfo = currentCategories.find((c) => c.id === catId);
                return (
                  <>
                    {/* Section header */}
                    <div className="flex items-center gap-1.5 mb-2 px-1 flex-wrap">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-gray-400 font-medium">
                          {isEn ? "Mode:" : "Modus:"}
                        </span>
                        <ModeIcon
                          mode={selectedMode}
                          className="h-3.5 w-3.5 text-gray-700"
                        />
                        <span className="text-gray-700">
                          {APP_MODES[selectedMode].label}
                        </span>
                      </div>
                      <span className="text-gray-300">•</span>
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-gray-400 font-medium">
                          {isEn ? "Category:" : "Kategori:"}
                        </span>
                        <CategoryIcon
                          mode={selectedMode}
                          category={catId}
                          className="h-3.5 w-3.5 text-gray-700"
                        />
                        <span className="text-gray-700 font-medium">
                          {catInfo?.label}
                        </span>
                      </div>
                    </div>

                    {/* Service cards */}
                    <div className="space-y-2">
                      {catServices.map((service) => {
                        const serviceVariants = serviceIdVariantsForSkills(
                          service.id,
                        );
                        const selectedServiceId = selectedServices.find((id) =>
                          serviceIdVariantsForSkills(id).some((variant) =>
                            serviceVariants.includes(variant),
                          ),
                        );
                        const isSelected = Boolean(selectedServiceId);
                        const serviceRating =
                          serviceRatings[service.id] ||
                          (selectedServiceId
                            ? serviceRatings[selectedServiceId]
                            : undefined) ||
                          3;
                        const targetInfo = currentTargets.find(
                          (t) => t.id === service.target,
                        );

                        return (
                          <div
                            key={service.id}
                            className="glass-morphism-strong rounded-2xl overflow-hidden border-0 shadow-sm"
                          >
                            <button
                              className="w-full p-4 text-left transition-all duration-300 hover:bg-white/10"
                              onClick={() => toggleService(service.id)}
                            >
                              <div className="flex items-center gap-3">
                                {/* Service icon */}
                                <div className="w-10 h-10 glass-morphism rounded-xl flex items-center justify-center border-0 flex-shrink-0">
                                  <CategoryIcon
                                    mode={selectedMode}
                                    category={catId}
                                    className="h-5 w-5 text-gray-700"
                                  />
                                </div>

                                {/* Service info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-gray-900 text-sm">
                                      {isEn && service.id === "odor-removal"
                                        ? "Odor Removal"
                                        : service.name}
                                    </h3>
                                    <span className="text-sm">
                                      {targetInfo?.icon}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    {service.duration} min
                                  </p>
                                </div>

                                {/* Toggle */}
                                <div
                                  role="switch"
                                  aria-checked={isSelected}
                                  tabIndex={0}
                                  className={cn(
                                    "w-12 h-7 rounded-full transition-all duration-300 relative touch-manipulation flex-shrink-0",
                                    isSelected
                                      ? "bg-green-500"
                                      : "bg-gray-300/60",
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleService(service.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      toggleService(service.id);
                                    }
                                  }}
                                >
                                  <div
                                    className={cn(
                                      "absolute top-1 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-300",
                                      isSelected ? "right-1" : "left-1",
                                    )}
                                  />
                                </div>
                              </div>
                            </button>

                            {/* Expanded - Rating + Typical price (FreshUp Pricing v1.0 §2.1) */}
                            {isSelected && (
                              <div className="border-t border-white/20 p-4 space-y-3">
                                <div>
                                  <p className="text-xs text-gray-600 mb-2">
                                    {isEn
                                      ? "Your skill level"
                                      : "Ditt ferdighetsniva"}
                                  </p>
                                  <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <button
                                        key={star}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRating(service.id, star);
                                        }}
                                        className="p-0.5"
                                      >
                                        <Star
                                          className={cn(
                                            "h-6 w-6 transition-colors",
                                            star <= serviceRating
                                              ? "fill-yellow-400 text-yellow-400"
                                              : "text-gray-300",
                                          )}
                                        />
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div>
                                  <p className="text-xs text-gray-600 mb-1">
                                    {isEn
                                      ? "Help set area price"
                                      : "Hjelp oss sette områdepris"}
                                  </p>
                                  {servicePricesLoading ? (
                                    <PriceSliderSkeleton />
                                  ) : (
                                    (() => {
                                      const priceKey =
                                        selectedServiceId || service.id;
                                      const anchorKr =
                                        servicePriceAnchors[priceKey] ??
                                        servicePriceAnchors[service.id] ??
                                        catalogPriceAnchorKr(service.duration);
                                      const priceMin = Math.round(
                                        anchorKr * 0.5,
                                      );
                                      const priceMax = Math.round(anchorKr * 2);
                                      const currentPriceKr =
                                        servicePrices[priceKey] ??
                                        servicePrices[service.id] ??
                                        anchorKr;
                                      return (
                                        <>
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="range"
                                              min={priceMin}
                                              max={priceMax}
                                              value={currentPriceKr}
                                              onChange={(e) =>
                                                setPriceKr(
                                                  priceKey,
                                                  parseInt(e.target.value, 10),
                                                )
                                              }
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                              className="flex-1 accent-foreground"
                                            />
                                            <span className="text-sm font-medium text-gray-800 w-16 text-right">
                                              {formatDisplayPrice(
                                                currentPriceKr,
                                                language,
                                              )}
                                            </span>
                                          </div>
                                          <div className="flex justify-between text-[10px] text-gray-400 mt-0.5 px-0.5">
                                            <span>
                                              {formatDisplayPrice(
                                                priceMin,
                                                language,
                                              )}
                                            </span>
                                            <span>
                                              {formatDisplayPrice(
                                                priceMax,
                                                language,
                                              )}
                                            </span>
                                          </div>
                                        </>
                                      );
                                    })()
                                  )}
                                  <p className="text-[10px] text-gray-500 mt-1">
                                    {isEn
                                      ? "We take the average of all providers in your area."
                                      : "Vi tar gjennomsnittet av alle tilbydere i ditt område."}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-border bg-background">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">
            {selectedServices.length}{" "}
            {isEn ? "services selected" : "tjenester valgt"}
          </span>
        </div>
        {saveError && <p className="mb-3 text-sm text-red-600">{saveError}</p>}
        <Button
          className="w-full h-12 rounded-xl bg-foreground text-background font-semibold"
          onClick={() => void handleSaveSkills()}
          disabled={isSaving || isLoadingSkills}
        >
          {isSaving
            ? isEn
              ? "Saving..."
              : "Lagrer..."
            : isEn
              ? "Save changes"
              : "Lagre endringer"}
        </Button>
      </div>
    </main>
  );
}
