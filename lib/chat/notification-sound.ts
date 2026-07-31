/** Short two-tone notification chime for incoming chat messages. */
let sharedCtx: AudioContext | null = null
const lastPlayedAtByKey = new Map<string, number>()
const DEDUPE_MS = 1500

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctx) return null
  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new Ctx()
  }
  return sharedCtx
}

function tone(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  gainValue: number,
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = "sine"
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

/**
 * Plays a soft "ding-dong" when a new message arrives from someone else.
 * `dedupeKey` avoids double-playing when realtime + poll both deliver the same message.
 */
export function playIncomingMessageBell(dedupeKey?: string) {
  try {
    if (dedupeKey) {
      const now = Date.now()
      const last = lastPlayedAtByKey.get(dedupeKey) ?? 0
      if (now - last < DEDUPE_MS) return
      lastPlayedAtByKey.set(dedupeKey, now)
      if (lastPlayedAtByKey.size > 100) {
        const oldest = lastPlayedAtByKey.keys().next().value
        if (oldest) lastPlayedAtByKey.delete(oldest)
      }
    }

    const ctx = getAudioContext()
    if (!ctx) return
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {})
    }

    const t0 = ctx.currentTime + 0.01
    tone(ctx, 880, t0, 0.14, 0.08)
    tone(ctx, 1174.66, t0 + 0.12, 0.22, 0.06)
  } catch {
    // Audio may be blocked until a user gesture; fail silently.
  }
}
