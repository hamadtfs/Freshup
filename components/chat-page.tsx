"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, Send, User } from "lucide-react"
import type { ChatUiMessage } from "@/lib/chat/message"
import { openOrderConversation } from "@/lib/chat/client"
import {
  getSessionAuth,
  useConversationMessages,
} from "@/lib/chat/use-conversation-messages"

interface ChatPageProps {
  onBack: () => void
  otherPartyName: string
  otherPartyAvatar?: string
  language?: "no" | "en"
  orderId?: string | null
}

export default function ChatPage({
  onBack,
  otherPartyName,
  language = "no",
  orderId = null,
}: ChatPageProps) {
  const isEn = language === "en"
  const [newMessage, setNewMessage] = useState("")
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [initialMessages, setInitialMessages] = useState<ChatUiMessage[] | null>(
    null,
  )
  const [bootLoading, setBootLoading] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const {
    messages,
    loading: messagesLoading,
    error: messagesError,
    setError,
    sendOptimistic,
  } = useConversationMessages({
    conversationId,
    language,
    enabled: !!conversationId,
    channelPrefix: "order-chat-page",
    initialMessages,
  })

  useEffect(() => {
    let cancelled = false

    async function boot() {
      if (!orderId) {
        setConversationId(null)
        setInitialMessages(null)
        setBootError(null)
        return
      }
      setBootLoading(true)
      setBootError(null)
      try {
        const auth = await getSessionAuth()
        if (!auth) {
          if (!cancelled) {
            setBootError(isEn ? "Please sign in again." : "Logg inn på nytt.")
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
  }, [isEn, language, orderId])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const loading = bootLoading || (messagesLoading && messages.length === 0)
  const error = bootError || messagesError

  const sendMessage = () => {
    const text = newMessage.trim()
    if (!text || !conversationId) return
    setNewMessage("")
    setError(null)
    setBootError(null)
    void (async () => {
      const result = await sendOptimistic(text)
      if (!result.ok) {
        setBootError(
          result.error ||
            (isEn ? "Could not send message." : "Kunne ikke sende melding."),
        )
        setNewMessage(text)
      }
    })()
  }

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 pt-14 pb-4 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center"
        >
          <ChevronLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
          <User className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {otherPartyName}
          </p>
          <p className="text-xs text-muted-foreground">
            {loading
              ? isEn
                ? "Connecting..."
                : "Kobler til..."
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

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {isEn ? "Loading messages..." : "Laster meldinger..."}
          </p>
        ) : error && messages.length === 0 ? (
          <p className="text-center text-sm text-red-600 py-8">{error}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {isEn
              ? "No messages yet. Say hello!"
              : "Ingen meldinger ennå. Si hei!"}
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
                "max-w-[75%] rounded-2xl px-4 py-2.5",
                msg.sender === "me"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted text-foreground rounded-bl-md",
              )}
            >
              <p className="text-sm whitespace-pre-wrap break-words">
                {msg.text}
              </p>
              <p
                className={cn(
                  "text-[10px] mt-1",
                  msg.sender === "me"
                    ? "text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                {msg.time}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pb-8 pt-2 border-t border-border space-y-2">
        {error && messages.length > 0 ? (
          <p className="text-xs text-red-600 px-1">{error}</p>
        ) : null}
        <div className="bg-muted rounded-full flex items-center p-1.5">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value.slice(0, 4000))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                sendMessage()
              }
            }}
            disabled={!conversationId || loading}
            placeholder={isEn ? "Write a message..." : "Skriv en melding..."}
            className="flex-1 bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => sendMessage()}
            disabled={!conversationId || loading || !newMessage.trim()}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-40",
              newMessage.trim() ? "bg-primary" : "bg-muted-foreground/20",
            )}
          >
            <Send
              className={cn(
                "h-5 w-5",
                newMessage.trim()
                  ? "text-primary-foreground"
                  : "text-muted-foreground",
              )}
            />
          </button>
        </div>
      </div>
    </main>
  )
}
