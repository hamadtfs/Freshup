/** Session gate so OTP/OAuth during provider signup does not jump into the main app. */

export const PROVIDER_SIGNUP_IN_PROGRESS_KEY =
  "freshup.provider.signup.inProgress";

export const PROVIDER_SIGNUP_RESUME_STEP_KEY =
  "freshup.provider.signup.resumeStep";

export type ProviderSignupResumeStep =
  | "phone"
  | "otp"
  | "profile"
  | "payment"
  | "services";

export function isProviderSignupInProgress(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(PROVIDER_SIGNUP_IN_PROGRESS_KEY) === "1";
}

export function beginProviderSignupInProgress(
  resumeStep: ProviderSignupResumeStep = "phone",
) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PROVIDER_SIGNUP_IN_PROGRESS_KEY, "1");
  sessionStorage.setItem(PROVIDER_SIGNUP_RESUME_STEP_KEY, resumeStep);
}

export function setProviderSignupResumeStep(
  step: ProviderSignupResumeStep,
) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(PROVIDER_SIGNUP_RESUME_STEP_KEY, step);
}

export function peekProviderSignupResumeStep(): ProviderSignupResumeStep | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(PROVIDER_SIGNUP_RESUME_STEP_KEY);
  if (
    raw === "phone" ||
    raw === "otp" ||
    raw === "profile" ||
    raw === "payment" ||
    raw === "services"
  ) {
    return raw;
  }
  return null;
}

export function clearProviderSignupInProgress() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PROVIDER_SIGNUP_IN_PROGRESS_KEY);
  sessionStorage.removeItem(PROVIDER_SIGNUP_RESUME_STEP_KEY);
}
