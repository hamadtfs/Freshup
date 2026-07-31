import { createAdminClient } from "@/lib/supabase/server";
import { getUserIdFromBearer } from "@/lib/supabase/route-user";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const userId = await getUserIdFromBearer(supabase, req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { order_id, rating, comment } = (await req.json()) as {
      order_id?: string;
      rating?: number;
      comment?: string | null;
    };

    if (!order_id || !rating) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 },
      );
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, customer_id, provider_id")
      .eq("id", order_id)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    let rateeId: string | null = null;
    if (userId === order.customer_id) {
      rateeId = order.provider_id ? String(order.provider_id) : null;
    } else if (userId === order.provider_id) {
      rateeId = order.customer_id ? String(order.customer_id) : null;
    } else {
      return NextResponse.json(
        { error: "You are not part of this order" },
        { status: 403 },
      );
    }

    if (!rateeId) {
      return NextResponse.json(
        { error: "Cannot rate this order" },
        { status: 422 },
      );
    }

    const { error: ratingError } = await supabase.from("ratings").upsert(
      {
        order_id,
        rater_id: userId,
        ratee_id: rateeId,
        rating,
        comment: comment ?? null,
      },
      { onConflict: "order_id,rater_id" },
    );

    if (ratingError) throw ratingError;

    const { data: ratings } = await supabase
      .from("ratings")
      .select("rating")
      .eq("ratee_id", rateeId);

    if (ratings && ratings.length > 0) {
      const avgRating =
        ratings.reduce((sum, r) => sum + Number(r.rating), 0) / ratings.length;
      await supabase
        .from("provider_details")
        .update({
          avg_rating: Math.round(avgRating * 100) / 100,
        })
        .eq("id", rateeId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[ratings/create]", error);
    return NextResponse.json(
      { error: "Failed to create rating" },
      { status: 500 },
    );
  }
}
