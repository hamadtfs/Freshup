import type { ChatUiMessage } from "@/lib/chat/message"

const inflightOpen = new Map<
  string,
  Promise<{ conversation_id: string; messages: ChatUiMessage[] }>
>()
const conversationCache = new Map<string, string>()

function cacheKey(orderId: string) {
  return `freshup.order-chat.conversation.${orderId}`
}

export function rememberOrderConversation(orderId: string, conversationId: string) {
  if (!orderId || !conversationId) return
  conversationCache.set(orderId, conversationId)
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(cacheKey(orderId), conversationId)
    } catch {
      // ignore quota / private mode
    }
  }
}

export function getCachedOrderConversation(orderId: string): string | null {
  const mem = conversationCache.get(orderId)
  if (mem) return mem
  if (typeof window === "undefined") return null
  try {
    const stored = sessionStorage.getItem(cacheKey(orderId))
    if (stored) {
      conversationCache.set(orderId, stored)
      return stored
    }
  } catch {
    // ignore
  }
  return null
}

async function authHeaders(token: string): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }
}

export async function openOrderConversation(options: {
  token: string
  orderId: string
  language?: "no" | "en"
}): Promise<{
  conversation_id: string
  messages: ChatUiMessage[]
  error?: string
}> {
  const key = `${options.orderId}:${options.language === "en" ? "en" : "no"}`
  const existing = inflightOpen.get(key)
  if (existing) {
    try {
      return await existing
    } catch (e) {
      return {
        conversation_id: "",
        messages: [],
        error: e instanceof Error ? e.message : "Failed to open chat",
      }
    }
  }

  const promise = (async () => {
    const res = await fetch("/api/chat/order-conversation", {
      method: "POST",
      headers: await authHeaders(options.token),
      body: JSON.stringify({
        order_id: options.orderId,
        lang: options.language === "en" ? "en" : "no",
      }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      conversation_id?: string
      messages?: ChatUiMessage[]
      error?: string
    }
    if (!res.ok || !json.conversation_id) {
      throw new Error(json.error || "Failed to open chat")
    }
    rememberOrderConversation(options.orderId, json.conversation_id)
    return {
      conversation_id: json.conversation_id,
      messages: Array.isArray(json.messages) ? json.messages : [],
    }
  })()

  inflightOpen.set(key, promise)
  try {
    return await promise
  } catch (e) {
    return {
      conversation_id: "",
      messages: [],
      error: e instanceof Error ? e.message : "Failed to open chat",
    }
  } finally {
    inflightOpen.delete(key)
  }
}

export async function listChatMessages(options: {
  token: string
  conversationId: string
  language?: "no" | "en"
}): Promise<{ messages: ChatUiMessage[]; error?: string }> {
  const url = new URL("/api/chat/messages", window.location.origin)
  url.searchParams.set("conversation_id", options.conversationId)
  url.searchParams.set("lang", options.language === "en" ? "en" : "no")
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${options.token}` },
    cache: "no-store",
  })
  const json = (await res.json().catch(() => ({}))) as {
    messages?: ChatUiMessage[]
    error?: string
  }
  if (!res.ok) {
    return { messages: [], error: json.error || "Failed to load messages" }
  }
  return { messages: Array.isArray(json.messages) ? json.messages : [] }
}

export async function sendChatMessage(options: {
  token: string
  conversationId: string
  body: string
  language?: "no" | "en"
}): Promise<{ message?: ChatUiMessage; error?: string }> {
  const res = await fetch("/api/chat/messages", {
    method: "POST",
    headers: await authHeaders(options.token),
    body: JSON.stringify({
      conversation_id: options.conversationId,
      body: options.body,
      lang: options.language === "en" ? "en" : "no",
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    message?: ChatUiMessage
    error?: string
  }
  if (!res.ok || !json.message) {
    return { error: json.error || "Failed to send message" }
  }
  return { message: json.message }
}
