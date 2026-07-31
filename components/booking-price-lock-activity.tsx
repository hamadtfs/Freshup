"use client";

import { Check, Loader2 } from "lucide-react";

type Phase = "calculating" | "finding" | "ready";

export default function BookingPriceLockActivity({
  phase,
  language = "no",
}: {
  phase: Phase;
  language?: "no" | "en";
}) {
  const isEn = language === "en";
  const steps = [
    {
      key: "calculating" as const,
      label: isEn ? "Calculating your price" : "Beregner prisen din",
    },
    {
      key: "finding" as const,
      label: isEn ? "Finding nearby providers" : "Finner tilbydere i nærheten",
    },
    {
      key: "ready" as const,
      label: isEn ? "Price confirmed" : "Pris bekreftet",
    },
  ];

  const phaseRank = (key: Phase) =>
    key === "calculating" ? 0 : key === "finding" ? 1 : 2;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white/70 px-3 py-3 space-y-2">
      {steps.map((step) => {
        const done = phaseRank(phase) > phaseRank(step.key);
        const active = phase === step.key;
        return (
          <div key={step.key} className="flex items-center gap-2.5 text-sm">
            <div
              className={
                done
                  ? "flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-white"
                  : active
                    ? "flex h-5 w-5 items-center justify-center text-gray-700"
                    : "flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-transparent"
              }
            >
              {done ? (
                <Check className="h-3.5 w-3.5" />
              ) : active ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
            </div>
            <span
              className={
                done || active
                  ? "font-medium text-gray-900"
                  : "text-gray-400"
              }
            >
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
