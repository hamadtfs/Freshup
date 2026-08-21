"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { formatDisplayPrice } from "@/lib/pricing/format-display-kr"
import { LOYALTY_DISCOUNT_BOOKINGS } from "@/lib/pricing/constants"
import {
  X,
  CreditCard,
  Calendar,
  Headphones,
  Info,
  LogIn,
  LogOut,
  User,
  Briefcase,
  Star,
  TrendingUp,
  Sparkles,
  ChevronRight,
  Globe,
  Trophy,
  Zap,
  CheckCircle,
  ArrowLeft,
  Gift,
  Share2,
  ShieldCheck,
  Wallet,
} from "lucide-react"
type UserMode = "customer" | "provider"
type Language = "no" | "en"
type Tier = "gold" | "silver" | "bronze"

type ResponseSpeedBuckets = {
  within3s: number
  within6s: number
  within9s: number
  after9s: number
  noResponse: number
  acceptedWithin3s: number
  acceptedWithin6s: number
  acceptedWithin9s: number
  acceptedAfter9s: number
  totalPoints: number
}

interface ProviderStats {
  tier: Tier
  score: number | null
  tierIsProvisional?: boolean
  received?: number
  acceptRate: number
  completionRate: number
  responseSpeed: number
  responseBuckets?: ResponseSpeedBuckets
}

interface HamburgerMenuProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (page: "orders" | "support" | "about" | "payment" | "earnings" | "wallet" | "skills" | "profile" | "stats" | "admin") => void
  onModeChange: (mode: UserMode) => void
  onLogout: () => void
  /** When false, footer shows Log in instead of Log out. */
  signedIn?: boolean
  onLogin?: () => void
  currentMode: UserMode
  /** When true, show Customer/Provider toggle. Otherwise Become a provider / Book a service. */
  canSwitchModes?: boolean
  hasCustomerRole?: boolean
  hasProviderRole?: boolean
  onBecomeProvider?: () => void
  onBookAService?: () => void
  userName?: string
  userAvatarUrl?: string
  userRating?: number
  rewardProgress?: number
  providerEarningsToday?: number
  providerEarningsWeek?: number
  providerCompletedJobs?: number
  providerStats?: ProviderStats
  providerStatsLoading?: boolean
  providerTier?: Tier
  language?: Language
  onLanguageChange?: (lang: Language) => void
  showAdminVerifications?: boolean
}

