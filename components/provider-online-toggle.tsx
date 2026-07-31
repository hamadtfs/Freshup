"use client";

import type { MouseEventHandler } from "react";
import { cn } from "@/lib/utils";

export function ProviderOnlineToggle({
  isOnline,
  onlineLabel,
  offlineLabel,
  onClick,
  disabled = false,
  className,
}: {
  isOnline: boolean;
  onlineLabel: string;
  offlineLabel: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "w-full h-11 rounded-2xl flex items-center justify-between px-4 transition-all duration-300 border-0",
        disabled
          ? "glass-morphism-strong opacity-50 cursor-not-allowed"
          : isOnline
            ? "bg-green-500/90 backdrop-blur-md shadow-lg shadow-green-500/20"
            : "glass-morphism-strong",
        onClick && !disabled && "cursor-pointer",
        className,
      )}
      onClick={disabled ? undefined : onClick}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "w-2 h-2 rounded-full transition-colors duration-300",
            disabled
              ? "bg-gray-400"
              : isOnline
                ? "bg-white animate-pulse"
                : "bg-gray-400",
          )}
        />
        <span
          className={cn(
            "text-sm font-medium transition-colors duration-300",
            disabled
              ? "text-gray-500"
              : isOnline
                ? "text-white"
                : "text-gray-700",
          )}
        >
          {isOnline ? onlineLabel : offlineLabel}
        </span>
      </div>
      <div
        className={cn(
          "w-10 h-6 rounded-full relative transition-all duration-300",
          disabled
            ? "bg-gray-300/40"
            : isOnline
              ? "bg-white/30"
              : "bg-gray-300/60",
        )}
      >
        <div
          className={cn(
            "absolute top-1 w-4 h-4 rounded-full shadow transition-all duration-300",
            disabled
              ? "left-1 bg-white/60"
              : isOnline
                ? "right-1 bg-white"
                : "left-1 bg-white/80",
          )}
        />
      </div>
    </button>
  );
}
