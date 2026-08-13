import type { DashboardMode } from "@/lib/auth/dashboard-mode";

export async function claimSignupRole(
  role: DashboardMode,
  opts?: { accessToken?: string | null; apiBase?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts?.accessToken) {
      headers.Authorization = `Bearer ${opts.accessToken}`;
    }
    const base = (opts?.apiBase ?? "").replace(/\/$/, "");
    const res = await fetch(`${base}/api/auth/claim-signup-role`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: String(json.error || "claim_failed") };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "claim_failed",
    };
  }
}
