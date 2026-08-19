"use client";

import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  Star,
  Check,
  Scissors,
  Sparkles,
  Car,
  PawPrint,
  Home,
  Heart,
  Loader2,
} from "lucide-react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { normalizeToE164 } from "@/lib/auth/phone";
import { sendPhoneOtpRequest, verifyPhoneSms } from "@/lib/auth/phone-client";
import {
  signInWithOAuthProvider,
  type OAuthProvider,
} from "@/lib/auth/oauth-client";
import { saveOAuthPending } from "@/lib/auth/oauth-pending";
import {
  beginProviderSignupInProgress,
  clearProviderSignupInProgress,
  isProviderSignupInProgress,
  peekProviderSignupResumeStep,
  setProviderSignupResumeStep,
} from "@/lib/auth/provider-signup-gate";
import { writeStoredDashboardMode } from "@/lib/auth/dashboard-mode";
import {
  peekLoginRoleIntent,
  writeLoginRoleIntent,
} from "@/lib/auth/login-role-intent";
import { fetchAccountRoles } from "@/lib/auth/fetch-account-roles";
import { isProviderSignupIncomplete } from "@/lib/auth/resolve-account-roles";
import { claimSignupRole } from "@/lib/auth/claim-signup-role";
import {
  snapPriceKr,
  snapPriceRangeKr,
} from "@/lib/pricing/snap-kr";
import {
  persistProviderOnboardingForUser,
  type ProviderOnboardingInput,
} from "@/lib/auth/provider-onboarding";
import {
  formatSignupPriceFailureMessage,
  readDeviceLocation,
  saveProviderSignupCoords,
  submitSignupBasePrices,
} from "@/lib/pricing/submit-signup-base-prices";
import {
  captureAndSaveCustomerSignupLocationWeb,
} from "@/lib/customer/save-signup-location-web";
import { formatDisplayPrice, formatDeliveryRateLabel } from "@/lib/pricing/format-display-kr";
import {
  stripeConnectStartUserMessage,
} from "@/lib/payments/stripe-connect-errors";

// ─── Types ───────────────────────────────────────────────────────────────────
type Language = "no" | "en";
export type UserType = "customer" | "provider";
type AppMode = "beauty" | "vehicle" | "pet" | "home_service" | "health";

interface LoginPageProps {
  onLogin: (userType: UserType) => void;
  onSkip?: (userType?: UserType) => void;
  /** Parent keeps LoginPage mounted while OTP/OAuth creates a session mid-signup. */
  onProviderSignupGateChange?: (active: boolean) => void;
  /** Signed in as customer but chose Provider login — not registered as provider. */
  needProviderPrompt?: boolean;
  onDismissNeedProvider?: () => void;
  onBecomeProviderFromLogin?: () => void;
  /** Phone/OAuth login-as-provider with no provider grant. */
  onNeedProviderLogin?: () => void;
  language?: Language;
  onLanguageChange?: (lang: Language) => void;
}

// ─── Data (EXACT same as main app) ───────────────────────────────────────────
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

