const KEY = "freshup.need_provider_login"

export function peekNeedProviderLogin(): boolean {
  if (typeof window === "undefined") return false
  try {
    return sessionStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
}

export function setNeedProviderLogin() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.setItem(KEY, "1")
  } catch {
    /* ignore */
  }
}

export function clearNeedProviderLogin() {
  if (typeof window === "undefined") return
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
