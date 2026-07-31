"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"
import {
  getCachedOrderConversation,
  listChatMessages,
  openOrderConversation,
} from "@/lib/chat/client"
import { playIncomingMessageBell } from "@/lib/chat/notification-sound"
import type { ChatUiMessage } from "@/lib/chat/message"

const POLL_MS = 4000
const readKey = (orderId: string) => `freshup.order-chat.lastReadAt.${orderId}`

function removeUnreadChannels(conversationId: string) {
  const supabase = createBrowserSupabaseClient() as any
  const marker = `order-chat-unread:${conversationId}`
  for (const ch of supabase.getChannels()) {
    if (String(ch.topic || "").includes(marker)) {
      void supabase.removeChannel(ch)
    }
  }
}

/**
 * Background unread counter for active-order chat while the sheet is closed.
 */
export function useOrderChatUnread(options: {
  orderId: string | null
  language: "no" | "en"
  enabled: boolean
  /** When true, treat conversation as read and clear badge. */
  chatOpen: boolean
}) {
  const { orderId, language, enabled, chatOpen } = options
  const [unreadCount, setUnreadCount] = useState(0)
  const myUserIdRef = useRef<string | null>(null)
  const tokenRef = useRef<string | null>(null)
  const lastReadAtRef = useRef(0)
  const conversationIdRef = useRef<string | null>(null)
  const knownIdsRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)
  const chatOpenRef = useRef(chatOpen)
  chatOpenRef.current = chatOpen

  const recompute = useCallback((messages: ChatUiMessage[]) => {
    const me = myUserIdRef.current
    if (!me) return
    let count = 0
    for (const msg of messages) {
      if (msg.sender === "me" || msg.senderId === me) continue
      if (msg.at > lastReadAtRef.current) count += 1
    }
    setUnreadCount(count)
  }, [])

  const markRead = useCallback(async () => {
    const now = Date.now()
    lastReadAtRef.current = now
    setUnreadCount(0)
    if (!orderId || typeof window === "undefined") return
    try {
      localStorage.setItem(readKey(orderId), String(now))
    } catch {
      // ignore
    }
  }, [orderId])

  useEffect(() => {
    if (chatOpen) {
      void markRead()
    }
  }, [chatOpen, markRead])

  useEffect(() => {
    if (!enabled || !orderId) {
      setUnreadCount(0)
      conversationIdRef.current = null
      primedRef.current = false
      knownIdsRef.current = new Set()
      return
    }

    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null
    primedRef.current = false
    knownIdsRef.current = new Set()
    const supabase = createBrowserSupabaseClient() as any

    void (async () => {
      try {
        if (typeof window !== "undefined") {
          try {
            const stored = localStorage.getItem(readKey(orderId))
            const parsed = stored ? Number(stored) : 0
            lastReadAtRef.current = Number.isFinite(parsed) ? parsed : 0
          } catch {
            lastReadAtRef.current = 0
          }
        }

        const { data } = await supabase.auth.getSession()
        const userId = data.session?.user?.id as string | undefined
        const token = data.session?.access_token as string | undefined
        if (!userId || !token || cancelled) return
        myUserIdRef.current = userId
        tokenRef.current = token

        const opened = await openOrderConversation({
          token,
          orderId,
          language,
        })
        if (cancelled || !opened.conversation_id) return
        conversationIdRef.current = opened.conversation_id

        for (const msg of opened.messages) {
          knownIdsRef.current.add(msg.id)
        }
        recompute(opened.messages)
        primedRef.current = true

        const cid = opened.conversation_id
        removeUnreadChannels(cid)
        if (typeof supabase.realtime?.setAuth === "function") {
          void supabase.realtime.setAuth(token)
        }

        try {
          const channel = supabase
            .channel(`order-chat-unread:${cid}:${Date.now()}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "messages",
                filter: `conversation_id=eq.${cid}`,
              },
              (payload: {
                new?: {
                  id?: string
                  sender_id?: string
                  sent_at?: string
                }
              }) => {
                const row = payload.new
                if (!row?.id || !row.sender_id || !row.sent_at) return
                if (knownIdsRef.current.has(row.id)) return
                knownIdsRef.current.add(row.id)
                const me = myUserIdRef.current
                if (!me || row.sender_id === me) return
                const at = new Date(row.sent_at).getTime()
                if (!Number.isFinite(at) || at <= lastReadAtRef.current) return
                if (primedRef.current && !chatOpenRef.current) {
                  playIncomingMessageBell(row.id)
                }
                setUnreadCount((n) => n + 1)
              },
            )
          channel.subscribe()
        } catch {
          // polling still works
        }

        pollTimer = setInterval(() => {
          const cidNow =
            conversationIdRef.current || getCachedOrderConversation(orderId)
          const tok = tokenRef.current
          if (!cidNow || !tok) return
          void listChatMessages({
            token: tok,
            conversationId: cidNow,
            language,
          })
            .then((listed) => {
              if (cancelled) return
              for (const msg of listed.messages) knownIdsRef.current.add(msg.id)
              recompute(listed.messages)
            })
            .catch(() => {})
        }, POLL_MS)
      } catch {
        // best effort — badge stays at 0
      }
    })()

    return () => {
      cancelled = true
      primedRef.current = false
      if (pollTimer) clearInterval(pollTimer)
      const cid = conversationIdRef.current
      if (cid) removeUnreadChannels(cid)
    }
  }, [enabled, language, orderId, recompute])

  return { unreadCount, markRead }
}
