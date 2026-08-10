"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import type { ChatUiMessage } from "@/lib/chat/message"
import { listChatMessages, sendChatMessage } from "@/lib/chat/client"
import { playIncomingMessageBell } from "@/lib/chat/notification-sound"
import {
  createAdaptivePoll,
  isRealtimeDownStatus,
  REALTIME_CHAT_SAFETY_POLL_MS,
  type AdaptivePoll,
} from "@/lib/realtime/adaptive-poll"

const POLL_MS = 2500
const OPTIMISTIC_PREFIX = "opt-"

type UseConversationMessagesOptions = {
  conversationId: string | null
  language?: "no" | "en"
  enabled?: boolean
  channelPrefix: string
  /** Preloaded history from openOrderConversation — skips a second fetch. */
  initialMessages?: ChatUiMessage[] | null
}

async function getSessionAuth(): Promise<{
  token: string
  userId: string
} | null> {
  const supabase = createBrowserSupabaseClient() as any
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  const userId = data?.session?.user?.id
  if (!token || !userId) return null
  return { token, userId }
}

function formatTime(language: "no" | "en") {
  return new Date().toLocaleTimeString(language === "en" ? "en-GB" : "nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function useConversationMessages({
  conversationId,
  language = "no",
  enabled = true,
  channelPrefix,
  initialMessages = null,
}: UseConversationMessagesOptions) {
  const [messages, setMessages] = useState<ChatUiMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const myUserIdRef = useRef<string | null>(null)
  const tokenRef = useRef<string | null>(null)
  const conversationIdRef = useRef<string | null>(conversationId)
  const languageRef = useRef(language)
  const knownIncomingIdsRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)
  const initialMessagesRef = useRef<ChatUiMessage[] | null>(initialMessages)
  const usedInitialForConversationRef = useRef<string | null>(null)

  conversationIdRef.current = conversationId
  languageRef.current = language
  initialMessagesRef.current = initialMessages

  const notifyIncomingIfNeeded = useCallback((msg: ChatUiMessage) => {
    const me = myUserIdRef.current
    if (!me || msg.senderId === me || msg.sender === "me") return
    if (msg.id.startsWith(OPTIMISTIC_PREFIX)) return
    if (knownIncomingIdsRef.current.has(msg.id)) return
    knownIncomingIdsRef.current.add(msg.id)
    // Skip bells for the initial history load.
    if (!primedRef.current) return
    playIncomingMessageBell(msg.id)
  }, [])

  const absorbOptimisticDuplicates = useCallback(
    (incoming: ChatUiMessage, prev: ChatUiMessage[]) => {
      // Drop local optimistic bubbles that match a confirmed server message.
      return prev.filter((m) => {
        if (!m.id.startsWith(OPTIMISTIC_PREFIX)) return true
        if (m.senderId !== incoming.senderId) return true
        if (m.text !== incoming.text) return true
        return Math.abs(m.at - incoming.at) > 60_000
      })
    },
    [],
  )

  const mergeMessage = useCallback(
    (msg: ChatUiMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev
        const cleaned = absorbOptimisticDuplicates(msg, prev)
        return [...cleaned, msg].sort((a, b) => a.at - b.at)
      })
      notifyIncomingIfNeeded(msg)
    },
    [absorbOptimisticDuplicates, notifyIncomingIfNeeded],
  )

  const mergeMany = useCallback(
    (next: ChatUiMessage[]) => {
      setMessages((prev) => {
        let cleaned = prev
        for (const msg of next) {
          cleaned = absorbOptimisticDuplicates(msg, cleaned)
        }
        const byId = new Map(cleaned.map((m) => [m.id, m]))
        for (const msg of next) byId.set(msg.id, msg)
        return Array.from(byId.values()).sort((a, b) => a.at - b.at)
      })
      for (const msg of next) notifyIncomingIfNeeded(msg)
    },
    [absorbOptimisticDuplicates, notifyIncomingIfNeeded],
  )

  const refresh = useCallback(async () => {
    const cid = conversationIdRef.current
    const token = tokenRef.current
    if (!cid || !token) return
    const listed = await listChatMessages({
      token,
      conversationId: cid,
      language: languageRef.current,
    })
    if (!listed.error) mergeMany(listed.messages)
  }, [mergeMany])

  /** Show the bubble immediately, then confirm with the server. */
  const sendOptimistic = useCallback(
    async (text: string): Promise<{ ok: boolean; error?: string }> => {
      const trimmed = text.trim()
      const cid = conversationIdRef.current
      const token = tokenRef.current
      const userId = myUserIdRef.current
      if (!trimmed || !cid || !token || !userId) {
        return { ok: false, error: "Not ready" }
      }

      const tempId = `${OPTIMISTIC_PREFIX}${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`
      const optimistic: ChatUiMessage = {
        id: tempId,
        text: trimmed,
        sender: "me",
        time: formatTime(languageRef.current),
        at: Date.now(),
        senderId: userId,
      }
      setMessages((prev) => [...prev, optimistic])

      try {
        const result = await sendChatMessage({
          token,
          conversationId: cid,
          body: trimmed,
          language: languageRef.current,
        })
        if (!result.message) {
          setMessages((prev) => prev.filter((m) => m.id !== tempId))
          return {
            ok: false,
            error: result.error || "Failed to send message",
          }
        }
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId)
          if (withoutTemp.some((m) => m.id === result.message!.id)) {
            return withoutTemp
          }
          return [...withoutTemp, result.message!].sort((a, b) => a.at - b.at)
        })
        return { ok: true }
      } catch {
        setMessages((prev) => prev.filter((m) => m.id !== tempId))
        return { ok: false, error: "Failed to send message" }
      }
    },
    [],
  )

  useEffect(() => {
    if (!enabled || !conversationId) {
      if (!enabled) {
        // Allow preloaded messages to be applied again on next open.
        usedInitialForConversationRef.current = null
        primedRef.current = false
      }
      setLoading(false)
      setError(null)
      // Keep messages in memory for fast reopen while conversationId is warm.
      if (!conversationId) setMessages([])
      return
    }

    let cancelled = false
    let channel: { unsubscribe?: () => void } | null = null
    let poll: AdaptivePoll | null = null
    const supabase = createBrowserSupabaseClient() as any

    async function boot() {
      setLoading(true)
      setError(null)
      primedRef.current = false
      knownIncomingIdsRef.current = new Set()
      try {
        const auth = await getSessionAuth()
        if (!auth) {
          if (!cancelled) setError("Unauthorized")
          return
        }
        myUserIdRef.current = auth.userId
        tokenRef.current = auth.token

        // Prefer preloaded messages from open (one round-trip instead of two).
        const preloaded =
          usedInitialForConversationRef.current !== conversationId
            ? initialMessagesRef.current
            : null
        if (preloaded) {
          usedInitialForConversationRef.current = conversationId
          for (const msg of preloaded) {
            if (msg.sender !== "me") {
              knownIncomingIdsRef.current.add(msg.id)
            }
          }
          if (!cancelled) {
            setMessages(preloaded)
            primedRef.current = true
            setLoading(false)
          }
        } else {
          const listed = await listChatMessages({
            token: auth.token,
            conversationId,
            language,
          })
          if (listed.error) {
            if (!cancelled) setError(listed.error)
            return
          }
          if (!cancelled) {
            for (const msg of listed.messages) {
              if (msg.sender !== "me") {
                knownIncomingIdsRef.current.add(msg.id)
              }
            }
            setMessages(listed.messages)
            primedRef.current = true
          }
        }

        // Realtime auth + subscribe after UI already has history.
        if (typeof supabase.realtime?.setAuth === "function") {
          void supabase.realtime.setAuth(auth.token)
        }

        // Prefer realtime; start on the slow cadence so open chat does not
        // hammer /api/chat/messages before SUBSCRIBED arrives.
        poll = createAdaptivePoll({
          run: () => void refresh(),
          fallbackMs: POLL_MS,
          connectedMs: REALTIME_CHAT_SAFETY_POLL_MS,
          assumeConnected: true,
        })

        if (typeof supabase.channel === "function") {
          channel = supabase
            .channel(`${channelPrefix}:${conversationId}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "messages",
                filter: `conversation_id=eq.${conversationId}`,
              },
              (payload: {
                new?: {
                  id?: string
                  body?: string
                  sender_id?: string
                  sent_at?: string
                }
              }) => {
                const row = payload.new
                if (!row?.id || !row.body || !row.sender_id || !row.sent_at) {
                  return
                }
                const me = myUserIdRef.current
                if (!me) return
                const at = new Date(row.sent_at).getTime()
                mergeMessage({
                  id: row.id,
                  text: row.body,
                  sender: row.sender_id === me ? "me" : "other",
                  time: new Date(row.sent_at).toLocaleTimeString(
                    languageRef.current === "en" ? "en-GB" : "nb-NO",
                    { hour: "2-digit", minute: "2-digit" },
                  ),
                  at: Number.isFinite(at) ? at : Date.now(),
                  senderId: row.sender_id,
                })
              },
            )
            .subscribe((channelStatus: string) => {
              if (channelStatus === "SUBSCRIBED") {
                poll?.setRealtimeConnected(true)
              } else if (isRealtimeDownStatus(channelStatus)) {
                poll?.setRealtimeConnected(false)
              }
            })
        }
      } catch {
        if (!cancelled) setError("Failed to load messages")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void boot()
    return () => {
      cancelled = true
      poll?.stop()
      if (channel) {
        if (typeof supabase.removeChannel === "function") {
          void supabase.removeChannel(channel)
        } else {
          channel.unsubscribe?.()
        }
      }
    }
  }, [
    channelPrefix,
    conversationId,
    enabled,
    language,
    mergeMessage,
    refresh,
  ])

  return {
    messages,
    loading,
    error,
    setError,
    mergeMessage,
    sendOptimistic,
    refresh,
    myUserIdRef,
    tokenRef,
  }
}

export { getSessionAuth }
