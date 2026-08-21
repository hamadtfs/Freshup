"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────
 * LOADING STATE — pixel-grid loader for async FreshUp work
 *
 * Variants:
 *   Drive — square cells, chevron wavefront
 *   Dots  — same wavefront, circular cells
 *   Orbit — comet lapping the grid perimeter
 *
 * Compact by default (no timer). Pass showTimer for longer
 * ops such as price lock.
 * ───────────────────────────────────────────────────────── */

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];

const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<
  string,
  { delays: (number | null)[]; dur: number; round: boolean }
> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export type LoadingStateVariant = "Drive" | "Dots" | "Orbit";

function useElapsed(enabled: boolean) {
  const [ds, setDs] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, [enabled]);

  if (!enabled) return null;

  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export type LoadingStateProps = {
  label?: string;
  variant?: LoadingStateVariant;
  /** Live elapsed timer — useful for longer ops (price lock). */
  showTimer?: boolean;
  /** sm = card/inline; md = banner/sheet. */
  size?: "sm" | "md";
  className?: string;
};

export default function LoadingState({
  label = "Loading",
  variant = "Drive",
  showTimer = false,
  size = "md",
  className,
}: LoadingStateProps) {
  const elapsed = useElapsed(showTimer);
  const { delays, dur, round } = PATTERNS[variant] ?? PATTERNS.Drive;
  const cell = size === "sm" ? "size-[3px]" : "size-[4px]";
  const gap = size === "sm" ? "gap-[1px]" : "gap-[1.5px]";
  const labelSize = size === "sm" ? "text-[11px]" : "text-[13px]";

  return (
    <div
      className={cn(
        "flex w-fit max-w-full items-center gap-2",
        size === "sm" && "gap-1.5",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span
        aria-hidden
        className={cn("grid shrink-0", gap)}
        style={{
          gridTemplateColumns:
            size === "sm" ? "repeat(3, 3px)" : "repeat(3, 4px)",
        }}
      >
        {delays.map((d, i) => (
          <span
            key={i}
            className={cn(
              cell,
              "bg-foreground",
              round ? "rounded-full" : "rounded-[1px]",
            )}
            style={{
              opacity: d === null ? 0.07 : 0.15,
              animation:
                d === null
                  ? "none"
                  : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>

      {label ? (
        <span
          className={cn(
            "bg-clip-text font-medium text-transparent truncate",
            labelSize,
          )}
          style={{
            backgroundImage:
              "linear-gradient(90deg, var(--muted-foreground) 35%, var(--foreground) 50%, var(--muted-foreground) 65%)",
            backgroundSize: "200% 100%",
            animation: "shimmer-text 1.4s linear infinite",
          }}
        >
          {label}
        </span>
      ) : null}

      {showTimer && elapsed ? (
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums shrink-0">
          {elapsed}
        </span>
      ) : null}
    </div>
  );
}
