export type ChatUiMessage = {
  id: string
  text: string
  sender: "me" | "other"
  time: string
  at: number
  senderId: string
}

export function formatChatMessageTime(
  iso: string,
  language: "no" | "en" = "no",
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString(language === "en" ? "en-GB" : "nb-NO", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function mapDbMessageToUi(
  row: {
    id: string
    body: string
    sender_id: string
    sent_at: string
  },
  myUserId: string,
  language: "no" | "en" = "no",
): ChatUiMessage {
  const at = new Date(row.sent_at).getTime()
  return {
    id: row.id,
    text: row.body,
    sender: row.sender_id === myUserId ? "me" : "other",
    time: formatChatMessageTime(row.sent_at, language),
    at: Number.isFinite(at) ? at : Date.now(),
    senderId: row.sender_id,
  }
}
