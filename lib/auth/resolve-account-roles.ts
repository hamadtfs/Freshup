import type { DashboardMode } from "@/lib/auth/dashboard-mode";
import type { RoleGrantStatus } from "@/lib/auth/account-role-grants";

export type AccountRoles = {
  user_id: string;
  has_customer: boolean;
  has_provider: boolean;
  roles: DashboardMode[];
  /** Best role for this login (never invent customer when provider-only). */
  preferred: DashboardMode;
  /** Grant statuses (null = no grant row). */
  customer_status?: RoleGrantStatus | null;
  provider_status?: RoleGrantStatus | null;
  /** Both roles are active — mode switch allowed. */
  can_switch_modes?: boolean;
  /** Server JWT claim / prefered active app role when dual. */
  active_role?: DashboardMode | null;
  /** True when at least one provider_skills row exists. */
  provider_has_skills?: boolean;
};

export function rolesFromFlags(
  hasCustomer: boolean,
  hasProvider: boolean,
): DashboardMode[] {
  const roles: DashboardMode[] = [];
  if (hasCustomer) roles.push("customer");
  if (hasProvider) roles.push("provider");
  return roles;
}

/**
 * Pick dashboard mode from real account capabilities.
 * - Provider-only → provider
 * - Customer-only → customer
 * - Both → preferredIntent if valid, else stored, else metadata, else customer
 * - Neither (brand-new) → preferredIntent if provided, else customer
 */
export function pickDashboardMode(opts: {
  hasCustomer: boolean;
  hasProvider: boolean;
  preferredIntent?: DashboardMode | null;
  stored?: DashboardMode | null;
  metadataRole?: DashboardMode | null;
}): DashboardMode {
  const { hasCustomer, hasProvider } = opts;
  const intent = opts.preferredIntent ?? null;
  const stored = opts.stored ?? null;
  const meta = opts.metadataRole ?? null;

  if (hasProvider && !hasCustomer) return "provider";
  if (hasCustomer && !hasProvider) return "customer";
  if (hasProvider && hasCustomer) {
    if (intent === "provider" || intent === "customer") return intent;
    if (meta === "provider" || meta === "customer") return meta;
    if (stored === "provider" || stored === "customer") return stored;
    return "customer";
  }

  // No durable role rows yet — honor explicit signup/login intent only.
  if (intent === "provider" || intent === "customer") return intent;
  if (meta === "provider") return "provider";
  return "customer";
}

/** Provider grant exists but skills/onboarding was never finished. */
export function isProviderSignupIncomplete(
  roles: Pick<AccountRoles, "has_provider" | "provider_has_skills"> | null,
): boolean {
  return Boolean(roles?.has_provider && !roles.provider_has_skills);
}

export function metadataRoleFromUser(user: {
  user_metadata?: { app_role?: unknown } | null;
  app_metadata?: { app_role?: unknown; active_role?: unknown } | null;
} | null): DashboardMode | null {
  const active = user?.app_metadata?.active_role;
  if (active === "provider" || active === "customer") return active;
  const raw =
    user?.user_metadata?.app_role ?? user?.app_metadata?.app_role ?? null;
  if (raw === "provider" || raw === "customer") return raw;
  return null;
}
