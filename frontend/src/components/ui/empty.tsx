import * as React from "react"
import { cn } from "@/lib/utils"

const Empty = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-1 h-full min-h-[200px] flex-col items-center justify-center gap-2 p-8 text-center",
      className
    )}
    {...props}
  />
))
Empty.displayName = "Empty"

const EmptyIcon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.03] border border-white/[0.06] text-zinc-500 [&>svg]:h-6 [&>svg]:w-6",
      className
    )}
    {...props}
  />
))
EmptyIcon.displayName = "EmptyIcon"

const EmptyTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-sm font-medium text-zinc-300", className)}
    {...props}
  />
))
EmptyTitle.displayName = "EmptyTitle"

const EmptyDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-xs text-zinc-500 max-w-[280px]", className)}
    {...props}
  />
))
EmptyDescription.displayName = "EmptyDescription"

const EmptyActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("mt-2 flex items-center gap-2", className)}
    {...props}
  />
))
EmptyActions.displayName = "EmptyActions"

export { Empty, EmptyIcon, EmptyTitle, EmptyDescription, EmptyActions }
