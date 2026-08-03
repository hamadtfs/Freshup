import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { mapDbMessageToUi } from "@/lib/chat/message"
import { NextRequest, NextResponse } from "next/server"

async function assertParticipant(
  supabase: ReturnType<typeof createAdminClient>,
  conversationId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .is("left_at", null)
    .maybeSingle()

  if (error) throw error
  return !!data
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const conversationId = req.nextUrl.searchParams.get("conversation_id")?.trim()
    const language =
      req.nextUrl.searchParams.get("lang") === "en" ? "en" : "no"

    if (!conversationId) {
      return NextResponse.json(
        { error: "Missing conversation_id" },
        { status: 400 },
      )
    }

    const isParticipant = await assertParticipant(
      supabase,
      conversationId,
      userId,
    )
    if (!isParticipant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("messages")
      .select("id, body, sender_id, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true })
      .limit(200)

    if (error) throw error

    const messages = (data || []).map((row) =>
      mapDbMessageToUi(row, userId, language),
    )

    return NextResponse.json({ messages })
  } catch (error) {
    console.error("[chat/messages GET]", error)
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json()) as {
      conversation_id?: string
      body?: string
      lang?: string
    }

    const conversationId =
      typeof body.conversation_id === "string"
        ? body.conversation_id.trim()
        : ""
    const text = typeof body.body === "string" ? body.body.trim() : ""
    const language = body.lang === "en" ? "en" : "no"

    if (!conversationId) {
      return NextResponse.json(
        { error: "Missing conversation_id" },
        { status: 400 },
      )
    }
    if (!text) {
      return NextResponse.json({ error: "Message is empty" }, { status: 400 })
    }
    if (text.length > 4000) {
      return NextResponse.json(
        { error: "Message is too long" },
        { status: 400 },
      )
    }

    const isParticipant = await assertParticipant(
      supabase,
      conversationId,
      userId,
    )
    if (!isParticipant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        message_type: "text",
        body: text,
      })
      .select("id, body, sender_id, sent_at")
      .single()

    if (error) throw error

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)

    try {
      const [{ data: peers }, { data: conversation }] = await Promise.all([
        supabase
          .from("conversation_participants")
          .select("user_id")
          .eq("conversation_id", conversationId)
          .is("left_at", null)
          .neq("user_id", userId),
        supabase
          .from("conversations")
          .select("order_id, conversation_type")
          .eq("id", conversationId)
          .maybeSingle(),
      ])
      const recipientIds = (peers || [])
        .map((p) => String(p.user_id || "").trim())
        .filter(Boolean)
      if (recipientIds.length > 0) {
        const preview = text.length > 120 ? `${text.slice(0, 117)}...` : text
        const isSupport = conversation?.conversation_type === "support"
        void import("@/lib/notifications/expo-push").then(({ notifyUsers }) =>
          notifyUsers({
            userIds: recipientIds,
            title: isSupport ? "Support message" : "New message",
            body: preview,
            data: {
              type: isSupport ? "support_message" : "chat_message",
              conversation_id: conversationId,
              order_id: conversation?.order_id
                ? String(conversation.order_id)
                : undefined,
            },
          }),
        )
      }
    } catch (e) {
      console.error("[chat/messages] push notify", e)
    }

    return NextResponse.json({
      message: mapDbMessageToUi(data, userId, language),
    })
  } catch (error) {
    console.error("[chat/messages POST]", error)
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    )
  }
}
