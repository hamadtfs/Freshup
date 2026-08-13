"use client"

import { useEffect, useRef, useState, type ComponentType } from "react"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import type { ChatUiMessage } from "@/lib/chat/message"
import { openOrderConversation } from "@/lib/chat/client"
import {
  getSessionAuth,
  useConversationMessages,
} from "@/lib/chat/use-conversation-messages"
import { loginToContinueCopy } from "@/lib/auth/login-required-copy"
import { useTypingIndicator } from "@/lib/chat/use-typing-indicator"

type AvatarProps = {
  avatarUrl?: string | null
  name: string
  className?: string
  iconClassName?: string
}

interface OrderChatModalProps {
  open: boolean
  onClose: () => void
  orderId: string | null
  language?: "no" | "en"
  otherPartyName: string
  otherPartyAvatarUrl?: string | null
  quickMessages?: string[]
  AvatarComponent: ComponentType<AvatarProps>
}

export default function OrderChatModal({
  open,
  onClose,
  orderId,
  language = "no",
  otherPartyName,
  otherPartyAvatarUrl,
  quickMessages = [],
  AvatarComponent,
}: OrderChatModalProps) {
  const isEn = language === "en"
  const [draft, setDraft] = useState("")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [initialMessages, setInitialMessages] = useState<ChatUiMessage[] | null>(
    null,
  )
  const [bootLoading, setBootLoading] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const {
    messages,
    loading: messagesLoading,
    error: messagesError,
    setError,
    sendOptimistic,
  } = useConversationMessages({
    conversationId: open ? conversationId : null,
    language,
    enabled: open,
    channelPrefix: "order-chat-modal",
    initialMessages: open ? initialMessages : null,
  })

  const { otherTyping, onDraftChange, setLocalTyping } = useTypingIndicator({
    conversationId: open ? conversationId : null,
    enabled: open && Boolean(conversationId),
    myUserId,
  })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void getSessionAuth().then((auth) => {
      if (!cancelled && auth?.userId) setMyUserId(auth.userId)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setBootError(null)
      setBootLoading(false)
      // Keep conversationId + messages warm for fast reopen.
      return
    }

    let cancelled = false

    async function boot() {
      if (!orderId) {
        setConversationId(null)
        setInitialMessages(null)
        setBootError(isEn ? "No active order" : "Ingen aktiv ordre")
        return
      }
      // Already loaded this order's thread — skip network.
      if (conversationId && initialMessages) {
        return
      }
      setBootLoading(true)
      setBootError(null)
      try {
        const auth = await getSessionAuth()
        if (!auth) {
          if (!cancelled) {
            setBootError(loginToContinueCopy(isEn))
          }
          return
        }
        const opened = await openOrderConversation({
          token: auth.token,
          orderId,
          language,
        })
        if (!opened.conversation_id) {
          if (!cancelled) {
            setBootError(
              opened.error ||
                (isEn ? "Could not open chat." : "Kunne ikke åpne chat."),
            )
          }
          return
        }
        if (!cancelled) {
          setInitialMessages(opened.messages)
          setConversationId(opened.conversation_id)
        }
      } catch {
        if (!cancelled) {
          setBootError(isEn ? "Could not open chat." : "Kunne ikke åpne chat.")
        }
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [conversationId, initialMessages, isEn, language, open, orderId])

  // Reset when the active order changes.
  useEffect(() => {
    setConversationId(null)
    setInitialMessages(null)
  }, [orderId])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, otherTyping])

  const loading = bootLoading || (messagesLoading && messages.length === 0)
  const error = bootError || messagesError

  const send = (textOverride?: string) => {
    const text = (textOverride ?? draft).trim()
    if (!text || !conversationId) return
    if (!textOverride) setDraft("")
    setLocalTyping(false)
    setError(null)
    setBootError(null)
    void (async () => {
      const result = await sendOptimistic(text)
      if (!result.ok) {
        setBootError(
          result.error ||
            (isEn ? "Could not send message." : "Kunne ikke sende melding."),
        )
        if (!textOverride) setDraft(text)
      }
    })()
  }

  if (!open) return null

  return (
    <div className="absolute inset-0 z-50 bg-black/50 flex items-end">
      <div className="w-full bg-white rounded-t-3xl max-h-[70vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <AvatarComponent
              avatarUrl={otherPartyAvatarUrl}
              name={otherPartyName}
              className="w-9 h-9"
              iconClassName="h-4 w-4"
            />
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">
                {otherPartyName}
              </h3>
              <p className="text-xs text-gray-500">
                {loading
                  ? isEn
                    ? "Connecting..."
                    : "Kobler til..."
                  : otherTyping
                    ? isEn
                      ? "Typing..."
                      : "Skriver..."
                    : orderId
                      ? isEn
                        ? "Order chat"
                        : "Ordrechat"
                      : isEn
                        ? "No active order"
                        : "Ingen aktiv ordre"}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
            onClick={onClose}
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[120px]"
        >
          {loading ? (
            <p className="text-xs text-gray-500 text-center py-4">
              {isEn ? "Loading..." : "Laster..."}
            </p>
          ) : error && messages.length === 0 ? (
            <p className="text-xs text-red-600 text-center py-4">{error}</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              {isEn ? "No messages yet" : "Ingen meldinger ennå"}
            </p>
          ) : null}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex",
                msg.sender === "me" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  msg.sender === "me"
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-900",
                )}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {otherTyping ? (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl rounded-bl-md px-3 py-2.5 flex items-center gap-1">
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:0ms]" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:150ms]" />
                <span className="typing-dot h-1.5 w-1.5 rounded-full bg-gray-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          ) : null}
        </div>

        {quickMessages.length > 0 ? (
          <div className="px-4 pb-2 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-600 py-2">
              {isEn ? "Quick messages" : "Hurtigmeldinger"}
            </p>
            <div className="flex flex-wrap gap-2 pb-2 max-h-24 overflow-y-auto">
              {quickMessages.map((message, index) => (
                <button
                  key={index}
                  type="button"
                  disabled={!conversationId}
                  className="bg-gray-100 hover:bg-gray-200 rounded-full px-3 py-1 text-xs text-gray-700 disabled:opacity-40"
                  onClick={() => send(message)}
                >
                  {message.length > 28
                    ? `${message.substring(0, 28)}…`
                    : message}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="px-4 pb-6 pt-1 space-y-1">
          {error && messages.length > 0 ? (
            <p className="text-xs text-red-600 px-1">{error}</p>
          ) : null}
          <div className="bg-gray-100 rounded-full flex items-center p-1">
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                const next = e.target.value.slice(0, 4000)
                setDraft(next)
                onDraftChange(next)
              }}
              placeholder={
                isEn ? "Write a message..." : "Skriv en melding..."
              }
              disabled={!conversationId || loading}
              className="flex-1 bg-transparent px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button
              type="button"
              className="px-4 py-2 text-sm font-medium text-gray-800 disabled:opacity-40"
              disabled={!conversationId || !draft.trim()}
              onClick={() => send()}
            >
              {isEn ? "Send" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
