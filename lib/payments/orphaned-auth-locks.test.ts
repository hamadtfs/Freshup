import { describe, expect, it } from "vitest";
import { isExpiredOrphanedAuthorizedLock } from "./orphaned-auth-lock-match";

const now = Date.parse("2026-08-12T12:00:00.000Z");

const orphan = {
  id: "lock-1",
  customer_id: "cust-1",
  order_id: null,
  stripe_payment_intent_id: "pi_123",
  payment_authorized_at: "2026-07-08T10:00:00.000Z",
  payment_captured_at: null,
  payment_status: "requires_capture",
  expires_at: "2026-07-08T10:15:00.000Z",
  locked_at: "2026-07-08T10:00:00.000Z",
};

describe("isExpiredOrphanedAuthorizedLock", () => {
  it("matches expired authorised locks with no order (8 Jul / 22 Jul hygiene)", () => {
    expect(isExpiredOrphanedAuthorizedLock(orphan, now)).toBe(true);
    expect(
      isExpiredOrphanedAuthorizedLock(
        { ...orphan, payment_authorized_at: "2026-07-22T09:00:00.000Z", expires_at: "2026-07-22T09:15:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("skips in-flight locks that still have time left", () => {
    expect(
      isExpiredOrphanedAuthorizedLock(
        {
          ...orphan,
          payment_authorized_at: "2026-08-12T11:50:00.000Z",
          expires_at: "2026-08-12T12:05:00.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("skips locks that already have an order, capture, or cancel", () => {
    expect(isExpiredOrphanedAuthorizedLock({ ...orphan, order_id: "ord-1" }, now)).toBe(
      false,
    );
    expect(
      isExpiredOrphanedAuthorizedLock(
        { ...orphan, payment_captured_at: "2026-07-08T10:20:00.000Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isExpiredOrphanedAuthorizedLock({ ...orphan, payment_status: "canceled" }, now),
    ).toBe(false);
  });
});