const MODE_SERVICES_NO: Record<
  AppMode,
  Record<
    string,
    Record<
      string,
      {
        id: string;
        name: string;
        price: number;
        duration: string;
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
          duration: "30 min",
          description: "Fade ned til hud for maksimal kontrast",
        },
        {
          id: "low-fade",
          name: "Low Fade",
          price: 370,
          duration: "25 min",
          description: "Subtil fade som starter lavt",
        },
        {
          id: "mid-fade",
          name: "Mid Fade",
          price: 400,
          duration: "25 min",
          description: "Ren overgang midt på hodet",
        },
        {
          id: "high-fade",
          name: "High Fade",
          price: 430,
          duration: "25 min",
          description: "Fade starter hoyt",
        },
        {
          id: "buzz-cut",
          name: "Buzz Cut",
          price: 250,
          duration: "15 min",
          description: "Kort over hele hodet",
        },
        {
          id: "classic-cut",
          name: "Classic Cut",
          price: 350,
          duration: "30 min",
          description: "Tidlos klassisk herreklipp",
        },
      ],
      braids: [
        {
          id: "box-braids-m",
          name: "Box Braids",
          price: 800,
          duration: "120 min",
          description: "Individuelle fletter",
        },
        {
          id: "cornrows-m",
          name: "Cornrows",
          price: 600,
          duration: "90 min",
          description: "Tradisjonelle rekkefletter",
        },
      ],
      beard: [
        {
          id: "beard-trim",
          name: "Beard Trim",
          price: 150,
          duration: "15 min",
          description: "Trimming av skjegg",
        },
        {
          id: "beard-shape",
          name: "Beard Shape",
          price: 200,
          duration: "20 min",
          description: "Forming og kantlinjer",
        },
        {
          id: "beard-dye",
          name: "Beard Dye",
          price: 300,
          duration: "30 min",
          description: "Farging av skjegg",
        },
      ],
      brows: [
        {
          id: "brow-shape-m",
          name: "Brow Shape",
          price: 150,
          duration: "15 min",
          description: "Forming av bryn",
        },
        {
          id: "brow-tint-m",
          name: "Brow Tint",
          price: 200,
          duration: "20 min",
          description: "Farging av bryn",
        },
      ],
    },
    female: {
      haircut: [
        {
          id: "classic-cut-f",
          name: "Classic Cut",
          price: 500,
          duration: "45 min",
          description: "Klassisk dameklipp med styling",
        },
        {
          id: "layers",
          name: "Layers",
          price: 550,
          duration: "50 min",
          description: "Lagklipp for volum",
        },
        {
          id: "bob",
          name: "Bob",
          price: 480,
          duration: "40 min",
          description: "Moderne bob-klipp",
        },
        {
          id: "pixie",
          name: "Pixie Cut",
          price: 450,
          duration: "35 min",
          description: "Kort pixie-klipp",
        },
      ],
      braids: [
        {
          id: "box-braids-f",
          name: "Box Braids",
          price: 1200,
          duration: "180 min",
          description: "Lange box braids",
        },
        {
          id: "cornrows-f",
          name: "Cornrows",
          price: 800,
          duration: "120 min",
          description: "Elegante cornrows",
        },
        {
          id: "french-braids",
          name: "French Braids",
          price: 400,
          duration: "45 min",
          description: "Klassiske franske fletter",
        },
        {
          id: "dutch-braids",
          name: "Dutch Braids",
          price: 400,
          duration: "45 min",
          description: "Hollandske fletter",
        },
      ],
      nails: [
        {
          id: "manicure",
          name: "Manicure",
          price: 350,
          duration: "45 min",
          description: "Komplett manikyr",
        },
        {
          id: "pedicure",
          name: "Pedicure",
          price: 400,
          duration: "50 min",
          description: "Komplett pedikyr",
        },
        {
          id: "gel-nails",
          name: "Gel Nails",
          price: 600,
          duration: "75 min",
          description: "Gel-negler med design",
        },
        {
          id: "acrylic-nails",
          name: "Acrylic Nails",
          price: 700,
          duration: "90 min",
          description: "Akrylnegler",
        },
      ],
      lashes: [
        {
          id: "classic-lashes",
          name: "Classic Lashes",
          price: 800,
          duration: "90 min",
          description: "Klassiske vipper",
        },
        {
          id: "volume-lashes",
          name: "Volume Lashes",
          price: 1000,
          duration: "120 min",
          description: "Volum-vipper",
        },
        {
          id: "hybrid-lashes",
          name: "Hybrid Lashes",
          price: 900,
          duration: "100 min",
          description: "Hybrid vipper",
        },
      ],
      brows: [
        {
          id: "brow-shape-f",
          name: "Brow Shape",
          price: 200,
          duration: "20 min",
          description: "Forming av bryn",
        },
        {
          id: "brow-tint-f",
          name: "Brow Tint",
          price: 250,
          duration: "25 min",
          description: "Farging av bryn",
        },
        {
          id: "brow-lamination",
          name: "Brow Lamination",
          price: 500,
          duration: "45 min",
          description: "Bryn-laminering",
        },
      ],
      body: [
        {
          id: "massage-f",
          name: "Massage",
          price: 600,
          duration: "60 min",
          description: "Avslappende massasje",
        },
        {
          id: "waxing-f",
          name: "Waxing",
          price: 400,
          duration: "30 min",
          description: "Voksing",
        },
        {
          id: "facial-f",
          name: "Facial",
          price: 500,
          duration: "45 min",
          description: "Ansiktsbehandling",
        },
      ],
    },
  },
  vehicle: {
    car: {
      wash: [
        {
          id: "exterior-wash",
          name: "Exterior Wash",
          price: 299,
          duration: "30 min",
          description: "Utvendig bilvask",
        },
        {
          id: "full-detail",
          name: "Full Detail",
          price: 1299,
          duration: "180 min",
          description: "Komplett detaljering",
        },
      ],
      service: [
        {
          id: "oil-change-car",
          name: "Oil Change",
          price: 699,
          duration: "45 min",
          description: "Bytte av olje og filter",
        },
        {
          id: "air-filter",
          name: "Air Filter",
          price: 200,
          duration: "20 min",
          description: "Bytte av luftfilter",
        },
      ],
      tires: [
        {
          id: "tire-change-car",
          name: "Tire Change",
          price: 599,
          duration: "45 min",
          description: "Skift av dekk",
        },
        {
          id: "tire-rotation",
          name: "Tire Rotation",
          price: 399,
          duration: "30 min",
          description: "Rotasjon av dekk",
        },
      ],
      interior: [
        {
          id: "vacuum",
          name: "Vacuum",
          price: 199,
          duration: "30 min",
          description: "Stovsuging av interiør",
        },
        {
          id: "deep-clean",
          name: "Deep Clean",
          price: 599,
          duration: "60 min",
          description: "Dyptgående rengjøring",
        },
      ],
    },
    motorcycle: {
      wash: [
        {
          id: "quick-wash-mc",
          name: "Quick Wash",
          price: 199,
          duration: "20 min",
          description: "Rask utvendig vask",
        },
        {
          id: "full-wash-mc",
          name: "Full Wash",
          price: 349,
          duration: "40 min",
          description: "Komplett vask",
        },
        {
          id: "premium-detail-mc",
          name: "Premium Detailing",
          price: 799,
          duration: "90 min",
          description: "Premium detaljering",
        },
      ],
      service: [
        {
          id: "oil-change-mc",
          name: "Oil Change",
          price: 499,
          duration: "30 min",
          description: "Bytte av olje og filter",
        },
        {
          id: "brake-change-mc",
          name: "Brake Service",
          price: 899,
          duration: "60 min",
          description: "Bytte av bremseklosser",
        },
      ],
      tires: [
        {
          id: "tire-change-mc",
          name: "Tire Change",
          price: 399,
          duration: "30 min",
          description: "Skift av dekk",
        },
        {
          id: "puncture-mc",
          name: "Puncture Repair",
          price: 199,
          duration: "20 min",
          description: "Reparasjon av punktering",
        },
      ],
    },
  },
  pet: {
    dog: {
      grooming: [
        {
          id: "dog-haircut",
          name: "Fur Cut",
          price: 550,
          duration: "60 min",
          description: "Klipping av pels",
        },
        {
          id: "dog-bath",
          name: "Bath",
          price: 350,
          duration: "45 min",
          description: "Bad og torking",
        },
      ],
      vet: [
        {
          id: "dog-health",
          name: "Health Check",
          price: 600,
          duration: "30 min",
          description: "Generell helsesjekk",
        },
        {
          id: "dog-vaccine",
          name: "Vaccination",
          price: 700,
          duration: "20 min",
          description: "Arlig vaksinering",
        },
      ],
      training: [
        {
          id: "obedience",
          name: "Obedience",
          price: 500,
          duration: "60 min",
          description: "Grunnleggende lydighet",
        },
        {
          id: "puppy-class",
          name: "Puppy Class",
          price: 450,
          duration: "45 min",
          description: "Trening for valper",
        },
      ],
    },
    cat: {
      grooming: [
        {
          id: "cat-haircut",
          name: "Fur Cut",
          price: 450,
          duration: "45 min",
          description: "Klipping av pels",
        },
        {
          id: "cat-bath",
          name: "Bath",
          price: 400,
          duration: "40 min",
          description: "Bad og torking",
        },
      ],
      vet: [
        {
          id: "cat-health",
          name: "Health Check",
          price: 500,
          duration: "30 min",
          description: "Generell helsesjekk",
        },
        {
          id: "cat-vaccine",
          name: "Vaccination",
          price: 600,
          duration: "20 min",
          description: "Arlig vaksinering",
        },
      ],
    },
  },
  home_service: {
    apartment: {
      cleaning: [
        {
          id: "basic-clean",
          name: "Basic Clean",
          price: 800,
          duration: "120 min",
          description: "Standard rengjøring",
        },
        {
          id: "deep-clean-apt",
          name: "Deep Clean",
          price: 1500,
          duration: "240 min",
          description: "Grundig rengjøring",
        },
      ],
      plumber: [
        {
          id: "drain",
          name: "Drain",
          price: 800,
          duration: "60 min",
          description: "Apning av tett avlop",
        },
        {
          id: "leak-repair",
          name: "Leak Repair",
          price: 600,
          duration: "90 min",
          description: "Reparasjon av lekkasje",
        },
      ],
      electrician: [
        {
          id: "outlet-install",
          name: "Outlet Install",
          price: 600,
          duration: "60 min",
          description: "Installasjon av stikkontakt",
        },
        {
          id: "light-install",
          name: "Light Install",
          price: 500,
          duration: "45 min",
          description: "Installasjon av lys",
        },
      ],
    },
    house: {
      cleaning: [
        {
          id: "basic-clean-h",
          name: "Basic Clean",
          price: 1200,
          duration: "180 min",
          description: "Standard rengjøring",
        },
        {
          id: "deep-clean-h",
          name: "Deep Clean",
          price: 2500,
          duration: "360 min",
          description: "Grundig rengjøring",
        },
      ],
      plumber: [
        {
          id: "drain-h",
          name: "Drain",
          price: 900,
          duration: "60 min",
          description: "Apning av tett avlop",
        },
        {
          id: "pipe-repair",
          name: "Pipe Repair",
          price: 800,
          duration: "120 min",
          description: "Reparasjon av ror",
        },
      ],
      electrician: [
        {
          id: "panel-service",
          name: "Panel Service",
          price: 1000,
          duration: "90 min",
          description: "Service av sikringsskap",
        },
      ],
      garden: [
        {
          id: "lawn-mowing",
          name: "Gressklipping",
          price: 500,
          duration: "60 min",
          description: "Klipping av plen",
        },
        {
          id: "hedge",
          name: "Hekk",
          price: 800,
          duration: "90 min",
          description: "Klipping av hekk",
        },
        {
          id: "snow-removal",
          name: "Snomaking",
          price: 400,
          duration: "45 min",
          description: "Making av sno",
        },
      ],
    },
  },
  health: {
    individual: {
      massage: [
        {
          id: "relaxing",
          name: "Relaxing",
          price: 700,
          duration: "60 min",
          description: "Avslappende massasje",
        },
        {
          id: "deep-tissue",
          name: "Deep Tissue",
          price: 900,
          duration: "60 min",
          description: "Dyptgaende massasje",
        },
        {
          id: "sports",
          name: "Sports",
          price: 800,
          duration: "60 min",
          description: "Sportsmassasje",
        },
      ],
      physio: [
        {
          id: "treatment",
          name: "Treatment",
          price: 700,
          duration: "45 min",
          description: "Fysioterapibehandling",
        },
        {
          id: "rehab",
          name: "Rehab",
          price: 800,
          duration: "60 min",
          description: "Rehabiliteringsprogram",
        },
      ],
      mental: [
        {
          id: "therapy",
          name: "Therapy",
          price: 900,
          duration: "60 min",
          description: "Samtaleterapi",
        },
        {
          id: "coaching",
          name: "Coaching",
          price: 700,
          duration: "50 min",
          description: "Coaching",
        },
      ],
    },
    group: {
      training: [
        {
          id: "yoga",
          name: "Yoga",
          price: 200,
          duration: "60 min",
          description: "Yogaklasse",
        },
        {
          id: "pilates",
          name: "Pilates",
          price: 200,
          duration: "60 min",
          description: "Pilatesklasse",
        },
        {
          id: "hiit",
          name: "HIIT",
          price: 180,
          duration: "45 min",
          description: "Hoyintensitetstrening",
        },
      ],
      wellness: [
        {
          id: "meditation",
          name: "Meditation",
          price: 150,
          duration: "45 min",
          description: "Guidet meditasjon",
        },
        {
          id: "breathwork",
          name: "Breathwork",
          price: 150,
          duration: "45 min",
          description: "Pusteovelser",
        },
      ],
    },
  },
};

const APP_MODES_NO: Record<AppMode, { id: AppMode; label: string }> = {
  beauty: { id: "beauty", label: "Skjonnhet" },
  vehicle: { id: "vehicle", label: "Kjoretoy" },
  pet: { id: "pet", label: "Kjaeledyr" },
  home_service: { id: "home_service", label: "Hjemmetjenester" },
  health: { id: "health", label: "Helse" },
};

