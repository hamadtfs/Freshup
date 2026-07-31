/** Deduplicate concurrent open-support-chat calls (React Strict Mode). */
const inflightByUser = new Map<string, Promise<{ conversation_id: string }>>()

export async function openSupportConversation(options: {
  token: string
  userId: string
  role: "customer" | "provider"
}): Promise<{ conversation_id: string; error?: string }> {
  const key = `${options.userId}:${options.role}`
  const existing = inflightByUser.get(key)
  if (existing) {
    try {
      const result = await existing
      return { conversation_id: result.conversation_id }
    } catch (e) {
      return {
        conversation_id: "",
        error: e instanceof Error ? e.message : "Failed to open support chat",
      }
    }
  }

  const promise = (async () => {
    const openRes = await fetch("/api/support/conversation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({ role: options.role }),
    })
    const openJson = (await openRes.json().catch(() => ({}))) as {
      conversation_id?: string
      error?: string
    }
    if (!openRes.ok || !openJson.conversation_id) {
      throw new Error(openJson.error || "Failed to open support chat")
    }
    return { conversation_id: openJson.conversation_id }
  })()

  inflightByUser.set(key, promise)
  try {
    const result = await promise
    return { conversation_id: result.conversation_id }
  } catch (e) {
    return {
      conversation_id: "",
      error: e instanceof Error ? e.message : "Failed to open support chat",
    }
  } finally {
    inflightByUser.delete(key)
  }
}
