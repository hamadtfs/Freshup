import type { BookOrderRequestBody } from "@/lib/customer/types"

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) {
    const msg = typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : res.statusText
    throw new Error(msg)
  }
  return data as T
}

export async function fetchServiceAddons(serviceId: string) {
  const res = await fetch(`/api/services/addons?service_id=${encodeURIComponent(serviceId)}`)
  return parseJson<{ addons: unknown[] }>(res)
}

export async function postBookOrder(accessToken: string, body: BookOrderRequestBody) {
  const res = await fetch("/api/orders/book", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  return parseJson<{
    success: boolean
    order_id: string
    service: { id: string; name: string; duration_minutes: number; base_price: number; total_price: number }
    providers_notified: number
    expires_at: string
  }>(res)
}