const APP_MODES_EN: Record<AppMode, { id: AppMode; label: string }> = {
  beauty: { id: "beauty", label: "Beauty" },
  vehicle: { id: "vehicle", label: "Vehicle" },
  pet: { id: "pet", label: "Pet" },
  home_service: { id: "home_service", label: "Home services" },
  health: { id: "health", label: "Health" },
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

// ─── Mode Icon (EXACT same as app) ───────────────────────────────────────────
function ModeIcon({ mode, className }: { mode: AppMode; className?: string }) {
  switch (mode) {
    case "beauty":
      return <Sparkles className={className} />;
    case "vehicle":
      return <Car className={className} />;
    case "pet":
      return <PawPrint className={className} />;
    case "home_service":
      return <Home className={className} />;
    case "health":
      return <Heart className={className} />;
  }
}

// ─── Category Icon (EXACT same as app) ───────────────────────────────────────
function CategoryIcon({
  appMode,
  category,
  className = "h-5 w-5",
}: {
  appMode: AppMode;
  category: string;
  className?: string;
}) {
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

// ─── Main Component ──────────────────────────────────────────────────────────
export default function LoginPage({
  onLogin,
  onSkip,
  onProviderSignupGateChange,
  needProviderPrompt = false,
  onDismissNeedProvider,
  onBecomeProviderFromLogin,
  onNeedProviderLogin,
  language = "no",
  onLanguageChange,
}: LoginPageProps) {
  const isEn = language === "en";
  const APP_MODES = isEn ? APP_MODES_EN : APP_MODES_NO;
  const MODE_TARGETS = isEn ? MODE_TARGETS_EN : MODE_TARGETS_NO;
  const MODE_CATEGORIES = isEn ? MODE_CATEGORIES_EN : MODE_CATEGORIES_NO;
  const supabase = useMemo(() => createBrowserSupabaseClient() as any, []);

  // View state
  const [view, setView] = useState<"landing" | "customer" | "provider">(() => {
    if (typeof window === "undefined") return "landing";
    if (isProviderSignupInProgress()) return "provider";
    if (peekLoginRoleIntent()) return "customer";
    return "landing";
  });
  const [isProviderMode, setIsProviderMode] = useState(
    () => peekLoginRoleIntent() === "provider",
  );
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [showOtp, setShowOtp] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"stripe" | null>(null);
  const [stripeConnectBusy, setStripeConnectBusy] = useState(false);

  // Provider signup
  const [appMode, setAppMode] = useState<AppMode>("beauty");

  const [selectedTargets, setSelectedTargets] = useState<string[]>(["male"]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    "haircut",
  ]);
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [enabledServices, setEnabledServices] = useState<
    Record<
      string,
      {
        rating: number;
        price: number;
        /** Per-service: home | provider (customer comes to me) | both */
        serviceMode: "home" | "provider" | "both";
        mode: AppMode;
        target: string;
        category: string;
        serviceName: string;
        rawServiceId: string;
      }
    >
  >({});
  const [step, setStep] = useState<"services" | "summary" | "auth">("services");
  const [providerAuthStep, setProviderAuthStep] = useState<
    "phone" | "otp" | "profile" | "payment"
  >("phone");
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [completingSignup, setCompletingSignup] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [devOtpFallback, setDevOtpFallback] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [processingProfileImage, setProcessingProfileImage] = useState(false);
  const profileImageInputRef = useRef<HTMLInputElement | null>(null);
  const [signupCoords, setSignupCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "pending" | "ready" | "denied"
  >("idle");

  useEffect(() => {
    if (!needProviderPrompt) return;
    setView("customer");
    setIsProviderMode(true);
    writeLoginRoleIntent("provider");
  }, [needProviderPrompt]);

  const renderNeedProviderDialog = () => {
    if (!needProviderPrompt) return null;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 px-6">
        <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
          <h2 className="text-lg font-semibold text-foreground mb-2">
            {isEn ? "Not a provider yet" : "Ikke tilbyder ennå"}
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            {isEn
              ? "This account is not registered as a provider. Become a provider first to continue."
              : "Denne kontoen er ikke registrert som tilbyder. Bli tilbyder først for å fortsette."}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setView("provider");
                setProviderAuthStep("profile");
                setShowSummary(true);
                setStep("auth");
                onBecomeProviderFromLogin?.();
              }}
              className="w-full py-3 rounded-xl bg-foreground text-background font-medium"
            >
              {isEn ? "Become a provider" : "Bli tilbyder"}
            </button>
            <button
              type="button"
              onClick={() => onDismissNeedProvider?.()}
              className="w-full py-3 rounded-xl border border-border font-medium"
            >
              {isEn ? "Cancel" : "Avbryt"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Resume phone-first provider signup after OAuth return (or remount).
  // Existing customer → skip verify-phone, same as mobile Become a provider.
  useEffect(() => {
    if (!isProviderSignupInProgress()) return;
    let resume = peekProviderSignupResumeStep() || "profile";
    setView("provider");
    if (resume === "services") {
      setShowSummary(false);
      setStep("services");
      return;
    }
    setShowSummary(true);
    setStep("auth");
    setProviderAuthStep(resume === "otp" ? "profile" : resume);
    onProviderSignupGateChange?.(true);

    void supabase.auth.getSession().then(({ data }: any) => {
      const user = data?.session?.user;
      if (!user) return;
      if (resume === "phone" || resume === "otp") {
        setProviderSignupResumeStep("profile");
        setProviderAuthStep("profile");
      }
      const meta = user.user_metadata ?? {};
      const name = String(
        meta.full_name || meta.name || meta.display_name || "",
      ).trim();
      if (name) setProfileName((prev) => prev || name);
      const avatar = String(meta.avatar_url || meta.picture || "").trim();
      if (avatar) setProfileAvatarUrl((prev) => prev || avatar);
    });

    const params = new URLSearchParams(window.location.search);
    const connectReturn =
      params.get("provider_signup") === "connect_return" ||
      params.get("provider_signup") === "connect_refresh";
    if (connectReturn) {
      window.history.replaceState({}, "", window.location.pathname || "/");
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data?.session?.access_token;
          const uid = data?.session?.user?.id;
          if (!token || !uid) return;
          const res = await fetch(
            "/api/providers/stripe-connect/status?refresh=1",
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "x-provider-id": uid,
              },
            },
          );
          const body = await res.json().catch(() => ({}));
          if (
            body?.stripe_payouts_enabled ||
            body?.stripe_onboarded ||
            body?.stripe_charges_enabled
          ) {
            setPaymentMethod("stripe");
            setProviderSignupResumeStep("services");
            setShowSummary(false);
            setStep("services");
          } else {
            setProviderAuthStep("payment");
          }
        } catch {
          setProviderAuthStep("payment");
        }
      })();
    }
  }, [onProviderSignupGateChange, supabase]);

  const startSignupStripeConnect = async () => {
    setAuthError(null);
    setStripeConnectBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const uid = data?.session?.user?.id;
      if (!token || !uid) {
        setAuthError(
          isEn
            ? "Verify your phone before setting up payouts."
            : "Bekreft telefonen før utbetalingsoppsett.",
        );
        return false;
      }
      beginProviderSignupInProgress("payment");
      setProviderSignupResumeStep("payment");
      onProviderSignupGateChange?.(true);
      const origin = window.location.origin;
      const res = await fetch("/api/providers/stripe-connect/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "x-provider-id": uid,
        },
        body: JSON.stringify({
          return_url: `${origin}/?provider_signup=connect_return`,
          refresh_url: `${origin}/?provider_signup=connect_refresh`,
          business_name: profileName.trim() || undefined,
          phone: normalizeToE164(phone) || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.onboarding_url) {
        const code = String(body?.error || body?.message || "CONNECT_START_FAILED");
        setAuthError(stripeConnectStartUserMessage(code, isEn));
        return false;
      }
      window.location.href = String(body.onboarding_url);
      return true;
    } catch (e) {
      const code =
        e instanceof Error ? e.message : "CONNECT_START_FAILED";
      setAuthError(stripeConnectStartUserMessage(code, isEn));
      return false;
    } finally {
      setStripeConnectBusy(false);
    }
  };

  const skipStripeConnectForDev = () => {
    setPaymentMethod("stripe");
    setAuthError(null);
    setProviderSignupResumeStep("services");
    setShowSummary(false);
    setStep("services");
  };

  useEffect(() => {
    if (view !== "provider" || step !== "services") return;
    let cancelled = false;
    setLocationStatus((prev) => (prev === "ready" ? prev : "pending"));
    void readDeviceLocation().then((coords) => {
      if (cancelled) return;
      if (coords) {
        setSignupCoords(coords);
        setLocationStatus("ready");
      } else {
        setLocationStatus("denied");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [view, step]);

  const retrySignupLocation = () => {
    setLocationStatus("pending");
    void readDeviceLocation().then((coords) => {
      if (coords) {
        setSignupCoords(coords);
        setLocationStatus("ready");
        setAuthError(null);
      } else {
        setLocationStatus("denied");
      }
    });
  };

  const handleOtpChange = (index: number, e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "");
    if (!val) {
      setOtp((prev) => prev.slice(0, index) + prev.slice(index + 1));
      return;
    }
    const digit = val.slice(-1);
    setOtp((prev) => {
      if (prev.length > index) {
        return (prev.slice(0, index) + digit + prev.slice(index + 1)).slice(
          0,
          6,
        );
      }
      return (prev + digit).slice(0, 6);
    });
    if (index < 5) {
      (e.target.nextElementSibling as HTMLInputElement | null)?.focus();
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key !== "Backspace") return;
    if (otp[index]) {
      setOtp((prev) => prev.slice(0, index) + prev.slice(index + 1));
      return;
    }
    if (index > 0) {
      setOtp((prev) => prev.slice(0, index - 1) + prev.slice(index));
      (
        (e.target as HTMLInputElement)
          .previousElementSibling as HTMLInputElement | null
      )?.focus();
    }
  };

  const handleOtpPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;
    setOtp(pasted);
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

  const onProfilePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAuthError(isEn ? "Please choose an image file." : "Velg en bildefil.");
      return;
    }
    try {
      setProcessingProfileImage(true);
      setAuthError(null);
      const avatarUrl = await toCompressedDataUrl(file);
      setProfileAvatarUrl(avatarUrl);
    } catch {
      setAuthError(
        isEn ? "Could not process image." : "Kunne ikke behandle bildet.",
      );
    } finally {
      setProcessingProfileImage(false);
      if (event.target) event.target.value = "";
    }
  };

  const buildProviderOnboardingInput = (): ProviderOnboardingInput | null => {
    const servicesByMode = new Map<
      string,
      {
        targets: Set<string>;
        categories: Set<string>;
        services: Array<{
          service_id: string;
          competence_rating: number;
          service_mode_id: "home" | "provider" | "both";
        }>;
      }
    >();

    Object.entries(enabledServices).forEach(([serviceId, service]) => {
      const modeKey = service.mode;
      if (!servicesByMode.has(modeKey)) {
        servicesByMode.set(modeKey, {
          targets: new Set<string>(),
          categories: new Set<string>(),
          services: [],
        });
      }
      const bucket = servicesByMode.get(modeKey)!;
      bucket.targets.add(service.target);
      bucket.categories.add(service.category);
      bucket.services.push({
        service_id: service.rawServiceId || serviceId,
        competence_rating: Math.max(
          1,
          Math.min(5, Number(service.rating) || 3),
        ),
        service_mode_id: "both" as const,
      });
    });

    const mode_selections = Array.from(servicesByMode.entries()).map(
      ([mode_id, value]) => ({
        mode_id,
        targets: Array.from(value.targets),
        categories: Array.from(value.categories),
        services: value.services,
      }),
    );

    if (mode_selections.length === 0) return null;

    // Signup no longer asks delivery; default both (per-service toggle lives on working cards).
    const delivery_modes: Array<"home" | "at_provider"> = [
      "home",
      "at_provider",
    ];
    if (delivery_modes.length === 0) {
      delivery_modes.push("at_provider");
    }
    const primaryMode = mode_selections[0];
    const signupServicePrices = Object.fromEntries(
      Object.values(enabledServices).map((service) => [
        service.rawServiceId,
        String(service.price),
      ]),
    );

    return {
      profileName,
      profileAvatarUrl,
      phoneE164: normalizeToE164(phone),
      mode_selections,
      delivery_modes,
      servicePrices: signupServicePrices,
      signupCoords,
      skillsSnapshot: {
        mode: primaryMode?.mode_id || appMode,
        target: primaryMode?.targets?.[0] || selectedTargets[0] || "",
        categories:
          primaryMode?.categories && primaryMode.categories.length > 0
            ? primaryMode.categories
            : selectedCategories,
        services: mode_selections.flatMap((m) =>
          (m.services || []).map((s) => s.service_id),
        ),
        ratings: Object.fromEntries(
          Object.entries(enabledServices).map(([serviceId, service]) => [
            service.rawServiceId || serviceId,
            Math.max(1, Math.min(5, Number(service.rating) || 3)),
          ]),
        ),
        deliveryMode: "home",
        savedAt: Date.now(),
      },
    };
  };

  const persistProviderOnboarding = async () => {
    const role = resolveLoginRole();
    if (role !== "provider") return;
    const { data: sessionData } = await supabase.auth.getSession();
    const providerId = sessionData?.session?.user?.id;
    if (!providerId) return;

    let coords = signupCoords;
    if (!coords) {
      coords = await readDeviceLocation();
      if (coords) setSignupCoords(coords);
    }
    if (
      !coords ||
      !Number.isFinite(coords.lat) ||
      !Number.isFinite(coords.lng)
    ) {
      throw new Error(
        isEn
          ? "Location is required to finish signup. Enable GPS and try again."
          : "Posisjon er påkrevd for å fullføre. Slå på GPS og prøv igjen.",
      );
    }

    const input = buildProviderOnboardingInput();
    if (!input) return;
    input.signupCoords = coords;

    await persistProviderOnboardingForUser(supabase, providerId, input);
    writeStoredDashboardMode(providerId, "provider");
    await saveProviderSignupCoords(providerId, coords);

    const serviceIds = input.mode_selections.flatMap((ms) =>
      (ms.services || []).map((s) => s.service_id),
    );
    const signupServicePrices = input.servicePrices || {};
    const hasPrices = Object.values(enabledServices).some(
      (service) => service.price > 0,
    );
    if (!hasPrices) return;

    const failures = await submitSignupBasePrices({
      providerId,
      servicePrices: signupServicePrices,
      serviceIds,
      coords,
    });
    if (failures.length > 0) {
      throw new Error(formatSignupPriceFailureMessage(failures, isEn));
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("providerSkillsUpdated"));
    }
  };

  // Dynamic data
  const currentTargets = MODE_TARGETS[appMode] || [];

  // Get all categories for all selected targets (merged, unique)
  const getAllCategories = () => {
    const allCats: { id: string; label: string }[] = [];
    const seenIds = new Set<string>();
    selectedTargets.forEach((t) => {
      const cats = MODE_CATEGORIES[appMode]?.[t] || [];
      cats.forEach((c) => {
        if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          allCats.push(c);
        }
      });
    });
    return allCats;
  };
  const currentCategories = getAllCategories();

  // Get services for all selected targets and categories
  const getServicesGrouped = () => {
    const result: {
      target: string;
      targetIcon: string;
      targetLabel: string;
      category: string;
      categoryLabel: string;
      services: typeof MODE_SERVICES_NO.beauty.male.haircut;
    }[] = [];

    selectedTargets.forEach((t) => {
      const targetInfo = currentTargets.find((x) => x.id === t);
      selectedCategories.forEach((cat) => {
        const catServices = MODE_SERVICES_NO[appMode]?.[t]?.[cat];
        if (catServices?.length) {
          const catInfo = MODE_CATEGORIES[appMode]?.[t]?.find(
            (c) => c.id === cat,
          );
          result.push({
            target: t,
            targetIcon: targetInfo?.icon || "",
            targetLabel: targetInfo?.label || t,
            category: cat,
            categoryLabel: catInfo?.label || cat,
            services: catServices,
          });
        }
      });
    });
    return result;
  };

  // Reset on mode change
  useEffect(() => {
    const targets = MODE_TARGETS[appMode];
    if (targets?.length) {
      setSelectedTargets([targets[0].id]);
      const cats = MODE_CATEGORIES[appMode]?.[targets[0].id];
      if (cats?.length) setSelectedCategories([cats[0].id]);
    }
  }, [appMode]);

  // Reset categories when targets change
  useEffect(() => {
    const allCats = getAllCategories();
    if (allCats.length > 0) {
      // Keep selected categories that are still valid, or reset to first
      const validCats = selectedCategories.filter((c) =>
        allCats.some((ac) => ac.id === c),
      );
      if (validCats.length === 0) {
        setSelectedCategories([allCats[0].id]);
      } else {
        setSelectedCategories(validCats);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTargets, appMode]);

  const phoneE164 = useMemo(() => {
    const digits = phone.replace(/\D/g, "").slice(0, 8);
    if (digits.length < 8) return null;
    return normalizeToE164(`+47${digits}`);
  }, [phone]);

  const resolveLoginRole = (): UserType =>
    view === "provider" || isProviderMode ? "provider" : "customer";

  const handleOAuthSignIn = async (provider: OAuthProvider) => {
    setAuthError(null);
    setOauthLoading(provider);
    try {
      const role = resolveLoginRole();
      if (role === "provider" && view === "provider") {
        beginProviderSignupInProgress("profile");
        setProviderSignupResumeStep("profile");
        onProviderSignupGateChange?.(true);
        const providerOnboarding = buildProviderOnboardingInput();
        saveOAuthPending({
          role: "provider",
          ...(providerOnboarding
            ? { providerOnboarding }
            : { providerSignupContinue: true }),
        });
      } else if (role === "provider") {
        // Customer login screen, Provider toggle — match mobile: no grant claim.
        writeLoginRoleIntent("provider");
        saveOAuthPending({ role: "provider", providerLoginOnly: true });
      } else {
        saveOAuthPending({ role });
      }
      const { error } = await signInWithOAuthProvider(supabase, provider);
      if (error) {
        setAuthError(error);
      }
    } finally {
      setOauthLoading(null);
    }
  };

  const renderSocialLoginButtons = () => (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void handleOAuthSignIn("apple")}
        disabled={!!oauthLoading}
        className="w-full py-3.5 border border-border rounded-xl font-medium flex items-center justify-center gap-3 hover:bg-muted/50 transition-colors disabled:opacity-40"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
          />
        </svg>
        {oauthLoading === "apple"
          ? isEn
            ? "Redirecting..."
            : "Omdirigerer..."
          : isEn
            ? "Continue with Apple"
            : "Fortsett med Apple"}
      </button>
      <button
        type="button"
        onClick={() => void handleOAuthSignIn("google")}
        disabled={!!oauthLoading}
        className="w-full py-3.5 border border-border rounded-xl font-medium flex items-center justify-center gap-3 hover:bg-muted/50 transition-colors disabled:opacity-40"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        {oauthLoading === "google"
          ? isEn
            ? "Redirecting..."
            : "Omdirigerer..."
          : isEn
            ? "Continue with Google"
            : "Fortsett med Google"}
      </button>
    </div>
  );

  const handleSendOtp = async () => {
    setAuthError(null);
    if (!phoneE164) {
      setAuthError(
        isEn
          ? "Enter a valid phone number."
          : "Skriv inn et gyldig telefonnummer.",
      );
      return false;
    }
    setSendingOtp(true);
    try {
      const role = resolveLoginRole();
      const { error } = await sendPhoneOtpRequest(phoneE164, role);
      if (error) {
        if (
          error.startsWith("DEV_OTP:") ||
          error.includes("Unsupported phone provider")
        ) {
          setDevOtpFallback(true);
          setShowOtp(true);
          setOtp("");
          setAuthError(
            error.startsWith("DEV_OTP:")
              ? error.replace("DEV_OTP:", "").trim()
              : isEn
                ? "Dev OTP mode enabled. Use code 123456."
                : "Dev OTP-modus aktiv. Bruk kode 123456.",
          );
          return true;
        }
        setAuthError(error);
        return false;
      }
      setDevOtpFallback(false);
      setShowOtp(true);
      setOtp("");
      return true;
    } finally {
      setSendingOtp(false);
    }
  };

  const abandonProviderSignup = async () => {
    clearProviderSignupInProgress();
    onProviderSignupGateChange?.(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        setShowSummary(false);
        setShowOtp(false);
        setOtp("");
        setView("landing");
        return;
      }
      const roles = await fetchAccountRoles({
        accessToken: sessionData.session.access_token,
        intent: "customer",
      });
      if (roles?.has_customer) {
        onLogin("customer");
        return;
      }
      await supabase.auth.signOut();
    } catch {
      try {
        await supabase.auth.signOut();
      } catch {
        /* still leave the flow */
      }
    }
    setShowSummary(false);
    setShowOtp(false);
    setOtp("");
    setView("landing");
  };

  const handleVerifyOtp = async () => {
    setAuthError(null);
    const token = otp.replace(/\D/g, "");
    if (token.length < 6) return false;
    const role = resolveLoginRole();

    if (devOtpFallback) {
      if (token !== "123456") {
        setAuthError(
          isEn
            ? "Invalid code. Use 123456 in dev mode."
            : "Ugyldig kode. Bruk 123456 i dev-modus.",
        );
        return false;
      }
      if (role === "customer") {
        onLogin("customer");
        return true;
      }
      // Phone verified first — collect profile/payment before durable onboard.
      setProviderAuthStep("profile");
      setProviderSignupResumeStep("profile");
      return true;
    }

    if (!phoneE164) {
      setAuthError(isEn ? "Invalid phone number." : "Ugyldig telefonnummer.");
      return false;
    }
    setVerifyingOtp(true);
    try {
      const { error } = await verifyPhoneSms(supabase, phoneE164, token);
      if (error) {
        setAuthError(
          error.message ||
            (isEn ? "Verification failed." : "Bekreftelse feilet."),
        );
        return false;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token as string | undefined;
      const isProviderLoginOnly =
        role === "provider" && view === "customer" && isProviderMode;

      if (role === "customer") {
        await supabase.auth.updateUser({ data: { app_role: role } });
        await claimSignupRole(role, { accessToken });
        const uid = sessionData?.session?.user?.id;
        if (uid) {
          void captureAndSaveCustomerSignupLocationWeb(uid);
        }
        onLogin("customer");
        return true;
      }

      if (isProviderLoginOnly) {
        const roles = await Promise.race([
          fetchAccountRoles({ intent: "provider", accessToken }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
        if (roles?.has_provider && roles.provider_has_skills) {
          onLogin("provider");
          return true;
        }
        if (isProviderSignupIncomplete(roles)) {
          beginProviderSignupInProgress("profile");
          setProviderSignupResumeStep("profile");
          onProviderSignupGateChange?.(true);
          setProviderAuthStep("profile");
          return true;
        }
        onNeedProviderLogin?.();
        return true;
      }

      await supabase.auth.updateUser({ data: { app_role: role } });
      await claimSignupRole(role, { accessToken });

      // Become-a-provider flow: existing finished provider → dashboard.
      try {
        const roles = await Promise.race([
          fetchAccountRoles({ intent: "provider", accessToken }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
        if (roles?.has_provider && roles.provider_has_skills) {
          onLogin("provider");
          return true;
        }
      } catch {
        // fall through to onboarding
      }

      beginProviderSignupInProgress("profile");
      setProviderSignupResumeStep("profile");
      onProviderSignupGateChange?.(true);
      setProviderAuthStep("profile");
      return true;
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleCompleteProviderSignup = async () => {
    setAuthError(null);
    const role = resolveLoginRole();
    setCompletingSignup(true);
    try {
      let coords = signupCoords;
      if (!coords) {
        coords = await readDeviceLocation();
        if (coords) setSignupCoords(coords);
      }
      if (
        !coords ||
        !Number.isFinite(coords.lat) ||
        !Number.isFinite(coords.lng)
      ) {
        setAuthError(
          isEn
            ? "Location is required to finish signup. Enable GPS and try again."
            : "Posisjon er påkrevd for å fullføre. Slå på GPS og prøv igjen.",
        );
        return false;
      }
      await persistProviderOnboarding();
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : isEn
            ? "Could not save onboarding data."
            : "Kunne ikke lagre onboarding-data.";
      setAuthError(message);
      return false;
    } finally {
      setCompletingSignup(false);
    }
    clearProviderSignupInProgress();
    onProviderSignupGateChange?.(false);
    onLogin(role);
    return true;
  };

  const toggleService = (
    id: string,
    price: number,
    serviceName: string,
    categoryId: string,
    targetId: string,
    rawServiceId: string,
  ) => {
    setEnabledServices((prev) => {
      if (prev[id]) {
        const { [id]: _, ...rest } = prev;
        setExpandedService(null);
        return rest;
      }
      setExpandedService(id);
      return {
        ...prev,
        [id]: {
          rating: 3,
          price,
          serviceMode: "both",
          mode: appMode,
          target: targetId,
          category: categoryId,
          serviceName,
          rawServiceId,
        },
      };
    });
  };

  const toggleTarget = (targetId: string) => {
    setSelectedTargets((prev) => {
      if (prev.includes(targetId)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((t) => t !== targetId);
      }
      return [...prev, targetId];
    });
  };

  const toggleCategory = (catId: string) => {
    setSelectedCategories((prev) => {
      if (prev.includes(catId)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((c) => c !== catId);
      }
      return [...prev, catId];
    });
  };

  const enabledCount = Object.keys(enabledServices).length;

  // Group enabled services by mode > target > category for summary
  const groupedServices = () => {
    const grouped: Record<
      string,
      Record<
        string,
        Record<string, Array<(typeof enabledServices)[string] & { id: string }>>
      >
    > = {};
    Object.entries(enabledServices).forEach(([id, service]) => {
      if (!grouped[service.mode]) grouped[service.mode] = {};
      if (!grouped[service.mode][service.target])
        grouped[service.mode][service.target] = {};
      if (!grouped[service.mode][service.target][service.category]) {
        grouped[service.mode][service.target][service.category] = [];
      }
      grouped[service.mode][service.target][service.category].push({
        ...service,
        id,
      });
    });
    return grouped;
  };

  // ─── Landing Page ───────��─────────────────────────────────────────────────
  if (view === "landing") {
    return (
      <main className="h-[100dvh] w-full max-w-md mx-auto bg-background flex flex-col">
        {/* Header with controls */}
        <div className="flex items-center justify-between px-4 pt-14 pb-4">
          <button
            onClick={() => {
              const newLang = language === "no" ? "en" : "no";
              onLanguageChange?.(newLang);
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {language === "no" ? "EN" : "NO"}
          </button>
          {onSkip && (
            <button
              onClick={() => onSkip("customer")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {isEn ? "Skip" : "Hopp over"}
            </button>
          )}
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col justify-center items-center px-6">
          <span className="text-5xl font-black tracking-tight mb-4">FUP</span>
          <p className="text-sm text-muted-foreground">
            {isEn ? "Tap. Match. Done." : "Trykk. Match. Ferdig."}
          </p>
        </div>

        {/* Bottom CTAs */}
        <div className="p-6 space-y-3">
          <button
            onClick={() => {
              writeLoginRoleIntent("customer");
              setIsProviderMode(false);
              setView("customer");
            }}
            className="w-full py-4 bg-muted text-foreground rounded-full font-medium"
          >
            {isEn ? "Log in" : "Logg inn"}
          </button>
          <button
            onClick={() => {
              setView("provider");
              setProviderAuthStep("phone");
              setShowSummary(true);
              setStep("auth");
              setShowOtp(false);
              setOtp("");
              setAuthError(null);
              beginProviderSignupInProgress("phone");
              onProviderSignupGateChange?.(true);
            }}
            className="w-full py-4 bg-foreground text-background rounded-full font-medium"
          >
            {isEn ? "Become a provider" : "Bli tilbyder"}
          </button>
        </div>
      </main>
    );
  }

  // ─── Customer Login ────────────────────────────────────────────────────────
  if (view === "customer") {
    return (
      <>
        {renderNeedProviderDialog()}
      <main className="h-[100dvh] w-full max-w-md mx-auto bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 pt-14 pb-4">
          <button
            onClick={() => {
              setView("landing");
              setShowOtp(false);
              setOtp("");
              setPhone("");
              setIsProviderMode(false);
            }}
            className="p-2 -ml-2"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          {onSkip && (
            <button
              onClick={() => onSkip(isProviderMode ? "provider" : "customer")}
              className="text-sm text-muted-foreground"
            >
              {isEn ? "Skip" : "Hopp over"}
            </button>
          )}
        </div>

        {/* Provider toggle */}
        <div className="px-6 mb-4">
          <div className="bg-muted rounded-full p-1 flex w-fit">
            <button
              onClick={() => {
                setIsProviderMode(false);
                writeLoginRoleIntent("customer");
              }}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all",
                !isProviderMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {isEn ? "Customer" : "Kunde"}
            </button>
            <button
              onClick={() => {
                setIsProviderMode(true);
                writeLoginRoleIntent("provider");
              }}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium transition-all",
                isProviderMode
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {isEn ? "Provider" : "Tilbyder"}
            </button>
          </div>
        </div>

        <div className="flex-1 px-6">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            {showOtp
              ? isEn
                ? "Enter code"
                : "Skriv inn kode"
              : isEn
                ? "Log in"
                : "Logg inn"}
          </h1>
          <p className="text-muted-foreground text-sm mb-8">
            {showOtp
              ? `${isEn ? "6-digit code sent to" : "6-sifret kode sendt til"} +47 ${phone}`
              : isEn
                ? "Enter your phone number"
                : "Skriv inn telefonnummer"}
          </p>

          {!showOtp ? (
            <>
              <div className="mb-6">
                <div className="flex items-center bg-muted rounded-xl px-4 py-3">
                  <span className="text-muted-foreground mr-2">+47</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))
                    }
                    placeholder="XXX XX XXX"
                    className="flex-1 bg-transparent text-foreground outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <button
                onClick={() => void handleSendOtp()}
                disabled={phone.length < 8 || sendingOtp}
                className="w-full py-4 bg-foreground text-background rounded-xl font-semibold disabled:opacity-40"
              >
                {sendingOtp
                  ? isEn
                    ? "Sending..."
                    : "Sender..."
                  : isEn
                    ? "Continue"
                    : "Fortsett"}
              </button>
              {authError && (
                <p className="text-sm text-red-600 mt-2">{authError}</p>
              )}

              {/* Divider */}
              <div className="flex items-center gap-4 my-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">
                  {isEn ? "or" : "eller"}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Social logins */}
              {renderSocialLoginButtons()}
            </>
          ) : (
            <>
              <div className="flex gap-2 justify-center mb-6">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <input
                    key={i}
                    type="text"
                    maxLength={1}
                    value={otp[i] || ""}
                    onChange={(e) => handleOtpChange(i, e)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    onPaste={handleOtpPaste}
                    className="w-11 h-14 text-center text-xl font-bold border border-border rounded-xl bg-transparent focus:border-foreground outline-none"
                    autoFocus={i === 0}
                  />
                ))}
              </div>
              <button
                onClick={() => void handleVerifyOtp()}
                disabled={otp.length < 6 || verifyingOtp}
                className="w-full py-4 bg-foreground text-background rounded-xl font-semibold disabled:opacity-40"
              >
                {verifyingOtp
                  ? isEn
                    ? "Verifying..."
                    : "Bekrefter..."
                  : isEn
                    ? "Verify"
                    : "Bekreft"}
              </button>
              {authError && (
                <p className="text-sm text-red-600 mt-2">{authError}</p>
              )}
              <button
                onClick={() => void handleSendOtp()}
                disabled={sendingOtp}
                className="w-full py-3 text-sm text-muted-foreground mt-2 disabled:opacity-40"
              >
                {sendingOtp
                  ? isEn
                    ? "Sending..."
                    : "Sender..."
                  : isEn
                    ? "Resend code"
                    : "Send kode på nytt"}
              </button>
              <button
                onClick={() => {
                  setShowOtp(false);
                  setOtp("");
                }}
                className="w-full py-3 text-sm text-muted-foreground"
              >
                {isEn ? "Use different number" : "Bruk annet nummer"}
              </button>
            </>
          )}
        </div>
      </main>
      </>
    );
  }

  // ─── Provider Summary ───────────────────────────────────────────────────────
  if (view === "provider" && step === "summary" && !showSummary) {
    const grouped = groupedServices();
    return (
      <main className="h-[100dvh] w-full max-w-md mx-auto bg-background flex flex-col">
        <div className="flex items-center px-4 pt-14 pb-4">
          <button onClick={() => setStep("services")} className="p-2 -ml-2">
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 px-6 overflow-y-auto">
          <h1 className="text-2xl font-bold text-foreground">
            {isEn ? "Your services" : "Dine tjenester"}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm mb-6">
            {enabledCount} {isEn ? "services selected" : "tjenester valgt"}
          </p>

          {/* Grouped summary */}
          <div className="space-y-4">
            {Object.entries(grouped).map(([modeKey, targets]) => (
              <div key={modeKey} className="space-y-3">
                {/* Mode header */}
                <div className="flex items-center gap-2">
                  <ModeIcon
                    mode={modeKey as AppMode}
                    className="h-4 w-4 text-gray-600"
                  />
                  <span className="text-sm font-semibold text-gray-800">
                    {APP_MODES[modeKey as AppMode].label}
                  </span>
                </div>

                {Object.entries(targets).map(([targetKey, categories]) => {
                  const targetInfo = MODE_TARGETS[modeKey as AppMode]?.find(
                    (t) => t.id === targetKey,
                  );
                  return (
                    <div key={targetKey} className="ml-4 space-y-2">
                      {/* Target header */}
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{targetInfo?.icon}</span>
                        <span className="text-xs font-medium text-gray-600">
                          {targetInfo?.label}
                        </span>
                      </div>

                      {Object.entries(categories).map(([catKey, services]) => {
                        const catInfo = MODE_CATEGORIES[modeKey as AppMode]?.[
                          targetKey
                        ]?.find((c) => c.id === catKey);
                        return (
                          <div key={catKey} className="ml-4">
                            {/* Category label */}
                            <p className="text-xs text-gray-500 mb-1">
                              {catInfo?.label}
                            </p>

                            {/* Services */}
                            <div className="space-y-1">
                              {services.map((s: any) => (
                                <div
                                  key={s.id}
                                  className="flex items-center justify-between py-1.5 px-3 bg-gray-50 rounded-lg"
                                >
                                  <span className="text-sm text-gray-800">
                                    {s.serviceName}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <div className="flex">
                                      {[1, 2, 3, 4, 5].map((star) => (
                                        <Star
                                          key={star}
                                          className={cn(
                                            "h-3 w-3",
                                            star <= s.rating
                                              ? "text-yellow-500 fill-current"
                                              : "text-gray-300",
                                          )}
                                        />
                                      ))}
                                    </div>
                                    <span className="text-xs text-gray-600">
                                      {formatDisplayPrice(s.price, language)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Add more */}
          <button
            onClick={() => setStep("services")}
            className="mt-6 text-sm text-primary font-medium"
          >
            + {isEn ? "Add more services" : "Legg til flere tjenester"}
          </button>
        </div>

        <div className="p-6">
          <button
            type="button"
            onClick={() => void handleCompleteProviderSignup()}
            disabled={
              enabledCount === 0 ||
              completingSignup ||
              !signupCoords ||
              locationStatus === "denied" ||
              locationStatus === "pending"
            }
            className={cn(
              "w-full py-4 bg-foreground text-background rounded-2xl font-semibold inline-flex items-center justify-center gap-2",
              completingSignup
                ? "opacity-90"
                : "disabled:opacity-40",
            )}
          >
            {completingSignup ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin shrink-0" />
                {isEn ? "Saving..." : "Lagrer..."}
              </>
            ) : isEn ? (
              "Complete signup"
            ) : (
              "Fullfør registrering"
            )}
          </button>
          {(!signupCoords || locationStatus === "denied") && (
            <div className="mt-3 text-center space-y-2">
              <p className="text-sm text-red-600">
                {isEn
                  ? "Location is required. Enable GPS to finish signup."
                  : "Posisjon er påkrevd. Slå på GPS for å fullføre."}
              </p>
              <button
                type="button"
                onClick={retrySignupLocation}
                className="text-sm font-medium underline text-foreground"
              >
                {isEn ? "Retry location" : "Prøv posisjon igjen"}
              </button>
            </div>
          )}
          {authError && (
            <p className="text-sm text-red-600 mt-2 text-center">{authError}</p>
          )}
        </div>
      </main>
    );
  }

  // ── Summary screen ─────────────────────────────────────────────────────────────
  if (showSummary) {
    return (
      <main className="h-[100dvh] w-full max-w-md mx-auto bg-background flex flex-col">
        <div className="flex items-center px-4 pt-14 pb-4">
          <button
            onClick={() => {
              if (providerAuthStep === "otp") {
                setShowOtp(false);
                setOtp("");
                setProviderAuthStep("phone");
              } else if (providerAuthStep === "phone") {
                void abandonProviderSignup();
              } else if (providerAuthStep === "payment") {
                setProviderAuthStep("profile");
                setProviderSignupResumeStep("profile");
              } else if (providerAuthStep === "profile") {
                // Become a provider from an existing customer skipped phone —
                // back goes home, not to a code they never received.
                void abandonProviderSignup();
              } else {
                void abandonProviderSignup();
              }
            }}
            className="p-2 -ml-2"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 px-6 overflow-y-auto">
          {/* Step 1: Profile name */}
          {providerAuthStep === "profile" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {isEn ? "Your profile" : "Din profil"}
              </h1>
              <p className="text-muted-foreground text-sm mb-6">
                {isEn
                  ? "This will be shown to customers"
                  : "Dette vises til kunder"}
              </p>

              {/* Profile picture */}
              <div className="flex justify-center mb-6">
                <div className="flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => profileImageInputRef.current?.click()}
                    className="w-24 h-24 rounded-full bg-muted flex items-center justify-center overflow-hidden"
                  >
                    {profileAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profileAvatarUrl}
                        alt="Profile"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <svg
                        className="w-10 h-10 text-muted-foreground"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
                      </svg>
                    )}
                  </button>
                  <input
                    ref={profileImageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void onProfilePhotoChange(e)}
                  />
                  <button
                    type="button"
                    onClick={() => profileImageInputRef.current?.click()}
                    className="text-xs text-muted-foreground"
                  >
                    {processingProfileImage
                      ? isEn
                        ? "Uploading..."
                        : "Laster opp..."
                      : isEn
                        ? "Upload photo"
                        : "Last opp bilde"}
                  </button>
                </div>
              </div>

              <div className="mb-6">
                <label className="text-xs text-muted-foreground mb-2 block">
                  {isEn ? "Display name" : "Visningsnavn"}
                </label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder={isEn ? "Your name" : "Ditt navn"}
                  className="w-full bg-muted rounded-xl px-4 py-3 text-foreground outline-none"
                  autoFocus
                />
              </div>
            </>
          )}

          {/* Step: Stripe Connect payouts */}
          {providerAuthStep === "payment" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {isEn ? "Get paid" : "Motta betaling"}
              </h1>
              <p className="text-muted-foreground text-sm mb-6">
                {isEn
                  ? "Set up payouts with Stripe Connect. Automatic payout every Monday at 09:00."
                  : "Sett opp utbetalinger med Stripe Connect. Automatisk utbetaling hver mandag kl. 09:00."}
              </p>

              <div className="rounded-xl border-2 border-border p-4 space-y-3">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center">
                    <svg
                      className="w-6 h-6 text-foreground"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="3" y="6" width="18" height="12" rx="2" />
                      <path d="M3 10h18" />
                    </svg>
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-foreground">
                      {isEn ? "Bank account via Stripe" : "Bankkonto via Stripe"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isEn
                        ? "Automatic payout every Monday at 09:00"
                        : "Automatisk utbetaling hver mandag kl. 09:00"}
                    </p>
                  </div>
                  {paymentMethod === "stripe" && (
                    <Check className="w-5 h-5 text-foreground" />
                  )}
                </div>
                {paymentMethod === "stripe" ? (
                  <p className="text-xs text-green-600">
                    {isEn
                      ? "Payouts connected. Continue to choose your services."
                      : "Utbetalinger koblet. Fortsett for å velge tjenester."}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {isEn
                      ? "You will complete identity and bank details on Stripe, then return here."
                      : "Du fullfører identitet og bankdetaljer hos Stripe, deretter kommer du tilbake hit."}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Step: Phone */}
          {providerAuthStep === "phone" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {isEn ? "Verify phone" : "Bekreft telefon"}
              </h1>
              <p className="text-muted-foreground text-sm mb-6">
                {isEn
                  ? "We'll send you a verification code"
                  : "Vi sender deg en bekreftelseskode"}
              </p>

              <div className="mb-6">
                <label className="text-xs text-muted-foreground mb-2 block">
                  {isEn ? "Phone number" : "Telefonnummer"}
                </label>
                <div className="flex items-center bg-muted rounded-xl px-4 py-3">
                  <span className="text-muted-foreground mr-2">+47</span>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) =>
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 8))
                    }
                    placeholder="XXX XX XXX"
                    className="flex-1 bg-transparent text-foreground outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex items-center gap-4 my-6">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">
                  {isEn ? "or" : "eller"}
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {renderSocialLoginButtons()}
              {authError && (
                <p className="text-sm text-red-600 mt-2">{authError}</p>
              )}
            </>
          )}

          {/* Step 4: OTP */}
          {providerAuthStep === "otp" && (
            <>
              <h1 className="text-2xl font-bold text-foreground mb-1">
                {isEn ? "Enter code" : "Skriv inn kode"}
              </h1>
              <p className="text-muted-foreground text-sm mb-6">
                {isEn ? "6-digit code sent to" : "6-sifret kode sendt til"} +47{" "}
                {phone}
              </p>

              <div className="flex gap-2 justify-center">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <input
                    key={i}
                    type="text"
                    maxLength={1}
                    value={otp[i] || ""}
                    onChange={(e) => handleOtpChange(i, e)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    onPaste={handleOtpPaste}
                    className="w-11 h-14 text-center text-xl font-bold border border-border rounded-xl bg-transparent focus:border-foreground outline-none"
                    autoFocus={i === 0}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="p-6">
          <button
            onClick={() => {
              if (providerAuthStep === "phone" && phone.length >= 8) {
                void handleSendOtp().then((ok) => {
                  if (ok) setProviderAuthStep("otp");
                });
              } else if (providerAuthStep === "otp" && otp.length >= 6) {
                void handleVerifyOtp();
              } else if (providerAuthStep === "profile" && profileName.length >= 2) {
                setProviderAuthStep("payment");
                setProviderSignupResumeStep("payment");
              } else if (providerAuthStep === "payment") {
                if (paymentMethod === "stripe") {
                  setProviderSignupResumeStep("services");
                  setShowSummary(false);
                  setStep("services");
                } else {
                  void startSignupStripeConnect();
                }
              }
            }}
            disabled={
              (providerAuthStep === "phone" && phone.length < 8) ||
              (providerAuthStep === "otp" && otp.length < 6) ||
              (providerAuthStep === "profile" && profileName.length < 2) ||
              sendingOtp ||
              verifyingOtp ||
              completingSignup ||
              stripeConnectBusy
            }
            className="w-full py-4 bg-foreground text-background rounded-xl font-semibold disabled:opacity-40"
          >
            {providerAuthStep === "payment"
              ? stripeConnectBusy
                ? isEn
                  ? "Opening Stripe..."
                  : "Åpner Stripe..."
                : paymentMethod === "stripe"
                  ? isEn
                    ? "Continue"
                    : "Fortsett"
                  : isEn
                    ? "Continue with Stripe"
                    : "Fortsett med Stripe"
              : providerAuthStep === "otp"
                ? verifyingOtp
                  ? isEn
                    ? "Verifying..."
                    : "Bekrefter..."
                  : isEn
                    ? "Continue"
                    : "Fortsett"
                : providerAuthStep === "phone" && sendingOtp
                  ? isEn
                    ? "Sending..."
                    : "Sender..."
                  : isEn
                    ? "Continue"
                    : "Fortsett"}
          </button>
          {authError && (
            <p className="text-sm text-red-600 mt-2 text-center">{authError}</p>
          )}
          {providerAuthStep === "payment" &&
            process.env.NODE_ENV !== "production" && (
              <button
                type="button"
                onClick={skipStripeConnectForDev}
                className="w-full py-3 text-sm text-muted-foreground mt-1 underline"
              >
                {isEn
                  ? "Skip Connect for now (dev only)"
                  : "Hopp over Connect for nå (kun dev)"}
              </button>
            )}
          {providerAuthStep === "otp" && (
            <button
              onClick={() => void handleSendOtp()}
              disabled={sendingOtp}
              className="w-full py-3 text-sm text-muted-foreground mt-2 disabled:opacity-40"
            >
              {sendingOtp
                ? isEn
                  ? "Sending..."
                  : "Sender..."
                : isEn
                  ? "Resend code"
                  : "Send kode på nytt"}
            </button>
          )}
        </div>
      </main>
    );
  }

  // ── Main login / sign-up screen ────────────────────────────────────────────────
  return (
    <main className="h-[100dvh] w-full max-w-md mx-auto bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-14 pb-2">
        <button
          onClick={() => {
            if (paymentMethod) {
              setProviderAuthStep("payment");
              setShowSummary(true);
            } else {
              void abandonProviderSignup();
            }
          }}
          className="p-2 -ml-2"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        {enabledCount > 0 && (
          <button
            onClick={() => setStep("summary")}
            className="text-sm text-primary font-medium"
          >
            {isEn ? "Review" : "Oppsummering"}
          </button>
        )}
      </div>

      {/* Instructions - minimal */}
      <div className="px-4 pb-4">
        <h1 className="text-xl font-bold text-foreground mb-1">
          {isEn ? "What can you offer?" : "Hva kan du tilby?"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEn
            ? "Select services and rate yourself 1-5 stars."
            : "Velg tjenester og rate deg selv med stjerner fra 1-5."}
        </p>
        <p
          className={cn(
            "text-xs mt-2",
            locationStatus === "ready"
              ? "text-green-600"
              : locationStatus === "denied"
                ? "text-red-600"
                : "text-muted-foreground",
          )}
        >
          {locationStatus === "ready"
            ? isEn
              ? "Location ready for area pricing."
              : "Posisjon klar for områdepris."
            : locationStatus === "pending"
              ? isEn
                ? "Getting your location…"
                : "Henter posisjon…"
              : locationStatus === "denied"
                ? isEn
                  ? "Location required — enable GPS, then retry before finishing."
                  : "Posisjon påkrevd — slå på GPS og prøv igjen før fullføring."
                : null}
          {locationStatus === "denied" ? (
            <>
              {" "}
              <button
                type="button"
                onClick={retrySignupLocation}
                className="underline font-medium"
              >
                {isEn ? "Retry" : "Prøv igjen"}
              </button>
            </>
          ) : null}
        </p>
      </div>

      {/* Mode dropdown - like in the app */}
      <div className="px-4 pb-2 relative z-50">
        <button
          type="button"
          className="glass-morphism-strong rounded-full px-3 h-10 border-0 text-gray-800 hover:text-gray-900 flex items-center gap-1.5 text-sm"
          onClick={() => setShowModeDropdown(!showModeDropdown)}
        >
          <ModeIcon mode={appMode} className="h-4 w-4" />
          <span className="font-semibold text-xs">
            {APP_MODES[appMode].label}
          </span>
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              showModeDropdown && "rotate-180",
            )}
          />
        </button>

        {showModeDropdown && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowModeDropdown(false)}
            />
            <div className="absolute top-full left-0 mt-2 glass-morphism-strong rounded-2xl p-2 min-w-[180px] z-50 animate-in fade-in-50 slide-in-from-top-4 duration-200 border-0">
              {(Object.keys(APP_MODES) as AppMode[]).map((key) => {
                const m = APP_MODES[key];
                const hasServicesInMode = Object.values(enabledServices).some(
                  (s) => s.mode === m.id,
                );
                return (
                  <button
                    key={m.id}
                    type="button"
                    className={cn(
                      "w-full px-3 py-2.5 rounded-xl text-left transition-all duration-200 flex items-center gap-2 text-sm",
                      appMode === m.id
                        ? "glass-button-active"
                        : "hover:bg-white/20 text-gray-800",
                    )}
                    onClick={() => {
                      setAppMode(m.id);
                      setShowModeDropdown(false);
                    }}
                  >
                    <ModeIcon mode={m.id} className="h-4 w-4" />
                    <span className="font-medium flex-1">{m.label}</span>
                    {hasServicesInMode && (
                      <Check className="h-4 w-4 text-green-600" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Target + Categories bar */}
      <div className="px-4 pb-3">
        <div className="glass-morphism-strong rounded-2xl px-3 py-2 border-0 flex items-center gap-2">
          {/* Target Switch */}
          <div className="glass-morphism rounded-full p-1 flex gap-0.5 border-0 flex-shrink-0">
            {currentTargets.map((t) => {
              const isSelected = selectedTargets.includes(t.id);
              return (
                <Button
                  key={t.id}
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "rounded-full h-8 w-8 p-0 border-0 transition-all duration-300 relative",
                    isSelected
                      ? `glass-button-active ring-2 ${t.id === "female" || t.id === "cat" ? "ring-pink-400" : "ring-blue-400"}`
                      : "glass-button text-gray-700",
                  )}
                  onClick={() => toggleTarget(t.id)}
                  title={t.label}
                >
                  <span className="text-sm">{t.icon}</span>
                  {isSelected && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white" />
                  )}
                </Button>
              );
            })}
          </div>

          <div className="w-px h-6 bg-white/30 flex-shrink-0" />

          {/* Category chips */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {currentCategories.map((c) => {
              const isSelected = selectedCategories.includes(c.id);
              return (
                <Button
                  key={c.id}
                  variant="ghost"
                  className={cn(
                    "h-7 px-3 rounded-full border-0 transition-all duration-300 relative flex-shrink-0 text-xs font-medium",
                    isSelected
                      ? "glass-button-active"
                      : "glass-button text-gray-700",
                  )}
                  onClick={() => toggleCategory(c.id)}
                >
                  <div className="flex items-center gap-1">
                    <CategoryIcon
                      appMode={appMode}
                      category={c.id}
                      className="h-3 w-3"
                    />
                    <span>{c.label}</span>
                  </div>
                  {isSelected && (
                    <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white" />
                  )}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Services */}
      <div className="flex-1 overflow-y-auto px-4 space-y-4 pb-4">
        {getServicesGrouped().map(
          ({
            target: targetId,
            targetIcon,
            targetLabel,
            category: catId,
            categoryLabel,
            services,
          }) => (
            <div key={`${targetId}-${catId}`}>
              {/* Section header */}
              <div className="flex items-center gap-1.5 mb-2 px-1 text-[11px] text-muted-foreground">
                <span>{targetIcon}</span>
                <span>{targetLabel}</span>
                <span>/</span>
                <span>{categoryLabel}</span>
              </div>

              {/* Service cards */}
              <div className="space-y-3 py-1">
                {services.map((service) => {
                  const serviceKey = `${appMode}-${targetId}-${catId}-${service.id}`;
                  const isEnabled = !!enabledServices[serviceKey];
                  const isExpanded =
                    expandedService === serviceKey && isEnabled;
                  const config = enabledServices[serviceKey];

                  return (
                    <div
                      key={serviceKey}
                      className="rounded-2xl bg-white"
                      style={{ boxShadow: "0 6px 20px rgba(15,23,42,0.14)" }}
                    >
                      <div className="overflow-hidden rounded-2xl">
                      {/* Card row - EXACT same as app */}
                      <button
                        className="w-full p-4 text-left transition-all duration-300 hover:bg-black/[0.02]"
                        onClick={() =>
                          isEnabled &&
                          setExpandedService(isExpanded ? null : serviceKey)
                        }
                      >
                        <div className="flex items-center gap-3">
                          {/* Service icon */}
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[#F3F4F2] border-none flex-shrink-0">
                            <CategoryIcon
                              appMode={appMode}
                              category={catId}
                              className="h-5 w-5 text-gray-700"
                            />
                          </div>

                          {/* Service info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h3 className="font-semibold text-gray-900 text-sm">
                                {service.name}
                              </h3>
                              <span className="text-sm">{targetIcon}</span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {service.duration}
                            </p>
                          </div>

                          {/* Toggle - EXACT same as app */}
                          <button
                            className={cn(
                              "w-12 h-7 rounded-full transition-all duration-300 relative touch-manipulation flex-shrink-0",
                              isEnabled ? "bg-green-500" : "bg-gray-300/60",
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleService(
                                serviceKey,
                                service.price,
                                service.name,
                                catId,
                                targetId,
                                service.id,
                              );
                            }}
                          >
                            <div
                              className={cn(
                                "absolute top-1 w-5 h-5 bg-white rounded-full shadow-md transition-all duration-300",
                                isEnabled ? "right-1" : "left-1",
                              )}
                            />
                          </button>
                        </div>
                      </button>

                      {/* Expanded - rating/price/delivery */}
                      {isExpanded && config && (
                        <div className="px-3 pb-3 space-y-4 border-t border-white/20 pt-3 animate-in slide-in-from-top-2 duration-200">
                          {/* Star rating */}
                          <div>
                            <p className="text-xs text-gray-600 mb-1">
                              {isEn
                                ? "Rate yourself 1-5"
                                : "Rate deg selv fra 1-5"}
                            </p>
                            <div className="flex gap-1 mb-1">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                  key={star}
                                  onClick={() =>
                                    setEnabledServices((prev) => ({
                                      ...prev,
                                      [serviceKey]: {
                                        ...prev[serviceKey],
                                        rating: star,
                                      },
                                    }))
                                  }
                                  className="p-0.5"
                                >
                                  <Star
                                    className={cn(
                                      "h-6 w-6 transition-colors",
                                      star <= config.rating
                                        ? "text-yellow-500 fill-current"
                                        : "text-gray-300",
                                    )}
                                  />
                                </button>
                              ))}
                            </div>
                            <p className="text-[10px] text-gray-500">
                              {isEn
                                ? "Not shown to customers. It helps us send you the right kind of jobs."
                                : "Ikke synlig for kunder. Hjelper oss sende deg riktig type oppdrag."}
                            </p>
                          </div>

                          {/* Price slider - help set area price */}
                          <div>
                            <p className="text-xs text-gray-600 mb-1">
                              {isEn
                                ? "Help set area price"
                                : "Hjelp oss sette områdepris"}
                            </p>
                            {(() => {
                              const { min: priceMin, max: priceMax } =
                                snapPriceRangeKr(
                                  service.price * 0.5,
                                  service.price * 2,
                                );
                              const snapped = snapPriceKr(config.price);
                              return (
                                <>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range"
                                      min={priceMin}
                                      max={priceMax}
                                      step={25}
                                      value={Math.min(
                                        priceMax,
                                        Math.max(priceMin, snapped),
                                      )}
                                      onChange={(e) =>
                                        setEnabledServices((prev) => ({
                                          ...prev,
                                          [serviceKey]: {
                                            ...prev[serviceKey],
                                            price: snapPriceKr(
                                              parseInt(e.target.value, 10),
                                            ),
                                          },
                                        }))
                                      }
                                      className="flex-1 accent-foreground"
                                    />
                                    <span className="text-sm font-medium text-gray-800 w-16 text-right">
                                      {formatDisplayPrice(snapped, language)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between text-[10px] text-gray-400 mt-0.5 px-0.5">
                                    <span>
                                      {formatDisplayPrice(priceMin, language)}
                                    </span>
                                    <span>
                                      {formatDisplayPrice(priceMax, language)}
                                    </span>
                                  </div>
                                </>
                              );
                            })()}
                            <p className="text-[10px] text-gray-500 mt-1">
                              {isEn
                                ? "We take the average of all providers in your area."
                                : "Vi tar gjennomsnittet av alle tilbydere i ditt område."}
                            </p>
                          </div>
                        </div>
                      )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ),
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-border bg-background">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-muted-foreground">
            {enabledCount === 0
              ? isEn
                ? "Select at least one service to continue"
                : "Velg minst én tjeneste for å fortsette"
              : `${enabledCount} ${isEn ? "services selected" : "tjenester valgt"}`}
          </span>
        </div>
        <Button
          onClick={() => {
            setStep("summary");
          }}
          type="button"
        >
          {isEn ? "Continue" : "Fortsett"}
        </Button>
      </div>
    </main>
  );
}
