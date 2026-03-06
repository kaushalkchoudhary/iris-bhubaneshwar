import { cn } from "@/lib/utils";

interface HudBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "success" | "warning" | "danger" | "info" | "secondary" | "default" | "high" | "medium" | "low";
  size?: "sm" | "md" | "xs";
}

const variantStyles: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-400 border-0",
  warning: "bg-amber-500/20 text-amber-400 border-0",
  danger: "bg-red-500/20 text-red-400 border-0",
  info: "bg-blue-500/20 text-blue-400 border-0",
  secondary: "bg-zinc-500/20 text-zinc-400 border-0",
  default: "bg-indigo-500/20 text-indigo-400 border-0",
  high: "bg-red-500/20 text-red-400 border-0 font-bold",
  medium: "bg-amber-500/20 text-amber-400 border-0 font-bold",
  low: "bg-emerald-500/20 text-emerald-400 border-0 font-bold",
};

const sizeStyles: Record<string, string> = {
  xs: "text-[8px] px-1.5 py-0.5",
  sm: "text-[9px] px-2 py-0.5",
  md: "text-xs px-2.5 py-1",
};

export function HudBadge({
  variant = "default",
  size = "sm",
  className,
  children,
  ...props
}: HudBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center whitespace-nowrap font-semibold rounded",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
