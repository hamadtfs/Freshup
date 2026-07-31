"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

interface SplashScreenProps {
  onComplete: () => void
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [animationStep, setAnimationStep] = useState(0)

  useEffect(() => {
    const timers = [
      setTimeout(() => setAnimationStep(1), 100),   // Arrow appears
      setTimeout(() => setAnimationStep(2), 400),   // Arrow starts moving up
      setTimeout(() => setAnimationStep(3), 1200),  // Arrow fades out
      setTimeout(() => onComplete(), 1600),
    ]
    return () => timers.forEach(clearTimeout)
  }, [onComplete])

  return (
    <main className="mx-auto h-[100dvh] w-full max-w-md relative overflow-hidden flex items-center justify-center bg-white">
      {/* Arrow pill animation only - black and white */}
      <div 
        className={cn(
          "absolute left-1/2 -translate-x-1/2 transition-all duration-800 ease-out",
          animationStep === 0 ? "bottom-8 opacity-0 scale-90" : "",
          animationStep === 1 ? "bottom-8 opacity-100 scale-100" : "",
          animationStep >= 2 ? "bottom-[50%] translate-y-[50%] opacity-100" : "",
          animationStep >= 3 ? "opacity-0 scale-110" : ""
        )}
      >
        <div 
          className={cn(
            "w-14 rounded-full bg-black flex flex-col items-center overflow-hidden transition-all duration-800",
            animationStep >= 2 ? "h-20" : "h-32"
          )}
        >
          <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center mt-2 flex-shrink-0">
            <svg 
              width="18" 
              height="18" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="black" 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </div>
        </div>
      </div>
    </main>
  )
}
