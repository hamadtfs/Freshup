"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  formatMmSs,
  readyForNextRemainingMs,
  readyForNextWaitMs,
} from "@/lib/orders/readyForNext";
import { Lock } from "lucide-react";

export function ReadyForNextLockedButton({
  serviceStartedAtIso,
  typicalDurationMinutes,
  nowMs,
  label,
  hint,
  unlocksInLabel,
  className,
  size = "md",
  onActivate,
}: {
  serviceStartedAtIso: string | null;
  typicalDurationMinutes: number;
  nowMs: number;
  label: string;
  hint: string;
  unlocksInLabel: string;
  className?: string;
  size?: "sm" | "md";
  onActivate: () => void;
}) {
  const totalWaitMs = readyForNextWaitMs(typicalDurationMinutes);
  const remainingMs = readyForNextRemainingMs(
    serviceStartedAtIso,
    typicalDurationMinutes,
    nowMs,
  );
  const unlocked = remainingMs <= 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  const elapsedMs = Math.max(0, totalWaitMs - remainingMs);
  const fillPct = unlocked
    ? 100
    : Math.min(100, (elapsedMs / totalWaitMs) * 100);
  const heightClass = size === "sm" ? "h-10 text-sm" : "h-11 text-sm";
  const lockedMinH = size === "sm" ? "min-h-[48px]" : "min-h-[52px]";

  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-xs text-gray-600 px-0.5 leading-snug">{hint}</p>

      {unlocked ? (
        <Button
          type="button"
          className={cn(
            "w-full bg-green-500 hover:bg-green-600 text-white font-semibold rounded-xl border-0 shadow-sm",
            heightClass,
          )}
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
          }}
        >
          {label}
        </Button>
      ) : (
        <div
          className={cn(
            "relative w-full rounded-xl overflow-hidden glass-morphism-strong border-0 shadow-sm",
            lockedMinH,
          )}
          aria-disabled
          aria-live="polite"
          aria-label={`${unlocksInLabel} ${formatMmSs(remainingSec)}`}
        >
          <div className="flex items-center justify-center gap-2.5 px-4 py-2.5 pb-3.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/30">
              <Lock className="h-3.5 w-3.5 text-gray-700" aria-hidden />
            </div>
            <div className="flex min-w-0 flex-col items-start">
              <span className="text-[11px] font-medium leading-none text-gray-600">
                {unlocksInLabel}
              </span>
              <span className="mt-1 text-xl font-bold leading-none tabular-nums tracking-tight text-gray-900">
                {formatMmSs(remainingSec)}
              </span>
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-200/80">
            <div
              className="h-full bg-green-500 transition-[width] duration-1000 ease-linear"
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
