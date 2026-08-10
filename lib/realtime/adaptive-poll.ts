/**
 * Poll timer that slows down while a Supabase realtime channel is delivering
 * events, so HTTP polling stays a fallback instead of a parallel data source.
 *
 * Start it in fallback cadence, then feed it the channel's subscribe status.
 */

/** Safety-net cadence for data that already arrives over realtime. */
export const REALTIME_SAFETY_POLL_MS = 60_000;

/** Safety-net cadence for chat, where a missed message is user visible. */
export const REALTIME_CHAT_SAFETY_POLL_MS = 20_000;

export type AdaptivePoll = {
  /**
   * Report channel health. Passing `true` switches to the slow cadence;
   * `false` restores the fast fallback cadence and runs `run()` immediately.
   */
  setRealtimeConnected: (connected: boolean) => void;
  /** Run now and reset the timer (e.g. tab focus). */
  runNow: () => void;
  stop: () => void;
};

export function createAdaptivePoll(options: {
  run: () => void;
  /** Cadence while realtime is down or not yet subscribed. */
  fallbackMs: number;
  /** Cadence while realtime is subscribed. */
  connectedMs?: number;
  /**
   * Start on the slow (connected) cadence and only switch to `fallbackMs`
   * after a realtime failure. Prefer this when a channel is about to join,
   * so you don't hammer HTTP for the first few seconds of every mount.
   */
  assumeConnected?: boolean;
}): AdaptivePoll {
  const { run, fallbackMs } = options;
  const connectedMs = options.connectedMs ?? REALTIME_SAFETY_POLL_MS;

  let timer: ReturnType<typeof setInterval> | null = null;
  let connected = Boolean(options.assumeConnected);
  let stopped = false;

  const arm = (intervalMs: number) => {
    if (timer) clearInterval(timer);
    timer = setInterval(run, intervalMs);
  };

  arm(connected ? connectedMs : fallbackMs);

  return {
    setRealtimeConnected(next: boolean) {
      if (stopped || next === connected) return;
      connected = next;
      arm(next ? connectedMs : fallbackMs);
      // Realtime just dropped: close the gap before the next tick.
      if (!next) run();
    },
    runNow() {
      if (stopped) return;
      arm(connected ? connectedMs : fallbackMs);
      run();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

/** Supabase channel statuses that mean realtime is no longer delivering. */
export function isRealtimeDownStatus(status: string): boolean {
  return (
    status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED"
  );
}
