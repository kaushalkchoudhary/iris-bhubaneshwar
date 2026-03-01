type IrisEyeMarkProps = {
  size?: number;
  accent?: string;
  className?: string;
  title?: string;
};

export function IrisEyeMark({ size = 24, accent = '#00F0FF', className, title = 'IRIS' }: IrisEyeMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label={title}
      style={{ display: 'block' }}
    >
      <defs>
        <radialGradient id="iris-halo" cx="50%" cy="50%" r="64%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
          <stop offset="62%" stopColor={accent} stopOpacity="0.14" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="iris-eye-fill" x1="14" y1="32" x2="50" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={accent} stopOpacity="0.06" />
          <stop offset="50%" stopColor={accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={accent} stopOpacity="0.06" />
        </linearGradient>
      </defs>

      <circle cx="32" cy="32" r="30" fill="url(#iris-halo)" />

      <path
        d="M32 5 L51 13 L59 32 L51 51 L32 59 L13 51 L5 32 L13 13 Z"
        fill="none"
        stroke={accent}
        strokeOpacity="0.42"
        strokeWidth="2"
      />
      <path
        d="M32 10 L47 17 L54 32 L47 47 L32 54 L17 47 L10 32 L17 17 Z"
        fill="none"
        stroke={accent}
        strokeOpacity="0.28"
        strokeWidth="1.2"
        strokeDasharray="3 4"
      />

      <path
        d="M14 32 Q32 18 50 32 Q32 46 14 32 Z"
        fill="url(#iris-eye-fill)"
        stroke={accent}
        strokeOpacity="0.78"
        strokeWidth="1.7"
      />
      <circle cx="32" cy="32" r="6.8" fill="#050a12" stroke={accent} strokeOpacity="0.85" strokeWidth="1.5" />
      <circle cx="30" cy="29.6" r="1.7" fill="#ffffff" fillOpacity="0.9" />
      <path d="M20 32 H44" stroke={accent} strokeOpacity="0.26" strokeWidth="1" />
    </svg>
  );
}
