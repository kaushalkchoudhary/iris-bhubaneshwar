import { motion } from "framer-motion";
import { useTheme } from "@/contexts/ThemeContext";
import { HyperText } from "@/components/ui/hyper-text";

interface StatusProps {
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "warning";
  scale?: number;
  text?: string;
  customColors?: {
    gradientStart?: string;
    gradientEnd?: string;
    stroke?: string;
    text?: string;
  };
}

export function Status({
  className,
  variant = "primary",
  scale = 1,
  text = "Active",
  customColors
}: StatusProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const getColors = () => {
    if (customColors) {
      return {
        gradientStart: customColors.gradientStart || (isDark ? "#4ade80" : "#16a34a"),
        gradientEnd: customColors.gradientEnd || (isDark ? "#15803d" : "#166534"),
        stroke: customColors.stroke || (isDark ? "#4ade80" : "#16a34a"),
        text: customColors.text || (isDark ? "text-green-300" : "text-white/80")
      };
    }

    switch (variant) {
      case "primary":
        return {
          gradientStart: isDark ? "#4ade80" : "#16a34a",
          gradientEnd: isDark ? "#15803d" : "#166534",
          stroke: isDark ? "#4ade80" : "#16a34a",
          text: isDark ? "text-green-300" : "text-white/80"
        };
      case "secondary":
        return {
          gradientStart: isDark ? "#64748b" : "#374151",
          gradientEnd: isDark ? "#334155" : "#1f2937",
          stroke: isDark ? "#64748b" : "#374151",
          text: isDark ? "text-slate-300" : "text-white/80"
        };
      case "danger":
        return {
          gradientStart: isDark ? "#f87171" : "#dc2626",
          gradientEnd: isDark ? "#b91c1c" : "#991b1b",
          stroke: isDark ? "#f87171" : "#dc2626",
          text: isDark ? "text-red-300" : "text-white/80"
        };
      case "warning":
        return {
          gradientStart: isDark ? "#fbbf24" : "#d97706",
          gradientEnd: isDark ? "#b45309" : "#92400e",
          stroke: isDark ? "#fbbf24" : "#d97706",
          text: isDark ? "text-amber-300" : "text-white/80"
        };
      default:
        return {
          gradientStart: isDark ? "#4ade80" : "#16a34a",
          gradientEnd: isDark ? "#15803d" : "#166534",
          stroke: isDark ? "#4ade80" : "#16a34a",
          text: isDark ? "text-green-300" : "text-white/80"
        };
    }
  };

  const colors = getColors();

  // Unique gradient ID to avoid SVG ID collisions when multiple Status components render
  const gradientId = `statusGradient-${variant}-${text.replace(/\s/g, '')}`;

  const containerVariants = {
    hidden: {
      opacity: 0,
      x: -100,
      scale: scale
    },
    visible: {
      opacity: 1,
      x: 0,
      scale: scale,
      transition: {
        duration: 0.8,
        ease: "easeOut" as const
      }
    }
  };

  return (
    <motion.div
      className={`relative ${className || ''}`}
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      style={{ transformOrigin: "left center" }}
    >
      <div className="relative">
        <svg
          width="180"
          height="36"
          viewBox="0 0 180 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={colors.gradientStart} stopOpacity="0.9" />
              <stop offset="100%" stopColor={colors.gradientEnd} stopOpacity="0.1" />
            </linearGradient>
          </defs>
          <path
            d="M0 0H180V24H8L0 16V0Z"
            fill={`url(#${gradientId})`}
            stroke={colors.stroke}
            strokeWidth="1.5"
          />
        </svg>

        <div className="absolute inset-0 flex items-center justify-start pl-4 pb-3">
          <HyperText
            text={text}
            className={`${colors.text} text-sm font-mono tracking-wider font-semibold`}
            duration={1000}
            animateOnLoad={true}
            trigger={true}
          />
        </div>
      </div>
    </motion.div>
  );
}
