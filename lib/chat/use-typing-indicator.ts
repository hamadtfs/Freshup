"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createBrowserSupabaseClient } from "@/lib/supabase/client"

const TYPING_IDLE_MS = 2200
const TYPING_EVENT = "typing"

type TypingPayload = {
  userId?: string
  typing?: boolean
}

/** Ephemeral typing indicator via Supabase Realtime broadcast. */
export function useTypingIndicator(options: {
  conversationId: string | null
  enabled?: boolean
  myUserId?: string | null
}) {
  const { conversationId, enabled = true, myUserId = null } = options
  const [otherTyping, setOtherTyping] = useState(false)
  const channelRef = useRef<any>(null)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remoteIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentTypingRef = useRef(false)
  const myUserIdRef = useRef(myUserId)

  myUserIdRef.current = myUserId

  const clearRemoteIdle = () => {
    if (remoteIdleTimerRef.current) {
      clearTimeout(remoteIdleTimerRef.current)
      remoteIdleTimerRef.current = null
    }
  }

  const clearLocalIdle = () => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }

  const broadcastTyping = useCallback(async (typing: boolean) => {
    const channel = channelRef.current
    const uid = myUserIdRef.current
    if (!channel || !uid) return
    if (lastSentTypingRef.current === typing) return
    lastSentTypingRef.current = typing
    try {
      await channel.send({
        type: "broadcast",
        event: TYPING_EVENT,
        payload: { userId: uid, typing } satisfies TypingPayload,
      })
    } catch {
      // best effort
    }
  }, [])

  const setLocalTyping = useCallback(
    (typing: boolean) => {
      clearLocalIdle()
      if (!typing) {
        void broadcastTyping(false)
        return
      }
      void broadcastTyping(true)
      idleTimerRef.current = setTimeout(() => {
        void broadcastTyping(false)
      }, TYPING_IDLE_MS)
    },
    [broadcastTyping],
  )

  const onDraftChange = useCallback(
    (text: string) => {
      setLocalTyping(text.trim().length > 0)
    },
    [setLocalTyping],
  )

  useEffect(() => {
    clearLocalIdle()
    clearRemoteIdle()
    setOtherTyping(false)
    lastSentTypingRef.current = false

    if (!enabled || !conversationId || !myUserId) {
      if (channelRef.current) {
        const supabase = createBrowserSupabaseClient() as any
        void supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      return
    }

    let cancelled = false
    const supabase = createBrowserSupabaseClient() as any
    const topic = `chat-typing:${conversationId}`

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession()
        const token = data?.session?.access_token
        if (token && typeof supabase.realtime?.setAuth === "function") {
          void supabase.realtime.setAuth(token)
        }
      } catch {
        // continue
      }
      if (cancelled) return

      const channel = supabase
        .channel(topic, {
          config: { broadcast: { self: false } },
        })
        .on(
          "broadcast",
          { event: TYPING_EVENT },
          ({ payload }: { payload: TypingPayload }) => {
            const uid = String(payload?.userId || "")
            if (!uid || uid === myUserIdRef.current) return
            clearRemoteIdle()
            if (payload?.typing) {
              setOtherTyping(true)
              remoteIdleTimerRef.current = setTimeout(() => {
                setOtherTyping(false)
              }, TYPING_IDLE_MS + 400)
            } else {
              setOtherTyping(false)
            }
          },
        )

      channel.subscribe()
      channelRef.current = channel
    })()

    return () => {
      cancelled = true
      clearLocalIdle()
      clearRemoteIdle()
      void broadcastTyping(false)
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
      setOtherTyping(false)
      lastSentTypingRef.current = false
    }
  }, [broadcastTyping, conversationId, enabled, myUserId])

  return { otherTyping, onDraftChange, setLocalTyping }
}
