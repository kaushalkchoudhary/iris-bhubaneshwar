import { cn } from "@/lib/utils";

interface HudBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "success" | "warning" | "danger" | "info" | "secondary" | "default";
  size?: "sm" | "md";
}

const variantStyles: Record<string, string> = {
  success: "iris-cut-tag iris-cut-tag-success",
  warning: "iris-cut-tag iris-cut-tag-warning",
  danger: "iris-cut-tag iris-cut-tag-danger",
  info: "iris-cut-tag iris-cut-tag-info",
  secondary: "iris-cut-tag iris-cut-tag-secondary",
  default: "iris-cut-tag iris-cut-tag-default",
};

const sizeStyles: Record<string, string> = {
  sm: "text-[10px] px-2 py-0.5 tracking-wider",
  md: "text-xs px-2.5 py-1 tracking-wider",
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
        "inline-flex items-center whitespace-nowrap font-mono font-semibold border iris-cut-tag-base",
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