export default function HamburgerMenu({
  isOpen,
  onClose,
  onNavigate,
  onModeChange,
  onLogout,
  signedIn = true,
  onLogin,
  currentMode,
  canSwitchModes = false,
  hasCustomerRole = false,
  hasProviderRole = false,
  onBecomeProvider,
  onBookAService,
  userName = "User",
  userAvatarUrl,
  userRating = 4.5,
  rewardProgress = 3,
  providerEarningsToday = 0,
  providerEarningsWeek = 8750,
  providerCompletedJobs = 47,
  providerStats,
  providerStatsLoading = false,
  providerTier,
  language = "no",
  onLanguageChange,
  showAdminVerifications = false,
}: HamburgerMenuProps) {
  const isEn = language === "en"
  const [showStats, setShowStats] = useState(false)
  const [showResponseInfo, setShowResponseInfo] = useState(false)
  const [roleSwitchTarget, setRoleSwitchTarget] = useState<UserMode | null>(
    null,
  )

  const requestModeChange = (mode: UserMode) => {
    if (mode === currentMode) return
    if (!signedIn) {
      onModeChange(mode)
      return
    }
    setRoleSwitchTarget(mode)
  }

  const formatPrice = (price: number) => formatDisplayPrice(price, language)
  const loyaltyProgress = Math.min(
    LOYALTY_DISCOUNT_BOOKINGS,
    Math.max(0, rewardProgress),
  )
  const loyaltyBookingsLeft = Math.max(
    0,
    LOYALTY_DISCOUNT_BOOKINGS - loyaltyProgress,
  )

  const statsPending =
    currentMode === "provider" && (providerStatsLoading || !providerStats)
  const resolvedTier: Tier =
    providerStats?.tier ?? providerTier ?? "silver"
  const stats: ProviderStats | null = providerStats
    ? { ...providerStats, tier: resolvedTier }
    : null
  const scoreLabel =
    stats?.tierIsProvisional || stats?.score == null
      ? "—"
      : String(stats.score)

  const tierConfig = {
    gold: { label: isEn ? "Gold" : "Gull", color: "text-amber-500", bg: "bg-amber-500", ring: "ring-amber-400" },
    silver: { label: isEn ? "Silver" : "Sølv", color: "text-slate-400", bg: "bg-slate-400", ring: "ring-slate-300" },
    bronze: { label: isEn ? "Bronze" : "Bronse", color: "text-orange-500", bg: "bg-orange-500", ring: "ring-orange-400" },
  }[resolvedTier]

  const ProviderTierCardSkeleton = ({ compact = false }: { compact?: boolean }) => (
    <div
      className={cn(
        "animate-pulse rounded-2xl bg-muted",
        compact ? "h-[88px] w-full" : "h-[140px] w-full",
      )}
      aria-hidden
    />
  )

  const MetricRowSkeleton = () => (
    <div className="rounded-2xl bg-muted/50 p-4 animate-pulse" aria-hidden>
      <div className="mb-2 flex items-center justify-between">
        <div className="h-4 w-24 rounded-md bg-muted" />
        <div className="h-5 w-14 rounded-md bg-muted" />
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted" />
    </div>
  )

  const adminMenuItem = showAdminVerifications
    ? {
        id: "admin" as const,
        label: isEn ? "Approvals" : "Godkjenninger",
        icon: ShieldCheck,
      }
    : null

  const customerMenuItems = [
    { id: "payment" as const, label: isEn ? "Payment" : "Betaling", icon: CreditCard },
    { id: "orders" as const, label: isEn ? "Orders" : "Bestillinger", icon: Calendar },
    { id: "support" as const, label: isEn ? "Help" : "Hjelp", icon: Headphones },
    { id: "about" as const, label: isEn ? "About" : "Om oss", icon: Info },
    ...(adminMenuItem ? [adminMenuItem] : []),
  ]

  const providerMenuItems = [
    { id: "stats" as const, label: isEn ? "My Stats" : "Min status", icon: Trophy },
    { id: "earnings" as const, label: isEn ? "Earnings" : "Inntjening", icon: TrendingUp },
    { id: "wallet" as const, label: isEn ? "Wallet" : "Lommebok", icon: Wallet },
    { id: "skills" as const, label: isEn ? "Skills" : "Ferdigheter", icon: Sparkles },
    { id: "orders" as const, label: isEn ? "Jobs" : "Oppdrag", icon: Calendar },
    { id: "support" as const, label: isEn ? "Help" : "Hjelp", icon: Headphones },
    ...(adminMenuItem ? [adminMenuItem] : []),
  ]

  const customerMenuItemsWithAdmin = customerMenuItems

  const menuItems =
    currentMode === "provider" ? providerMenuItems : customerMenuItemsWithAdmin

  if (!isOpen) return null

  // Stats Sheet (Provider only)
  if (showStats && currentMode === "provider") {
    return (
      <>
        <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setShowStats(false)} />
        <div className="fixed left-0 top-0 bottom-0 w-[88%] max-w-[360px] z-50 animate-in slide-in-from-left duration-200 bg-background flex flex-col">
          {/* Header */}
          <div className="pt-14 px-5 pb-4">
            <div className="flex items-center justify-between mb-6">
              <button onClick={() => setShowStats(false)} className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <button onClick={onClose} className="w-10 h-10 rounded-xl flex items-center justify-center text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>

            {statsPending ? (
              <ProviderTierCardSkeleton />
            ) : stats ? (
            <div className="bg-foreground rounded-3xl p-6 text-background relative overflow-hidden">
              {/* Background pattern - subtle */}
              <div className="absolute inset-0 opacity-5">
                <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white translate-x-8 -translate-y-8" />
                <div className="absolute bottom-0 left-0 w-24 h-24 rounded-full bg-white -translate-x-6 translate-y-6" />
              </div>
              
              <div className="relative">
                {/* Top row */}
                <div className="flex items-start justify-between mb-8">
                  <div>
                    <p className="text-xs text-background/60 uppercase tracking-wider font-medium mb-1">
                      {isEn ? "Provider Tier" : "Tilbyder-tier"}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-3 h-3 rounded-full", tierConfig.bg)} />
                      <span className="text-2xl font-bold">{tierConfig.label}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-5xl font-bold tracking-tight">{scoreLabel}</p>
                    <p className="text-xs text-background/60">
                      {stats.tierIsProvisional
                        ? isEn
                          ? "starter tier"
                          : "startnivå"
                        : isEn
                          ? "points"
                          : "poeng"}
                    </p>
                  </div>
                </div>

                {/* Dispatch priority visual */}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-background/60">{isEn ? "Priority" : "Prioritet"}</span>
                  <div className="flex-1 flex gap-1">
                    <div className={cn("h-2 flex-1 rounded-full", resolvedTier === "gold" ? "bg-amber-400" : "bg-background/20")} />
                    <div className={cn("h-2 flex-1 rounded-full", resolvedTier !== "bronze" ? "bg-slate-300" : "bg-background/20")} />
                    <div className="h-2 flex-1 rounded-full bg-orange-400" />
                  </div>
                  <span className="text-background/60">1st</span>
                </div>
              </div>
            </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isEn ? "Could not load performance stats." : "Kunne ikke laste ytelsesstatistikk."}
              </p>
            )}
          </div>

          {/* Metrics */}
          <div className="flex-1 overflow-y-auto px-5 pb-6">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {isEn ? "Performance" : "Ytelse"}
            </p>

            {statsPending ? (
              <div className="space-y-2">
                <MetricRowSkeleton />
                <MetricRowSkeleton />
                <MetricRowSkeleton />
              </div>
            ) : stats ? (
            <div className="space-y-2">
              {stats.tierIsProvisional ? (
                <p className="rounded-2xl bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
                  {isEn
                    ? "Starter Silver tier until you receive 3 offers. Your score will appear after that."
                    : "Startnivå Sølv inntil du har mottatt 3 tilbud. Poengsummen vises etter det."}
                </p>
              ) : null}
              {/* Accept Rate */}
              <div className="bg-muted/50 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{isEn ? "Accept" : "Aksept"}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold">{stats.acceptRate}%</span>
                    <span className="text-xs text-muted-foreground ml-1">{stats.acceptRate}/100</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${stats.acceptRate}%` }} />
                </div>
              </div>

              {/* Completion Rate */}
              <div className="bg-muted/50 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{isEn ? "Complete" : "Fullført"}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-bold">{stats.completionRate}%</span>
                    <span className="text-xs text-muted-foreground ml-1">{stats.completionRate}/100</span>
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${stats.completionRate}%` }} />
                </div>
              </div>

              {/* Response Speed */}
              <button 
                onClick={() => setShowResponseInfo(true)}
                className="w-full bg-muted/50 rounded-2xl p-4 text-left"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">{isEn ? "Speed" : "Hastighet"}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-lg font-bold">{stats.responseSpeed}%</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${stats.responseSpeed}%` }} />
                </div>
              </button>
            </div>
            ) : null}

            {/* How it works */}
            <div className="mt-6 p-4 border border-border rounded-2xl">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {isEn ? "How dispatch works" : "Slik fungerer tildeling"}
              </p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-amber-600">1</span>
                  </div>
                  <span className="text-muted-foreground">{isEn ? "Gold gets request" : "Gull får forespørselen"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-500">2</span>
                  </div>
                  <span className="text-muted-foreground">{isEn ? "Then Silver" : "Så Sølv"}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-orange-600">3</span>
                  </div>
                  <span className="text-muted-foreground">{isEn ? "Then Bronze" : "Så Bronse"}</span>
                </div>
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground text-center mt-4">
              {isEn ? "Based on last 30 days" : "Basert på siste 30 dager"}
            </p>
          </div>
        </div>

        {/* Response Info Sheet */}
        {showResponseInfo && (
          <>
            <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setShowResponseInfo(false)} />
            <div className="fixed bottom-0 left-0 right-0 z-[60] bg-background rounded-t-3xl p-6 max-w-md mx-auto animate-in slide-in-from-bottom">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold">{isEn ? "Response speed" : "Responstid"}</h3>
                <button onClick={() => setShowResponseInfo(false)} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {stats?.responseBuckets ? (
                <p className="text-xs text-muted-foreground mb-4">
                  {isEn
                    ? "Time from offer sent to your response (accept or decline). Checkmarks = accepted in that bucket."
                    : "Tid fra tilbud sendt til du svarte (akseptert eller avslått). Hake = akseptert i intervallet."}
                </p>
              ) : null}
              <div className="space-y-2">
                {(stats?.responseBuckets
                  ? [
                      {
                        labelEn: "Within 3 sec",
                        labelNo: "Innen 3 sek",
                        count: stats.responseBuckets.within3s,
                        accepted: stats.responseBuckets.acceptedWithin3s,
                        points: 1,
                        highlight: true,
                      },
                      {
                        labelEn: "Within 6 sec",
                        labelNo: "Innen 6 sek",
                        count: stats.responseBuckets.within6s,
                        accepted: stats.responseBuckets.acceptedWithin6s,
                        points: 0.5,
                        highlight: false,
                      },
                      {
                        labelEn: "Within 9 sec",
                        labelNo: "Innen 9 sek",
                        count: stats.responseBuckets.within9s,
                        accepted: stats.responseBuckets.acceptedWithin9s,
                        points: 0.25,
                        highlight: false,
                      },
                      {
                        labelEn: "After 9 sec",
                        labelNo: "Etter 9 sek",
                        count: stats.responseBuckets.after9s,
                        accepted: stats.responseBuckets.acceptedAfter9s,
                        points: 0,
                        highlight: false,
                      },
                      {
                        labelEn: "No response",
                        labelNo: "Uten svar",
                        count: stats.responseBuckets.noResponse,
                        accepted: 0,
                        points: 0,
                        highlight: false,
                      },
                    ]
                  : [
                      { labelEn: "Within 3 sec", labelNo: "Innen 3 sek", count: null, accepted: 0, points: 1, highlight: true },
                      { labelEn: "Within 6 sec", labelNo: "Innen 6 sek", count: null, accepted: 0, points: 0.5, highlight: false },
                      { labelEn: "Within 9 sec", labelNo: "Innen 9 sek", count: null, accepted: 0, points: 0.25, highlight: false },
                      { labelEn: "After 9 sec", labelNo: "Etter 9 sek", count: null, accepted: 0, points: 0, highlight: false },
                    ]
                ).map((item, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl",
                      item.highlight ? "bg-primary/10" : "bg-muted",
                    )}
                  >
                    <div>
                      <span className="text-sm">{isEn ? item.labelEn : item.labelNo}</span>
                      {item.count != null ? (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {item.count} {isEn ? "offers" : "tilbud"}
                          {item.accepted > 0
                            ? ` · ${item.accepted} ${isEn ? "accepted" : "akseptert"}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "text-sm font-bold",
                        item.highlight ? "text-primary" : "text-foreground",
                      )}
                    >
                      {item.points} {isEn ? "pt" : "p"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </>
    )
  }

  // Main Menu
  const roleSwitchTitle =
    roleSwitchTarget === "provider"
      ? isEn
        ? "Log in as provider"
        : "Logg inn som tilbyder"
      : isEn
        ? "Log in as customer"
        : "Logg inn som kunde"

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed left-0 top-0 bottom-0 w-[85%] max-w-[320px] z-50 animate-in slide-in-from-left duration-200 bg-background flex flex-col">
        {/* Header */}
        <div className="pt-14 px-5 pb-4">
          <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground">
            <X className="h-4 w-4" />
          </button>

          {/* Profile */}
          <button 
            onClick={() => { onNavigate("profile"); onClose() }}
            className="flex items-center gap-3 w-full text-left"
          >
            <div className="w-11 h-11 bg-gray-100 rounded-full flex items-center justify-center overflow-hidden">
              {userAvatarUrl ? (
                <img
                  src={userAvatarUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : currentMode === "provider" ? (
                <Briefcase className="h-5 w-5 text-gray-600" />
              ) : (
                <User className="h-5 w-5 text-gray-600" />
              )}
            </div>
            <div className="flex-1">
              <p className="font-semibold">{userName}</p>
              <div className="flex items-center gap-1">
                {currentMode === "provider" ? (
                  <>
                    <Star className="h-3 w-3 fill-primary text-primary" />
                    <span className="text-sm text-muted-foreground">{userRating}</span>
                  </>
                ) : null}
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* Quick Stats Card */}
        <div className="px-5 pb-4">
          {currentMode === "customer" ? (
            <div className="space-y-2">
              {/* Loyalty: 20% off (commission waived) after 5 bookings */}
              <div className="bg-foreground text-background rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-background/60">
                      {loyaltyBookingsLeft > 0
                        ? isEn
                          ? "20% off in"
                          : "20 % rabatt om"
                        : isEn
                          ? "20% off unlocked"
                          : "20 % rabatt opplåst"}
                    </p>
                    <p className="text-2xl font-bold">
                      {loyaltyBookingsLeft > 0
                        ? `${loyaltyBookingsLeft} ${
                            loyaltyBookingsLeft === 1
                              ? isEn
                                ? "booking"
                                : "bestilling"
                              : isEn
                                ? "bookings"
                                : "bestillinger"
                          }`
                        : isEn
                          ? "Next booking"
                          : "Neste booking"}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {Array.from(
                      { length: LOYALTY_DISCOUNT_BOOKINGS },
                      (_, i) => i + 1,
                    ).map((i) => (
                      <div
                        key={i}
                        className={cn(
                          "w-2 h-8 rounded-full",
                          i <= loyaltyProgress
                            ? "bg-primary"
                            : "bg-background/20",
                        )}
                      />
                    ))}
                  </div>
                </div>
              </div>
              {/* Referral: 20% off after invited person completes first booking */}
              <button className="w-full bg-primary/10 border border-primary/20 rounded-2xl p-4 flex items-center gap-3 text-left hover:bg-primary/15 transition-colors">
                <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center">
                  <Gift className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{isEn ? "Invite a friend" : "Inviter en venn"}</p>
                  <p className="text-xs text-muted-foreground">
                    {isEn
                      ? "20% off a service of your choice after they complete their first booking"
                      : "20 % rabatt på en tjeneste etter at de fullfører sin første booking"}
                  </p>
                </div>
                <Share2 className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            </div>
          ) : statsPending ? (
            <ProviderTierCardSkeleton compact />
          ) : stats ? (
            <button
              type="button"
              onClick={() => setShowStats(true)}
              className="w-full bg-foreground text-background rounded-2xl p-4 text-left"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={cn("w-2.5 h-2.5 rounded-full", tierConfig.bg)} />
                    <span className="text-xs text-background/60">{tierConfig.label} {isEn ? "tier" : ""}</span>
                  </div>
                  <p className="text-2xl font-bold">{formatPrice(providerEarningsToday)}</p>
                  <p className="text-xs text-background/60">{isEn ? "today" : "i dag"}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold">{scoreLabel}</p>
                  <p className="text-xs text-background/60">
                    {stats.tierIsProvisional
                      ? isEn
                        ? "starter"
                        : "startnivå"
                      : isEn
                        ? "score"
                        : "poeng"}
                  </p>
                </div>
              </div>
            </button>
          ) : (
            <div className="rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
              {isEn ? "Stats unavailable" : "Statistikk utilgjengelig"}
            </div>
          )}
        </div>

        {/* Menu Items */}
        <div className="flex-1 px-5 overflow-y-auto">
          <div className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.id === "stats") {
                      setShowStats(true)
                    } else {
                      onNavigate(item.id as never)
                      onClose()
                    }
                  }}
                  className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors"
                >
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Bottom */}
        <div className="p-5 border-t border-border space-y-3">
          {canSwitchModes ? (
            <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
              <span className="text-sm font-medium text-muted-foreground">
                {isEn ? "Mode" : "Modus"}
              </span>
              <div className="bg-muted rounded-full p-1 flex">
                <button
                  type="button"
                  onClick={() => requestModeChange("customer")}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    currentMode === "customer" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {isEn ? "Customer" : "Kunde"}
                </button>
                <button
                  type="button"
                  onClick={() => requestModeChange("provider")}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                    currentMode === "provider" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {isEn ? "Provider" : "Tilbyder"}
                </button>
              </div>
            </div>
            </div>
          ) : (
            <div className="space-y-2">
              {!hasProviderRole && onBecomeProvider ? (
                <button
                  type="button"
                  onClick={() => {
                    onBecomeProvider()
                    onClose()
                  }}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-muted/50 hover:bg-muted text-sm font-medium"
                >
                  <Briefcase className="h-4 w-4" />
                  {isEn ? "Become a provider" : "Bli tilbyder"}
                </button>
              ) : null}
              {!hasCustomerRole && onBookAService ? (
                <button
                  type="button"
                  onClick={() => {
                    onBookAService()
                    onClose()
                  }}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl bg-muted/50 hover:bg-muted text-sm font-medium"
                >
                  <Calendar className="h-4 w-4" />
                  {isEn ? "Book a service" : "Bestill en tjeneste"}
                </button>
              ) : null}
            </div>
          )}

          {/* Language */}
          {onLanguageChange && (
            <button
              onClick={() => onLanguageChange(language === "no" ? "en" : "no")}
              className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors"
            >
              <Globe className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{language === "no" ? "English" : "Norsk"}</span>
            </button>
          )}

          {signedIn ? (
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors text-red-500"
            >
              <LogOut className="h-5 w-5" />
              <span className="font-medium">{isEn ? "Log out" : "Logg ut"}</span>
            </button>
          ) : (
            <button
              onClick={() => {
                onLogin?.()
                onClose()
              }}
              className="w-full flex items-center gap-4 p-3 rounded-xl hover:bg-muted transition-colors"
            >
              <LogIn className="h-5 w-5" />
              <span className="font-medium">{isEn ? "Log in" : "Logg inn"}</span>
            </button>
          )}
        </div>
      </div>

      {roleSwitchTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-switch-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label={isEn ? "Cancel" : "Avbryt"}
            onClick={() => setRoleSwitchTarget(null)}
          />
          <div className="relative z-[81] w-full max-w-sm rounded-2xl bg-background p-5 shadow-2xl">
            <h3 id="role-switch-title" className="text-base font-semibold">
              {roleSwitchTitle}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {isEn
                ? "Switching role signs you out. Log in again as the other role."
                : "Bytte av rolle logger deg ut. Logg inn igjen som den andre rollen."}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRoleSwitchTarget(null)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                {isEn ? "Cancel" : "Avbryt"}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = roleSwitchTarget
                  setRoleSwitchTarget(null)
                  onModeChange(next)
                }}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
              >
                {isEn ? "Log out" : "Logg ut"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
