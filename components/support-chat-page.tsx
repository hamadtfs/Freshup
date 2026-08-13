"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { ChevronLeft, Headphones, Send } from "lucide-react"
import { openSupportConversation } from "@/lib/support/open-conversation"
import {
  getSessionAuth,
  useConversationMessages,
} from "@/lib/chat/use-conversation-messages"
import {
  loginToContinueCopy,
  mapAuthGateCopy,
} from "@/lib/auth/login-required-copy"

interface SupportChatPageProps {
  onBack: () => void
  language?: "no" | "en"
  userRole?: "customer" | "provider"
}

export default function SupportChatPage({
  onBack,
  language = "no",
  userRole = "customer",
}: SupportChatPageProps) {
  const isEn = language === "en"
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [newMessage, setNewMessage] = useState("")
  const [bootLoading, setBootLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const title = isEn ? "Fresh Up Support" : "Fresh Up kundeservice"
  const subtitle = useMemo(
    () =>
      userRole === "provider"
        ? isEn
          ? "Provider support"
          : "Tilbyder-støtte"
        : isEn
          ? "Customer support"
          : "Kundestøtte",
    [isEn, userRole],
  )

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
    channelPrefix: "support-chat",
  })

  useEffect(() => {
    let cancelled = false

    async function boot() {
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

        const opened = await openSupportConversation({
          token: auth.token,
          userId: auth.userId,
          role: userRole,
        })
        if (!opened.conversation_id) {
          if (!cancelled) {
            setBootError(
              mapAuthGateCopy(
                opened.error ||
                  (isEn
                    ? "Could not open support chat."
                    : "Kunne ikke åpne supportchat."),
                isEn,
                undefined,
                "continue",
              ) || loginToContinueCopy(isEn),
            )
          }
          return
        }
        if (!cancelled) setConversationId(opened.conversation_id)
      } catch {
        if (!cancelled) {
          setBootError(
            isEn
              ? "Could not open support chat."
              : "Kunne ikke åpne supportchat.",
          )
        }
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [isEn, userRole])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages])

  const loading = bootLoading || messagesLoading
  const rawError = bootError || messagesError
  const error = rawError
    ? mapAuthGateCopy(rawError, isEn, undefined, "continue") || rawError
    : null

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
          <Headphones className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
      >
        {loading ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {isEn ? "Opening chat..." : "Åpner chat..."}
          </p>
        ) : error && messages.length === 0 ? (
          <p className="text-center text-sm text-red-600 py-8">{error}</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            {isEn
              ? "No messages yet. Tell us how we can help."
              : "Ingen meldinger ennå. Fortell oss hvordan vi kan hjelpe."}
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
            disabled={loading || !conversationId}
            placeholder={isEn ? "Write a message..." : "Skriv en melding..."}
            className="flex-1 bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => sendMessage()}
            disabled={loading || !conversationId || !newMessage.trim()}
            className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-40",
              newMessage.trim() ? "bg-primary" : "bg-muted-foreground/20",
            )}
          >
            <Send
              className={cn(
                "h-4 w-4",
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
