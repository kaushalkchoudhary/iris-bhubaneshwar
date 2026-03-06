import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap font-semibold text-[9px] px-1.5 py-0.5 shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-indigo-500/90 to-indigo-700/20 text-indigo-100 border border-indigo-500/60",
        secondary:
          "bg-gradient-to-b from-zinc-500/90 to-zinc-700/20 text-zinc-200 border border-zinc-500/60",
        destructive:
          "bg-gradient-to-b from-red-500/90 to-red-700/20 text-red-100 border border-red-500/60",
        outline:
          "bg-transparent text-zinc-400 border border-zinc-600",
        success:
          "bg-gradient-to-b from-emerald-500/90 to-emerald-700/20 text-emerald-100 border border-emerald-500/60",
        warning:
          "bg-gradient-to-b from-amber-500/90 to-amber-700/20 text-amber-100 border border-amber-500/60",
        info:
          "bg-gradient-to-b from-blue-500/90 to-blue-700/20 text-blue-100 border border-blue-500/60",
        indigo:
          "bg-gradient-to-b from-indigo-500/90 to-indigo-700/20 text-indigo-100 border border-indigo-500/60",
        orange:
          "bg-gradient-to-b from-orange-500/90 to-orange-700/20 text-orange-100 border border-orange-500/60",
        // FRS specific variants
        threatHigh:
          "bg-red-500/20 text-red-400 border-0 font-bold",
        threatMedium:
          "bg-amber-500/20 text-amber-400 border-0 font-bold",
        threatLow:
          "bg-emerald-500/20 text-emerald-400 border-0 font-bold",
        category:
          "bg-primary/15 text-primary/90 border-0 font-mono text-[8px]",
        watchlist:
          "bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[8px]",
        active:
          "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[8px]",
        inactive:
          "bg-zinc-500/15 text-zinc-400 border border-zinc-500/30 text-[8px]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
