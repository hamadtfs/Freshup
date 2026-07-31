import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { NextRequest, NextResponse } from "next/server"

async function ensureProfile(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle()

  if (existing) return

  const { data: authUser } = await supabase.auth.admin.getUserById(userId)
  const email = authUser?.user?.email ?? null
  const phone = authUser?.user?.phone ?? null
  const displayName =
    (authUser?.user?.user_metadata?.full_name as string | undefined) ||
    (authUser?.user?.user_metadata?.name as string | undefined) ||
    null

  const { error } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      phone,
      display_name: displayName,
    },
    { onConflict: "id" },
  )
  if (error) throw error
}

async function findExistingSupportConversation(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string | null> {
  // Prefer creator lookup — works even if a concurrent request has not
  // inserted the participant row yet.
  const { data: byCreator, error: byCreatorError } = await supabase
    .from("conversations")
    .select("id")
    .eq("created_by", userId)
    .eq("conversation_type", "support")
    .is("order_id", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (byCreatorError) throw byCreatorError
  if (byCreator?.id) return String(byCreator.id)

  const { data: memberships, error: membershipError } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", userId)
    .is("left_at", null)

  if (membershipError) throw membershipError

  const candidateIds = (memberships || [])
    .map((row) => String(row.conversation_id || ""))
    .filter(Boolean)

  if (candidateIds.length === 0) return null

  const { data: supportConvs, error: supportError } = await supabase
    .from("conversations")
    .select("id")
    .eq("conversation_type", "support")
    .in("id", candidateIds)
    .order("created_at", { ascending: true })
    .limit(1)

  if (supportError) throw supportError
  return supportConvs?.[0]?.id ? String(supportConvs[0].id) : null
}

async function ensureParticipant(
  supabase: ReturnType<typeof createAdminClient>,
  conversationId: string,
  userId: string,
  roleId: string,
) {
  const { data: existing } = await supabase
    .from("conversation_participants")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle()

  if (existing) return

  const { error } = await supabase.from("conversation_participants").insert({
    conversation_id: conversationId,
    user_id: userId,
    role_id: roleId,
  })

  // Unique race: another request inserted the same participant.
  if (error && error.code !== "23505") throw error
}

async function findOpenTicketId(
  supabase: ReturnType<typeof createAdminClient>,
  userId: string,
  conversationId: string,
): Promise<string | null> {
  try {
    const { data: ticket } = await supabase
      .from("support_tickets")
      .select("id")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return ticket?.id ? String(ticket.id) : null
  } catch {
    return null
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { code?: string; message?: string }
  return (
    e.code === "23505" ||
    /duplicate key|uniq_support_conversation/i.test(String(e.message || ""))
  )
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      role?: string
    }
    const roleSlug = body.role === "provider" ? "provider" : "customer"

    await ensureProfile(supabase, userId)

    const { data: roleRow, error: roleError } = await supabase
      .from("roles")
      .select("id")
      .eq("slug", roleSlug)
      .maybeSingle()

    if (roleError) throw roleError
    if (!roleRow?.id) {
      return NextResponse.json(
        { error: `Role "${roleSlug}" is not configured` },
        { status: 500 },
      )
    }

    const existingId = await findExistingSupportConversation(supabase, userId)
    if (existingId) {
      await ensureParticipant(supabase, existingId, userId, roleRow.id)
      const ticketId = await findOpenTicketId(supabase, userId, existingId)
      return NextResponse.json({
        conversation_id: existingId,
        ticket_id: ticketId,
        created: false,
      })
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .insert({
        conversation_type: "support",
        created_by: userId,
        order_id: null,
      })
      .select("id")
      .single()

    if (convError) {
      if (isUniqueViolation(convError)) {
        const racedId = await findExistingSupportConversation(supabase, userId)
        if (racedId) {
          await ensureParticipant(supabase, racedId, userId, roleRow.id)
          const ticketId = await findOpenTicketId(supabase, userId, racedId)
          return NextResponse.json({
            conversation_id: racedId,
            ticket_id: ticketId,
            created: false,
          })
        }
      }
      throw convError
    }

    await ensureParticipant(supabase, conversation.id, userId, roleRow.id)

    const subject =
      roleSlug === "provider" ? "Provider support chat" : "Customer support chat"
    const description =
      roleSlug === "provider"
        ? "Provider opened in-app support chat"
        : "Customer opened in-app support chat"

    let ticketId: string | null = null
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .insert({
        user_id: userId,
        subject,
        description,
        status: "open",
        priority: "normal",
        conversation_id: conversation.id,
      })
      .select("id")
      .maybeSingle()

    if (ticketError) {
      console.warn("[support/conversation] ticket insert:", ticketError.message)
    } else {
      ticketId = ticket?.id ?? null
    }

    return NextResponse.json({
      conversation_id: conversation.id,
      ticket_id: ticketId,
      created: true,
    })
  } catch (error) {
    console.error("[support/conversation]", error)
    return NextResponse.json(
      { error: "Failed to open support chat" },
      { status: 500 },
    )
  }
}
