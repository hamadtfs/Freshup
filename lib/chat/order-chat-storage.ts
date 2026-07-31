export type OrderChatMessage = {
  id: string;
  text: string;
  sender: "me" | "other";
  time: string;
  at: number;
};

function storageKey(orderId: string) {
  return `freshup.order-chat.${orderId}`;
}

export function loadOrderChatMessages(orderId: string): OrderChatMessage[] {
  if (typeof window === "undefined" || !orderId) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(orderId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OrderChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOrderChatMessages(
  orderId: string,
  messages: OrderChatMessage[],
): void {
  if (typeof window === "undefined" || !orderId) return;
  try {
    window.localStorage.setItem(storageKey(orderId), JSON.stringify(messages));
  } catch {
    // quota / private mode
  }
}

export function appendOrderChatMessage(
  orderId: string,
  text: string,
  sender: "me" | "other",
): OrderChatMessage[] {
  const trimmed = text.trim();
  if (!trimmed) return loadOrderChatMessages(orderId);

  const msg: OrderChatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: trimmed,
    sender,
    time: new Date().toLocaleTimeString("nb-NO", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    at: Date.now(),
  };
  const next = [...loadOrderChatMessages(orderId), msg];
  saveOrderChatMessages(orderId, next);
  return next;
}
