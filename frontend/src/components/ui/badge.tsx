import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap font-mono font-semibold border [clip-path:polygon(0_0,100%_0,100%_70%,calc(100%-6px)_100%,0_100%)] text-[10px] px-2 py-0.5 tracking-wider",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-b from-indigo-500/90 to-indigo-700/20 text-indigo-100 border-indigo-500/60",
        secondary:
          "bg-gradient-to-b from-zinc-500/90 to-zinc-700/20 text-zinc-200 border-zinc-500/60",
        destructive:
          "bg-gradient-to-b from-red-500/90 to-red-700/20 text-red-100 border-red-500/60",
        outline:
          "bg-gradient-to-b from-zinc-500/90 to-zinc-700/20 text-zinc-200 border-zinc-500/60",
        success:
          "bg-gradient-to-b from-emerald-500/90 to-emerald-700/20 text-emerald-100 border-emerald-500/60",
        warning:
          "bg-gradient-to-b from-amber-500/90 to-amber-700/20 text-amber-100 border-amber-500/60",
        info:
          "bg-gradient-to-b from-blue-500/90 to-blue-700/20 text-blue-100 border-blue-500/60",
        indigo:
          "bg-gradient-to-b from-indigo-500/90 to-indigo-700/20 text-indigo-100 border-indigo-500/60",
        orange:
          "bg-gradient-to-b from-orange-500/90 to-orange-700/20 text-orange-100 border-orange-500/60",
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
