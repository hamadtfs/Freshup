import { createAdminClient } from "@/lib/supabase/server"

export type ExpoPushMessage = {
  to: string
  title: string
  body: string
  data?: Record<string, unknown>
  sound?: "default" | null
  priority?: "default" | "normal" | "high"
  channelId?: string
}

type PushTicket = {
  status: "ok" | "error"
  id?: string
  message?: string
  details?: { error?: string }
}

/**
 * Best-effort Expo Push send. Never throws to callers — push must not
 * fail the primary API action (accept, chat, dispatch, etc.).
 */
export async function sendExpoPush(
  messages: ExpoPushMessage[],
): Promise<{ sent: number; errors: number }> {
  if (messages.length === 0) return { sent: 0, errors: 0 }

  const chunks: ExpoPushMessage[][] = []
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100))
  }

  let sent = 0
  let errors = 0
  const badTokens = new Set<string>()

  for (const chunk of chunks) {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      }
      const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim()
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`
      }

      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers,
        body: JSON.stringify(chunk),
      })

      if (!res.ok) {
        console.error(
          "[expo-push] HTTP",
          res.status,
          await res.text().catch(() => ""),
        )
        errors += chunk.length
        continue
      }

      const json = (await res.json()) as { data?: PushTicket[] }
      const tickets = Array.isArray(json.data) ? json.data : []
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i]
        const token = chunk[i]?.to
        if (ticket?.status === "ok") {
          sent += 1
        } else {
          errors += 1
          const errCode = ticket?.details?.error
          if (
            token &&
            (errCode === "DeviceNotRegistered" ||
              errCode === "InvalidCredentials")
          ) {
            badTokens.add(token)
          }
          console.warn("[expo-push] ticket error", ticket?.message, errCode)
        }
      }
    } catch (e) {
      console.error("[expo-push] send failed", e)
      errors += chunk.length
    }
  }

  if (badTokens.size > 0) {
    try {
      const supabase = createAdminClient()
      await supabase
        .from("push_tokens")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in("token", [...badTokens])
    } catch (e) {
      console.error("[expo-push] deactivate tokens failed", e)
    }
  }

  return { sent, errors }
}

export async function getActivePushTokensForUsers(
  userIds: string[],
): Promise<Array<{ user_id: string; token: string; platform: string }>> {
  const ids = [...new Set(userIds.map((id) => String(id || "").trim()).filter(Boolean))]
  if (ids.length === 0) return []

  const supabase = createAdminClient()

  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, notification_opt_in")
    .in("id", ids)

  if (profileErr) {
    console.error("[expo-push] profiles lookup", profileErr)
    return []
  }

  const optedOut = new Set(
    (profiles || [])
      .filter((p) => p.notification_opt_in === false)
      .map((p) => String(p.id)),
  )
  const allowed = ids.filter((id) => !optedOut.has(id))
  if (allowed.length === 0) return []

  const { data, error } = await supabase
    .from("push_tokens")
    .select("user_id, token, platform")
    .in("user_id", allowed)
    .eq("is_active", true)

  if (error) {
    console.error("[expo-push] tokens lookup", error)
    return []
  }

  return (data || []).map((row) => ({
    user_id: String(row.user_id),
    token: String(row.token),
    platform: String(row.platform || "android"),
  }))
}

export async function notifyUsers(params: {
  userIds: string[]
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    const tokens = await getActivePushTokensForUsers(params.userIds)
    if (tokens.length === 0) return

    const messages: ExpoPushMessage[] = tokens.map((t) => ({
      to: t.token,
      title: params.title,
      body: params.body,
      data: params.data,
      sound: "default",
      priority: "high",
      channelId: t.platform === "android" ? "default" : undefined,
    }))

    await sendExpoPush(messages)
  } catch (e) {
    console.error("[expo-push] notifyUsers", e)
  }
}
