import { createAdminClient } from "@/lib/supabase/server"
import { getUserIdFromBearer } from "@/lib/supabase/route-user"
import { mapDbMessageToUi } from "@/lib/chat/message"
import { NextRequest, NextResponse } from "next/server"

type AdminClient = ReturnType<typeof createAdminClient>

const roleIdCache = new Map<string, string>()

async function ensureProfile(supabase: AdminClient, userId: string) {
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

async function roleIdForSlug(
  supabase: AdminClient,
  slug: "customer" | "provider",
): Promise<string | null> {
  const cached = roleIdCache.get(slug)
  if (cached) return cached

  const { data, error } = await supabase
    .from("roles")
    .select("id")
    .eq("slug", slug)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) return null
  const id = String(data.id)
  roleIdCache.set(slug, id)
  return id
}

async function ensureParticipant(
  supabase: AdminClient,
  conversationId: string,
  userId: string,
  roleId: string,
) {
  const { error } = await supabase.from("conversation_participants").upsert(
    {
      conversation_id: conversationId,
      user_id: userId,
      role_id: roleId,
    },
    { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
  )
  if (error && error.code !== "23505") throw error
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const e = error as { code?: string; message?: string }
  return (
    e.code === "23505" ||
    /duplicate key|uniq_order_conversation/i.test(String(e.message || ""))
  )
}

async function loadMessages(
  supabase: AdminClient,
  conversationId: string,
  userId: string,
  language: "no" | "en",
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, body, sender_id, sent_at")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true })
    .limit(200)
  if (error) throw error
  return (data || []).map((row) => mapDbMessageToUi(row, userId, language))
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient()
    const userId = await getUserIdFromBearer(supabase, req)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      order_id?: string
      lang?: string
    }
    const orderId =
      typeof body.order_id === "string" ? body.order_id.trim() : ""
    const language = body.lang === "en" ? "en" : "no"
    if (!orderId) {
      return NextResponse.json({ error: "Missing order_id" }, { status: 400 })
    }

    // Fast path: look up order + existing conversation in one round.
    const [{ data: order, error: orderError }, { data: existing, error: existingError }] =
      await Promise.all([
        supabase
          .from("orders")
          .select("id, customer_id, provider_id")
          .eq("id", orderId)
          .maybeSingle(),
        supabase
          .from("conversations")
          .select("id")
          .eq("conversation_type", "order")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ])

    if (orderError) throw orderError
    if (existingError) throw existingError
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 })
    }

    const customerId = order.customer_id ? String(order.customer_id) : ""
    const providerId = order.provider_id ? String(order.provider_id) : ""

    if (!customerId || !providerId) {
      return NextResponse.json(
        { error: "Order has no customer/provider pair yet" },
        { status: 422 },
      )
    }

    if (userId !== customerId && userId !== providerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let conversationId = existing?.id ? String(existing.id) : null
    let created = false

    if (conversationId) {
      // Existing thread: load messages immediately; backfill participants in parallel.
      const messagesPromise = loadMessages(
        supabase,
        conversationId,
        userId,
        language,
      )

      void (async () => {
        try {
          const [customerRoleId, providerRoleId] = await Promise.all([
            roleIdForSlug(supabase, "customer"),
            roleIdForSlug(supabase, "provider"),
          ])
          if (!customerRoleId || !providerRoleId) return
          await Promise.all([
            ensureParticipant(
              supabase,
              conversationId!,
              customerId,
              customerRoleId,
            ),
            ensureParticipant(
              supabase,
              conversationId!,
              providerId,
              providerRoleId,
            ),
          ])
        } catch {
          // Non-blocking backfill.
        }
      })()

      const messages = await messagesPromise
      return NextResponse.json({
        conversation_id: conversationId,
        order_id: orderId,
        created: false,
        messages,
      })
    }

    // Slow path: first open — ensure profiles/roles then create.
    const [, , customerRoleId, providerRoleId] = await Promise.all([
      ensureProfile(supabase, userId),
      Promise.all([
        ensureProfile(supabase, customerId),
        ensureProfile(supabase, providerId),
      ]),
      roleIdForSlug(supabase, "customer"),
      roleIdForSlug(supabase, "provider"),
    ])

    if (!customerRoleId || !providerRoleId) {
      return NextResponse.json(
        { error: "Chat roles are not configured" },
        { status: 500 },
      )
    }

    const { data: createdConv, error: createError } = await supabase
      .from("conversations")
      .insert({
        conversation_type: "order",
        order_id: orderId,
        created_by: userId,
      })
      .select("id")
      .single()

    if (createError) {
      if (isUniqueViolation(createError)) {
        const { data: raced } = await supabase
          .from("conversations")
          .select("id")
          .eq("conversation_type", "order")
          .eq("order_id", orderId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
        conversationId = raced?.id ? String(raced.id) : null
      } else {
        throw createError
      }
    } else {
      conversationId = String(createdConv.id)
      created = true
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "Could not create conversation" },
        { status: 500 },
      )
    }

    await Promise.all([
      ensureParticipant(supabase, conversationId, customerId, customerRoleId),
      ensureParticipant(supabase, conversationId, providerId, providerRoleId),
    ])

    const messages = await loadMessages(
      supabase,
      conversationId,
      userId,
      language,
    )

    return NextResponse.json({
      conversation_id: conversationId,
      order_id: orderId,
      created,
      messages,
    })
  } catch (error) {
    console.error("[chat/order-conversation]", error)
    return NextResponse.json(
      { error: "Failed to open order chat" },
      { status: 500 },
    )
  }
}
