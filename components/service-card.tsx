"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { X, Scissors } from "lucide-react"

interface ServiceCardProps {
  title: string
  subtitle: string
  onCancel?: () => void
  isSearching?: boolean
  className?: string
  icon?: ReactNode
  cancelLabel?: string
}

export default function ServiceCard({ title, subtitle, onCancel, isSearching = false, className, icon, cancelLabel }: ServiceCardProps) {
  return (
    <div className={cn("glass-morphism-strong rounded-2xl p-4 shadow-lg border-0 max-w-sm mx-auto", className)}>
      <div className="flex items-center gap-3">
        {/* Cancel/Close button */}
        {onCancel && (
          <button
            className="h-8 w-8 rounded-full glass-button border-0 text-gray-700 flex-shrink-0 flex items-center justify-center hover:bg-gray-100 transition-colors"
            onClick={onCancel}
            title={cancelLabel}
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Service icon with optional spinner */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 glass-morphism rounded-xl flex items-center justify-center border-0 text-gray-700">
            {icon || <Scissors className="h-5 w-5" />}
          </div>
          {/* Searching spinner overlay */}
          {isSearching && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 border-2 border-gray-200 rounded-full animate-spin border-t-green-500"></div>
            </div>
          )}
        </div>

        {/* Service info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{title}</h3>
          <p className="text-xs text-gray-600 truncate">{subtitle}</p>
        </div>
      </div>
      

    </div>
  )
}
